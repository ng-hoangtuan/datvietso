/**
 * Dữ liệu mẫu, chuyển từ `migrations/20261109_seed_data.sql` sang Mongo.
 *
 * Khác biệt chính so với bản SQL:
 *   - ID số AUTO_INCREMENT -> ObjectId sinh trước, tham chiếu theo mã nghiệp vụ
 *     (BGD, DVS-002, TS-PHY-001...) thay vì theo số thứ tự.
 *   - `users` + `employees` gộp thành một doc.
 *   - Tiền dùng Decimal128, KHÔNG dùng Number.
 *   - Mốc thời gian ghi kèm offset +07:00 để seed không lệch theo múi giờ máy chạy.
 *   - `conversations.lastMessage` tính sẵn — thay cho câu COUNT(*) của bản MySQL.
 *
 * Những bảng bản SQL không seed thì ở đây cũng để trống: attendances,
 * leave_requests, asset_maintenances, asset_audit_logs, crm_contacts, crm_leads,
 * calendar_event_attendees/reminders, kanban checklists/comments/attachments.
 */
const { ObjectId, Decimal128 } = require('mongodb');

// Tin nhan mau di qua dung tang nghiep vu ma REST va socket dung, nen
// attachmentKind / mentions duoc tinh y nhu tin nhan that.
const { buildMessage, buildSystemMessage, lastMessageSnapshot } = require('../services/chat');

// Key bản quyền và mật khẩu tài khoản dùng chung đi qua đúng lớp mã hoá mà
// API dùng — seed KHÔNG lưu plaintext.
const { encrypt } = require('../services/assetCrypto');

/** Tiền: luôn qua Decimal128, nhận chuỗi để không mất chính xác dọc đường. */
const money = (v) => Decimal128.fromString(String(v));

/** Ngày (không giờ) — ghim UTC để không lệch ngày theo máy. */
const day = (s) => new Date(`${s}T00:00:00Z`);

/** Mốc thời gian theo giờ Việt Nam. */
const vn = (s) => new Date(`${s}+07:00`);

const avatar = (seed) => `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;

/** username trong seed, dùng để tra lại user đang có khi chỉ nạp một phần. */
const SEED_USERNAMES = {
  admin: 'admin',
  tuan: 'tuan.dev',
  hoa: 'hoa.sales',
  lan: 'lan.hr',
};

/**
 * @param {object} [opts]
 * @param {object} [opts.userIds] _id CÓ SẴN của 4 user, dạng { admin, tuan, hoa, lan }.
 *   Bắt buộc truyền khi nạp một phần mà KHÔNG nạp lại `users`: mặc định hàm này
 *   sinh ObjectId mới mỗi lần chạy, nên nếu cứ để mặc định thì conversations và
 *   messages sẽ trỏ vào user không tồn tại — đăng nhập vào sẽ không thấy phòng nào.
 */
function buildSeed(opts = {}) {
  const { userIds = null } = opts;
  const now = new Date();
  const oid = () => new ObjectId();

  const id = {
    dept: { BGD: oid(), TECH: oid(), SALES: oid(), HR: oid() },
    pos: { CEO: oid(), TECH_LEAD: oid(), SENIOR_DEV: oid(), SALES_LEAD: oid(), HR_LEAD: oid() },
    user: userIds || { admin: oid(), tuan: oid(), hoa: oid(), lan: oid() },
    phys: { laptopTuan: oid(), laptopHoa: oid(), laptopKho: oid(), manHinh: oid(), dienThoai: oid() },
    dig: {
      m365Tenant: oid(), m365Basic: oid(), m365Standard: oid(),
      winFpp: oid(), winEsd: oid(), officeMak: oid(), figmaShared: oid(), canva: oid(),
    },
    // keyId của từng key rời trong keyPool, đặt theo chính chuỗi key cho dễ tra
    key: {
      'VK7JD-2HTYU-9XQWE-4RMNB-7T8K9': oid(),
      'TR4PL-8MWQZ-3NVKD-6YHCX-2F5G7': oid(),
      'QX9WN-5JBTR-7KDHM-2PVLY-8S3C6': oid(),
      'HM2KV-6RQDX-4TNBW-9ZCPJ-5L7F8': oid(),
      'BN8CT-3YKWP-6HDQR-5XMVZ-4J9G2': oid(),
      'WE5XQ-7NTCB-2KVHD-8RMPY-3J6L4': oid(),
      'ZD9FR-4HKWN-6TQBV-2XCLM-7P5S8': oid(),
      'KP3MT-9VBXQ-5WNHR-4DJCZ-6Y2G7': oid(),
    },
    asg: {
      asgLaptopTuan: oid(), asgWinTuan: oid(), asgOfficeTuan: oid(), asgM365Tuan: oid(),
      asgLaptopHoa: oid(), asgM365Hoa: oid(), asgFigmaHoa: oid(),
      asgM365Admin: oid(), asgCanvaLan: oid(), asgManHinhLanCu: oid(),
    },
    conv: { company: oid(), techProject: oid(), adminTuan: oid(), tuanHoa: oid() },
    board: oid(),
    col: { todo: oid(), doing: oid(), review: oid(), done: oid() },
    tag: { backend: oid(), uiux: oid(), high: oid(), database: oid() },
    card: { schema: oid(), kanbanUi: oid(), socket: oid() },
    calCat: { internal: oid(), customer: oid(), deadline: oid(), event: oid() },
    customer: { saomai: oid(), angiaphat: oid() },
    deal: { erp: oid(), assetCrm: oid() },
  };

  // Trong hệ chat, userId là hex của users._id ở dạng CHUỖI (bảng gốc dùng
  // VARCHAR(100)). Xem ghi chú ở schema.js.
  const chatId = (k) => id.user[k].toHexString();

  /** Tên và email 4 nhân sự mẫu — dùng lại ở cả phần tài sản lẫn phần chat. */
  const WHO = {
    admin: { name: 'Nguyễn Quản Trị', seed: 'Admin' },
    tuan: { name: 'Trần Anh Tuấn', seed: 'Tuan' },
    hoa: { name: 'Lê Thị Mai Hoa', seed: 'Hoa' },
    lan: { name: 'Phạm Ngọc Lan', seed: 'Lan' },
  };
  const EMAIL = {
    admin: 'admin@datvietso.vn',
    tuan: 'tuan.tech@datvietso.vn',
    hoa: 'hoa.sales@datvietso.vn',
    lan: 'lan.hr@datvietso.vn',
  };

  // -------------------------------------------------------------------------
  // 1. Phòng ban (BGD là gốc, 3 khối còn lại là con)
  // -------------------------------------------------------------------------
  const deptMeta = {
    BGD: { code: 'BGD', name: 'Ban Giám Đốc' },
    TECH: { code: 'TECH', name: 'Khối Kỹ Thuật & Công Nghệ' },
    SALES: { code: 'SALES', name: 'Khối Kinh Doanh & CRM' },
    HR: { code: 'HR', name: 'Phòng Hành Chính & Nhân Sự' },
  };

  const mkDept = (key, parentKey, managerKey, description) => ({
    _id: id.dept[key],
    ...deptMeta[key],
    parentId: parentKey ? id.dept[parentKey] : null,
    ancestors: parentKey ? [id.dept[parentKey]] : [],
    managerId: id.user[managerKey],
    description,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  });

  const departments = [
    mkDept('BGD', null, 'admin', 'Điều hành chiến lược toàn công ty'),
    mkDept('TECH', 'BGD', 'tuan', 'Phát triển phần mềm, hạ tầng & bảo mật'),
    mkDept('SALES', 'BGD', 'hoa', 'Tư vấn giải pháp, bán hàng và chăm sóc khách hàng'),
    mkDept('HR', 'BGD', 'lan', 'Quản lý nhân sự, chế độ đãi ngộ & văn hóa doanh nghiệp'),
  ];

  // -------------------------------------------------------------------------
  // 2. Chức danh
  // -------------------------------------------------------------------------
  const posMeta = {
    CEO: { code: 'CEO', title: 'Tổng Giám Đốc' },
    TECH_LEAD: { code: 'TECH_LEAD', title: 'Trưởng Phòng Kỹ Thuật' },
    SENIOR_DEV: { code: 'SENIOR_DEV', title: 'Kỹ Sư Phần Mềm Cao Cấp' },
    SALES_LEAD: { code: 'SALES_LEAD', title: 'Trưởng Phòng Kinh Doanh' },
    HR_LEAD: { code: 'HR_LEAD', title: 'Trưởng Phòng Nhân Sự' },
  };

  const positions = [
    { key: 'CEO', dept: 'BGD', level: 'Manager', description: 'Điều hành tổng thể' },
    { key: 'TECH_LEAD', dept: 'TECH', level: 'Leader', description: 'Quản lý team kỹ thuật & kiến trúc hệ thống' },
    { key: 'SENIOR_DEV', dept: 'TECH', level: 'Senior', description: 'Lập trình Fullstack & DevOps' },
    { key: 'SALES_LEAD', dept: 'SALES', level: 'Leader', description: 'Chỉ đạo kinh doanh & đối ngoại' },
    { key: 'HR_LEAD', dept: 'HR', level: 'Leader', description: 'Tuyển dụng & Đào tạo' },
  ].map((p) => ({
    _id: id.pos[p.key],
    ...posMeta[p.key],
    departmentId: id.dept[p.dept],
    level: p.level,
    description: p.description,
    createdAt: now,
    updatedAt: now,
  }));

  // -------------------------------------------------------------------------
  // 3. users — gộp users + employees, kèm snapshot phòng ban / chức vụ
  // -------------------------------------------------------------------------
  // Placeholder giữ nguyên giá trị giả trong seed cũ. KHÔNG phải bcrypt hash thật
  // — xem mục "ba lỗi nên sửa" trong MONGODB.md.
  const PLACEHOLDER_HASH = '$2a$10$abcdefghijklmnopqrstuv';

  const mkUser = (key, u) => ({
    _id: id.user[key],
    username: u.username,
    email: u.email,
    passwordHash: PLACEHOLDER_HASH,
    fullName: u.fullName,
    phone: u.phone,
    avatar: avatar(u.avatarSeed),
    role: u.role,
    status: 'ACTIVE',
    lastLoginAt: null,
    employee: {
      employeeCode: u.code,
      departmentId: id.dept[u.dept],
      department: deptMeta[u.dept],
      positionId: id.pos[u.pos],
      position: posMeta[u.pos],
      directManagerId: u.manager ? id.user[u.manager] : null,
      gender: u.gender,
      dateOfBirth: day(u.dob),
      idCardNumber: u.idCard,
      joinDate: day(u.joinDate),
      contractType: u.contract,
      baseSalary: money(u.salary),
      bankAccountNumber: null,
      bankName: null,
      address: null,
      emergencyContact: null,
      status: 'WORKING',
      resignedDate: null,
    },
    createdAt: now,
    updatedAt: now,
  });

  const users = [
    mkUser('admin', {
      username: 'admin', email: 'admin@datvietso.vn', fullName: 'Nguyễn Quản Trị',
      phone: '0901234567', avatarSeed: 'Admin', role: 'SUPER_ADMIN',
      code: 'DVS-001', dept: 'BGD', pos: 'CEO', manager: null, gender: 'MALE',
      dob: '1988-05-15', idCard: '001088001234', joinDate: '2023-01-01',
      contract: 'INDEFINITE', salary: 50000000,
    }),
    mkUser('tuan', {
      username: 'tuan.dev', email: 'tuan.tech@datvietso.vn', fullName: 'Trần Anh Tuấn',
      phone: '0912345678', avatarSeed: 'Tuan', role: 'EMPLOYEE',
      code: 'DVS-002', dept: 'TECH', pos: 'SENIOR_DEV', manager: 'admin', gender: 'MALE',
      dob: '1995-10-20', idCard: '001095002345', joinDate: '2023-06-01',
      contract: 'OFFICIAL_3Y', salary: 25000000,
    }),
    mkUser('hoa', {
      username: 'hoa.sales', email: 'hoa.sales@datvietso.vn', fullName: 'Lê Thị Mai Hoa',
      phone: '0923456789', avatarSeed: 'Hoa', role: 'EMPLOYEE',
      code: 'DVS-003', dept: 'SALES', pos: 'SALES_LEAD', manager: 'admin', gender: 'FEMALE',
      dob: '1996-08-12', idCard: '001096003456', joinDate: '2023-08-15',
      contract: 'OFFICIAL_3Y', salary: 22000000,
    }),
    mkUser('lan', {
      username: 'lan.hr', email: 'lan.hr@datvietso.vn', fullName: 'Phạm Ngọc Lan',
      phone: '0934567890', avatarSeed: 'Lan', role: 'HR_MANAGER',
      code: 'DVS-004', dept: 'HR', pos: 'HR_LEAD', manager: 'admin', gender: 'FEMALE',
      dob: '1994-03-25', idCard: '001094004567', joinDate: '2023-03-10',
      contract: 'INDEFINITE', salary: 20000000,
    }),
  ];

  // -------------------------------------------------------------------------
  // 4. Tài sản hữu hình
  //
  //    Bộ dữ liệu phủ các tình huống mà đặc tả phân biệt:
  //      - máy KHÔNG có OEM, phải cấp key FPP rời (Luồng 2 bước 2)
  //      - máy CÓ sẵn Windows OEM chết theo mainboard (Quy tắc 1)
  //      - máy đang rảnh trong kho, máy đang có người giữ
  // -------------------------------------------------------------------------
  const mkPhysical = (key, p) => ({
    _id: id.phys[key],
    assetCode: p.assetCode,
    serialNumber: p.serial,
    name: p.name,
    category: p.category,
    specs: p.specs || null,
    bundledOemLicense: {
      hasOem: !!p.oem,
      osName: p.oem || null,
      // Key OEM thường không trích xuất được khỏi mainboard -> để null
      encryptedKey: p.oemKey ? encrypt(p.oemKey) : null,
    },
    condition: p.condition || 'good',
    status: p.holder ? 'assigned' : 'available',
    currentHolderId: p.holder ? id.user[p.holder] : null,
    currentHolderName: p.holder ? WHO[p.holder].name : null,
    assignedAt: p.holder ? vn(p.assignedAt) : null,
    purchaseDate: day(p.purchaseDate),
    warrantyExpiry: day(p.warrantyExpiry),
    cost: money(p.cost),
    note: p.note || null,
    createdAt: now,
    updatedAt: now,
  });

  const physicalAssets = [
    mkPhysical('laptopTuan', {
      assetCode: 'LAP-2026-001', serial: 'DL5440X7742', name: 'Dell Latitude 5440',
      category: 'laptop', specs: 'Core i7-1365U / 16GB RAM / 512GB SSD',
      // Không kèm OEM -> phải cấp key Windows FPP rời từ kho
      condition: 'good', holder: 'tuan', assignedAt: '2026-01-10T09:00:00',
      purchaseDate: '2025-12-20', warrantyExpiry: '2028-12-20', cost: 28500000,
      note: 'Máy chính của kỹ sư phần mềm',
    }),
    mkPhysical('laptopHoa', {
      assetCode: 'LAP-2026-002', serial: 'C02G998877', name: 'MacBook Pro 14 M3',
      category: 'laptop', specs: 'M3 Pro / 18GB RAM / 512GB SSD',
      condition: 'new', holder: 'hoa', assignedAt: '2026-02-01T09:00:00',
      purchaseDate: '2026-01-25', warrantyExpiry: '2027-01-25', cost: 52000000,
      note: 'Máy khối kinh doanh, không cài Windows',
    }),
    mkPhysical('laptopKho', {
      assetCode: 'LAP-2026-003', serial: 'DL5440X7988', name: 'Dell Latitude 5440',
      category: 'laptop', specs: 'Core i5-1345U / 16GB RAM / 512GB SSD',
      // Quy tắc 1: Windows OEM gắn chết theo máy, KHÔNG chiếm chỗ của kho nào
      oem: 'Windows 11 Pro OEM', oemKey: 'OEM11-PRO44-DELL5-440XX-99881',
      condition: 'new', holder: null,
      purchaseDate: '2026-03-01', warrantyExpiry: '2029-03-01', cost: 26900000,
      note: 'Máy dự phòng, đã kèm sẵn Windows OEM',
    }),
    mkPhysical('manHinh', {
      assetCode: 'MON-2025-014', serial: 'CN05X992AB', name: 'Dell UltraSharp U2723QE 4K',
      category: 'monitor', specs: '27 inch 4K IPS Black',
      condition: 'good', holder: null,
      purchaseDate: '2025-02-10', warrantyExpiry: '2028-02-10', cost: 13500000,
      note: 'Vừa thu hồi, đang trong kho',
    }),
    mkPhysical('dienThoai', {
      assetCode: 'MOB-2025-003', serial: 'RFCT90XK2P', name: 'Samsung Galaxy A54 (máy test)',
      category: 'mobile_device', specs: 'Android 14 / 8GB RAM',
      condition: 'good', holder: null,
      purchaseDate: '2025-06-15', warrantyExpiry: '2026-06-15', cost: 8900000,
      note: 'Dùng để kiểm thử ứng dụng trên Android',
    }),
  ];

  // -------------------------------------------------------------------------
  // 5. Tài sản số — phủ đủ 5 packagingType và 4 fulfillmentMethod của đặc tả
  //
  //    BẤT BIẾN: `usedSeats` phải khớp số phiếu đang chiếm chỗ ở mục 6, và
  //    `keyPool[].status` phải khớp phiếu trỏ tới nó. Sửa chỗ này nhớ sửa cả
  //    mục 6, nếu không kho báo sai ngay từ lúc seed.
  // -------------------------------------------------------------------------
  const mkKey = (keyStr, status, assignmentKey, label) => ({
    keyId: id.key[keyStr],
    encryptedKey: encrypt(keyStr),
    status,
    assignedToAssignmentId: assignmentKey ? id.asg[assignmentKey] : null,
    label: label || null,
  });

  const digitalBase = {
    isContainerOnly: false,
    parentAssetId: null,
    isKeyReusable: true,
    loginIdentifier: null,
    encryptedSecret: null,
    keyPool: [],
    physicalStorageLocation: null,
    recoveryEmail: 'it-admin@datvietso.vn',
    has2FA: false,
    twoFactorNote: null,
    requiresPasswordRotation: false,
    currency: 'VND',
    billingCycle: 'yearly',
    expiryDate: null,
    autoRenew: false,
    note: null,
    createdAt: now,
    updatedAt: now,
  };

  const digitalAssets = [
    // --- Microsoft 365: tenant cha + 2 gói con (phân cấp) -------------------
    {
      ...digitalBase,
      _id: id.dig.m365Tenant,
      isContainerOnly: true, // chỉ là cổng quản trị, không cấp phát trực tiếp
      name: 'Microsoft 365 Tenant — datvietso.onmicrosoft.com',
      provider: 'Microsoft',
      packagingType: 'cloud_subscription',
      fulfillmentMethod: 'tenant_seat',
      bindingTarget: 'user',
      totalSeats: null, // cổng tổng, không có khái niệm số chỗ
      usedSeats: 0,
      loginIdentifier: 'admin@datvietso.onmicrosoft.com',
      encryptedSecret: encrypt('Tenant#Admin2026!'),
      has2FA: true,
      twoFactorNote: 'MFA qua Microsoft Authenticator trên máy IT Lead',
      cost: money(0),
      status: 'available',
      ownerId: id.user.tuan,
      note: 'Cổng quản trị tổng. Gói con nằm bên dưới.',
    },
    {
      ...digitalBase,
      _id: id.dig.m365Basic,
      parentAssetId: id.dig.m365Tenant,
      name: 'Microsoft 365 Business Basic',
      provider: 'Microsoft',
      packagingType: 'cloud_subscription',
      fulfillmentMethod: 'tenant_seat',
      bindingTarget: 'user', // đi theo NGƯỜI: đổi máy không ảnh hưởng
      totalSeats: 20,
      usedSeats: 2, // phiếu asgM365Tuan + asgM365Hoa
      cost: money(45000000),
      billingCycle: 'yearly',
      expiryDate: day('2026-12-31'),
      autoRenew: true,
      status: 'available',
      ownerId: id.user.tuan,
    },
    {
      ...digitalBase,
      _id: id.dig.m365Standard,
      parentAssetId: id.dig.m365Tenant,
      name: 'Microsoft 365 Business Standard',
      provider: 'Microsoft',
      packagingType: 'cloud_subscription',
      fulfillmentMethod: 'tenant_seat',
      bindingTarget: 'user',
      totalSeats: 5,
      usedSeats: 1, // asgM365Admin
      cost: money(18500000),
      expiryDate: day('2026-12-31'),
      autoRenew: true,
      status: 'available',
      ownerId: id.user.tuan,
    },

    // --- Lô hộp cứng Windows 11 Pro FPP: kho key rời, gắn theo MÁY ----------
    {
      ...digitalBase,
      _id: id.dig.winFpp,
      name: 'Lô 5 hộp Windows 11 Pro FPP',
      provider: 'Microsoft',
      packagingType: 'physical_box_fpp',
      fulfillmentMethod: 'discrete_key_pool',
      bindingTarget: 'device', // cài lên máy cụ thể (Quy tắc 2)
      isKeyReusable: true, // FPP chuyển máy được
      totalSeats: 5, // = số key trong kho
      usedSeats: 1, // key số 1 đang nằm trên LAP-2026-001
      keyPool: [
        mkKey('VK7JD-2HTYU-9XQWE-4RMNB-7T8K9', 'assigned', 'asgWinTuan', 'Hộp số 1'),
        mkKey('TR4PL-8MWQZ-3NVKD-6YHCX-2F5G7', 'available', null, 'Hộp số 2'),
        mkKey('QX9WN-5JBTR-7KDHM-2PVLY-8S3C6', 'available', null, 'Hộp số 3'),
        mkKey('HM2KV-6RQDX-4TNBW-9ZCPJ-5L7F8', 'available', null, 'Hộp số 4'),
        mkKey('BN8CT-3YKWP-6HDQR-5XMVZ-4J9G2', 'available', null, 'Hộp số 5'),
      ],
      physicalStorageLocation: 'Tủ IT — Ngăn B2',
      cost: money(24500000),
      billingCycle: 'one_time',
      status: 'available',
      ownerId: id.user.tuan,
      note: 'Vỏ hộp lưu trong tủ IT, cần cho kiểm toán bản quyền',
    },

    // --- Windows 11 Pro ESD: key điện tử gửi qua email, gắn theo MÁY -------
    {
      ...digitalBase,
      _id: id.dig.winEsd,
      name: 'Windows 11 Pro ESD — 3 key điện tử',
      provider: 'Microsoft',
      packagingType: 'digital_esd', // gửi qua email, không có vỏ hộp để cất
      fulfillmentMethod: 'discrete_key_pool',
      bindingTarget: 'device',
      isKeyReusable: true,
      totalSeats: 3,
      usedSeats: 0, // còn nguyên trong kho
      keyPool: [
        mkKey('WE5XQ-7NTCB-2KVHD-8RMPY-3J6L4', 'available', null, 'ESD lô tháng 3'),
        mkKey('ZD9FR-4HKWN-6TQBV-2XCLM-7P5S8', 'available', null, 'ESD lô tháng 3'),
        mkKey('KP3MT-9VBXQ-5WNHR-4DJCZ-6Y2G7', 'available', null, 'ESD lô tháng 3'),
      ],
      cost: money(14700000),
      billingCycle: 'one_time',
      status: 'available',
      ownerId: id.user.tuan,
      note: 'Key gửi qua email từ nhà phân phối, lưu trong hộp thư it-admin@',
    },

    // --- Office LTSC MAK: một key dùng cho N máy, gắn theo MÁY --------------
    {
      ...digitalBase,
      _id: id.dig.officeMak,
      name: 'Office LTSC 2024 — MAK Volume',
      provider: 'Microsoft',
      packagingType: 'volume_portal',
      fulfillmentMethod: 'mak_volume_key',
      bindingTarget: 'device',
      isKeyReusable: false, // mỗi lượt kích hoạt MAK là tiêu một lượt, không hoàn lại
      totalSeats: 50, // số lượt kích hoạt tối đa
      usedSeats: 1,
      loginIdentifier: 'VLSC — datvietso',
      encryptedSecret: encrypt('MAKVL-2024X-OFFIC-LTSC7-99KD3'),
      cost: money(68000000),
      billingCycle: 'one_time',
      status: 'available',
      ownerId: id.user.tuan,
      note: 'Key dùng chung, KHÔNG gửi cho nhân sự — IT tự kích hoạt trên máy',
    },

    // --- Tài khoản dùng chung: không giới hạn chỗ --------------------------
    {
      ...digitalBase,
      _id: id.dig.figmaShared,
      name: 'Figma Organization — tài khoản thiết kế dùng chung',
      provider: 'Figma',
      packagingType: 'shared_account',
      fulfillmentMethod: 'shared_account',
      bindingTarget: 'user',
      totalSeats: null, // không giới hạn -> không bao giờ 'fully_assigned'
      usedSeats: 1,
      loginIdentifier: 'design@datvietso.vn',
      encryptedSecret: encrypt('Fig#Design@2026'),
      has2FA: false,
      cost: money(12000000),
      expiryDate: day('2026-11-30'),
      autoRenew: false,
      status: 'available',
      ownerId: id.user.hoa,
      note: 'Thu hồi bất kỳ ai cũng phải đổi mật khẩu gốc (Quy tắc 4)',
    },

    // --- Gói sắp hết hạn: để cron Luồng 6 có việc mà cảnh báo ---------------
    {
      ...digitalBase,
      _id: id.dig.canva,
      name: 'Canva Teams Business Pro',
      provider: 'Canva',
      packagingType: 'cloud_subscription',
      fulfillmentMethod: 'tenant_seat',
      bindingTarget: 'user',
      totalSeats: 10,
      usedSeats: 1,
      cost: money(3500000),
      // Cố ý đặt gần hôm nay để thấy cảnh báo sắp hết hạn ngay sau khi seed
      expiryDate: new Date(now.getTime() + 7 * 86400000),
      autoRenew: false,
      status: 'available',
      ownerId: id.user.hoa,
      note: 'Hết hạn trong 7 ngày, autoRenew tắt — cron sẽ cảnh báo',
    },
  ];

  // -------------------------------------------------------------------------
  // 6. Phiếu cấp phát — sổ cái, gồm cả phiếu ĐÃ THU HỒI để thấy lịch sử
  //    (Quy tắc 6: không xóa, không ghi đè người nhận)
  // -------------------------------------------------------------------------
  const mkAsg = (key, a) => ({
    _id: id.asg[key],
    assignmentType: a.type,
    employeeId: id.user[a.who],
    employeeName: WHO[a.who].name,
    employeeEmail: EMAIL[a.who],
    physicalAssetId: a.phys ? id.phys[a.phys] : null,
    digitalAssetId: a.dig ? id.dig[a.dig] : null,
    allocatedKeyId: a.key ? id.key[a.key] : null,
    assignedIdentifier: a.identifier || null,
    accessScope: a.scope || null,
    // Có revokedAt thì trạng thái bắt buộc là 'revoked' — để lẫn 'active' là
    // máy hiện đang rảnh mà phiếu vẫn báo có người giữ.
    status: a.revokedAt ? 'revoked' : (a.status || 'active'),
    holderReleased: !!a.holderReleased,
    assignedBy: id.user.admin,
    assignedAt: vn(a.at),
    activatedAt: a.status === 'pending_activation' ? null : vn(a.at),
    handoverConditionNote: a.handover || null,
    revokedBy: a.revokedAt ? id.user.admin : null,
    revokedAt: a.revokedAt ? vn(a.revokedAt) : null,
    revokeReason: a.revokeReason || null,
    returnConditionNote: a.returnNote || null,
    keyReturnedToPool: a.revokedAt ? (a.keyReturned !== false) : null,
    note: a.note || null,
    createdAt: vn(a.at),
    updatedAt: now,
  });

  const assetAssignments = [
    // Tuấn: máy + Windows FPP cài trên máy đó + M365 theo người
    mkAsg('asgLaptopTuan', {
      type: 'physical_handover', who: 'tuan', phys: 'laptopTuan',
      at: '2026-01-10T09:00:00', handover: 'Máy mới 100%, kèm sạc zin và túi chống sốc',
    }),
    mkAsg('asgWinTuan', {
      type: 'digital_device_license', who: 'tuan', dig: 'winFpp', phys: 'laptopTuan',
      key: 'VK7JD-2HTYU-9XQWE-4RMNB-7T8K9', scope: 'Device License',
      at: '2026-01-10T09:15:00', note: 'Kích hoạt Windows 11 Pro trên LAP-2026-001',
    }),
    mkAsg('asgOfficeTuan', {
      type: 'digital_device_license', who: 'tuan', dig: 'officeMak', phys: 'laptopTuan',
      scope: 'Device License', at: '2026-01-10T09:20:00',
      note: 'Kích hoạt Office LTSC bằng MAK key',
    }),
    mkAsg('asgM365Tuan', {
      type: 'digital_user_license', who: 'tuan', dig: 'm365Basic',
      identifier: EMAIL.tuan, scope: 'User', at: '2026-01-10T09:30:00',
    }),

    // Hoà: máy Mac + M365 CHỜ kích hoạt (để thấy trạng thái pending_activation)
    mkAsg('asgLaptopHoa', {
      type: 'physical_handover', who: 'hoa', phys: 'laptopHoa',
      at: '2026-02-01T09:00:00', handover: 'Máy mới, đã dán màn hình',
    }),
    mkAsg('asgM365Hoa', {
      type: 'digital_user_license', who: 'hoa', dig: 'm365Basic',
      identifier: EMAIL.hoa, scope: 'User', status: 'pending_activation',
      at: '2026-02-01T09:10:00', note: 'Chờ nhân sự accept invite bên Microsoft',
    }),
    mkAsg('asgFigmaHoa', {
      type: 'digital_user_license', who: 'hoa', dig: 'figmaShared',
      identifier: 'design@datvietso.vn', scope: 'Editor', at: '2026-02-05T14:00:00',
    }),

    // Quản trị: gói Standard
    mkAsg('asgM365Admin', {
      type: 'digital_user_license', who: 'admin', dig: 'm365Standard',
      identifier: EMAIL.admin, scope: 'Global Admin', at: '2026-01-05T08:00:00',
    }),

    // Lan: Canva
    mkAsg('asgCanvaLan', {
      type: 'digital_user_license', who: 'lan', dig: 'canva',
      identifier: EMAIL.lan, scope: 'User', at: '2026-03-01T10:00:00',
    }),

    // Phiếu ĐÃ THU HỒI: màn hình từng giao cho Lan, nay đã trả về kho.
    // Giữ lại để chứng minh lịch sử không bị xóa khi tái cấp phát (Quy tắc 6).
    mkAsg('asgManHinhLanCu', {
      type: 'physical_handover', who: 'lan', phys: 'manHinh',
      at: '2025-03-01T09:00:00', handover: 'Màn hình mới, kèm cáp DisplayPort',
      revokedAt: '2026-02-20T16:00:00', revokeReason: 'Đổi sang vị trí làm việc khác',
      returnNote: 'Màn hình còn tốt, có vết xước nhẹ ở viền dưới',
    }),
  ];

  // -------------------------------------------------------------------------
  // 7. Chat — GroupMembers nhập vào members[] của conversation
  //
  // Dữ liệu mẫu đi qua đúng `buildMessage()` mà REST và socket dùng, nên
  // `attachmentKind` và `mentions` được tính y như tin nhắn thật. Nếu seed tự
  // gán tay thì panel "Bộ sưu tập" và badge @ sẽ lệch với dữ liệu chạy thật.
  //
  // Bộ dữ liệu này cố ý phủ hết các trạng thái mà UI phải xử lý:
  //   - 2 nhóm + 1 chat 1-1 có tin + 1 chat 1-1 CHƯA có tin (lastMessage = null,
  //     để kiểm tra luật "phòng direct chỉ hiện ở phía người nhận sau tin đầu")
  //   - đủ 5 loại tin: system, text, media (ảnh/video), file, location
  //   - tin có link trong nội dung -> vào tab "Liên kết"
  //   - một tin đã xóa mềm (lastMessage phải trỏ tin TRƯỚC nó)
  //   - mention @tên và @all -> badge nhắc tên ở sidebar
  //   - reactions sẵn trên vài tin
  //   - lastReadAt lệch nhau giữa các thành viên -> có số chưa đọc để nhìn thấy
  // -------------------------------------------------------------------------
  const member = (key, name, avatarSeed, role, lastReadAt = null) => ({
    userId: chatId(key),
    userName: name,
    avatar: avatar(avatarSeed),
    role,
    joinedAt: now,
    lastReadAt,
  });

  /**
   * Dựng tin nhắn qua tầng nghiệp vụ. `members` phải truyền vào để parse @mention
   * theo người thật — truyền thiếu thì mentions rỗng và badge @ không có gì để hiện.
   */
  const mkMsg = (convKey, userKey, content, at, opts = {}) => {
    const w = WHO[userKey];
    const doc = buildMessage({
      conversationId: id.conv[convKey],
      sender: { id: chatId(userKey), name: w.name, avatar: avatar(w.seed) },
      type: opts.type || 'text',
      content,
      metadata: opts.metadata || null,
      members: convMembers[convKey],
      createdAt: vn(at),
    });

    if (opts.reactions) {
      doc.reactions = opts.reactions.map((r) => ({
        userId: chatId(r.by),
        reaction: r.reaction,
        createdAt: vn(r.at || at),
      }));
    }
    // Xóa mềm: nội dung vẫn nằm trong DB, API trả về placeholder
    if (opts.deletedAt) doc.deletedAt = vn(opts.deletedAt);

    return doc;
  };

  /** Tin hệ thống (tạo nhóm, thêm thành viên...) — sender.id = 'system'. */
  const mkSys = (convKey, content, at) =>
    buildSystemMessage(id.conv[convKey], content, vn(at));

  // Thành viên từng phòng. Khai báo trước messages vì mkMsg() cần để parse mention.
  const convMembers = {
    company: [
      member('admin', WHO.admin.name, WHO.admin.seed, 'owner', vn('2026-11-11T18:00:00')),
      member('tuan', WHO.tuan.name, WHO.tuan.seed, 'admin', vn('2026-11-09T09:30:00')),
      member('hoa', WHO.hoa.name, WHO.hoa.seed, 'member', null),
      member('lan', WHO.lan.name, WHO.lan.seed, 'member', vn('2026-11-11T18:00:00')),
    ],
    techProject: [
      member('tuan', WHO.tuan.name, WHO.tuan.seed, 'owner', vn('2026-11-11T18:00:00')),
      member('admin', WHO.admin.name, WHO.admin.seed, 'admin', vn('2026-11-10T11:00:00')),
      member('hoa', WHO.hoa.name, WHO.hoa.seed, 'member', null),
    ],
    adminTuan: [
      member('admin', WHO.admin.name, WHO.admin.seed, 'member', vn('2026-11-11T18:00:00')),
      member('tuan', WHO.tuan.name, WHO.tuan.seed, 'member', vn('2026-11-10T14:00:00')),
    ],
    tuanHoa: [
      member('tuan', WHO.tuan.name, WHO.tuan.seed, 'member', null),
      member('hoa', WHO.hoa.name, WHO.hoa.seed, 'member', null),
    ],
  };

  const messages = [
    // --- Nhóm toàn công ty ---------------------------------------------------
    mkSys('company',
      'Nguyễn Quản Trị đã tạo nhóm "Đất Việt Số - Tổng Công Ty" với 4 thành viên.',
      '2026-11-09T08:58:00'),
    mkMsg('company', 'admin',
      'Chào mừng cả đội ngũ tham gia hệ thống quản trị DatVietSo!',
      '2026-11-09T09:00:00',
      { reactions: [{ by: 'tuan', reaction: 'like' }, { by: 'hoa', reaction: 'love' }] }),
    mkMsg('company', 'tuan',
      'Hệ thống đã triển khai đầy đủ Chat, Tài sản, Kanban, Lịch và CRM.',
      '2026-11-09T09:02:00'),
    mkMsg('company', 'hoa',
      'Tuyệt vời, khối kinh doanh sẵn sàng cập nhật dữ liệu khách hàng!',
      '2026-11-09T09:05:00',
      { reactions: [{ by: 'admin', reaction: 'like' }] }),
    // Tin có link -> tab "Liên kết" của panel Bộ sưu tập
    mkMsg('company', 'lan',
      'Quy chế nhân sự mới đã đăng tại https://datvietso.vn/noi-bo/quy-che, mọi người đọc trước thứ Hai nhé.',
      '2026-11-09T10:15:00'),
    // Ảnh -> tab "Hình ảnh"
    mkMsg('company', 'lan', 'so-do-to-chuc-2026.png', '2026-11-09T10:20:00', {
      type: 'media',
      metadata: {
        fileUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800',
        filename: 'so-do-to-chuc-2026.png',
        mimetype: 'image/png',
        fileSize: '0.42 MB',
      },
    }),
    // Tệp tài liệu -> tab "Files"
    mkMsg('company', 'lan', 'quy-che-nhan-su-2026.pdf', '2026-11-09T10:22:00', {
      type: 'media',
      metadata: {
        fileUrl: 'https://datvietso.vn/noi-bo/quy-che-nhan-su-2026.pdf',
        filename: 'quy-che-nhan-su-2026.pdf',
        mimetype: 'application/pdf',
        fileSize: '1.80 MB',
      },
    }),
    // Tin đã xóa mềm: nằm giữa lịch sử nên lastMessage KHÔNG được trỏ vào đây
    mkMsg('company', 'hoa', 'Gửi nhầm nhóm, mọi người bỏ qua giúp mình.',
      '2026-11-10T08:05:00', { deletedAt: '2026-11-10T08:06:00' }),
    // Mention đích danh -> badge @ cho Trần Anh Tuấn
    mkMsg('company', 'admin',
      '@Trần Anh Tuấn chốt giúp tôi tiến độ module Chat trước 17h hôm nay nhé.',
      '2026-11-10T09:30:00'),
    // Vị trí GPS -> tab "Liên kết"
    mkMsg('company', 'admin', 'Văn phòng Đất Việt Số', '2026-11-11T08:00:00', {
      type: 'location',
      metadata: {
        lat: 21.028511,
        lng: 105.854444,
        address: 'Tòa nhà văn phòng Đất Việt Số, Hoàn Kiếm, Hà Nội',
      },
    }),

    // --- Nhóm dự án ---------------------------------------------------------
    mkSys('techProject',
      'Trần Anh Tuấn đã tạo nhóm "Dự án Chat Realtime" với 3 thành viên.',
      '2026-11-10T10:00:00'),
    mkMsg('techProject', 'tuan',
      'Nhóm này để trao đổi riêng về module chat realtime: socket, mention, bộ sưu tập file.',
      '2026-11-10T10:01:00'),
    mkMsg('techProject', 'admin',
      'Ưu tiên xong phân quyền nhóm và badge chưa đọc trước, phần lọc theo thời gian để sau.',
      '2026-11-10T10:05:00',
      { reactions: [{ by: 'tuan', reaction: 'like' }] }),
    // Mention @all -> badge @ cho mọi thành viên trừ người gửi
    mkMsg('techProject', 'tuan',
      '@all mình demo bản chạy thử lúc 15h chiều nay, mọi người vào sớm 5 phút nhé.',
      '2026-11-11T09:00:00'),
    // Video -> tab "Hình ảnh / Video"
    mkMsg('techProject', 'tuan', 'demo-chat-realtime.mp4', '2026-11-11T09:05:00', {
      type: 'media',
      metadata: {
        fileUrl: 'https://cdn.datvietso.vn/demo/demo-chat-realtime.mp4',
        filename: 'demo-chat-realtime.mp4',
        mimetype: 'video/mp4',
        fileSize: '8.60 MB',
      },
    }),

    // --- Chat 1-1 admin <-> tuấn --------------------------------------------
    mkMsg('adminTuan', 'admin', 'Tuấn gửi anh bản ước lượng thời gian phần chat nhé.',
      '2026-11-10T13:55:00'),
    mkMsg('adminTuan', 'tuan', 'Vâng, em gửi anh trong chiều nay. Còn phần mention và bộ sưu tập file.',
      '2026-11-10T14:00:00',
      { reactions: [{ by: 'admin', reaction: 'like' }] }),
    mkMsg('adminTuan', 'admin', 'Ổn rồi. Ưu tiên phân quyền nhóm trước nhé.',
      '2026-11-11T08:30:00'),
  ];

  /**
   * Snapshot tin cuối cho sidebar — thay cho câu COUNT(*) của bản MySQL.
   *
   * BẮT BUỘC bỏ qua tin đã xóa mềm: `lastMessage` luôn là tin CHƯA XÓA mới nhất,
   * nếu không sidebar sẽ hiện "Tin nhắn này đã bị xóa" ngay sau khi seed.
   */
  const lastMessageOf = (conversationId) => {
    const inConv = messages
      .filter((m) => String(m.conversationId) === String(conversationId) && !m.deletedAt)
      .sort((a, b) => a.createdAt - b.createdAt);

    return inConv.length > 0 ? lastMessageSnapshot(inConv[inConv.length - 1]) : null;
  };

  /** updatedAt phải khớp tin cuối, vì sidebar sắp xếp theo nó. */
  const convTimes = (conversationId) => {
    const lm = lastMessageOf(conversationId);

    return { createdAt: now, updatedAt: lm ? lm.createdAt : now };
  };

  const conversations = [
    {
      _id: id.conv.company,
      type: 'group',
      name: 'Đất Việt Số - Tổng Công Ty',
      avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo',
      // Ghim theo từng người: chỉ admin ghim phòng này
      pinnedBy: [chatId('admin')],
      createdBy: chatId('admin'),
      members: convMembers.company,
      lastMessage: lastMessageOf(id.conv.company),
      ...convTimes(id.conv.company),
    },
    {
      _id: id.conv.techProject,
      type: 'group',
      name: 'Dự án Chat Realtime',
      avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=ChatRealtime',
      pinnedBy: [chatId('tuan')],
      createdBy: chatId('tuan'),
      members: convMembers.techProject,
      lastMessage: lastMessageOf(id.conv.techProject),
      ...convTimes(id.conv.techProject),
    },
    {
      _id: id.conv.adminTuan,
      type: 'direct',
      name: null, // chat 1-1 lấy tên người đối diện lúc đọc, không lưu cứng
      avatar: null,
      pinnedBy: [],
      createdBy: chatId('admin'),
      members: convMembers.adminTuan,
      lastMessage: lastMessageOf(id.conv.adminTuan),
      ...convTimes(id.conv.adminTuan),
    },
    {
      _id: id.conv.tuanHoa,
      type: 'direct',
      name: null,
      avatar: null,
      pinnedBy: [],
      createdBy: chatId('tuan'),
      members: convMembers.tuanHoa,
      // null: phòng mới mở, chưa ai gửi gì. Phía Hoa chưa thấy phòng này trong
      // sidebar cho tới khi có tin đầu tiên (xem endpoint GET /conversations).
      lastMessage: null,
      createdAt: now,
      updatedAt: now,
    },
  ];


  // -------------------------------------------------------------------------
  // 8. Kanban — columns + tags + members nhập vào board
  // -------------------------------------------------------------------------
  const kanbanBoards = [
    {
      _id: id.board,
      title: 'Phát Triển Hệ Thống DatVietSo 2.0',
      description: 'Dự án số hóa quy trình quản trị nội bộ toàn diện',
      color: '#7367F0',
      icon: 'tabler-brand-vue',
      departmentId: id.dept.TECH,
      ownerId: id.user.admin,
      isPrivate: false,
      // Bản SQL không seed `kanban_board_members`. Thêm chủ sở hữu để index
      // 'members.userId' có dữ liệu dùng được ngay.
      members: [
        { userId: id.user.admin, name: 'Nguyễn Quản Trị', avatar: avatar('Admin'), role: 'OWNER', createdAt: now },
        { userId: id.user.tuan, name: 'Trần Anh Tuấn', avatar: avatar('Tuan'), role: 'MEMBER', createdAt: now },
      ],
      columns: [
        { _id: id.col.todo, title: 'Cần Làm (To Do)', color: '#EA5455', position: 0, wipLimit: 10 },
        { _id: id.col.doing, title: 'Đang Thực Hiện (In Progress)', color: '#FF9F43', position: 1, wipLimit: 5 },
        { _id: id.col.review, title: 'Đang Kiểm Thử (In Review)', color: '#00CFE8', position: 2, wipLimit: 5 },
        { _id: id.col.done, title: 'Hoàn Thành (Done)', color: '#28C76F', position: 3, wipLimit: 0 },
      ],
      tags: [
        { _id: id.tag.backend, name: 'Backend API', color: '#7367F0' },
        { _id: id.tag.uiux, name: 'UI / UX', color: '#28C76F' },
        { _id: id.tag.high, name: 'High Priority', color: '#EA5455' },
        { _id: id.tag.database, name: 'Database', color: '#FF9F43' },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const assignTuan = [{ userId: id.user.tuan, name: 'Trần Anh Tuấn', avatar: avatar('Tuan') }];

  const mkCard = (key, colKey, title, description, priority, start, due, tagKeys, creatorKey) => ({
    _id: id.card[key],
    boardId: id.board,
    columnId: id.col[colKey],
    title,
    description,
    priority,
    startDate: day(start),
    dueDate: day(due),
    estimatedHours: 0,
    actualHours: 0,
    position: 0,
    isCompleted: false,
    completedAt: null,
    assignees: assignTuan,
    tagIds: tagKeys.map((t) => id.tag[t]),
    checklists: [],
    comments: [],
    attachments: [],
    createdBy: id.user[creatorKey],
    createdAt: now,
    updatedAt: now,
  });

  const kanbanCards = [
    mkCard('schema', 'done', 'Thiết kế cơ sở dữ liệu DatVietSo',
      'Đầy đủ các module Chat, Assets, Kanban, Calendar, HRM, CRM',
      'HIGH', '2026-11-01', '2026-11-09', ['backend', 'database'], 'admin'),
    mkCard('kanbanUi', 'doing', 'Hoàn thiện giao diện Kanban Vuetify',
      'Tích hợp kéo thả v-drag-and-drop giữa các cột và lưu trạng thái vào DB',
      'HIGH', '2026-11-09', '2026-11-15', ['uiux', 'high'], 'tuan'),
    mkCard('socket', 'todo', 'Tích hợp Socket.io Realtime Chat với Vuetify',
      'Đồng bộ tin nhắn tức thì, trạng thái online và gõ phím',
      'MEDIUM', '2026-11-12', '2026-11-20', ['backend'], 'tuan'),
  ];

  // -------------------------------------------------------------------------
  // 9. Lịch
  // -------------------------------------------------------------------------
  const calCatMeta = {
    internal: { name: 'Cuộc Họp Nội Bộ', color: '#7367F0' },
    customer: { name: 'Họp Với Khách Hàng', color: '#28C76F' },
    deadline: { name: 'Hạn Chót Dự Án', color: '#EA5455' },
    event: { name: 'Sự Kiện & Kỷ Niệm', color: '#FF9F43' },
  };

  const calendarCategories = [
    { key: 'internal', description: 'Họp giao ban, retrospective, sprint planning' },
    { key: 'customer', description: 'Demo giải pháp, thương thảo hợp đồng' },
    { key: 'deadline', description: 'Các mốc release hoặc deadline trọng điểm' },
    { key: 'event', description: 'Sinh nhật, teambuilding, ngày lễ' },
  ].map((c) => ({
    _id: id.calCat[c.key], ...calCatMeta[c.key], description: c.description,
    createdAt: now, updatedAt: now,
  }));

  const mkEvent = (title, description, catKey, start, end, location, url, creatorKey) => ({
    title,
    description,
    categoryId: id.calCat[catKey],
    category: calCatMeta[catKey],
    startTime: vn(start),
    endTime: vn(end),
    isAllDay: false,
    location,
    meetingUrl: url,
    recurrenceRule: 'NONE',
    recurrenceEnd: null,
    relatedType: 'NONE',
    relatedId: null,
    attendees: [],
    reminders: [],
    createdBy: id.user[creatorKey],
    createdAt: now,
    updatedAt: now,
  });

  const calendarEvents = [
    mkEvent('Họp Giao Ban Đầu Tuần DatVietSo',
      'Đánh giá tiến độ các dự án và phân bổ công việc tuần mới', 'internal',
      '2026-11-10T09:00:00', '2026-11-10T10:30:00',
      'Phòng Họp Ban Giám Đốc', 'https://meet.google.com/dvs-corp-meet', 'admin'),
    mkEvent('Demo Phần Mềm Cho Khách Hàng VIP',
      'Trình bày giải pháp số hóa doanh nghiệp cho đối tác', 'customer',
      '2026-11-11T14:00:00', '2026-11-11T15:30:00',
      'Phòng Khách VIP Tầng 2', 'https://meet.google.com/dvs-demo-sales', 'hoa'),
  ];

  // -------------------------------------------------------------------------
  // 10. CRM
  // -------------------------------------------------------------------------
  const crmCustomers = [
    {
      _id: id.customer.saomai, code: 'KH-001',
      companyName: 'Tập Đoàn Công Nghệ Số Sao Mai', contactName: 'Ông Trần Quốc Tuấn',
      email: 'contact@saomaitech.vn', phone: '02838999888', taxCode: '0315897645',
      address: 'Tòa nhà Sao Mai, Q.1, TP.HCM', website: null,
      industry: 'Công nghệ thông tin', customerType: 'ENTERPRISE', customerTier: 'VIP',
      assignedTo: id.user.hoa, status: 'ACTIVE', contacts: [],
    },
    {
      _id: id.customer.angiaphat, code: 'KH-002',
      companyName: 'Công Ty CP Bất Động Sản An Gia Phát', contactName: 'Bà Vũ Minh Châu',
      email: 'chau.vu@angiaphat.vn', phone: '02437666555', taxCode: '0108992341',
      address: 'Thanh Xuân, Hà Nội', website: null,
      industry: 'Bất động sản', customerType: 'ENTERPRISE', customerTier: 'GOLD',
      assignedTo: id.user.hoa, status: 'ACTIVE', contacts: [],
    },
  ].map((c) => ({ ...c, createdAt: now, updatedAt: now }));

  const crmDeals = [
    {
      _id: id.deal.erp, customerId: id.customer.saomai, leadId: null,
      dealName: 'Hợp Đồng Cung Cấp Nền Tảng DatVietSo ERP',
      dealValue: money(450000000), currency: 'VND', pipelineStage: 'NEGOTIATION',
      probability: 80, expectedCloseDate: day('2026-11-30'), actualCloseDate: null,
      assignedTo: id.user.hoa, lostReason: null,
      note: 'Khách hàng đã duyệt demo, đang chốt điều khoản thanh toán',
    },
    {
      _id: id.deal.assetCrm, customerId: id.customer.angiaphat, leadId: null,
      dealName: 'Phần Mềm Quản Lý Tài Sản & Chăm Sóc Khách Hàng',
      dealValue: money(180000000), currency: 'VND', pipelineStage: 'PROPOSAL',
      probability: 50, expectedCloseDate: day('2026-12-15'), actualCloseDate: null,
      assignedTo: id.user.hoa, lostReason: null,
      note: 'Đang gửi bảng báo giá chi tiết và lộ trình triển khai',
    },
  ].map((d) => ({ ...d, createdAt: now, updatedAt: now }));

  const crmActivities = [
    {
      customerId: id.customer.saomai, dealId: id.deal.erp, leadId: null,
      activityType: 'MEETING', title: 'Họp thống nhất bảng điều khoản hợp đồng',
      description: 'Đàm phán lịch thanh toán và thời hạn bàn giao bản quyền',
      scheduledAt: vn('2026-11-08T14:00:00'), completedAt: null,
      performedBy: id.user.hoa, status: 'COMPLETED',
    },
    {
      customerId: id.customer.angiaphat, dealId: id.deal.assetCrm, leadId: null,
      activityType: 'CALL', title: 'Gọi điện tư vấn phân hệ Quản lý tài sản',
      description: 'Khách hàng rất quan tâm đến tính năng phân bổ tài sản vật lý & bản quyền số',
      scheduledAt: vn('2026-11-09T10:00:00'), completedAt: null,
      performedBy: id.user.hoa, status: 'COMPLETED',
    },
  ].map((a) => ({ ...a, createdAt: now, updatedAt: now }));

  return {
    departments, positions, users,
    physicalAssets, digitalAssets, assetAssignments,
    conversations, messages, kanbanBoards, kanbanCards,
    calendarCategories, calendarEvents, crmCustomers, crmDeals, crmActivities,
  };
}

/**
 * Nạp dữ liệu mẫu. Mặc định bỏ qua collection đã có dữ liệu để chạy lại không
 * sinh bản ghi trùng; `replace: true` thì xóa sạch collection đó rồi nạp lại.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.replace=false] xóa dữ liệu cũ của collection rồi nạp lại
 * @param {string[]} [opts.only]          chỉ nạp các collection này
 */
async function seed(db, opts = {}) {
  const { replace = false, verbose = true, only = null } = opts;
  const log = verbose ? (...a) => console.log(...a) : () => {};

  // `only` giới hạn vào vài collection — nạp lại dữ liệu chat mà không đụng tới
  // tài sản / CRM / kanban đang có.
  const wanted = only && only.length > 0 ? new Set(only) : null;

  // Nếu lần chạy này KHÔNG ghi lại collection `users` thì phải dùng _id của user
  // ĐANG CÓ trong database. buildSeed() sinh ObjectId mới mỗi lần gọi, nên bỏ
  // qua bước này là conversations / messages / tài sản mới sẽ trỏ vào user không
  // tồn tại: migrate báo thành công, nhưng đăng nhập vào thì trống trơn.
  //
  // Hai trường hợp đều phải xử lý:
  //   - `--only` không bao gồm 'users'
  //   - seed thường, nhưng `users` đã có dữ liệu nên sẽ bị bỏ qua
  const usersAlready = await db.collection('users').countDocuments({}, { limit: 1 });
  const willWriteUsers = (!wanted || wanted.has('users')) && (usersAlready === 0 || replace);

  let userIds = null;
  if (!willWriteUsers) {
    const rows = await db.collection('users')
      .find({ username: { $in: Object.values(SEED_USERNAMES) } })
      .toArray();
    const byUsername = new Map(rows.map((u) => [u.username, u._id]));

    const resolved = {};
    const missing = [];
    for (const [key, username] of Object.entries(SEED_USERNAMES)) {
      const found = byUsername.get(username);
      if (found) resolved[key] = found;
      else missing.push(username);
    }

    if (missing.length > 0) {
      throw new Error(
        `Không tìm thấy user ${missing.join(', ')} trong database. `
        + 'Seed cần sẵn 4 user mẫu — chạy `npm run migrate:fresh` trước.',
      );
    }
    userIds = resolved;
    log(`   dùng lại _id của ${rows.length} user đang có trong database`);
  }

  const data = buildSeed({ userIds });
  const result = { inserted: {}, skipped: [] };

  for (const [name, docs] of Object.entries(data)) {
    if (wanted && !wanted.has(name)) continue;
    if (docs.length === 0) continue;

    const coll = db.collection(name);
    const existing = await coll.countDocuments({}, { limit: 1 });

    if (existing > 0) {
      if (!replace) {
        result.skipped.push(name);
        log(`   ${name.padEnd(20)} bỏ qua (đã có dữ liệu)`);
        continue;
      }
      await coll.deleteMany({});
    }

    await coll.insertMany(docs, { ordered: true });
    result.inserted[name] = docs.length;
    log(`   ${name.padEnd(20)} +${docs.length}`);
  }

  const total = Object.values(result.inserted).reduce((a, b) => a + b, 0);
  log(`\n   ✔ Đã nạp ${total} bản ghi vào ${Object.keys(result.inserted).length} collection.`);
  if (result.skipped.length > 0) {
    log(`   Bỏ qua ${result.skipped.length} collection đã có dữ liệu (dùng --fresh để nạp lại).`);
  }

  return result;
}

module.exports = { buildSeed, seed, SEED_USERNAMES };
