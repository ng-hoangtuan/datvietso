const express = require('express');
const { getClient } = require('../db/mongo');
const { assetService, AssetError, toId } = require('../services/assets');

/**
 * Phiếu cấp phát — Luồng 2, 3, 5 của đặc tả.
 *
 * Mọi thao tác thay đổi kho đều gọi xuống `services/assets.js` và chạy trong
 * transaction ở đó. Route không tự `updateOne` vào collection tài sản, nếu
 * không ba bất biến ở đầu service sẽ vỡ ở chỗ không ai ngờ.
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
            console.error('[assignments]', err);
            res.status(500).json({ error: err.message });
        }
    };

    const IT_ROLES = ['SUPER_ADMIN', 'ADMIN'];

    /** Xem ghi chú requireActor ở routes/assets.js — đây KHÔNG phải xác thực thật. */
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

    /**
     * Báo cho nhân sự qua Chat khi được cấp tài sản.
     *
     * CỐ Ý KHÔNG gửi key / mật khẩu vào nội dung tin nhắn. Tin chat lưu plaintext
     * vĩnh viễn trong `messages.content`, ai trong phòng cũng đọc được, kể cả sau
     * khi người đó nghỉ việc — làm vậy thì công mã hoá AES bằng không.
     * Chỉ báo có gì đang chờ; muốn xem key thì vào trang tài sản, đi qua
     * reveal-secret và được ghi log.
     * Xem Docs/danh-gia-dac-ta-tai-san-so.md mục 2.2.
     */
    function notifyEmployee(employeeId, lines) {
        if (!io || !employeeId) return;

        io.to(`user_${String(employeeId)}`).emit('asset_notification', {
            title: 'Bạn vừa được cấp phát tài sản',
            lines,
            createdAt: new Date(),
        });
    }

    const mapAssignment = (a) => ({
        id: String(a._id),
        assignmentType: a.assignmentType,
        employeeId: String(a.employeeId),
        employeeName: a.employeeName,
        employeeEmail: a.employeeEmail,
        physicalAssetId: a.physicalAssetId ? String(a.physicalAssetId) : null,
        digitalAssetId: a.digitalAssetId ? String(a.digitalAssetId) : null,
        allocatedKeyId: a.allocatedKeyId ? String(a.allocatedKeyId) : null,
        assignedIdentifier: a.assignedIdentifier,
        accessScope: a.accessScope,
        status: a.status,
        holderReleased: !!a.holderReleased,
        assignedBy: String(a.assignedBy),
        assignedAt: a.assignedAt,
        activatedAt: a.activatedAt,
        handoverConditionNote: a.handoverConditionNote,
        revokedAt: a.revokedAt,
        revokeReason: a.revokeReason,
        returnConditionNote: a.returnConditionNote,
        keyReturnedToPool: a.keyReturnedToPool,
        note: a.note,
    });

    // GET /api/assignments?employeeId=&status=&type=
    router.get('/', handle(async (req, res) => {
        const { employeeId, status, type, physicalAssetId, digitalAssetId } = req.query;
        const filter = {};
        if (employeeId) filter.employeeId = toId(employeeId);
        if (physicalAssetId) filter.physicalAssetId = toId(physicalAssetId);
        if (digitalAssetId) filter.digitalAssetId = toId(digitalAssetId);
        if (status && status !== 'ALL') {
            filter.status = status === 'OPEN' ? { $in: svc.HOLDING_STATUSES } : status;
        }
        if (type && type !== 'ALL') filter.assignmentType = type;

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
        const rows = await svc.assignments.find(filter).sort({ assignedAt: -1 }).limit(limit).toArray();

        res.json(rows.map(mapAssignment));
    }));

    // POST /api/assignments/physical — bàn giao một thiết bị
    router.post('/physical', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const doc = await svc.assignPhysical(getClient(), {
            ...req.body,
            assignedBy: actor.id,
            actorName: actor.name,
        });

        notifyEmployee(doc.employeeId, ['Bạn vừa được bàn giao 1 thiết bị. Mở trang Tài sản để xác nhận.']);
        res.status(201).json(mapAssignment(doc));
    }));

    // POST /api/assignments/digital — cấp một bản quyền / tài khoản
    router.post('/digital', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const doc = await svc.assignDigital(getClient(), {
            ...req.body,
            assignedBy: actor.id,
            actorName: actor.name,
        });

        notifyEmployee(doc.employeeId, [
            doc.status === 'pending_activation'
                ? 'Bạn vừa được cấp 1 bản quyền, cần xác nhận kích hoạt.'
                : 'Bạn vừa được cấp 1 bản quyền.',
        ]);
        res.status(201).json(mapAssignment(doc));
    }));

    // POST /api/assignments/handover-bundle — Luồng 2, cấp trọn gói 1 transaction
    router.post('/handover-bundle', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const created = await svc.handoverBundle(getClient(), {
            ...req.body,
            assignedBy: actor.id,
            actorName: actor.name,
        });

        const needActivation = created.filter((c) => c.status === 'pending_activation').length;
        if (created.length > 0) {
            notifyEmployee(created[0].employeeId, [
                `Bạn vừa được cấp phát ${created.length} tài sản.`,
                ...(needActivation ? [`${needActivation} mục cần bạn xác nhận kích hoạt.`] : []),
            ]);
        }

        res.status(201).json({
            created: created.map(mapAssignment),
            total: created.length,
            pendingActivation: needActivation,
        });
    }));

    // PATCH /api/assignments/:id/confirm-activation — nhân sự tự xác nhận
    router.patch('/:id/confirm-activation', handle(async (req, res) => {
        // Không giới hạn vai trò: đây là thao tác của chính nhân sự nhận tài sản.
        // Service đã chặn người khác xác nhận hộ (employeeId nằm trong filter).
        const userId = toId(req.body.userId || req.body.actorId);
        if (!userId) throw new AssetError('Thiếu userId', 401);

        const doc = await svc.confirmActivation(req.params.id, userId);
        res.json(mapAssignment(doc));
    }));

    // POST /api/assignments/:id/revoke — thu hồi đơn lẻ (Luồng 3)
    router.post('/:id/revoke', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const doc = await svc.revokeAssignment(getClient(), req.params.id, {
            ...req.body,
            revokedBy: actor.id,
            actorName: actor.name,
        });

        res.json({
            message: 'Đã thu hồi',
            keyReturnedToPool: doc.keyReturnedToPool,
            assignment: mapAssignment(doc),
        });
    }));

    // POST /api/assignments/transfer-device — Luồng 3 bước 3 / Quy tắc 2
    // Giao máy nguyên trạng cho người khác, giữ nguyên key đã cài.
    router.post('/transfer-device', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const created = await svc.transferDeviceLicenses(getClient(), {
            ...req.body,
            assignedBy: actor.id,
            actorName: actor.name,
        });

        res.json({
            message: created.length
                ? `Đã chuyển ${created.length} bản quyền trên máy sang người giữ mới`
                : 'Máy này không có bản quyền nào gắn theo thiết bị',
            transferred: created.map(mapAssignment),
        });
    }));

    router.svc = svc;

    return router;
};
