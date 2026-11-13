/**
 * Tầng nghiệp vụ phân hệ Quản lý Tài sản.
 *
 * Hiện thực 6 quy tắc trong `Docs/đặc tả kĩ thuật và triển khai quản lý tài sản
 * số.docx`. Những chỗ lệch khỏi đặc tả (và lý do) nằm ở
 * `Docs/danh-gia-dac-ta-tai-san-so.md` — đọc mục 2 trước khi sửa file này.
 *
 * BA BẤT BIẾN, mọi hàm ở đây phải giữ:
 *
 *   1. `digitalAsset.usedSeats` = số phiếu đang chiếm chỗ (active + suspended +
 *      pending_activation) của gói đó. Lệch một lần là kho báo sai mãi mãi.
 *   2. `keyPool[].status` khớp với phiếu: 'assigned' thì phải có đúng một phiếu
 *      chưa revoke trỏ tới `keyId` đó.
 *   3. Phiếu `assetAssignments` là sổ cái: không sửa người nhận, không xóa.
 *      Tái cấp phát = revoke phiếu cũ + tạo phiếu mới (Quy tắc 6).
 *
 * Vì ba bất biến này trải trên nhiều collection, MỌI thao tác assign/revoke đều
 * chạy trong transaction (Quy tắc 5). Replica set rs0 đã bật sẵn cho việc đó.
 */
const { ObjectId, Decimal128 } = require('mongodb');
const { encrypt, maskKey } = require('./assetCrypto');

/** Trạng thái phiếu vẫn đang chiếm seat / giữ key. */
const HOLDING_STATUSES = ['pending_activation', 'active', 'suspended'];

/** Ép hex thành ObjectId, null nếu không hợp lệ. */
const toId = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null);

/** Tiền luôn Decimal128 — xem MONGODB.md mục 3. */
const money = (v) => {
    if (v === null || v === undefined || v === '') return null;

    return Decimal128.fromString(String(v));
};

const toDate = (v) => (v ? new Date(v) : null);

/** Lỗi nghiệp vụ có mã HTTP đi kèm, để route khỏi đoán 400 hay 500. */
class AssetError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'AssetError';
        this.status = status;
    }
}

/**
 * Trạng thái kho của một gói bản quyền, tính từ usedSeats/totalSeats.
 *
 * Không tự ghi đè các trạng thái do người/cron đặt: suspended, expired,
 * archived. Chỉ qua lại giữa 'available' và 'fully_assigned'.
 */
function digitalStatusFor(doc) {
    if (['suspended', 'expired', 'archived'].includes(doc.status)) return doc.status;

    // totalSeats null = không giới hạn (shared_account) -> không bao giờ đầy
    if (doc.totalSeats === null || doc.totalSeats === undefined) return 'available';

    return (doc.usedSeats || 0) >= doc.totalSeats ? 'fully_assigned' : 'available';
}

function assetService(db) {
    const physicalAssets = db.collection('physicalAssets');
    const digitalAssets = db.collection('digitalAssets');
    const assignments = db.collection('assetAssignments');
    const auditLogs = db.collection('assetAuditLogs');
    const users = db.collection('users');

    // -----------------------------------------------------------------------
    // Tiện ích chung
    // -----------------------------------------------------------------------

    /** Ghi sổ audit. Append-only, không bao giờ sửa (đặc tả Quy tắc 6). */
    async function audit(entry, session = undefined) {
        await auditLogs.insertOne(
            {
                assetId: entry.assetId,
                assetKind: entry.assetKind,
                action: entry.action,
                actorId: entry.actorId || null,
                actorName: entry.actorName || 'Hệ thống',
                details: entry.details || null,
                snapshot: entry.snapshot || null,
                createdAt: new Date(),
            },
            { session },
        );
    }

    /** Hồ sơ rút gọn của nhân sự, để snapshot vào phiếu. */
    async function getEmployee(employeeId, session = undefined) {
        const id = toId(employeeId);
        if (!id) throw new AssetError('employeeId không hợp lệ');

        const u = await users.findOne(
            { _id: id },
            { projection: { fullName: 1, email: 1, 'employee.employeeCode': 1, 'employee.department': 1 }, session },
        );
        if (!u) throw new AssetError('Không tìm thấy nhân sự', 404);

        return u;
    }

    /** Cập nhật lại status của gói bản quyền sau khi usedSeats đổi. */
    async function syncDigitalStatus(digitalId, session = undefined) {
        const doc = await digitalAssets.findOne(
            { _id: digitalId },
            { projection: { usedSeats: 1, totalSeats: 1, status: 1 }, session },
        );
        if (!doc) return null;

        const next = digitalStatusFor(doc);
        if (next !== doc.status) {
            await digitalAssets.updateOne(
                { _id: digitalId },
                { $set: { status: next, updatedAt: new Date() } },
                { session },
            );
        }

        return next;
    }

    /**
     * Chạy một khối trong transaction. Mọi lệnh bên trong PHẢI nhận `session`,
     * nếu không nó chạy ngoài transaction và không rollback cùng.
     *
     * Lưu ý: callback có thể được driver chạy lại khi gặp transient error, nên
     * đừng sinh ObjectId hay đọc giờ bên trong — sinh sẵn ở ngoài rồi truyền vào.
     */
    async function inTransaction(client, fn) {
        const session = client.startSession();
        try {
            let out;
            await session.withTransaction(async () => {
                out = await fn(session);
            });

            return out;
        } finally {
            await session.endSession();
        }
    }

    // -----------------------------------------------------------------------
    // Nhập kho (Luồng 1)
    // -----------------------------------------------------------------------

    /**
     * Tạo thiết bị vật lý. `bundledOemLicense` là Windows OEM chết theo máy —
     * không tạo digitalAsset, không chiếm seat của kho nào (Quy tắc 1).
     */
    async function createPhysicalAsset(input, actor) {
        const now = new Date();
        const oem = input.bundledOemLicense || {};

        const doc = {
            _id: new ObjectId(),
            assetCode: String(input.assetCode || '').trim(),
            serialNumber: String(input.serialNumber || '').trim(),
            name: String(input.name || '').trim(),
            category: input.category,
            specs: input.specs || null,
            bundledOemLicense: {
                hasOem: !!oem.hasOem,
                osName: oem.hasOem ? (oem.osName || null) : null,
                // Key OEM thường không trích xuất được -> cho phép null
                encryptedKey: oem.hasOem && oem.productKey ? encrypt(oem.productKey) : null,
            },
            condition: input.condition || 'new',
            status: 'available',
            currentHolderId: null,
            currentHolderName: null,
            assignedAt: null,
            purchaseDate: toDate(input.purchaseDate),
            warrantyExpiry: toDate(input.warrantyExpiry),
            cost: money(input.cost ?? 0),
            note: input.note || null,
            createdAt: now,
            updatedAt: now,
        };

        if (!doc.assetCode) throw new AssetError('Thiếu mã tài sản (assetCode)');
        if (!doc.serialNumber) throw new AssetError('Thiếu số serial');
        if (!doc.name) throw new AssetError('Thiếu tên thiết bị');

        await physicalAssets.insertOne(doc);
        await audit({
            assetId: doc._id,
            assetKind: 'physical',
            action: 'CREATE',
            actorId: toId(actor?.id),
            actorName: actor?.name || 'Hệ thống',
            details: `Nhập kho thiết bị ${doc.assetCode} — ${doc.name}`,
        });

        return doc;
    }

    /**
     * Tạo tài sản số. Tuỳ `fulfillmentMethod` mà phần "ruột" khác nhau:
     *   discrete_key_pool -> mảng key rời, mã hoá từng chuỗi
     *   mak_volume_key    -> một key dùng chung + totalSeats = số lượt kích hoạt
     *   tenant_seat       -> chỉ cần totalSeats
     *   shared_account    -> loginIdentifier + mật khẩu chung
     */
    async function createDigitalAsset(input, actor) {
        const now = new Date();
        const fulfillment = input.fulfillmentMethod;

        if (!input.name) throw new AssetError('Thiếu tên tài sản số');
        if (!input.provider) throw new AssetError('Thiếu nhà cung cấp (provider)');
        if (!input.bindingTarget) throw new AssetError('Thiếu bindingTarget (user hoặc device)');

        const ownerId = toId(input.ownerId);
        if (!ownerId) throw new AssetError('Thiếu ownerId — người chịu trách nhiệm quản lý');

        // FPP là hộp cứng, phải biết vỏ hộp nằm đâu thì mới kiểm kê được
        if (input.packagingType === 'physical_box_fpp' && !input.physicalStorageLocation) {
            throw new AssetError('Bản quyền hộp cứng (FPP) phải ghi vị trí lưu kho');
        }

        const keyPool = [];
        if (fulfillment === 'discrete_key_pool') {
            const keys = Array.isArray(input.keys) ? input.keys.filter((k) => k && String(k).trim()) : [];
            if (keys.length === 0) {
                throw new AssetError('Kho key rời (FPP/ESD) phải có ít nhất một key');
            }
            keys.forEach((k, i) => {
                keyPool.push({
                    keyId: new ObjectId(),
                    encryptedKey: encrypt(String(k).trim()),
                    status: 'available',
                    assignedToAssignmentId: null,
                    label: (input.keyLabels && input.keyLabels[i]) || null,
                });
            });
        }

        // Số chỗ: key rời thì bằng số key, còn lại lấy theo đầu vào.
        // null = không giới hạn, chỉ hợp lệ với tài khoản dùng chung.
        let totalSeats;
        if (fulfillment === 'discrete_key_pool') {
            totalSeats = keyPool.length;
        } else if (input.totalSeats === null || input.totalSeats === 'unlimited') {
            if (fulfillment !== 'shared_account') {
                throw new AssetError('Chỉ tài khoản dùng chung mới được để số chỗ không giới hạn');
            }
            totalSeats = null;
        } else {
            totalSeats = Number(input.totalSeats) || 1;
        }

        const secret = input.secret || input.password || input.makKey || null;

        const doc = {
            _id: new ObjectId(),
            parentAssetId: toId(input.parentAssetId),
            isContainerOnly: !!input.isContainerOnly,
            name: String(input.name).trim(),
            provider: String(input.provider).trim(),
            packagingType: input.packagingType,
            fulfillmentMethod: fulfillment,
            bindingTarget: input.bindingTarget,
            isKeyReusable: input.isKeyReusable !== false,
            totalSeats,
            usedSeats: 0,
            loginIdentifier: input.loginIdentifier || null,
            encryptedSecret: secret ? encrypt(secret) : null,
            keyPool,
            physicalStorageLocation: input.physicalStorageLocation || null,
            recoveryEmail: input.recoveryEmail || null,
            has2FA: !!input.has2FA,
            twoFactorNote: input.twoFactorNote || null,
            requiresPasswordRotation: false,
            cost: money(input.cost ?? 0),
            currency: input.currency || 'VND',
            billingCycle: input.billingCycle || 'yearly',
            expiryDate: toDate(input.expiryDate),
            autoRenew: !!input.autoRenew,
            status: 'available',
            ownerId,
            note: input.note || null,
            createdAt: now,
            updatedAt: now,
        };

        await digitalAssets.insertOne(doc);
        await audit({
            assetId: doc._id,
            assetKind: 'digital',
            action: 'CREATE',
            actorId: toId(actor?.id),
            actorName: actor?.name || 'Hệ thống',
            details: `Nhập kho ${doc.name} (${doc.packagingType}${keyPool.length ? `, ${keyPool.length} key` : ''})`,
        });

        return doc;
    }

    // -----------------------------------------------------------------------
    // Cấp phát (Luồng 2)
    // -----------------------------------------------------------------------

    /**
     * Lấy một "suất" ra khỏi kho bản quyền, bên trong transaction.
     *
     * Trả về phần dữ liệu cấp phát để nhét vào phiếu. KHÔNG tự tạo phiếu — hàm
     * gọi nó chịu trách nhiệm đó, vì bundle cấp nhiều thứ trong cùng transaction.
     */
    async function consumeDigitalSeat(digitalId, assignmentId, session) {
        const dig = await digitalAssets.findOne({ _id: digitalId }, { session });
        if (!dig) throw new AssetError('Không tìm thấy tài sản số', 404);

        if (dig.isContainerOnly) {
            throw new AssetError(`"${dig.name}" là cổng quản trị tổng, không cấp phát trực tiếp`);
        }
        if (['suspended', 'expired', 'archived'].includes(dig.status)) {
            throw new AssetError(`"${dig.name}" đang ở trạng thái ${dig.status}, không cấp phát được`);
        }

        // Kiểm tra chỗ trống trước khi đụng vào keyPool
        const unlimited = dig.totalSeats === null || dig.totalSeats === undefined;
        if (!unlimited && (dig.usedSeats || 0) >= dig.totalSeats) {
            throw new AssetError(`"${dig.name}" đã dùng hết ${dig.totalSeats} chỗ`);
        }

        let allocatedKeyId = null;

        if (dig.fulfillmentMethod === 'discrete_key_pool') {
            const free = (dig.keyPool || []).find((k) => k.status === 'available');
            if (!free) throw new AssetError(`"${dig.name}" không còn key trống trong kho`);

            allocatedKeyId = free.keyId;

            // Điều kiện status:'available' nằm ngay trong filter: hai request
            // song song thì chỉ một cái khớp, cái kia modifiedCount = 0.
            const r = await digitalAssets.updateOne(
                { _id: digitalId, 'keyPool.keyId': allocatedKeyId, 'keyPool.status': 'available' },
                {
                    $set: {
                        'keyPool.$.status': 'assigned',
                        'keyPool.$.assignedToAssignmentId': assignmentId,
                        updatedAt: new Date(),
                    },
                    $inc: { usedSeats: 1 },
                },
                { session },
            );
            if (r.modifiedCount === 0) {
                throw new AssetError('Key vừa bị người khác lấy mất, thử lại');
            }
        } else {
            await digitalAssets.updateOne(
                { _id: digitalId },
                { $inc: { usedSeats: 1 }, $set: { updatedAt: new Date() } },
                { session },
            );
        }

        return { digital: dig, allocatedKeyId };
    }

    /**
     * Cấp một bản quyền / tài khoản cho nhân sự.
     *
     * Quy tắc 2: bản quyền `bindingTarget: 'device'` BẮT BUỘC kèm máy đích —
     * key Windows cài lên một chiếc máy cụ thể, không lơ lửng theo người.
     */
    async function assignDigital(client, input) {
        const digitalId = toId(input.digitalAssetId);
        if (!digitalId) throw new AssetError('digitalAssetId không hợp lệ');

        const employee = await getEmployee(input.employeeId);
        const assignedBy = toId(input.assignedBy);
        if (!assignedBy) throw new AssetError('Thiếu assignedBy');

        const physicalId = toId(input.physicalAssetId);
        const assignmentId = new ObjectId();
        const now = new Date();

        return inTransaction(client, async (session) => {
            const { digital, allocatedKeyId } = await consumeDigitalSeat(digitalId, assignmentId, session);

            if (digital.bindingTarget === 'device') {
                if (!physicalId) {
                    throw new AssetError(
                        `"${digital.name}" là bản quyền gắn theo máy — phải chọn thiết bị đích`,
                    );
                }
                const machine = await physicalAssets.findOne({ _id: physicalId }, { session });
                if (!machine) throw new AssetError('Không tìm thấy thiết bị đích', 404);
            }

            // Cloud/SaaS phải chờ người dùng bấm accept invite bên hãng
            const needsActivation = digital.fulfillmentMethod === 'tenant_seat'
                || digital.packagingType === 'cloud_subscription';

            const doc = {
                _id: assignmentId,
                assignmentType: digital.bindingTarget === 'device'
                    ? 'digital_device_license'
                    : 'digital_user_license',
                employeeId: employee._id,
                employeeName: employee.fullName,
                employeeEmail: employee.email || null,
                physicalAssetId: physicalId,
                digitalAssetId: digitalId,
                allocatedKeyId,
                assignedIdentifier: input.assignedIdentifier || employee.email || null,
                accessScope: input.accessScope
                    || (digital.bindingTarget === 'device' ? 'Device License' : 'User'),
                status: needsActivation ? 'pending_activation' : 'active',
                holderReleased: false,
                assignedBy,
                assignedAt: now,
                activatedAt: needsActivation ? null : now,
                handoverConditionNote: null,
                revokedBy: null,
                revokedAt: null,
                revokeReason: null,
                returnConditionNote: null,
                keyReturnedToPool: null,
                note: input.note || null,
                createdAt: now,
                updatedAt: now,
            };

            await assignments.insertOne(doc, { session });
            await syncDigitalStatus(digitalId, session);
            await audit({
                assetId: digitalId,
                assetKind: 'digital',
                action: 'ASSIGN',
                actorId: assignedBy,
                actorName: input.actorName || 'IT Admin',
                details: `Cấp "${digital.name}" cho ${employee.fullName}`,
                snapshot: { assignmentId: String(assignmentId), allocatedKeyId: allocatedKeyId ? String(allocatedKeyId) : null },
            }, session);

            return doc;
        });
    }

    /** Bàn giao thiết bị vật lý. */
    async function assignPhysical(client, input) {
        const physicalId = toId(input.physicalAssetId);
        if (!physicalId) throw new AssetError('physicalAssetId không hợp lệ');

        const employee = await getEmployee(input.employeeId);
        const assignedBy = toId(input.assignedBy);
        if (!assignedBy) throw new AssetError('Thiếu assignedBy');

        const assignmentId = new ObjectId();
        const now = new Date();

        return inTransaction(client, async (session) => {
            // status:'available' trong filter = khoá lạc quan: máy đã bàn giao
            // cho người khác thì matchedCount = 0, không có chuyện hai phiếu
            // cùng sống trên một máy.
            const r = await physicalAssets.updateOne(
                { _id: physicalId, status: 'available' },
                {
                    $set: {
                        status: 'assigned',
                        currentHolderId: employee._id,
                        currentHolderName: employee.fullName,
                        assignedAt: now,
                        updatedAt: now,
                    },
                },
                { session },
            );

            if (r.matchedCount === 0) {
                const cur = await physicalAssets.findOne({ _id: physicalId }, { session });
                if (!cur) throw new AssetError('Không tìm thấy thiết bị', 404);
                throw new AssetError(
                    `Thiết bị ${cur.assetCode} đang ở trạng thái "${cur.status}", chỉ bàn giao được khi "available"`,
                );
            }

            const doc = {
                _id: assignmentId,
                assignmentType: 'physical_handover',
                employeeId: employee._id,
                employeeName: employee.fullName,
                employeeEmail: employee.email || null,
                physicalAssetId: physicalId,
                digitalAssetId: null,
                allocatedKeyId: null,
                assignedIdentifier: null,
                accessScope: null,
                status: 'active',
                holderReleased: false,
                assignedBy,
                assignedAt: now,
                activatedAt: now,
                handoverConditionNote: input.handoverConditionNote || null,
                revokedBy: null,
                revokedAt: null,
                revokeReason: null,
                returnConditionNote: null,
                keyReturnedToPool: null,
                note: input.note || null,
                createdAt: now,
                updatedAt: now,
            };

            await assignments.insertOne(doc, { session });
            await audit({
                assetId: physicalId,
                assetKind: 'physical',
                action: 'ASSIGN',
                actorId: assignedBy,
                actorName: input.actorName || 'IT Admin',
                details: `Bàn giao thiết bị cho ${employee.fullName}`,
                snapshot: { assignmentId: String(assignmentId) },
            }, session);

            return doc;
        });
    }

    /**
     * Cấp phát trọn gói (Luồng 2) — máy + key theo máy + license theo người,
     * tất cả trong MỘT transaction. Hỏng bất kỳ bước nào thì không còn dấu vết
     * nào sót lại: không có cảnh máy đã đổi sang 'assigned' mà seat M365 thì
     * chưa trừ.
     */
    async function handoverBundle(client, input) {
        const employee = await getEmployee(input.employeeId);
        const assignedBy = toId(input.assignedBy);
        if (!assignedBy) throw new AssetError('Thiếu assignedBy');

        const physicalId = toId(input.physicalAssetId);
        const digitalIds = (input.digitalAssetIds || []).map(toId).filter(Boolean);

        if (!physicalId && digitalIds.length === 0) {
            throw new AssetError('Phải chọn ít nhất một thiết bị hoặc một bản quyền');
        }

        const now = new Date();
        // Sinh id trước vòng transaction: withTransaction có thể chạy lại callback
        const ids = {
            physical: new ObjectId(),
            digital: digitalIds.map(() => new ObjectId()),
        };

        return inTransaction(client, async (session) => {
            const created = [];

            if (physicalId) {
                const r = await physicalAssets.updateOne(
                    { _id: physicalId, status: 'available' },
                    {
                        $set: {
                            status: 'assigned',
                            currentHolderId: employee._id,
                            currentHolderName: employee.fullName,
                            assignedAt: now,
                            updatedAt: now,
                        },
                    },
                    { session },
                );
                if (r.matchedCount === 0) {
                    const cur = await physicalAssets.findOne({ _id: physicalId }, { session });
                    throw new AssetError(
                        cur
                            ? `Thiết bị ${cur.assetCode} đang "${cur.status}", không bàn giao được`
                            : 'Không tìm thấy thiết bị',
                        cur ? 400 : 404,
                    );
                }

                const doc = {
                    _id: ids.physical,
                    assignmentType: 'physical_handover',
                    employeeId: employee._id,
                    employeeName: employee.fullName,
                    employeeEmail: employee.email || null,
                    physicalAssetId: physicalId,
                    digitalAssetId: null,
                    allocatedKeyId: null,
                    assignedIdentifier: null,
                    accessScope: null,
                    status: 'active',
                    holderReleased: false,
                    assignedBy,
                    assignedAt: now,
                    activatedAt: now,
                    handoverConditionNote: input.handoverConditionNote || null,
                    revokedBy: null,
                    revokedAt: null,
                    revokeReason: null,
                    returnConditionNote: null,
                    keyReturnedToPool: null,
                    note: null,
                    createdAt: now,
                    updatedAt: now,
                };
                await assignments.insertOne(doc, { session });
                created.push(doc);

                await audit({
                    assetId: physicalId,
                    assetKind: 'physical',
                    action: 'ASSIGN',
                    actorId: assignedBy,
                    actorName: input.actorName || 'IT Admin',
                    details: `Bàn giao trọn gói cho ${employee.fullName}`,
                }, session);
            }

            for (let i = 0; i < digitalIds.length; i += 1) {
                const digitalId = digitalIds[i];
                const assignmentId = ids.digital[i];
                const { digital, allocatedKeyId } = await consumeDigitalSeat(digitalId, assignmentId, session);

                // Bản quyền gắn theo máy trong bundle thì gắn vào đúng máy vừa giao
                if (digital.bindingTarget === 'device' && !physicalId) {
                    throw new AssetError(
                        `"${digital.name}" gắn theo máy — bundle phải kèm thiết bị đích`,
                    );
                }

                const needsActivation = digital.fulfillmentMethod === 'tenant_seat'
                    || digital.packagingType === 'cloud_subscription';

                const doc = {
                    _id: assignmentId,
                    assignmentType: digital.bindingTarget === 'device'
                        ? 'digital_device_license'
                        : 'digital_user_license',
                    employeeId: employee._id,
                    employeeName: employee.fullName,
                    employeeEmail: employee.email || null,
                    physicalAssetId: digital.bindingTarget === 'device' ? physicalId : null,
                    digitalAssetId: digitalId,
                    allocatedKeyId,
                    assignedIdentifier: employee.email || null,
                    accessScope: digital.bindingTarget === 'device' ? 'Device License' : 'User',
                    status: needsActivation ? 'pending_activation' : 'active',
                    holderReleased: false,
                    assignedBy,
                    assignedAt: now,
                    activatedAt: needsActivation ? null : now,
                    handoverConditionNote: null,
                    revokedBy: null,
                    revokedAt: null,
                    revokeReason: null,
                    returnConditionNote: null,
                    keyReturnedToPool: null,
                    note: null,
                    createdAt: now,
                    updatedAt: now,
                };

                await assignments.insertOne(doc, { session });
                await syncDigitalStatus(digitalId, session);
                created.push(doc);

                await audit({
                    assetId: digitalId,
                    assetKind: 'digital',
                    action: 'ASSIGN',
                    actorId: assignedBy,
                    actorName: input.actorName || 'IT Admin',
                    details: `Cấp "${digital.name}" cho ${employee.fullName} (trọn gói)`,
                }, session);
            }

            return created;
        });
    }

    /** Nhân sự xác nhận đã nhận và kích hoạt xong (pending_activation -> active). */
    async function confirmActivation(assignmentId, userId) {
        const id = toId(assignmentId);
        if (!id) throw new AssetError('assignmentId không hợp lệ');

        const uid = toId(userId);
        const now = new Date();

        // employeeId nằm trong filter: chỉ chính chủ xác nhận được phiếu của mình
        const r = await assignments.findOneAndUpdate(
            { _id: id, employeeId: uid, status: 'pending_activation' },
            { $set: { status: 'active', activatedAt: now, updatedAt: now } },
            { returnDocument: 'after' },
        );

        if (!r) {
            const cur = await assignments.findOne({ _id: id });
            if (!cur) throw new AssetError('Không tìm thấy phiếu cấp phát', 404);
            if (String(cur.employeeId) !== String(uid)) {
                throw new AssetError('Chỉ người được cấp mới xác nhận được phiếu này', 403);
            }
            throw new AssetError(`Phiếu đang ở trạng thái "${cur.status}", không cần kích hoạt`);
        }

        await audit({
            assetId: r.digitalAssetId || r.physicalAssetId,
            assetKind: r.digitalAssetId ? 'digital' : 'physical',
            action: 'ACTIVATE',
            actorId: uid,
            actorName: r.employeeName || 'Nhân sự',
            details: 'Xác nhận đã nhận và kích hoạt',
        });

        return r;
    }

    // -----------------------------------------------------------------------
    // Thu hồi (Luồng 3, 4)
    // -----------------------------------------------------------------------

    /**
     * Thu hồi một phiếu.
     *
     * `returnKeyToPool` chỉ có nghĩa với key rời:
     *   true  + isKeyReusable -> key về kho ('available'), usedSeats giảm
     *   true  + !isKeyReusable -> key 'burned', usedSeats KHÔNG giảm (key cháy)
     *   false -> key ở nguyên trên máy ('assigned'), usedSeats không đổi.
     *            Dùng khi máy giao nguyên trạng cho người khác (Quy tắc 2).
     *
     * Quy tắc 4: thu hồi khỏi shared_account luôn bật cờ đỏ đổi mật khẩu.
     */
    async function revokeAssignment(client, assignmentId, input) {
        const id = toId(assignmentId);
        if (!id) throw new AssetError('assignmentId không hợp lệ');

        const revokedBy = toId(input.revokedBy);
        if (!revokedBy) throw new AssetError('Thiếu revokedBy');

        const now = new Date();
        const returnKeyToPool = input.returnKeyToPool !== false; // mặc định hoàn key

        return inTransaction(client, async (session) => {
            const asg = await assignments.findOne({ _id: id }, { session });
            if (!asg) throw new AssetError('Không tìm thấy phiếu cấp phát', 404);
            if (asg.status === 'revoked') throw new AssetError('Phiếu này đã được thu hồi trước đó');

            let keyReturned = null;

            // --- Thiết bị vật lý ---
            if (asg.assignmentType === 'physical_handover' && asg.physicalAssetId) {
                const back = input.returnToStatus || 'available';
                if (!['available', 'maintenance', 'lost', 'retired'].includes(back)) {
                    throw new AssetError(`Trạng thái trả về "${back}" không hợp lệ`);
                }

                // Chỉ đưa `condition` vào $set khi người thu hồi thực sự ghi
                // tình trạng máy. KHÔNG dùng `condition: x || undefined`: driver
                // serialize `undefined` thành null, mà condition là enum nên
                // validator chặn cả lệnh update (lỗi 121).
                const $set = {
                    status: back,
                    currentHolderId: null,
                    currentHolderName: null,
                    assignedAt: null,
                    updatedAt: now,
                };
                if (input.condition) $set.condition = input.condition;

                await physicalAssets.updateOne(
                    { _id: asg.physicalAssetId },
                    { $set },
                    { session },
                );
            }

            // --- Bản quyền / tài khoản số ---
            if (asg.digitalAssetId) {
                const dig = await digitalAssets.findOne({ _id: asg.digitalAssetId }, { session });
                if (!dig) throw new AssetError('Không tìm thấy tài sản số của phiếu', 404);

                if (asg.allocatedKeyId) {
                    if (returnKeyToPool) {
                        // Key không tái sử dụng được -> đánh dấu cháy, KHÔNG trả seat
                        const nextStatus = dig.isKeyReusable ? 'available' : 'burned';

                        await digitalAssets.updateOne(
                            { _id: dig._id, 'keyPool.keyId': asg.allocatedKeyId },
                            {
                                $set: {
                                    'keyPool.$.status': nextStatus,
                                    'keyPool.$.assignedToAssignmentId': null,
                                    updatedAt: now,
                                },
                                ...(dig.isKeyReusable ? { $inc: { usedSeats: -1 } } : {}),
                            },
                            { session },
                        );
                        keyReturned = dig.isKeyReusable;

                        if (!dig.isKeyReusable) {
                            await audit({
                                assetId: dig._id,
                                assetKind: 'digital',
                                action: 'KEY_BURNED',
                                actorId: revokedBy,
                                actorName: input.actorName || 'IT Admin',
                                details: `Key không tái sử dụng được, đã đánh dấu burned`,
                            }, session);
                        }
                    } else {
                        // Giữ key trên máy cho người kế nhiệm — seat vẫn bị chiếm
                        keyReturned = false;
                    }
                } else {
                    // seat (M365) hoặc lượt kích hoạt MAK -> luôn hoàn về kho
                    await digitalAssets.updateOne(
                        { _id: dig._id },
                        { $inc: { usedSeats: -1 }, $set: { updatedAt: now } },
                        { session },
                    );
                    keyReturned = true;
                }

                // Quy tắc 4: ai đó rời khỏi tài khoản dùng chung -> phải đổi mật khẩu
                if (dig.fulfillmentMethod === 'shared_account') {
                    await digitalAssets.updateOne(
                        { _id: dig._id },
                        { $set: { requiresPasswordRotation: true, updatedAt: now } },
                        { session },
                    );
                }

                await syncDigitalStatus(dig._id, session);
            }

            await assignments.updateOne(
                { _id: id },
                {
                    $set: {
                        status: 'revoked',
                        revokedBy,
                        revokedAt: now,
                        revokeReason: input.revokeReason || null,
                        returnConditionNote: input.returnConditionNote || null,
                        keyReturnedToPool: keyReturned,
                        updatedAt: now,
                    },
                },
                { session },
            );

            await audit({
                assetId: asg.digitalAssetId || asg.physicalAssetId,
                assetKind: asg.digitalAssetId ? 'digital' : 'physical',
                action: 'REVOKE',
                actorId: revokedBy,
                actorName: input.actorName || 'IT Admin',
                details: `Thu hồi của ${asg.employeeName || 'nhân sự'}`
                    + (input.revokeReason ? ` — ${input.revokeReason}` : ''),
                snapshot: { assignmentId: String(id), keyReturnedToPool: keyReturned },
            }, session);

            return { ...asg, status: 'revoked', keyReturnedToPool: keyReturned };
        });
    }

    /**
     * Chuyển máy nguyên trạng sang người khác, giữ nguyên key đã cài (Quy tắc 2).
     *
     * Đặc tả bảo "cập nhật employeeId sang người giữ máy mới", nhưng ghi đè như
     * vậy làm mất dấu ai giữ key trong khoảng nào — trái tinh thần Quy tắc 6.
     * Ở đây làm theo chuỗi revoke + tạo phiếu mới GIỮ NGUYÊN allocatedKeyId:
     * cùng kết quả nghiệp vụ, lịch sử liền mạch, key không rơi về kho rồi được
     * lấy lại (tránh cảnh một máy đang cài Windows mà kho báo key còn trống).
     */
    async function transferDeviceLicenses(client, input) {
        const physicalId = toId(input.physicalAssetId);
        if (!physicalId) throw new AssetError('physicalAssetId không hợp lệ');

        const employee = await getEmployee(input.newEmployeeId);
        const actorId = toId(input.assignedBy);
        if (!actorId) throw new AssetError('Thiếu assignedBy');

        const now = new Date();

        const open = await assignments.find({
            physicalAssetId: physicalId,
            assignmentType: 'digital_device_license',
            status: { $in: HOLDING_STATUSES },
        }).toArray();

        if (open.length === 0) return [];

        const newIds = open.map(() => new ObjectId());

        return inTransaction(client, async (session) => {
            const created = [];

            for (let i = 0; i < open.length; i += 1) {
                const old = open[i];

                await assignments.updateOne(
                    { _id: old._id },
                    {
                        $set: {
                            status: 'revoked',
                            revokedBy: actorId,
                            revokedAt: now,
                            revokeReason: input.reason || 'Chuyển máy nguyên trạng cho nhân sự khác',
                            keyReturnedToPool: false, // key ở nguyên trên máy
                            updatedAt: now,
                        },
                    },
                    { session },
                );

                const doc = {
                    ...old,
                    _id: newIds[i],
                    employeeId: employee._id,
                    employeeName: employee.fullName,
                    employeeEmail: employee.email || null,
                    status: 'active',
                    holderReleased: false,
                    assignedBy: actorId,
                    assignedAt: now,
                    activatedAt: now,
                    revokedBy: null,
                    revokedAt: null,
                    revokeReason: null,
                    returnConditionNote: null,
                    keyReturnedToPool: null,
                    note: `Kế thừa key đã cài trên máy từ ${old.employeeName || 'người giữ trước'}`,
                    createdAt: now,
                    updatedAt: now,
                };

                await assignments.insertOne(doc, { session });

                // Key trong pool giờ trỏ sang phiếu mới
                if (old.allocatedKeyId) {
                    await digitalAssets.updateOne(
                        { _id: old.digitalAssetId, 'keyPool.keyId': old.allocatedKeyId },
                        { $set: { 'keyPool.$.assignedToAssignmentId': newIds[i], updatedAt: now } },
                        { session },
                    );
                }

                created.push(doc);

                await audit({
                    assetId: old.digitalAssetId,
                    assetKind: 'digital',
                    action: 'ASSIGN',
                    actorId,
                    actorName: input.actorName || 'IT Admin',
                    details: `Chuyển bản quyền trên máy sang ${employee.fullName}, giữ nguyên key`,
                }, session);
            }

            return created;
        });
    }

    // -----------------------------------------------------------------------
    // Offboarding (Luồng 4)
    // -----------------------------------------------------------------------

    /** Toàn bộ tài sản một nhân sự đang giữ, phân thành 3 nhóm như đặc tả. */
    async function offboardingSummary(employeeId) {
        const employee = await getEmployee(employeeId);

        const open = await assignments
            .find({ employeeId: employee._id, status: { $in: HOLDING_STATUSES } })
            .sort({ assignedAt: -1 })
            .toArray();

        const physIds = open.map((a) => a.physicalAssetId).filter(Boolean);
        const digIds = open.map((a) => a.digitalAssetId).filter(Boolean);

        const [phys, digs] = await Promise.all([
            physIds.length ? physicalAssets.find({ _id: { $in: physIds } }).toArray() : [],
            digIds.length ? digitalAssets.find({ _id: { $in: digIds } }).toArray() : [],
        ]);
        const physById = new Map(phys.map((p) => [String(p._id), p]));
        const digById = new Map(digs.map((d) => [String(d._id), d]));

        const groups = { physical: [], deviceLicenses: [], userLicenses: [] };
        const sharedAccounts = [];

        for (const a of open) {
            const p = a.physicalAssetId ? physById.get(String(a.physicalAssetId)) : null;
            const d = a.digitalAssetId ? digById.get(String(a.digitalAssetId)) : null;

            // Phiếu digital_device_license có CẢ physicalAssetId lẫn digitalAssetId.
            // Phải rẽ theo assignmentType, không rẽ theo "id nào có mặt": chọn
            // theo id thì phiếu cấp key lại hiện tên chiếc máy, nên màn hình
            // offboarding in ra tên máy hai lần thay vì tên hai bản quyền.
            const isPhysical = a.assignmentType === 'physical_handover';

            const row = {
                assignmentId: String(a._id),
                status: a.status,
                assignedAt: a.assignedAt,
                asset: isPhysical
                    ? (p && { id: String(p._id), code: p.assetCode, name: p.name, serialNumber: p.serialNumber }) || null
                    : (d && {
                        id: String(d._id),
                        name: d.name,
                        provider: d.provider,
                        packagingType: d.packagingType,
                        fulfillmentMethod: d.fulfillmentMethod,
                    }) || null,
                // Máy mà key đang nằm trên đó — chỉ có nghĩa với license gắn theo máy
                machine: !isPhysical && a.physicalAssetId
                    ? {
                        id: String(a.physicalAssetId),
                        code: p ? p.assetCode : null,
                        name: p ? p.name : null,
                    }
                    : null,
            };

            if (a.assignmentType === 'physical_handover') groups.physical.push(row);
            else if (a.assignmentType === 'digital_device_license') groups.deviceLicenses.push(row);
            else groups.userLicenses.push(row);

            if (d && d.fulfillmentMethod === 'shared_account') {
                sharedAccounts.push({
                    assignmentId: String(a._id),
                    digitalAssetId: String(d._id),
                    name: d.name,
                    requiresPasswordRotation: !!d.requiresPasswordRotation,
                });
            }
        }

        return {
            employee: {
                id: String(employee._id),
                name: employee.fullName,
                email: employee.email || null,
                employeeCode: employee.employee ? employee.employee.employeeCode : null,
            },
            groups,
            // Đặc tả: khóa nút hoàn tất cho tới khi IT xác nhận đã đổi mật khẩu
            sharedAccounts,
            blockingSharedAccounts: sharedAccounts.length,
            total: open.length,
        };
    }

    /**
     * Thực thi thu hồi hàng loạt khi nhân sự nghỉ việc.
     *
     * `deviceLicenseAction` cho nhóm bản quyền gắn trên máy:
     *   'keep'   (Lựa chọn A) giữ key trên máy, phiếu -> suspended + holderReleased
     *   'revoke' (Lựa chọn B) format máy, hoàn key về kho
     */
    async function offboardExecute(client, employeeId, input) {
        const employee = await getEmployee(employeeId);
        const revokedBy = toId(input.revokedBy);
        if (!revokedBy) throw new AssetError('Thiếu revokedBy');

        const summary = await offboardingSummary(employeeId);

        // Đặc tả: chặn hoàn tất nếu còn tài khoản dùng chung chưa đổi mật khẩu
        if (summary.blockingSharedAccounts > 0 && !input.sharedAccountsRotated) {
            throw new AssetError(
                `Nhân sự đang giữ ${summary.blockingSharedAccounts} tài khoản dùng chung. `
                + 'Phải đổi mật khẩu gốc và xác nhận (sharedAccountsRotated) trước khi hoàn tất offboarding.',
                409,
            );
        }

        const deviceAction = input.deviceLicenseAction === 'keep' ? 'keep' : 'revoke';
        const now = new Date();
        const result = { physical: 0, deviceLicenses: 0, userLicenses: 0, kept: 0 };

        // Giữ key trên máy: không revoke, chỉ treo phiếu lại
        if (deviceAction === 'keep') {
            for (const row of summary.groups.deviceLicenses) {
                await assignments.updateOne(
                    { _id: new ObjectId(row.assignmentId) },
                    {
                        $set: {
                            status: 'suspended',
                            holderReleased: true,
                            note: 'Nhân sự nghỉ việc, key giữ nguyên trên máy chờ người kế nhiệm',
                            updatedAt: now,
                        },
                    },
                );
                result.kept += 1;
            }
        }

        const toRevoke = [
            ...summary.groups.physical.map((r) => ({ id: r.assignmentId, kind: 'physical' })),
            ...summary.groups.userLicenses.map((r) => ({ id: r.assignmentId, kind: 'user' })),
            ...(deviceAction === 'revoke'
                ? summary.groups.deviceLicenses.map((r) => ({ id: r.assignmentId, kind: 'device' }))
                : []),
        ];

        for (const item of toRevoke) {
            await revokeAssignment(client, item.id, {
                revokedBy,
                actorName: input.actorName || 'HR/IT',
                revokeReason: input.reason || 'Offboarding — nhân sự nghỉ việc',
                returnConditionNote: input.returnConditionNote || null,
                returnToStatus: input.returnToStatus || 'available',
                returnKeyToPool: true,
            });

            if (item.kind === 'physical') result.physical += 1;
            else if (item.kind === 'user') result.userLicenses += 1;
            else result.deviceLicenses += 1;
        }

        await audit({
            assetId: employee._id,
            assetKind: 'physical', // log gắn với hồ sơ nhân sự, không gắn tài sản cụ thể
            action: 'OFFBOARD',
            actorId: revokedBy,
            actorName: input.actorName || 'HR/IT',
            details: `Offboarding ${employee.fullName}: thu hồi ${result.physical} thiết bị, `
                + `${result.userLicenses} license theo người, ${result.deviceLicenses} license trên máy`
                + (result.kept ? `, giữ ${result.kept} key trên máy` : ''),
            snapshot: result,
        });

        return { employee: summary.employee, ...result, deviceLicenseAction: deviceAction };
    }

    return {
        // collections
        physicalAssets,
        digitalAssets,
        assignments,
        auditLogs,
        // helpers
        audit,
        getEmployee,
        syncDigitalStatus,
        digitalStatusFor,
        inTransaction,
        maskKey,
        // nghiệp vụ
        createPhysicalAsset,
        createDigitalAsset,
        assignPhysical,
        assignDigital,
        handoverBundle,
        confirmActivation,
        revokeAssignment,
        transferDeviceLicenses,
        offboardingSummary,
        offboardExecute,
        HOLDING_STATUSES,
    };
}

module.exports = { assetService, AssetError, digitalStatusFor, toId, money, HOLDING_STATUSES };
