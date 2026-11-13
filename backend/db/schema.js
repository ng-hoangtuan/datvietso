/**
 * Định nghĩa 19 collection MongoDB thay cho toàn bộ 33 bảng MySQL.
 * Hệ thống không còn dùng MySQL. Xem MONGODB.md để biết bản đồ chuyển đổi.
 *
 * Mỗi collection gồm:
 *   - replaces: các bảng MySQL mà nó gộp lại (để truy vết khi migrate)
 *   - validator: $jsonSchema giữ lại ràng buộc ENUM + NOT NULL mà Mongo không có sẵn
 *   - indexes:   gồm cả unique index thay cho UNIQUE KEY của MySQL
 *
 * Dùng:
 *   const { syncSchema } = require('./db/schema');
 *   await syncSchema(db);                 // tạo/cập nhật, chạy lại nhiều lần vô hại
 *   await syncSchema(db, { drop: true }); // xóa sạch rồi tạo lại (cho migrate --fresh)
 */

// ---------------------------------------------------------------------------
// Helper cho $jsonSchema. Hậu tố N = cho phép null.
// ---------------------------------------------------------------------------
const str = { bsonType: 'string' };
const strN = { bsonType: ['string', 'null'] };
// JavaScript chỉ có một kiểu số và driver ghi xuống thành double, nên validator
// phải nhận cả 'double' — nếu chỉ để ['int','long'] thì `position: 0` cũng bị từ chối.
const int = { bsonType: ['int', 'long', 'double'] };
const intN = { bsonType: ['int', 'long', 'double', 'null'] };
const num = { bsonType: ['int', 'long', 'double'] };
const money = { bsonType: ['decimal', 'null'] }; // Decimal128 — xem MONGODB.md
const date = { bsonType: 'date' };
const dateN = { bsonType: ['date', 'null'] };
const bool = { bsonType: 'bool' };
const oid = { bsonType: 'objectId' };
const oidN = { bsonType: ['objectId', 'null'] };
const objN = { bsonType: ['object', 'null'] };
const boolN = { bsonType: ['bool', 'null'] };

/**
 * Blob AES-256-GCM: { ct, iv, tag } đều là hex. Không lưu chuỗi phẳng để sau này
 * đổi thuật toán / xoay khóa còn biết đường nhận dạng bản ghi cũ.
 * `encrypted` cho phép null (chưa có key), `encryptedReq` thì bắt buộc.
 */
const encryptedShape = { ct: str, iv: str, tag: str };
const encrypted = { bsonType: ['object', 'null'], required: ['ct', 'iv', 'tag'], properties: encryptedShape };
const encryptedReq = { bsonType: 'object', required: ['ct', 'iv', 'tag'], properties: encryptedShape };

const enumOf = (...values) => ({ enum: values });
const arrayOf = (items) => ({ bsonType: 'array', items });
const shape = (required, properties) => ({ bsonType: 'object', required, properties });

/**
 * Unique index cho field không bắt buộc — nhân sự chưa có tài khoản đăng nhập thì
 * không có username/email. Unique index thường chỉ cho phép MỘT doc thiếu field.
 *
 * Phải dùng `$exists` chứ không phải `$type`: query planner chỉ dùng partial index
 * khi chứng minh được query là tập con của partialFilterExpression. Nó suy ra được
 *     { username: 'x' }  =>  { username: { $exists: true } }
 * nhưng KHÔNG suy ra được
 *     { username: 'x' }  =>  { username: { $type: 'string' } }
 * Đã đo trên Mongo 7: dùng $type thì câu login chạy COLLSCAN, dùng $exists thì IXSCAN.
 *
 * Hệ quả: field không có giá trị thì BỎ HẲN khỏi document, đừng set null.
 */
const uniqueOptional = (field, name) => ({
  keys: { [field]: 1 },
  options: { name, unique: true, partialFilterExpression: { [field]: { $exists: true } } },
});

// ---------------------------------------------------------------------------
// 19 collection
// ---------------------------------------------------------------------------
const COLLECTIONS = [
  // 1. users — gộp `users` + `employees` (employees.user_id là UNIQUE nên 1:1)
  {
    name: 'users',
    replaces: ['users', 'employees'],
    validator: {
      $jsonSchema: shape(['fullName', 'role', 'status', 'createdAt'], {
        // BỎ HẲN field nếu chưa có tài khoản, không set null — xem uniqueOptional()
        username: str,
        email: str,
        passwordHash: strN,
        fullName: str,
        phone: strN,
        avatar: strN,
        role: enumOf('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'EMPLOYEE'),
        status: enumOf('ACTIVE', 'INACTIVE', 'SUSPENDED'),
        lastLoginAt: dateN,
        employee: {
          bsonType: ['object', 'null'],
          required: ['employeeCode', 'departmentId', 'positionId', 'joinDate', 'status'],
          properties: {
            employeeCode: str,
            departmentId: oid,
            department: objN, // snapshot { code, name } để login khỏi lookup
            positionId: oid,
            position: objN, // snapshot { code, title }
            directManagerId: oidN,
            gender: enumOf('MALE', 'FEMALE', 'OTHER'),
            dateOfBirth: dateN,
            idCardNumber: strN,
            joinDate: date,
            contractType: enumOf('PROBATION', 'OFFICIAL_1Y', 'OFFICIAL_3Y', 'INDEFINITE', 'INTERNSHIP'),
            baseSalary: money,
            bankAccountNumber: strN,
            bankName: strN,
            address: strN,
            emergencyContact: objN,
            status: enumOf('PROBATION', 'WORKING', 'ON_LEAVE', 'RESIGNED'),
            resignedDate: dateN,
          },
        },
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      uniqueOptional('username', 'uq_users_username'),
      uniqueOptional('email', 'uq_users_email'),
      uniqueOptional('employee.employeeCode', 'uq_users_employee_code'),
      { keys: { role: 1 }, options: { name: 'ix_users_role' } },
      { keys: { status: 1 }, options: { name: 'ix_users_status' } },
      { keys: { 'employee.departmentId': 1 }, options: { name: 'ix_users_department' } },
      { keys: { 'employee.status': 1 }, options: { name: 'ix_users_employee_status' } },
    ],
  },

  // 2. departments — cây phòng ban, ancestors là materialized path
  {
    name: 'departments',
    replaces: ['departments'],
    validator: {
      $jsonSchema: shape(['code', 'name', 'status', 'createdAt'], {
        code: str,
        name: str,
        parentId: oidN,
        ancestors: arrayOf(oid),
        managerId: oidN,
        description: strN,
        status: enumOf('ACTIVE', 'INACTIVE'),
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { code: 1 }, options: { name: 'uq_departments_code', unique: true } },
      { keys: { status: 1 }, options: { name: 'ix_departments_status' } },
      { keys: { parentId: 1 }, options: { name: 'ix_departments_parent' } },
      { keys: { ancestors: 1 }, options: { name: 'ix_departments_ancestors' } },
    ],
  },

  // 3. positions
  {
    name: 'positions',
    replaces: ['positions'],
    validator: {
      $jsonSchema: shape(['code', 'title', 'createdAt'], {
        code: str,
        title: str,
        departmentId: oidN,
        level: strN,
        description: strN,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { code: 1 }, options: { name: 'uq_positions_code', unique: true } },
      { keys: { departmentId: 1 }, options: { name: 'ix_positions_department' } },
    ],
  },

  // 4. attendances — tăng không giới hạn theo thời gian nên KHÔNG embed vào user
  {
    name: 'attendances',
    replaces: ['attendances'],
    validator: {
      $jsonSchema: shape(['userId', 'date', 'status', 'createdAt'], {
        userId: oid,
        date: date,
        checkIn: strN, // 'HH:MM' — MySQL dùng TIME, Mongo không có kiểu tương đương
        checkOut: strN,
        status: enumOf('ON_TIME', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'HOLIDAY', 'WEEKEND'),
        workHours: num,
        note: strN,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { userId: 1, date: 1 }, options: { name: 'uq_attendances_user_date', unique: true } },
      { keys: { date: -1 }, options: { name: 'ix_attendances_date' } },
    ],
  },

  // 5. leaveRequests
  {
    name: 'leaveRequests',
    replaces: ['leave_requests'],
    validator: {
      $jsonSchema: shape(['userId', 'leaveType', 'startDate', 'endDate', 'reason', 'status', 'createdAt'], {
        userId: oid,
        leaveType: enumOf('ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'COMPENSATORY'),
        startDate: date,
        endDate: date,
        totalDays: num,
        reason: str,
        status: enumOf('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'),
        approvedBy: oidN,
        approvedAt: dateN,
        rejectReason: strN,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { status: 1 }, options: { name: 'ix_leave_status' } },
      { keys: { userId: 1, startDate: -1 }, options: { name: 'ix_leave_user_start' } },
    ],
  },

  // 6. physicalAssets — thiết bị hữu hình (laptop, PC, màn hình, máy test).
  //
  //    Tách khỏi `assets` gộp cũ: thiết bị và bản quyền có vòng đời, trạng thái
  //    và cách cấp phát khác hẳn nhau, nhét chung một collection thì nửa số
  //    field luôn null và validator không ràng buộc được gì.
  //
  //    `bundledOemLicense` là bản quyền Windows OEM chết theo mainboard: nó
  //    KHÔNG phải một digitalAsset, không chiếm seat của kho nào, và đi theo máy
  //    suốt vòng đời (Quy tắc 1 của đặc tả).
  {
    name: 'physicalAssets',
    replaces: ['assets (PHYSICAL)'],
    validator: {
      $jsonSchema: shape(
        ['assetCode', 'serialNumber', 'name', 'category', 'condition', 'status', 'createdAt'],
        {
          assetCode: str, // mã nội bộ, VD "LAP-2026-001"
          serialNumber: str,
          name: str,
          category: enumOf('laptop', 'pc', 'monitor', 'mobile_device', 'peripheral', 'network'),
          specs: strN,
          bundledOemLicense: {
            bsonType: ['object', 'null'],
            required: ['hasOem'],
            properties: {
              hasOem: bool,
              osName: strN,
              encryptedKey: encrypted, // null nếu không trích xuất được key
            },
          },
          condition: enumOf('new', 'good', 'needs_repair', 'broken', 'liquidated'),
          status: enumOf('available', 'assigned', 'maintenance', 'lost', 'retired'),
          // Snapshot người đang giữ, để bảng danh sách không phải lookup
          // assetAssignments cho từng dòng.
          currentHolderId: oidN,
          currentHolderName: strN,
          assignedAt: dateN,
          purchaseDate: dateN,
          warrantyExpiry: dateN,
          cost: money, // Decimal128 — đặc tả để Number, xem Docs/danh-gia-dac-ta-tai-san-so.md mục 2.5
          note: strN,
          createdAt: date,
          updatedAt: date,
        },
      ),
    },
    indexes: [
      { keys: { assetCode: 1 }, options: { name: 'uq_phys_code', unique: true } },
      { keys: { serialNumber: 1 }, options: { name: 'uq_phys_serial', unique: true } },
      { keys: { status: 1, category: 1 }, options: { name: 'ix_phys_status_category' } },
      { keys: { currentHolderId: 1 }, options: { name: 'ix_phys_holder' } },
      { keys: { warrantyExpiry: 1 }, options: { name: 'ix_phys_warranty' } },
      { keys: { updatedAt: -1 }, options: { name: 'ix_phys_updated' } },
    ],
  },

  // 7. digitalAssets — kho bản quyền và tài khoản số.
  //
  //    Hai trục quyết định toàn bộ nghiệp vụ:
  //
  //    `bindingTarget`  'user'   -> bản quyền đi theo NGƯỜI (M365, Figma).
  //                                 Đổi máy không ảnh hưởng.
  //                     'device' -> bản quyền cài trên MÁY (Win FPP/ESD, MAK).
  //                                 Đổi người giữ máy thì bản quyền ở nguyên đó.
  //
  //    `fulfillmentMethod` quyết định cấp phát lấy gì ra:
  //       tenant_seat        -> trừ 1 seat trong usedSeats, gán email vào phiếu
  //       discrete_key_pool  -> lấy 1 key rời khỏi keyPool[] (FPP box, ESD)
  //       mak_volume_key     -> dùng chung 1 key, chỉ đếm số lượt kích hoạt
  //       shared_account     -> dùng chung loginIdentifier + encryptedSecret
  //
  //    `totalSeats: null` = không giới hạn (shared_account), khi đó không bao
  //    giờ chuyển sang 'fully_assigned'.
  {
    name: 'digitalAssets',
    replaces: ['assets (DIGITAL)'],
    validator: {
      $jsonSchema: shape(
        ['name', 'provider', 'packagingType', 'fulfillmentMethod', 'bindingTarget', 'status', 'ownerId', 'createdAt'],
        {
          // Phân cấp cha - con: M365 Tenant (cha) -> gói Basic / Standard (con)
          parentAssetId: oidN,
          isContainerOnly: bool, // true = chỉ là cổng quản trị tổng, không cấp phát trực tiếp

          name: str,
          provider: str,

          packagingType: enumOf(
            'cloud_subscription', // thuê bao theo năm/tháng
            'physical_box_fpp', // hộp cứng FPP, cần lưu kho vỏ hộp
            'digital_esd', // bản điện tử gửi qua email
            'volume_portal', // MAK doanh nghiệp, 1 key cho N máy
            'shared_account', // tài khoản dùng chung
          ),
          fulfillmentMethod: enumOf('tenant_seat', 'mak_volume_key', 'discrete_key_pool', 'shared_account'),
          bindingTarget: enumOf('user', 'device'),

          // false = thu hồi xong key coi như cháy, không hoàn về kho
          isKeyReusable: bool,

          totalSeats: intN, // null = không giới hạn
          usedSeats: int,

          loginIdentifier: strN,
          encryptedSecret: encrypted, // mật khẩu chung HOẶC chuỗi MAK key

          // Key rời cho discrete_key_pool (FPP box, ESD). Mỗi phần tử có keyId
          // riêng để phiếu cấp phát trỏ tới đúng một key.
          keyPool: arrayOf(
            shape(['keyId', 'encryptedKey', 'status'], {
              keyId: oid,
              encryptedKey: encryptedReq,
              status: enumOf('available', 'assigned', 'burned'),
              assignedToAssignmentId: oidN,
              label: strN, // VD "Hộp số 3", để IT đối chiếu với vỏ hộp trong tủ
            }),
          ),

          physicalStorageLocation: strN, // bắt buộc trên UI nếu physical_box_fpp

          recoveryEmail: strN,
          has2FA: bool,
          twoFactorNote: strN,
          // Cờ đỏ: bật khi có người bị thu hồi khỏi shared_account (Quy tắc 4)
          requiresPasswordRotation: bool,

          cost: money,
          currency: enumOf('VND', 'USD'),
          billingCycle: enumOf('monthly', 'yearly', 'one_time'),
          expiryDate: dateN,
          autoRenew: bool,

          status: enumOf('available', 'fully_assigned', 'suspended', 'expired', 'archived'),
          ownerId: oid,
          note: strN,
          createdAt: date,
          updatedAt: date,
        },
      ),
    },
    indexes: [
      { keys: { parentAssetId: 1, status: 1 }, options: { name: 'ix_dig_parent_status' } },
      { keys: { expiryDate: 1, status: 1 }, options: { name: 'ix_dig_expiry_status' } },
      { keys: { provider: 1 }, options: { name: 'ix_dig_provider' } },
      { keys: { bindingTarget: 1, status: 1 }, options: { name: 'ix_dig_binding_status' } },
      { keys: { ownerId: 1 }, options: { name: 'ix_dig_owner' } },
      // Tìm ngược từ key rời về gói chứa nó
      { keys: { 'keyPool.keyId': 1 }, options: { name: 'ix_dig_keypool' } },
      { keys: { requiresPasswordRotation: 1 }, options: { name: 'ix_dig_rotation' } },
    ],
  },

  // 8. assetAssignments — phiếu cấp phát, thay cho `assetAllocations`.
  //
  //    BẤT BIẾN (Quy tắc 6 của đặc tả): phiếu là sổ cái, KHÔNG sửa người nhận và
  //    KHÔNG xóa. Tái cấp phát luôn đi theo chuỗi revoke phiếu cũ -> tạo phiếu
  //    mới. Nhờ vậy câu hỏi "tháng 3/2026 máy LAP-001 do ai giữ" luôn trả lời được.
  //
  //    `holderReleased` giải quyết mâu thuẫn trong đặc tả (employeeId vừa
  //    `required: true` vừa phải set null ở Luồng 4 Lựa chọn A): người giữ đã
  //    nghỉ, key vẫn nằm trên máy chờ người kế nhiệm, nhưng phiếu vẫn giữ nguyên
  //    employeeId để không mất dấu lịch sử.
  {
    name: 'assetAssignments',
    replaces: ['asset_allocations'],
    validator: {
      $jsonSchema: shape(
        ['assignmentType', 'employeeId', 'status', 'assignedBy', 'assignedAt', 'createdAt'],
        {
          assignmentType: enumOf(
            'physical_handover', // bàn giao thiết bị
            'digital_user_license', // bản quyền theo người (M365, SaaS)
            'digital_device_license', // key cài lên máy (Win FPP/ESD/MAK)
          ),

          employeeId: oid,
          employeeName: strN, // snapshot, để bảng lịch sử không phải lookup users
          employeeEmail: strN,

          physicalAssetId: oidN,
          digitalAssetId: oidN,

          // Key cụ thể trong keyPool của digitalAsset (chỉ discrete_key_pool)
          allocatedKeyId: oidN,
          assignedIdentifier: strN, // email được gán seat (tenant_seat)
          accessScope: strN, // "Global Admin", "Editor", "Device License"...

          status: enumOf('pending_activation', 'active', 'suspended', 'revoked'),
          holderReleased: bool, // xem ghi chú ở đầu collection

          assignedBy: oid,
          assignedAt: date,
          activatedAt: dateN,
          handoverConditionNote: strN,

          revokedBy: oidN,
          revokedAt: dateN,
          revokeReason: strN,
          returnConditionNote: strN,
          keyReturnedToPool: boolN, // lúc thu hồi có hoàn key về kho hay không

          note: strN,
          createdAt: date,
          updatedAt: date,
        },
      ),
    },
    indexes: [
      { keys: { employeeId: 1, status: 1 }, options: { name: 'ix_asg_employee_status' } },
      { keys: { physicalAssetId: 1, status: 1 }, options: { name: 'ix_asg_physical_status' } },
      { keys: { digitalAssetId: 1, status: 1 }, options: { name: 'ix_asg_digital_status' } },
      { keys: { status: 1, assignedAt: -1 }, options: { name: 'ix_asg_status_time' } },
      { keys: { allocatedKeyId: 1 }, options: { name: 'ix_asg_key' } },
      // Luồng 6: nhắc nhở phiếu pending_activation quá 3 ngày
      { keys: { status: 1, createdAt: 1 }, options: { name: 'ix_asg_pending_age' } },
    ],
  },

  // 9. assetMaintenances — lịch sử bảo trì. Đặc tả nhắc "Bảo hành/Sửa chữa" ở
  //    Luồng 3 nhưng không định nghĩa schema, nên giữ nguyên collection cũ và
  //    thêm `assetKind` vì giờ assetId có thể trỏ sang hai collection khác nhau.
  {
    name: 'assetMaintenances',
    replaces: ['asset_maintenances'],
    validator: {
      $jsonSchema: shape(['assetId', 'assetKind', 'maintenanceType', 'startDate', 'status', 'createdAt'], {
        assetId: oid,
        assetKind: enumOf('physical', 'digital'),
        maintenanceType: enumOf('ROUTINE', 'REPAIR', 'UPGRADE', 'WARRANTY'),
        cost: money,
        performedBy: strN,
        startDate: date,
        completionDate: dateN,
        status: enumOf('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'),
        note: strN,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { assetId: 1, startDate: -1 }, options: { name: 'ix_maint_asset_start' } },
      { keys: { status: 1 }, options: { name: 'ix_maint_status' } },
    ],
  },

  // 10. assetAuditLogs — append-only. `VIEW_SECRET` ghi lại ai đã bấm xem key
  //     hoặc mật khẩu (đặc tả mục 5.1: "có ghi log ai đã xem").
  //     Muốn tự dọn log cũ thì thêm TTL index trên createdAt.
  {
    name: 'assetAuditLogs',
    replaces: ['asset_audit_logs'],
    validator: {
      $jsonSchema: shape(['assetId', 'assetKind', 'action', 'actorName', 'createdAt'], {
        assetId: oid,
        assetKind: enumOf('physical', 'digital'),
        action: enumOf(
          'CREATE', 'UPDATE', 'DELETE', 'ASSIGN', 'REVOKE', 'ACTIVATE',
          'STATUS_CHANGE', 'MAINTENANCE', 'VIEW_SECRET', 'KEY_BURNED', 'OFFBOARD',
        ),
        actorId: oidN,
        actorName: str,
        details: strN,
        snapshot: objN,
        createdAt: date,
      }),
    },
    indexes: [
      { keys: { assetId: 1, createdAt: -1 }, options: { name: 'ix_audit_asset_created' } },
      { keys: { createdAt: -1 }, options: { name: 'ix_audit_created' } },
      { keys: { action: 1, createdAt: -1 }, options: { name: 'ix_audit_action' } },
      { keys: { actorId: 1, createdAt: -1 }, options: { name: 'ix_audit_actor' } },
    ],
  },

  // 11. conversations — gộp Conversations + GroupMembers.
  //     userId là hex của users._id, dạng CHUỖI (bảng gốc để VARCHAR(100)).
  //
  //     `members[].lastReadAt` là con dấu đọc tới đâu của từng người. Số tin chưa
  //     đọc = đếm message trong phòng có createdAt > lastReadAt, nên không cần
  //     collection `message_reads` riêng như cách làm quan hệ.
  {
    name: 'conversations',
    replaces: ['Conversations', 'GroupMembers'],
    validator: {
      $jsonSchema: shape(['type', 'members', 'createdAt'], {
        type: enumOf('direct', 'group'),
        name: strN,
        avatar: strN,
        pinnedBy: arrayOf(str),
        createdBy: strN,
        members: arrayOf(
          shape(['userId', 'userName', 'role'], {
            userId: str,
            userName: str,
            avatar: strN,
            role: enumOf('owner', 'admin', 'member'),
            joinedAt: dateN,
            lastReadAt: dateN,
          }),
        ),
        lastMessage: objN, // { id, senderId, senderName, type, content, createdAt }
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { 'members.userId': 1, updatedAt: -1 }, options: { name: 'ix_conv_member_updated' } },
      { keys: { type: 1 }, options: { name: 'ix_conv_type' } },
      { keys: { updatedAt: -1 }, options: { name: 'ix_conv_updated' } },
    ],
  },

  // 12. messages — gộp Messages + MessageReactions.
  //     UNIQUE cũ là (message_id, user_id, reaction): một user ĐƯỢC thả nhiều loại
  //     cảm xúc khác nhau trên cùng tin nhắn, chỉ không trùng cùng loại.
  //
  //     Hai field tính sẵn lúc ghi, để đọc chỉ cần một câu dùng index:
  //       - `mentions`: userId được @ trong nội dung, server tự parse theo danh
  //         sách thành viên (không tin mảng client gửi lên). Dùng cho badge
  //         "có người nhắc tên bạn" ở sidebar.
  //       - `attachmentKind`: phân loại sẵn image / video / file / link cho panel
  //         "Bộ sưu tập" (Task 3.2). Nếu để trống rồi lọc bằng regex lúc đọc thì
  //         mỗi lần mở panel phải quét toàn bộ tin nhắn của phòng.
  //
  //     `type: 'system'` là tin nhắn hệ thống (tạo nhóm, thêm/xóa thành viên,
  //     đổi vai trò, đổi tên nhóm) — sender.id = 'system', render giữa khung chat.
  {
    name: 'messages',
    replaces: ['Messages', 'MessageReactions'],
    validator: {
      $jsonSchema: shape(['conversationId', 'sender', 'type', 'createdAt'], {
        conversationId: oid,
        sender: shape(['id'], { id: str, name: strN, avatar: strN }),
        type: enumOf('text', 'media', 'location', 'file', 'system'),
        content: strN,
        metadata: objN,
        mentions: arrayOf(str),
        attachmentKind: { enum: ['image', 'video', 'file', 'link', null] },
        reactions: arrayOf(
          shape(['userId', 'reaction'], { userId: str, reaction: str, createdAt: dateN }),
        ),
        deletedAt: dateN,
        createdAt: date,
      }),
    },
    indexes: [
      { keys: { conversationId: 1, createdAt: -1 }, options: { name: 'ix_msg_conv_created' } },
      { keys: { conversationId: 1, _id: -1 }, options: { name: 'ix_msg_conv_id' } },
      { keys: { 'sender.id': 1 }, options: { name: 'ix_msg_sender' } },
      // Panel Bộ sưu tập: lọc theo loại đính kèm trong một phòng (Task 3.2).
      // partial $exists chứ không $type — xem phụ lục MONGODB.md. Tin không có
      // đính kèm thì BỎ HẲN field, không set null, nếu không index vẫn nuốt hết.
      {
        keys: { conversationId: 1, attachmentKind: 1, createdAt: -1 },
        options: { name: 'ix_msg_conv_attachment', partialFilterExpression: { attachmentKind: { $exists: true } } },
      },
      // Badge mention: đếm tin @ tôi trong phòng, sau mốc lastReadAt (Task 4.1)
      { keys: { conversationId: 1, mentions: 1, createdAt: -1 }, options: { name: 'ix_msg_conv_mentions' } },
    ],
  },

  // 13. kanbanBoards — gộp 4 bảng: boards + board_members + columns + tags
  {
    name: 'kanbanBoards',
    replaces: ['kanban_boards', 'kanban_board_members', 'kanban_columns', 'kanban_tags'],
    validator: {
      $jsonSchema: shape(['title', 'ownerId', 'createdAt'], {
        title: str,
        description: strN,
        color: str,
        icon: str,
        departmentId: oidN,
        ownerId: oid,
        isPrivate: bool,
        members: arrayOf(
          shape(['userId', 'role'], {
            userId: oid, name: strN, avatar: strN,
            role: enumOf('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'),
            createdAt: dateN,
          }),
        ),
        columns: arrayOf(
          shape(['_id', 'title', 'position'], {
            _id: oid, title: str, color: str, position: int, wipLimit: int,
          }),
        ),
        tags: arrayOf(shape(['_id', 'name'], { _id: oid, name: str, color: str })),
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { ownerId: 1 }, options: { name: 'ix_board_owner' } },
      { keys: { 'members.userId': 1 }, options: { name: 'ix_board_member' } },
      { keys: { departmentId: 1 }, options: { name: 'ix_board_department' } },
    ],
  },

  // 14. kanbanCards — gộp 6 bảng. `comments` là chỗ duy nhất có thể tăng không
  //     giới hạn; vượt vài trăm thì tách riêng (giới hạn cứng một doc là 16MB).
  {
    name: 'kanbanCards',
    replaces: [
      'kanban_cards', 'kanban_card_assignees', 'kanban_card_tags',
      'kanban_card_checklists', 'kanban_card_comments', 'kanban_card_attachments',
    ],
    validator: {
      $jsonSchema: shape(['boardId', 'columnId', 'title', 'priority', 'createdBy', 'createdAt'], {
        boardId: oid,
        columnId: oid, // -> kanbanBoards.columns[]._id
        title: str,
        description: strN,
        priority: enumOf('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
        startDate: dateN,
        dueDate: dateN,
        estimatedHours: num,
        actualHours: num,
        position: int,
        isCompleted: bool,
        completedAt: dateN,
        assignees: arrayOf(shape(['userId'], { userId: oid, name: strN, avatar: strN })),
        tagIds: arrayOf(oid), // -> kanbanBoards.tags[]._id
        checklists: arrayOf(
          shape(['_id', 'title'], { _id: oid, title: str, isCompleted: bool, position: int }),
        ),
        comments: arrayOf(
          shape(['_id', 'userId', 'content'], {
            _id: oid, userId: oid, userName: strN, content: str,
            createdAt: dateN, updatedAt: dateN,
          }),
        ),
        attachments: arrayOf(
          shape(['_id', 'fileName', 'fileUrl'], {
            _id: oid, fileName: str, fileUrl: str, fileSize: int,
            fileType: strN, uploadedBy: oidN, createdAt: dateN,
          }),
        ),
        createdBy: oid,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { boardId: 1, columnId: 1, position: 1 }, options: { name: 'ix_card_board_col_pos' } },
      { keys: { columnId: 1, position: 1 }, options: { name: 'ix_card_col_pos' } },
      { keys: { 'assignees.userId': 1 }, options: { name: 'ix_card_assignee' } },
      { keys: { priority: 1 }, options: { name: 'ix_card_priority' } },
      { keys: { dueDate: 1 }, options: { name: 'ix_card_due' } },
    ],
  },

  // 15. calendarCategories
  {
    name: 'calendarCategories',
    replaces: ['calendar_categories'],
    validator: {
      $jsonSchema: shape(['name', 'color', 'createdAt'], {
        name: str, color: str, description: strN, createdAt: date, updatedAt: date,
      }),
    },
    indexes: [{ keys: { name: 1 }, options: { name: 'ix_calcat_name' } }],
  },

  // 16. calendarEvents — gộp events + attendees + reminders
  {
    name: 'calendarEvents',
    replaces: ['calendar_events', 'calendar_event_attendees', 'calendar_event_reminders'],
    validator: {
      $jsonSchema: shape(
        ['title', 'startTime', 'endTime', 'recurrenceRule', 'relatedType', 'createdBy', 'createdAt'],
        {
          title: str,
          description: strN,
          categoryId: oidN,
          category: objN, // snapshot { name, color }
          startTime: date,
          endTime: date,
          isAllDay: bool,
          location: strN,
          meetingUrl: strN,
          recurrenceRule: enumOf('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'),
          recurrenceEnd: dateN,
          relatedType: enumOf('NONE', 'KANBAN_CARD', 'CRM_DEAL', 'CRM_CUSTOMER', 'ASSET_MAINTENANCE'),
          relatedId: oidN,
          attendees: arrayOf(
            shape(['userId', 'status'], {
              userId: oid, name: strN,
              status: enumOf('PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE'),
              responseNote: strN, createdAt: dateN,
            }),
          ),
          reminders: arrayOf(
            shape(['_id', 'remindBeforeMinutes', 'channel', 'status'], {
              _id: oid, remindBeforeMinutes: int,
              channel: enumOf('IN_APP', 'EMAIL', 'CHAT'),
              status: enumOf('PENDING', 'SENT', 'FAILED'),
              createdAt: dateN,
            }),
          ),
          createdBy: oid,
          createdAt: date,
          updatedAt: date,
        },
      ),
    },
    indexes: [
      { keys: { startTime: 1, endTime: 1 }, options: { name: 'ix_event_time' } },
      { keys: { 'attendees.userId': 1, startTime: 1 }, options: { name: 'ix_event_attendee_time' } },
      { keys: { categoryId: 1 }, options: { name: 'ix_event_category' } },
      { keys: { createdBy: 1 }, options: { name: 'ix_event_creator' } },
      { keys: { relatedType: 1, relatedId: 1 }, options: { name: 'ix_event_related' } },
    ],
  },

  // 17. crmCustomers — gộp crm_customers + crm_contacts
  {
    name: 'crmCustomers',
    replaces: ['crm_customers', 'crm_contacts'],
    validator: {
      $jsonSchema: shape(['code', 'companyName', 'customerType', 'customerTier', 'status', 'createdAt'], {
        code: str,
        companyName: str,
        contactName: strN,
        email: strN,
        phone: strN,
        taxCode: strN,
        address: strN,
        website: strN,
        industry: strN,
        customerType: enumOf('ENTERPRISE', 'SME', 'INDIVIDUAL'),
        customerTier: enumOf('STANDARD', 'SILVER', 'GOLD', 'VIP'),
        assignedTo: oidN,
        status: enumOf('PROSPECT', 'ACTIVE', 'INACTIVE'),
        contacts: arrayOf(
          shape(['_id', 'fullName'], {
            _id: oid, fullName: str, position: strN, phone: strN, email: strN,
            isPrimary: bool, createdAt: dateN, updatedAt: dateN,
          }),
        ),
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { code: 1 }, options: { name: 'uq_customers_code', unique: true } },
      { keys: { status: 1 }, options: { name: 'ix_customers_status' } },
      { keys: { assignedTo: 1 }, options: { name: 'ix_customers_assigned' } },
      { keys: { customerTier: 1 }, options: { name: 'ix_customers_tier' } },
    ],
  },

  // 18. crmLeads
  {
    name: 'crmLeads',
    replaces: ['crm_leads'],
    validator: {
      $jsonSchema: shape(['fullName', 'source', 'status', 'createdAt'], {
        fullName: str,
        company: strN,
        email: strN,
        phone: strN,
        source: enumOf('WEBSITE', 'FACEBOOK', 'GOOGLE_ADS', 'REFERRAL', 'EVENT', 'COLD_CALL', 'OTHER'),
        estimatedBudget: money,
        status: enumOf('NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED'),
        assignedTo: oidN,
        convertedCustomerId: oidN,
        note: strN,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { status: 1 }, options: { name: 'ix_leads_status' } },
      { keys: { assignedTo: 1 }, options: { name: 'ix_leads_assigned' } },
      { keys: { email: 1 }, options: { name: 'ix_leads_email' } },
    ],
  },

  // 19. crmDeals
  {
    name: 'crmDeals',
    replaces: ['crm_deals'],
    validator: {
      $jsonSchema: shape(['customerId', 'dealName', 'pipelineStage', 'assignedTo', 'createdAt'], {
        customerId: oid,
        leadId: oidN,
        dealName: str,
        dealValue: money,
        currency: str,
        pipelineStage: enumOf('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'),
        probability: int,
        expectedCloseDate: dateN,
        actualCloseDate: dateN,
        assignedTo: oid,
        lostReason: strN,
        note: strN,
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { pipelineStage: 1 }, options: { name: 'ix_deals_stage' } },
      { keys: { customerId: 1 }, options: { name: 'ix_deals_customer' } },
      { keys: { assignedTo: 1 }, options: { name: 'ix_deals_assigned' } },
      { keys: { expectedCloseDate: 1 }, options: { name: 'ix_deals_expected_close' } },
    ],
  },

  // 20. crmActivities — timeline tăng liên tục, query xuyên customer/deal/lead
  {
    name: 'crmActivities',
    replaces: ['crm_activities'],
    validator: {
      $jsonSchema: shape(['activityType', 'title', 'performedBy', 'status', 'createdAt'], {
        customerId: oidN,
        dealId: oidN,
        leadId: oidN,
        activityType: enumOf('CALL', 'MEETING', 'EMAIL', 'NOTE', 'TASK'),
        title: str,
        description: strN,
        scheduledAt: dateN,
        completedAt: dateN,
        performedBy: oid,
        status: enumOf('PENDING', 'COMPLETED', 'CANCELLED'),
        createdAt: date,
        updatedAt: date,
      }),
    },
    indexes: [
      { keys: { customerId: 1, createdAt: -1 }, options: { name: 'ix_act_customer' } },
      { keys: { dealId: 1, createdAt: -1 }, options: { name: 'ix_act_deal' } },
      { keys: { leadId: 1, createdAt: -1 }, options: { name: 'ix_act_lead' } },
      { keys: { activityType: 1 }, options: { name: 'ix_act_type' } },
      { keys: { status: 1, scheduledAt: 1 }, options: { name: 'ix_act_status_sched' } },
    ],
  },
];

const COLLECTION_NAMES = COLLECTIONS.map((c) => c.name);

/**
 * Collection của mô hình tài sản CŨ, đã bị `physicalAssets` / `digitalAssets` /
 * `assetAssignments` thay thế (xem Docs/danh-gia-dac-ta-tai-san-so.md).
 *
 * Giữ tên ở đây để `--fresh` dọn luôn, nếu không chúng nằm lại trong database
 * như rác mà không collection nào quản lý. Chạy KHÔNG có `--fresh` thì chỉ cảnh
 * báo, không tự xóa dữ liệu của ai.
 */
const LEGACY_COLLECTIONS = ['assets', 'assetAllocations'];

// ---------------------------------------------------------------------------
// Áp schema lên database
// ---------------------------------------------------------------------------

/**
 * Tạo hoặc cập nhật 19 collection cùng validator và index. Chạy lại nhiều lần vô hại.
 *
 * @param {import('mongodb').Db} db
 * @param {object}  [opts]
 * @param {boolean} [opts.drop=false]   xóa sạch collection trước khi tạo lại
 * @param {boolean} [opts.verbose=true] in tiến trình
 * @param {string[]} [opts.only]        chỉ xử lý các collection này
 * @param {'strict'|'moderate'} [opts.validationLevel='strict']
 */
async function syncSchema(db, opts = {}) {
  const { drop = false, verbose = true, validationLevel = 'strict', only = null } = opts;
  const log = verbose ? (...a) => console.log(...a) : () => {};

  // `only` thu hẹp phạm vi — dùng khi chỉ muốn dựng lại vài collection (ví dụ
  // làm mới dữ liệu chat) mà không đụng tới phần còn lại của database.
  const wanted = only && only.length > 0 ? new Set(only) : null;
  const targets = COLLECTIONS.filter((c) => !wanted || wanted.has(c.name));
  const targetNames = targets.map((c) => c.name);

  if (wanted) {
    const unknown = [...wanted].filter((n) => !COLLECTION_NAMES.includes(n));
    if (unknown.length > 0) {
      throw new Error(`Collection không tồn tại: ${unknown.join(', ')}`);
    }
  }

  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );

  if (drop) {
    for (const name of targetNames) {
      if (existing.has(name)) {
        await db.collection(name).drop();
        existing.delete(name);
      }
    }
    log(`   đã xóa ${targetNames.length} collection cũ (--fresh)`);
  }

  // Mô hình tài sản cũ đã bị thay thế. Chỉ dọn khi --fresh và không giới hạn
  // --only; ngoài ra chỉ cảnh báo, không tự xóa dữ liệu của ai.
  if (!wanted) {
    for (const name of LEGACY_COLLECTIONS) {
      if (!existing.has(name)) continue;

      if (drop) {
        await db.collection(name).drop();
        existing.delete(name);
        log(`   đã xóa collection cũ không còn dùng: ${name}`);
      } else {
        const n = await db.collection(name).countDocuments();
        log(`   ⚠ '${name}' không còn thuộc schema (${n} doc). `
          + 'Mô hình tài sản đã chuyển sang physicalAssets / digitalAssets / '
          + 'assetAssignments. Dùng --fresh để dọn.');
      }
    }
  }

  let createdCount = 0;
  let indexCount = 0;

  for (const def of targets) {
    if (existing.has(def.name)) {
      await db.command({
        collMod: def.name,
        validator: def.validator,
        validationLevel,
        validationAction: 'error',
      });
    } else {
      await db.createCollection(def.name, {
        validator: def.validator,
        validationLevel,
        validationAction: 'error',
      });
      createdCount += 1;
    }

    if (def.indexes && def.indexes.length > 0) {
      // Index đã tồn tại cùng TÊN nhưng khác định nghĩa thì phải xóa rồi tạo lại.
      // MongoDB từ chối createIndexes trong trường hợp đó ("An existing index has
      // the same name as the requested index") và cả lệnh migrate dừng giữa chừng.
      //
      // Chỉ gặp khi nâng cấp database ĐANG CÓ dữ liệu — `--fresh` xóa sạch nên
      // không bao giờ lộ ra. Ví dụ thật: `ix_audit_action` từ {action:1} đổi
      // thành {action:1, createdAt:-1} khi chuyển sang mô hình tài sản mới.
      if (existing.has(def.name)) {
        const current = await db.collection(def.name).indexes();
        const byName = new Map(current.map((i) => [i.name, i]));

        for (const want of def.indexes) {
          const have = byName.get(want.options.name);
          if (!have) continue;

          const sameKey = JSON.stringify(have.key) === JSON.stringify(want.keys);
          const o = want.options;
          const sameUnique = !!have.unique === !!o.unique;
          const samePartial = JSON.stringify(have.partialFilterExpression || null)
            === JSON.stringify(o.partialFilterExpression || null);

          if (!sameKey || !sameUnique || !samePartial) {
            await db.collection(def.name).dropIndex(want.options.name);
            log(`   đổi định nghĩa index ${def.name}.${want.options.name}, tạo lại`);
          }
        }
      }

      await db.collection(def.name).createIndexes(
        def.indexes.map((i) => ({ key: i.keys, ...i.options })),
      );
      indexCount += def.indexes.length;
    }

    log(`   ${def.name.padEnd(20)} <- ${def.replaces.join(', ')}`);
  }

  log(
    `\n   ✔ ${COLLECTIONS.length} collection (${createdCount} tạo mới), ${indexCount} index. `
    + `Thay cho ${COLLECTIONS.reduce((n, c) => n + c.replaces.length, 0)} bảng MySQL.`,
  );

  return { collections: COLLECTIONS.length, created: createdCount, indexes: indexCount };
}

module.exports = { COLLECTIONS, COLLECTION_NAMES, LEGACY_COLLECTIONS, syncSchema };
