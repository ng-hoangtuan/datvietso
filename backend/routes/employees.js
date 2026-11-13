const express = require('express');
const { getClient } = require('../db/mongo');
const { assetService, AssetError, toId } = require('../services/assets');

/**
 * Offboarding — Luồng 4 của đặc tả.
 *
 * Hai endpoint: xem trước nhân sự đang giữ gì, rồi thực thi thu hồi hàng loạt.
 * Tách riêng vì đây là thao tác theo CON NGƯỜI, không theo tài sản.
 */
module.exports = function (db, io) {
    const router = express.Router();
    const svc = assetService(db);
    const users = db.collection('users');

    const handle = (fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            if (err instanceof AssetError) return res.status(err.status).json({ error: err.message });
            console.error('[employees]', err);
            res.status(500).json({ error: err.message });
        }
    };

    const HR_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER'];

    async function requireActor(req, roles = null) {
        const actorId = toId(req.body?.actorId || req.query?.actorId);
        if (!actorId) throw new AssetError('Thiếu actorId', 401);

        const u = await users.findOne({ _id: actorId }, { projection: { fullName: 1, role: 1, status: 1 } });
        if (!u) throw new AssetError('Người thao tác không tồn tại', 401);
        if (u.status !== 'ACTIVE') throw new AssetError('Tài khoản đang bị khóa', 403);
        if (roles && !roles.includes(u.role)) {
            throw new AssetError(`Chỉ ${roles.join(' / ')} mới được thao tác (bạn là ${u.role})`, 403);
        }

        return { id: u._id, name: u.fullName, role: u.role };
    }

    // GET /api/employees/:id/offboarding-summary
    // Xem trước: nhân sự đang giữ thiết bị nào, license nào, có tài khoản dùng
    // chung nào đang chặn việc hoàn tất không.
    router.get('/:id/offboarding-summary', handle(async (req, res) => {
        await requireActor(req, HR_ROLES);
        const summary = await svc.offboardingSummary(req.params.id);

        res.json({
            ...summary,
            // Đặc tả: khóa nút hoàn tất cho tới khi IT xác nhận đã đổi mật khẩu gốc
            canComplete: summary.blockingSharedAccounts === 0,
            blockReason: summary.blockingSharedAccounts > 0
                ? `Đang giữ ${summary.blockingSharedAccounts} tài khoản dùng chung — `
                  + 'phải đổi mật khẩu gốc và tick xác nhận trước khi hoàn tất.'
                : null,
        });
    }));

    // POST /api/employees/:id/offboard-execute
    router.post('/:id/offboard-execute', handle(async (req, res) => {
        const actor = await requireActor(req, HR_ROLES);

        const result = await svc.offboardExecute(getClient(), req.params.id, {
            ...req.body,
            revokedBy: actor.id,
            actorName: actor.name,
        });

        if (io) {
            // Báo cho IT biết còn việc phải làm bên Admin Center của hãng
            io.emit('asset_offboard_done', {
                employee: result.employee,
                revokedUserLicenses: result.userLicenses,
                at: new Date(),
            });
        }

        res.json({
            message: `Đã hoàn tất offboarding cho ${result.employee.name}`,
            ...result,
            reminder: result.userLicenses > 0
                ? `Nhớ vào Admin Center của hãng cắt quyền truy cập cho ${result.employee.email || result.employee.name}.`
                : null,
        });
    }));

    router.svc = svc;

    return router;
};
