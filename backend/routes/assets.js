const express = require('express');
const { getClient } = require('../db/mongo');
const { assetService, AssetError, toId } = require('../services/assets');
const { decrypt, maskKey, isConfigured } = require('../services/assetCrypto');
const { blockInDemo, isDemoMode } = require('../middleware/auth');

/**
 * Kho tài sản: thiết bị vật lý và tài sản số.
 *
 * Nghiệp vụ nằm ở `services/assets.js`; file này lo kiểm tra quyền, dựng
 * response và biến `AssetError` thành mã HTTP.
 *
 * Phiếu cấp phát ở `routes/assignments.js`, offboarding ở `routes/employees.js`
 * — tách theo đúng ba nhóm URL mà đặc tả mục 5.1 đặt ra.
 */
module.exports = function (db) {
    const router = express.Router();
    const svc = assetService(db);
    const users = db.collection('users');

    /** Bọc handler async: lỗi nghiệp vụ ra đúng status, lỗi lạ thì 500 + log. */
    const handle = (fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            if (err instanceof AssetError) {
                return res.status(err.status).json({ error: err.message });
            }
            // Trùng khóa: assetCode / serialNumber đã tồn tại
            if (err.code === 11000) {
                const field = Object.keys(err.keyPattern || {})[0] || 'giá trị';

                return res.status(409).json({ error: `Trùng ${field}, đã có tài sản khác dùng giá trị này` });
            }
            console.error('[assets]', err);
            res.status(500).json({ error: err.message });
        }
    };

    /**
     * Người thao tác, lấy từ `actorId` client gửi lên.
     *
     * CẢNH BÁO: đây KHÔNG phải xác thực thật. Token của hệ thống chưa được ký
     * (MONGODB.md mục 7) nên client khai gì thì tin nấy. Hàm này chặn được thao
     * tác sai vai trò do nhầm lẫn, không chặn được người cố tình giả mạo.
     * Xem Docs/danh-gia-dac-ta-tai-san-so.md mục 2.1.
     */
    async function requireActor(req, roles = null) {
        const actorId = toId(req.body?.actorId || req.query?.actorId);
        if (!actorId) throw new AssetError('Thiếu actorId — không xác định được người thao tác', 401);

        const u = await users.findOne({ _id: actorId }, { projection: { fullName: 1, role: 1, status: 1 } });
        if (!u) throw new AssetError('Người thao tác không tồn tại', 401);
        if (u.status !== 'ACTIVE') throw new AssetError('Tài khoản đang bị khóa', 403);

        if (roles && !roles.includes(u.role)) {
            throw new AssetError(
                `Chỉ ${roles.join(' / ')} mới được thực hiện thao tác này (bạn đang là ${u.role})`,
                403,
            );
        }

        return { id: u._id, name: u.fullName, role: u.role };
    }

    const IT_ROLES = ['SUPER_ADMIN', 'ADMIN'];

    const escapeRx = (s) => String(s).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // -----------------------------------------------------------------------
    // Hình dạng dữ liệu trả về
    // -----------------------------------------------------------------------

    const mapPhysical = (p) => ({
        id: String(p._id),
        assetCode: p.assetCode,
        serialNumber: p.serialNumber,
        name: p.name,
        category: p.category,
        specs: p.specs,
        // Chỉ báo CÓ key OEM hay không — không bao giờ kèm bản mã trong danh sách
        bundledOemLicense: {
            hasOem: !!(p.bundledOemLicense && p.bundledOemLicense.hasOem),
            osName: (p.bundledOemLicense && p.bundledOemLicense.osName) || null,
            hasStoredKey: !!(p.bundledOemLicense && p.bundledOemLicense.encryptedKey),
        },
        condition: p.condition,
        status: p.status,
        currentHolderId: p.currentHolderId ? String(p.currentHolderId) : null,
        currentHolderName: p.currentHolderName || null,
        assignedAt: p.assignedAt,
        purchaseDate: p.purchaseDate,
        warrantyExpiry: p.warrantyExpiry,
        cost: p.cost ? Number(p.cost.toString()) : 0,
        note: p.note,
        updatedAt: p.updatedAt,
    });

    /**
     * Tài sản số. KHÔNG trả `encryptedSecret` và `encryptedKey` ra ngoài — kể cả
     * dạng bản mã. Muốn xem thì gọi reveal-secret và chịu ghi log.
     */
    const mapDigital = (d) => ({
        id: String(d._id),
        parentAssetId: d.parentAssetId ? String(d.parentAssetId) : null,
        isContainerOnly: !!d.isContainerOnly,
        name: d.name,
        provider: d.provider,
        packagingType: d.packagingType,
        fulfillmentMethod: d.fulfillmentMethod,
        bindingTarget: d.bindingTarget,
        isKeyReusable: d.isKeyReusable !== false,
        totalSeats: d.totalSeats === null || d.totalSeats === undefined ? null : d.totalSeats,
        usedSeats: d.usedSeats || 0,
        availableSeats: d.totalSeats === null || d.totalSeats === undefined
            ? null
            : Math.max(d.totalSeats - (d.usedSeats || 0), 0),
        loginIdentifier: d.loginIdentifier || null,
        hasSecret: !!d.encryptedSecret,
        keyPool: (d.keyPool || []).map((k) => ({
            keyId: String(k.keyId),
            status: k.status,
            label: k.label || null,
            assignedToAssignmentId: k.assignedToAssignmentId ? String(k.assignedToAssignmentId) : null,
        })),
        keyStats: (d.keyPool || []).reduce(
            (acc, k) => ({ ...acc, [k.status]: (acc[k.status] || 0) + 1 }),
            { available: 0, assigned: 0, burned: 0 },
        ),
        physicalStorageLocation: d.physicalStorageLocation || null,
        recoveryEmail: d.recoveryEmail || null,
        has2FA: !!d.has2FA,
        twoFactorNote: d.twoFactorNote || null,
        requiresPasswordRotation: !!d.requiresPasswordRotation,
        cost: d.cost ? Number(d.cost.toString()) : 0,
        currency: d.currency || 'VND',
        billingCycle: d.billingCycle,
        expiryDate: d.expiryDate,
        autoRenew: !!d.autoRenew,
        daysToExpiry: d.expiryDate
            ? Math.ceil((new Date(d.expiryDate) - new Date()) / 86400000)
            : null,
        status: d.status,
        ownerId: String(d.ownerId),
        note: d.note,
        updatedAt: d.updatedAt,
    });

    // =======================================================================
    // THIẾT BỊ VẬT LÝ
    // =======================================================================

    // GET /api/assets/physical
    router.get('/physical', handle(async (req, res) => {
        const { status, category, holderId, search, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(parseInt(page, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

        const filter = {};
        if (status && status !== 'ALL') filter.status = status;
        if (category && category !== 'ALL') filter.category = category;
        if (holderId) filter.currentHolderId = toId(holderId);
        if (search && search.trim()) {
            const rx = new RegExp(escapeRx(search), 'i');
            filter.$or = [{ assetCode: rx }, { name: rx }, { serialNumber: rx }, { currentHolderName: rx }];
        }

        const [rows, total] = await Promise.all([
            svc.physicalAssets.find(filter).sort({ updatedAt: -1 })
                .skip((pageNum - 1) * limitNum).limit(limitNum).toArray(),
            svc.physicalAssets.countDocuments(filter),
        ]);

        res.json({
            data: rows.map(mapPhysical),
            pagination: { total, page: pageNum, limit: limitNum },
        });
    }));

    // POST /api/assets/physical — Luồng 1
    router.post('/physical', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const doc = await svc.createPhysicalAsset(req.body, actor);
        res.status(201).json(mapPhysical(doc));
    }));

    // GET /api/assets/physical/:id — chi tiết + lịch sử luân chuyển
    router.get('/physical/:id', handle(async (req, res) => {
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        const p = await svc.physicalAssets.findOne({ _id: id });
        if (!p) throw new AssetError('Không tìm thấy thiết bị', 404);

        // Toàn bộ phiếu từng gắn với máy này, kể cả đã thu hồi (Quy tắc 6)
        const history = await svc.assignments.find({ physicalAssetId: id })
            .sort({ assignedAt: -1 }).toArray();

        const digIds = [...new Set(history.filter((h) => h.digitalAssetId)
            .map((h) => String(h.digitalAssetId)))].map(toId);
        const digs = digIds.length
            ? await svc.digitalAssets.find({ _id: { $in: digIds } },
                { projection: { name: 1, provider: 1 } }).toArray()
            : [];
        const digName = new Map(digs.map((d) => [String(d._id), d.name]));

        res.json({
            ...mapPhysical(p),
            history: history.map((h) => ({
                id: String(h._id),
                assignmentType: h.assignmentType,
                employeeId: String(h.employeeId),
                employeeName: h.employeeName,
                digitalAssetName: h.digitalAssetId ? digName.get(String(h.digitalAssetId)) || null : null,
                status: h.status,
                assignedAt: h.assignedAt,
                revokedAt: h.revokedAt,
                revokeReason: h.revokeReason,
                handoverConditionNote: h.handoverConditionNote,
                returnConditionNote: h.returnConditionNote,
            })),
        });
    }));

    // PUT /api/assets/physical/:id
    router.put('/physical/:id', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        // Không cho sửa tay những field do nghiệp vụ cấp phát quản lý
        const FORBIDDEN = ['status', 'currentHolderId', 'currentHolderName', 'assignedAt'];
        const touched = FORBIDDEN.filter((f) => f in req.body);
        if (touched.length > 0) {
            throw new AssetError(
                `Không sửa trực tiếp ${touched.join(', ')} — dùng API bàn giao / thu hồi`,
            );
        }

        const $set = { updatedAt: new Date() };
        for (const f of ['name', 'category', 'specs', 'condition', 'note', 'assetCode', 'serialNumber']) {
            if (f in req.body) $set[f] = req.body[f];
        }
        for (const f of ['purchaseDate', 'warrantyExpiry']) {
            if (f in req.body) $set[f] = req.body[f] ? new Date(req.body[f]) : null;
        }
        if ('cost' in req.body) {
            const { money } = require('../services/assets');
            $set.cost = money(req.body.cost);
        }

        const r = await svc.physicalAssets.findOneAndUpdate(
            { _id: id }, { $set }, { returnDocument: 'after' },
        );
        if (!r) throw new AssetError('Không tìm thấy thiết bị', 404);

        await svc.audit({
            assetId: id,
            assetKind: 'physical',
            action: 'UPDATE',
            actorId: actor.id,
            actorName: actor.name,
            details: `Cập nhật ${Object.keys($set).filter((k) => k !== 'updatedAt').join(', ')}`,
        });

        res.json(mapPhysical(r));
    }));

    // DELETE /api/assets/physical/:id
    router.delete('/physical/:id', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        // Chặn xóa khi còn phiếu sống: xóa đi thì phiếu trỏ vào hư không, đúng
        // kiểu rác mà MONGODB.md mục 5 cảnh báo khi mất khóa ngoại.
        const open = await svc.assignments.countDocuments({
            physicalAssetId: id,
            status: { $in: svc.HOLDING_STATUSES },
        });
        if (open > 0) {
            throw new AssetError(
                `Thiết bị còn ${open} phiếu cấp phát chưa thu hồi. Thu hồi hết rồi mới xóa được.`,
                409,
            );
        }

        const p = await svc.physicalAssets.findOne({ _id: id });
        if (!p) throw new AssetError('Không tìm thấy thiết bị', 404);

        await svc.physicalAssets.deleteOne({ _id: id });
        await svc.audit({
            assetId: id,
            assetKind: 'physical',
            action: 'DELETE',
            actorId: actor.id,
            actorName: actor.name,
            details: `Xóa thiết bị ${p.assetCode} — ${p.name}`,
            snapshot: { assetCode: p.assetCode, serialNumber: p.serialNumber, name: p.name },
        });

        // Phiếu lịch sử GIỮ NGUYÊN, không cascade: sổ cái không được xóa (Quy tắc 6)
        res.json({ message: 'Đã xóa thiết bị', historyKept: true });
    }));

    // =======================================================================
    // TÀI SẢN SỐ
    // =======================================================================

    // GET /api/assets/digital
    router.get('/digital', handle(async (req, res) => {
        const { status, provider, bindingTarget, packagingType, expiringInDays, search } = req.query;

        const filter = {};
        if (status && status !== 'ALL') filter.status = status;
        if (provider && provider !== 'ALL') filter.provider = provider;
        if (bindingTarget && bindingTarget !== 'ALL') filter.bindingTarget = bindingTarget;
        if (packagingType && packagingType !== 'ALL') filter.packagingType = packagingType;
        if (expiringInDays) {
            const limit = new Date(Date.now() + Number(expiringInDays) * 86400000);
            filter.expiryDate = { $ne: null, $lte: limit };
        }
        if (search && search.trim()) {
            const rx = new RegExp(escapeRx(search), 'i');
            filter.$or = [{ name: rx }, { provider: rx }, { loginIdentifier: rx }];
        }

        const rows = await svc.digitalAssets.find(filter).sort({ provider: 1, name: 1 }).toArray();
        const mapped = rows.map(mapDigital);

        // Gom theo cây cha-con cho bảng phân cấp ở Tab 2
        const byId = new Map(mapped.map((d) => [d.id, { ...d, children: [] }]));
        const roots = [];
        for (const d of byId.values()) {
            const parent = d.parentAssetId ? byId.get(d.parentAssetId) : null;
            if (parent) parent.children.push(d);
            else roots.push(d);
        }

        res.json({ data: mapped, tree: roots, total: mapped.length });
    }));

    // POST /api/assets/digital — Luồng 1
    router.post('/digital', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const doc = await svc.createDigitalAsset(req.body, actor);
        res.status(201).json(mapDigital(doc));
    }));

    // GET /api/assets/digital/:id
    router.get('/digital/:id', handle(async (req, res) => {
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        const d = await svc.digitalAssets.findOne({ _id: id });
        if (!d) throw new AssetError('Không tìm thấy tài sản số', 404);

        const open = await svc.assignments
            .find({ digitalAssetId: id })
            .sort({ assignedAt: -1 })
            .limit(200)
            .toArray();

        res.json({
            ...mapDigital(d),
            assignments: open.map((a) => ({
                id: String(a._id),
                employeeId: String(a.employeeId),
                employeeName: a.employeeName,
                assignmentType: a.assignmentType,
                physicalAssetId: a.physicalAssetId ? String(a.physicalAssetId) : null,
                allocatedKeyId: a.allocatedKeyId ? String(a.allocatedKeyId) : null,
                assignedIdentifier: a.assignedIdentifier,
                status: a.status,
                holderReleased: !!a.holderReleased,
                assignedAt: a.assignedAt,
                revokedAt: a.revokedAt,
            })),
        });
    }));

    // PUT /api/assets/digital/:id
    router.put('/digital/:id', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        const FORBIDDEN = ['usedSeats', 'keyPool', 'status'];
        const touched = FORBIDDEN.filter((f) => f in req.body);
        if (touched.length > 0) {
            throw new AssetError(`Không sửa trực tiếp ${touched.join(', ')} — dùng API cấp phát / thu hồi`);
        }

        const $set = { updatedAt: new Date() };
        for (const f of ['name', 'provider', 'loginIdentifier', 'physicalStorageLocation',
            'recoveryEmail', 'twoFactorNote', 'note', 'billingCycle', 'currency']) {
            if (f in req.body) $set[f] = req.body[f];
        }
        for (const f of ['has2FA', 'autoRenew', 'isKeyReusable']) {
            if (f in req.body) $set[f] = !!req.body[f];
        }
        if ('expiryDate' in req.body) $set.expiryDate = req.body.expiryDate ? new Date(req.body.expiryDate) : null;
        if ('cost' in req.body) {
            const { money } = require('../services/assets');
            $set.cost = money(req.body.cost);
        }
        // Đổi mật khẩu gốc xong -> hạ cờ đỏ (Quy tắc 4)
        if (req.body.secret) {
            const { encrypt } = require('../services/assetCrypto');
            $set.encryptedSecret = encrypt(req.body.secret);
            $set.requiresPasswordRotation = false;
        }
        if (req.body.clearPasswordRotationFlag === true) $set.requiresPasswordRotation = false;

        // totalSeats không được nhỏ hơn số chỗ đang dùng
        if ('totalSeats' in req.body) {
            const cur = await svc.digitalAssets.findOne({ _id: id }, { projection: { usedSeats: 1, fulfillmentMethod: 1 } });
            if (!cur) throw new AssetError('Không tìm thấy tài sản số', 404);
            if (cur.fulfillmentMethod === 'discrete_key_pool') {
                throw new AssetError('Kho key rời: số chỗ bằng số key, thêm key để tăng (POST /digital/:id/keys)');
            }
            const next = req.body.totalSeats === null ? null : Number(req.body.totalSeats);
            if (next !== null && next < (cur.usedSeats || 0)) {
                throw new AssetError(`Đang dùng ${cur.usedSeats} chỗ, không hạ tổng số chỗ xuống ${next}`);
            }
            $set.totalSeats = next;
        }

        const r = await svc.digitalAssets.findOneAndUpdate({ _id: id }, { $set }, { returnDocument: 'after' });
        if (!r) throw new AssetError('Không tìm thấy tài sản số', 404);

        await svc.syncDigitalStatus(id);
        await svc.audit({
            assetId: id,
            assetKind: 'digital',
            action: 'UPDATE',
            actorId: actor.id,
            actorName: actor.name,
            details: `Cập nhật ${Object.keys($set).filter((k) => k !== 'updatedAt').join(', ')}`,
        });

        const after = await svc.digitalAssets.findOne({ _id: id });
        res.json(mapDigital(after));
    }));

    // POST /api/assets/digital/:id/keys — nhập thêm key rời vào kho
    router.post('/digital/:id/keys', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        const keys = (req.body.keys || []).filter((k) => k && String(k).trim());
        if (keys.length === 0) throw new AssetError('Danh sách key trống');

        const d = await svc.digitalAssets.findOne({ _id: id }, { projection: { fulfillmentMethod: 1, totalSeats: 1 } });
        if (!d) throw new AssetError('Không tìm thấy tài sản số', 404);
        if (d.fulfillmentMethod !== 'discrete_key_pool') {
            throw new AssetError('Chỉ kho key rời (FPP / ESD) mới nhập thêm key được');
        }

        const { ObjectId } = require('mongodb');
        const { encrypt } = require('../services/assetCrypto');
        const items = keys.map((k, i) => ({
            keyId: new ObjectId(),
            encryptedKey: encrypt(String(k).trim()),
            status: 'available',
            assignedToAssignmentId: null,
            label: (req.body.labels && req.body.labels[i]) || null,
        }));

        await svc.digitalAssets.updateOne(
            { _id: id },
            {
                $push: { keyPool: { $each: items } },
                // Số chỗ của kho key rời luôn bằng số key
                $inc: { totalSeats: items.length },
                $set: { updatedAt: new Date() },
            },
        );
        await svc.syncDigitalStatus(id);
        await svc.audit({
            assetId: id,
            assetKind: 'digital',
            action: 'UPDATE',
            actorId: actor.id,
            actorName: actor.name,
            details: `Nhập thêm ${items.length} key vào kho`,
        });

        const after = await svc.digitalAssets.findOne({ _id: id });
        res.status(201).json({ added: items.length, ...mapDigital(after) });
    }));

    // DELETE /api/assets/digital/:id
    router.delete('/digital/:id', handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        const open = await svc.assignments.countDocuments({
            digitalAssetId: id,
            status: { $in: svc.HOLDING_STATUSES },
        });
        if (open > 0) {
            throw new AssetError(`Còn ${open} phiếu chưa thu hồi, không xóa được`, 409);
        }
        const children = await svc.digitalAssets.countDocuments({ parentAssetId: id });
        if (children > 0) {
            throw new AssetError(`Còn ${children} gói con trực thuộc, xóa hoặc chuyển chúng trước`, 409);
        }

        const d = await svc.digitalAssets.findOne({ _id: id });
        if (!d) throw new AssetError('Không tìm thấy tài sản số', 404);

        await svc.digitalAssets.deleteOne({ _id: id });
        await svc.audit({
            assetId: id,
            assetKind: 'digital',
            action: 'DELETE',
            actorId: actor.id,
            actorName: actor.name,
            details: `Xóa ${d.name} (${d.provider})`,
            snapshot: { name: d.name, provider: d.provider, totalSeats: d.totalSeats },
        });

        res.json({ message: 'Đã xóa tài sản số', historyKept: true });
    }));

    // -----------------------------------------------------------------------
    // GET /api/assets/digital/:id/reveal-secret — giải mã key / mật khẩu
    //
    // ĐÂY LÀ ENDPOINT NHẠY CẢM NHẤT CỦA PHÂN HỆ. Nó trả về bản rõ của key bản
    // quyền hoặc mật khẩu tài khoản dùng chung.
    //
    // Mã hoá AES-256-GCM chỉ chặn người đọc thẳng file database — KHÔNG chặn
    // người gọi API. Tầng xác thực hiện tại chưa ký token (MONGODB.md mục 7),
    // nên trên thực tế ai chạm được cổng 5000 cũng gọi được endpoint này.
    // Phải ký token trước khi mở cho người dùng thật.
    // Xem Docs/danh-gia-dac-ta-tai-san-so.md mục 2.1.
    //
    // Mọi lần gọi đều ghi VIEW_SECRET kèm ai xem, xem gì, lúc nào.
    // -----------------------------------------------------------------------
    router.get(
        '/digital/:id/reveal-secret',
        // Token chưa ký nên ai cũng tự xưng được là SUPER_ADMIN. Trong LAN kín
        // thì rủi ro còn chịu được; mở ra Internet thì endpoint này giao nộp
        // toàn bộ kho key. Tắt hẳn ở bản demo.
        blockInDemo('Xem key bị tắt trong bản dùng thử. Các chức năng khác vẫn dùng bình thường.'),
        handle(async (req, res) => {
        const actor = await requireActor(req, IT_ROLES);
        const id = toId(req.params.id);
        if (!id) throw new AssetError('id không hợp lệ');

        const d = await svc.digitalAssets.findOne({ _id: id });
        if (!d) throw new AssetError('Không tìm thấy tài sản số', 404);

        const keyId = toId(req.query.keyId);
        let value = null;
        let what = null;

        if (keyId) {
            const item = (d.keyPool || []).find((k) => String(k.keyId) === String(keyId));
            if (!item) throw new AssetError('Không tìm thấy key trong kho', 404);
            value = decrypt(item.encryptedKey);
            what = `key ${item.label || String(keyId).slice(-6)}`;
        } else {
            if (!d.encryptedSecret) throw new AssetError('Tài sản này không lưu mật khẩu / key dùng chung', 404);
            value = decrypt(d.encryptedSecret);
            what = d.fulfillmentMethod === 'mak_volume_key' ? 'MAK key' : 'mật khẩu dùng chung';
        }

        await svc.audit({
            assetId: id,
            assetKind: 'digital',
            action: 'VIEW_SECRET',
            actorId: actor.id,
            actorName: actor.name,
            details: `${actor.name} đã xem ${what} của "${d.name}"`,
            snapshot: { keyId: keyId ? String(keyId) : null, ip: req.ip || null },
        });

        res.json({
            value,
            masked: maskKey(value),
            loginIdentifier: d.loginIdentifier || null,
            what,
            // UI tự ẩn sau 30 giây (đặc tả mục 5.2)
            hideAfterSeconds: 30,
            warning: 'Lượt xem này đã được ghi vào nhật ký kiểm toán.',
        });
        }),
    );

    // -----------------------------------------------------------------------
    // Thống kê + tra cứu
    // -----------------------------------------------------------------------

    // GET /api/assets/stats
    router.get('/stats', handle(async (req, res) => {
        const soon = new Date(Date.now() + 30 * 86400000);

        const [physByStatus, digByStatus, expiring, rotation, pending] = await Promise.all([
            svc.physicalAssets.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
            svc.digitalAssets.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
            svc.digitalAssets.countDocuments({
                expiryDate: { $ne: null, $lte: soon },
                status: { $nin: ['archived', 'expired'] },
            }),
            svc.digitalAssets.countDocuments({ requiresPasswordRotation: true }),
            svc.assignments.countDocuments({ status: 'pending_activation' }),
        ]);

        const toMap = (rows) => rows.reduce((a, r) => ({ ...a, [r._id]: r.n }), {});

        // Chi phí bản quyền quy về hằng tháng
        const costRows = await svc.digitalAssets.aggregate([
            { $match: { status: { $in: ['available', 'fully_assigned'] } } },
            {
                $group: {
                    _id: '$billingCycle',
                    total: { $sum: { $toDouble: { $ifNull: ['$cost', 0] } } },
                },
            },
        ]).toArray();
        const monthlyCost = costRows.reduce((sum, r) => {
            if (r._id === 'monthly') return sum + r.total;
            if (r._id === 'yearly') return sum + r.total / 12;

            return sum; // one_time không tính vào chi phí định kỳ
        }, 0);

        res.json({
            physical: { byStatus: toMap(physByStatus), total: physByStatus.reduce((n, r) => n + r.n, 0) },
            digital: { byStatus: toMap(digByStatus), total: digByStatus.reduce((n, r) => n + r.n, 0) },
            expiringIn30Days: expiring,
            needPasswordRotation: rotation,
            pendingActivation: pending,
            monthlyLicenseCost: Math.round(monthlyCost),
        });
    }));

    // GET /api/assets/by-employee/:employeeId — Tab 3 "Tra cứu theo nhân sự"
    router.get('/by-employee/:employeeId', handle(async (req, res) => {
        const employee = await svc.getEmployee(req.params.employeeId);

        const open = await svc.assignments
            .find({ employeeId: employee._id, status: { $in: svc.HOLDING_STATUSES } })
            .sort({ assignedAt: -1 })
            .toArray();

        const physIds = open.map((a) => a.physicalAssetId).filter(Boolean);
        const digIds = open.map((a) => a.digitalAssetId).filter(Boolean);

        const [phys, digs] = await Promise.all([
            physIds.length ? svc.physicalAssets.find({ _id: { $in: physIds } }).toArray() : [],
            digIds.length ? svc.digitalAssets.find({ _id: { $in: digIds } }).toArray() : [],
        ]);
        const physById = new Map(phys.map((p) => [String(p._id), p]));
        const digById = new Map(digs.map((d) => [String(d._id), d]));

        let monthlyCost = 0;
        const devices = [];
        const licenses = [];

        for (const a of open) {
            if (a.assignmentType === 'physical_handover') {
                const p = physById.get(String(a.physicalAssetId));
                if (p) {
                    devices.push({
                        assignmentId: String(a._id),
                        ...mapPhysical(p),
                        assignedAt: a.assignedAt,
                        handoverConditionNote: a.handoverConditionNote,
                    });
                }
                continue;
            }

            const d = digById.get(String(a.digitalAssetId));
            if (!d) continue;

            // Chi phí mỗi chỗ, quy về tháng
            const cost = d.cost ? Number(d.cost.toString()) : 0;
            const seats = d.totalSeats || 1;
            const perSeat = cost / seats;
            if (d.billingCycle === 'monthly') monthlyCost += perSeat;
            else if (d.billingCycle === 'yearly') monthlyCost += perSeat / 12;

            licenses.push({
                assignmentId: String(a._id),
                digitalAssetId: String(d._id),
                name: d.name,
                provider: d.provider,
                packagingType: d.packagingType,
                bindingTarget: d.bindingTarget,
                assignmentType: a.assignmentType,
                onMachine: a.physicalAssetId
                    ? (physById.get(String(a.physicalAssetId))?.assetCode || String(a.physicalAssetId))
                    : null,
                assignedIdentifier: a.assignedIdentifier,
                accessScope: a.accessScope,
                status: a.status,
                holderReleased: !!a.holderReleased,
                assignedAt: a.assignedAt,
                expiryDate: d.expiryDate,
                currency: d.currency || 'VND',
            });
        }

        res.json({
            employee: {
                id: String(employee._id),
                name: employee.fullName,
                email: employee.email || null,
                employeeCode: employee.employee ? employee.employee.employeeCode : null,
                department: employee.employee && employee.employee.department
                    ? employee.employee.department.name
                    : null,
            },
            devices,
            licenses,
            monthlyLicenseCost: Math.round(monthlyCost),
            total: devices.length + licenses.length,
        });
    }));

    // GET /api/assets/audit-logs?assetId=&action=
    router.get('/audit-logs', handle(async (req, res) => {
        const filter = {};
        if (req.query.assetId) filter.assetId = toId(req.query.assetId);
        if (req.query.action && req.query.action !== 'ALL') filter.action = req.query.action;

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
        const rows = await svc.auditLogs.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();

        res.json(rows.map((l) => ({
            id: String(l._id),
            assetId: String(l.assetId),
            assetKind: l.assetKind,
            action: l.action,
            actorName: l.actorName,
            details: l.details,
            createdAt: l.createdAt,
        })));
    }));

    // Cảnh báo một lần lúc gắn router, nếu chưa cấu hình khoá mã hoá
    if (!isConfigured()) {
        console.warn(
            '[assets] ⚠ Chưa có ASSET_SECRET_KEY hợp lệ trong .env — '
            + 'không tạo được tài sản số có key/mật khẩu. '
            + 'Sinh khoá: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
    }

    // Chia sẻ lại cho nơi khác dùng.
    //
    // KHÔNG đặt tên thuộc tính là `handle`, `use`, `route`, `param` hay `stack`:
    // đó là thành phần nội bộ của Express Router. `router.handle` chính là hàm
    // dispatch request — ghi đè nó thì mọi request vào router treo vĩnh viễn,
    // không lỗi, không log, chỉ là không bao giờ có response.
    router.svc = svc;
    router.requireActor = requireActor;
    router.mapPhysical = mapPhysical;
    router.mapDigital = mapDigital;
    router.IT_ROLES = IT_ROLES;

    return router;
};
