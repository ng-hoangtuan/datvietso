# Đánh giá đặc tả "Quản lý Tài sản số" trước khi triển khai

Đối chiếu `Docs/đặc tả kĩ thuật và triển khai quản lý tài sản số.docx` với kiến
trúc đang chạy (`MONGODB.md`, 19 collection, driver `mongodb` thuần).

> Lưu ý nhỏ: tệp đặc tả có đuôi `.docx` nhưng ruột là **văn bản thuần UTF-8**,
> không phải OOXML. Word mở được do đoán định dạng, nhưng mọi công cụ đọc docx
> thật sẽ báo lỗi "not a zipfile". Nên đổi đuôi thành `.md` hoặc `.txt`.

## 1. Kết luận

**Khả thi, và phù hợp hơn hẳn mô hình tài sản đang có.** Nên triển khai.

Phần lõi của đặc tả — tách `PhysicalAsset` / `DigitalAsset` / `AssetAssignment`,
và đặc biệt là trục `bindingTarget: user | device` — giải đúng bài toán mà mô
hình hiện tại không giải được: *bản quyền Windows cài trên máy thì đi theo máy,
còn Microsoft 365 thì đi theo người*. Mô hình hiện tại chỉ có một bảng `assets`
phẳng với `metadata.licenseKey` là **một chuỗi duy nhất**, nên không thể biểu
diễn một lô 10 key FPP, cũng không biết key nào đang nằm trên máy nào.

Hạ tầng đã sẵn sàng cho yêu cầu khó nhất của đặc tả: Quy tắc 5 đòi mọi thao tác
Assign/Revoke chạy trong **transaction**, và MongoDB ở đây vốn đã chạy single-node
replica set `rs0` chính vì lý do đó.

Nhưng có **5 điểm phải xử lý trước khi code**, trong đó 2 điểm là mâu thuẫn nội
tại của chính đặc tả và 1 điểm là rủi ro bảo mật nghiêm trọng.

## 2. Năm điểm phải xử lý

### 2.1. `GET /reveal-secret` dựng trên tầng xác thực đang hỏng — rủi ro cao nhất

Đặc tả yêu cầu mã hoá AES-256 toàn bộ key bản quyền và mật khẩu tài khoản dùng
chung, rồi mở endpoint `GET /api/assets/digital/:id/reveal-secret` để giải mã.

Vấn đề: `MONGODB.md` mục 7 đã ghi rõ tầng đăng nhập hiện tại có ba lỗ hổng được
giữ lại **có chủ đích**:

1. mật khẩu `123456` mở được **mọi** tài khoản
2. so sánh mật khẩu plaintext
3. token `dvs_token_<id>_<timestamp>` **không có chữ ký** — sửa chuỗi token là
   đăng nhập thành người khác

Mã hoá at-rest chỉ chống được người đọc thẳng file database. Nó **không** chống
được người gọi API. Dựng endpoint giải mã lên trên tầng xác thực đó nghĩa là bất
kỳ ai chạm được tới cổng 5000 đều lấy sạch kho key Windows và mật khẩu tài khoản
dùng chung bằng vài request — đúng những thứ mà việc mã hoá sinh ra để bảo vệ.

**Xử lý khi triển khai:** vẫn làm đủ AES-256-GCM + ghi log `VIEW_SECRET` (enum
`assetAuditLogs.action` đã có sẵn giá trị này từ trước), nhưng:

- khoá chủ nằm trong `ASSET_SECRET_KEY` ở `.env`, không commit, không hardcode
- mọi lần gọi `reveal-secret` ghi log: ai xem, xem tài sản nào, lúc nào
- **chưa nên mở cho người dùng thật** cho tới khi ký token xong

Sửa xác thực là việc riêng (đã tách từ trước), nhưng nó là **điều kiện tiên
quyết** để phân hệ này dùng được trong thực tế, không phải "cải tiến sau này".

### 2.2. Gửi key qua Chat (Luồng 2) phá chính thiết kế mã hoá

Luồng 2 yêu cầu: *"gửi tin nhắn qua module Chat nội bộ kèm thông tin tài khoản/key
để nhân sự kích hoạt"*.

Tin nhắn chat lưu plaintext vĩnh viễn trong `messages.content`. Mọi thành viên
trong phòng đọc được, kể cả người vào sau, và vẫn còn đó sau khi nhân sự nghỉ
việc. Mã hoá key trong database rồi lại phát tán cùng chuỗi key đó dưới dạng
plaintext sang một collection khác thì công mã hoá bằng không.

**Xử lý:** gửi **thông báo** qua chat ("Bạn được cấp 1 seat Microsoft 365, bấm
vào đây để kích hoạt") kèm liên kết tới trang tài sản cá nhân. Người nhận tự bấm
"Xem key", đi qua `reveal-secret` và được ghi log. Cùng trải nghiệm, không rải
secret ra chỗ khác.

### 2.3. Mâu thuẫn: `employeeId` vừa `required` vừa phải `null`

| Chỗ | Nội dung |
|---|---|
| Schema `AssetAssignment` | `employeeId: { ..., required: true }` |
| Luồng 4, Lựa chọn A | *"gỡ liên kết khỏi nhân sự nghỉ việc (`employeeId: null`...)"* |

Hai yêu cầu loại trừ nhau.

**Xử lý:** giữ `employeeId` bắt buộc — một phiếu cấp phát luôn phải trả lời được
"cấp cho ai". Lựa chọn A của Luồng 4 (giữ key trên máy cho người kế nhiệm) xử lý
bằng cách chuyển phiếu sang `suspended` và đánh dấu `holderReleased: true`: key
vẫn chiếm seat, vẫn nằm trên máy, nhưng không còn ai đang dùng. Khi có người kế
nhiệm thì revoke phiếu đó và tạo phiếu mới — không mất lịch sử.

### 2.4. Mâu thuẫn: Quy tắc 2 ghi đè `employeeId`, Quy tắc 6 cấm ghi đè

| Chỗ | Nội dung |
|---|---|
| Quy tắc 2 | *"phiếu `digital_device_license` trên máy đó được **cập nhật** `employeeId` sang người giữ máy mới"* |
| Quy tắc 6 | *"Tuyệt đối không ... ghi đè người nhận mới lên phiếu đã kết thúc"* |

Quy tắc 6 nói về phiếu *đã kết thúc* nên về chữ nghĩa thì không trực tiếp chọi
nhau, nhưng hệ quả thì có: ghi đè `employeeId` trên phiếu đang `active` làm **mất
dấu ai giữ key đó trong khoảng thời gian nào** — đúng câu hỏi mà audit cần trả
lời ("tháng 3/2026 máy LAP-001 do ai dùng?").

**Xử lý:** luôn theo chuỗi *revoke phiếu cũ → tạo phiếu mới*, nhưng khi là trường
hợp "giao nguyên trạng không cài lại máy" thì phiếu mới **giữ nguyên
`allocatedKeyId`** và không trả key về kho. Kết quả nghiệp vụ giống hệt điều Quy
tắc 2 mong muốn, mà lịch sử vẫn liền mạch và không vi phạm Quy tắc 6.

### 2.5. `cost: Number` trái quy ước tiền tệ của dự án

Đặc tả để `cost: { type: Number, default: 0 }` ở cả hai schema. `MONGODB.md` mục 3
đã chốt: số của JavaScript là float64, **không an toàn cho tiền**, năm trường tiền
hiện có đều dùng `Decimal128` và validator chặn nếu truyền `Number`.

**Xử lý:** dùng `Decimal128`, nhất quán với `assets.purchaseCost`,
`crmDeals.dealValue`... đang chạy.

## 3. Lệch về công nghệ (chấp nhận có chủ đích)

Đặc tả viết bằng **Mongoose + TypeScript**. Backend dự án là **CommonJS
JavaScript + driver `mongodb` thuần**, raw query, schema khai báo tập trung trong
`db/schema.js` dưới dạng `$jsonSchema` validator + index.

Đây là lệch đã có tiền lệ và đã được ghi nhận: `MONGODB.md` mục 0 cho biết tài
liệu gốc `datvietso_qlts.docx` đòi **Sequelize ORM**, repo không dùng ORM nào.

Chuyển riêng phân hệ tài sản sang Mongoose sẽ tạo ra hai cách định nghĩa schema
song song trong cùng một codebase, hai cách kết nối, hai kiểu validate. Vì vậy:
**giữ nguyên mô hình dữ liệu, enum, index và quy tắc nghiệp vụ của đặc tả**, chỉ
dịch cú pháp sang `$jsonSchema` như 19 collection còn lại.

## 4. Ánh xạ sang hệ thống hiện tại

| Đặc tả | Hiện tại | Việc phải làm |
|---|---|---|
| `PhysicalAsset` | `assets` (`assetKind: 'PHYSICAL'`) | Tách thành collection riêng, thêm `bundledOemLicense`, `currentHolderId` |
| `DigitalAsset` | `assets` (`assetKind: 'DIGITAL'`) | Tách riêng; thêm `keyPool[]`, `bindingTarget`, `fulfillmentMethod`, `parentAssetId`, `usedSeats/totalSeats` |
| `AssetAssignment` | `assetAllocations` | Mở rộng: `assignmentType`, `allocatedKeyId`, vòng đời 4 trạng thái, audit giao/thu hồi |
| `keyPool[]` từng key mã hoá | `metadata.licenseKey` — **một** chuỗi | Mới hoàn toàn |
| `bindingTarget: user \| device` | *không có* | Mới — đây là giá trị cốt lõi của đặc tả |
| `parentAssetId` (tenant cha → gói con) | *không có* | Mới |
| Transaction khi assign/revoke | `/allocate` cập nhật rời rạc | Mới |
| Handover bundle 1 lần bấm | *không có* | Mới |
| Offboarding quét toàn bộ tài sản | *không có* | Mới |
| Cronjob 08:00 cảnh báo hết hạn | *không có* | Mới |
| UI 3 tab + drawer cấp phát | 1 bảng gộp (`assets.vue`) | Viết lại |

Giữ lại ngoài đặc tả: `assetMaintenances` (Luồng 3 có nhắc "Bảo hành/Sửa chữa"
nhưng không định nghĩa schema) và `assetAuditLogs` (đặc tả đòi ghi log ai xem key
— collection này đã có sẵn `action: 'VIEW_SECRET'`).

**Chi phí di trú dữ liệu: gần như bằng không.** `assets` đang có 4 bản ghi và
`assetAllocations` có 2, đều là dữ liệu mẫu. Chi phí thật nằm ở code: viết lại
`routes/assets.js` (438 dòng), `useAssetStore.ts` (441 dòng), `assets.vue` (224 dòng).

## 5. Những chỗ đặc tả chưa nói, sẽ quyết khi làm

| Vấn đề | Quyết định |
|---|---|
| `totalSeats` mặc định 1, nhưng comment nói `null` cho shared_account không giới hạn | `null` = không giới hạn; khi đó không bao giờ chuyển `fully_assigned` |
| Enum dùng chữ thường (`available`) trong khi repo dùng CHỮ HOA (`AVAILABLE`) | Theo đặc tả (chữ thường) cho 3 collection mới — mô hình khác hẳn nên không gây lẫn với collection cũ |
| Thu hồi key `isKeyReusable: false` | Key chuyển `burned`, không trả về kho, `usedSeats` **không** giảm |
| Ai được cấp phát / thu hồi | `SUPER_ADMIN`, `ADMIN` — nhất quán với `users.role` đang có |
| Xoá `PhysicalAsset` còn phiếu `active` | Chặn, bắt revoke trước (tránh phiếu mồ côi như mục 5 `MONGODB.md`) |

## 6. Phạm vi triển khai

**Backend**

- `db/schema.js`: 3 collection mới (`physicalAssets`, `digitalAssets`, `assetAssignments`) + index theo đặc tả
- `services/assetCrypto.js`: AES-256-GCM, khoá từ `ASSET_SECRET_KEY`
- `services/assets.js`: 6 quy tắc nghiệp vụ, mọi assign/revoke trong transaction
- `routes/assets.js`: 8 endpoint của đặc tả mục 5.1 + CRUD + tra cứu
- `jobs/assetMonitor.js`: cronjob 08:00 (Luồng 6)
- `db/seed.js`: dữ liệu mẫu phủ FPP / ESD / MAK / M365 tenant / shared account

**Frontend**

- `useAssetStore.ts` viết lại theo mô hình 3 thực thể
- `assets.vue`: 3 tab (Thiết bị vật lý · Bản quyền & Tài khoản số · Tra cứu theo nhân sự)
- Drawer cấp phát trọn gói, modal xem key (tự ẩn sau 30 giây)

**Không làm trong đợt này:** sửa 3 lỗ hổng xác thực ở mục 2.1 — là việc riêng,
cần đổi cả frontend, nhưng phải xong trước khi phân hệ này chạy thật.
