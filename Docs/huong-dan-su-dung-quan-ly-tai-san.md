# Hướng dẫn thao tác — Quản lý Tài sản

Dành cho IT và HR vận hành phân hệ tài sản. Về thiết kế dữ liệu và những chỗ
triển khai lệch khỏi đặc tả, xem `Docs/danh-gia-dac-ta-tai-san-so.md`.

## 0. Trước khi bắt đầu

Ba thứ phải chạy, theo đúng thứ tự:

```bash
docker compose up -d
```

```bash
cd backend; npm run dev
```

```bash
cd frontend/typescript-version; npm run dev
```

Mở `http://localhost:5173` → đăng nhập → menu **Quản lý Tài sản**.

### Ai làm được gì

Hệ thống kiểm tra vai trò ở server theo `users.role`:

| Thao tác | SUPER_ADMIN · ADMIN | HR_MANAGER | EMPLOYEE |
|---|---|---|---|
| Xem danh sách, tra cứu, lịch sử | ✓ | ✓ | ✓ |
| Cấp phát, thu hồi, nhập kho | ✓ | – | – |
| Xem key / mật khẩu (`reveal-secret`) | ✓ | – | – |
| Offboarding | ✓ | ✓ | – |
| Xác nhận đã nhận tài sản của **chính mình** | ✓ | ✓ | ✓ |

> Tài khoản mẫu: `DVS-001` (SUPER_ADMIN), `DVS-002`/`DVS-003` (EMPLOYEE),
> `DVS-004` (HR_MANAGER). Mật khẩu đều là `123456`.
>
> Muốn thử các nút cấp phát thì đăng nhập **DVS-001**. Đăng nhập DVS-002 sẽ
> không thấy nút nào — đúng như thiết kế.

---

## 1. Hiểu màn hình chính

Trên cùng là **dải cảnh báo** (chỉ hiện khi có việc cần xử lý):

- 🔴 *"N tài khoản dùng chung cần đổi mật khẩu gốc"* — có người vừa bị thu hồi
  khỏi tài khoản chung, mật khẩu cũ coi như đã lộ
- 🟡 *"N bản quyền hết hạn trong 30 ngày"*
- 🔴 *"N bản quyền đã hết hạn"*

Dưới đó là 4 ô thống kê, rồi 3 tab.

---

## 2. Tab 1 — Thiết bị vật lý

### Đọc bảng

| Cột | Ý nghĩa |
|---|---|
| Mã / Thiết bị | Mã nội bộ, tên máy, số serial. Badge xanh **OEM** = máy kèm sẵn Windows bản quyền gắn theo mainboard |
| Người đang giữ | Ai đang cầm máy, từ ngày nào |
| Tình trạng | Mới / Tốt / Cần sửa… kèm hạn bảo hành (đỏ = hết, vàng = còn dưới 60 ngày) |
| Trạng thái | Trong kho · Đang sử dụng · Đang bảo trì · Thất lạc · Đã thanh lý |

Badge **OEM** quan trọng: máy có nó thì **không cần cấp thêm key Windows**, và
bản quyền đó đi theo máy suốt đời, không chiếm chỗ của kho nào.

### Xem lịch sử luân chuyển

Bấm icon 🕘 ở cuối dòng. Hiện dòng thời gian đầy đủ: ai từng giữ máy, từ ngày
nào đến ngày nào, tình trạng lúc giao và lúc nhận lại, lý do thu hồi, và cả
những bản quyền từng cài trên máy đó.

Lịch sử **không bao giờ bị xoá**, kể cả khi xoá máy khỏi kho — đây là căn cứ
khi kiểm toán bản quyền.

### Thu hồi thiết bị

Bấm icon 🚪 (chỉ hiện với máy *Đang sử dụng*). Điền 4 mục:

1. **Máy về trạng thái** — *Trong kho* nếu dùng lại được, *Đưa đi bảo trì* nếu
   hỏng, *Thanh lý* nếu loại bỏ
2. **Tình trạng máy khi nhận lại**
3. **Lý do thu hồi** — "Đổi máy mới", "Nghỉ việc", "Hỏng mainboard"…
4. **Ghi chú tình trạng**

> ⚠ Thu hồi máy **không** thu hồi bản quyền cài trên máy đó. Key Windows/Office
> vẫn nằm nguyên trên máy, chờ người kế nhiệm. Muốn lấy key về kho thì phải
> thu hồi riêng phiếu bản quyền (mục 4 — Offboarding, hoặc API mục 7).

### Xoá thiết bị

Menu ⋮ → *Xoá thiết bị*. Hệ thống **chặn** nếu máy còn phiếu cấp phát chưa thu
hồi — phải thu hồi hết trước. Xoá máy không xoá lịch sử phiếu.

---

## 3. Tab 2 — Bản quyền & Tài khoản số

### Đọc cây tài sản

Gói con nằm thụt vào dưới gói cha (ví dụ *Microsoft 365 Tenant* → *Business
Basic* / *Business Standard*). Gói cha gắn nhãn **Cổng quản trị** là nơi quản
trị tổng, **không cấp phát trực tiếp** được.

Hai nhãn quyết định mọi thứ:

| Nhãn | Nghĩa | Khi nhân sự đổi máy |
|---|---|---|
| 👤 **Theo người** | M365, Figma, SaaS | Không ảnh hưởng, bản quyền đi theo người |
| 💻 **Theo máy** | Windows FPP/ESD, Office MAK | Ở nguyên trên máy cũ |

Thanh seat `2/20` cho biết đã dùng bao nhiêu chỗ. `1/∞` là tài khoản dùng chung
không giới hạn. Thanh chuyển vàng khi dùng quá 80%, đỏ khi hết chỗ.

### Kho key rời (FPP / ESD)

Gói dùng key rời hiện thêm dòng *"Kho key: 4 trống · 1 đã cấp · 0 đã cháy"* và
các chip `Hộp số 1`…`Hộp số 5`:

- 🟢 xanh = còn trống, **bấm vào để xem key**
- 🔵 xanh dương = đã cấp cho một máy
- 🔴 đỏ = đã cháy, không tái sử dụng được

Với bản quyền hộp cứng FPP, dòng mô tả có ghi vị trí vỏ hộp trong kho
(*📦 Tủ IT — Ngăn B2*) để đối chiếu khi kiểm kê.

### Xem key / mật khẩu

Bấm icon 👁 (màu vàng). Hộp thoại hiện cảnh báo trước:

> Lượt xem này sẽ được **ghi vào nhật ký kiểm toán** kèm tên bạn và thời điểm.

Bấm *"Tôi hiểu, hiện thông tin"* → key hiện ra kèm đồng hồ đếm ngược **30 giây**
rồi tự ẩn. Có nút *Sao chép*.

Mỗi lần xem đều ghi một bản ghi `VIEW_SECRET` vào `assetAuditLogs`: ai xem, xem
tài sản nào, lúc mấy giờ.

> ⚠ **Chưa nên dùng thật.** Tầng đăng nhập hiện chưa ký token (mật khẩu `123456`
> mở được mọi tài khoản), nên ai chạm được cổng 5000 cũng gọi được API này.
> Mã hoá AES chỉ chặn người đọc thẳng database, không chặn người gọi API.
> Xem `Docs/danh-gia-dac-ta-tai-san-so.md` mục 2.1.

### Nhập thêm key vào kho

Bấm icon ➕ (chỉ có ở gói dùng key rời). Dán danh sách key, **mỗi dòng một key**.
Key được mã hoá ngay khi lưu, và tổng số chỗ của kho tự tăng theo số key.

### Hạ cờ đỏ "Cần đổi mật khẩu"

Khi thu hồi bất kỳ ai khỏi tài khoản dùng chung, hệ thống tự bật cờ đỏ. Sau khi
IT đã thực sự đổi mật khẩu gốc bên nhà cung cấp, bấm icon 🛡 xanh để hạ cờ.

---

## 4. Tab 3 — Tra cứu theo nhân sự & Offboarding

Chọn nhân sự ở ô trên cùng. **Gõ không dấu cũng tìm được** — "tuan" ra "Trần Anh
Tuấn"; gõ mã `DVS-002` hoặc email cũng được.

Màn hình cho biết ngay: đang giữ mấy thiết bị, mấy license, và **chi phí bản
quyền mỗi tháng** của riêng người đó (chia đều theo số chỗ của từng gói).

License gắn theo máy có ghi rõ *"cài trên LAP-2026-001"*.

### Nhân sự tự xác nhận đã nhận

License ở trạng thái **Chờ kích hoạt** (M365, SaaS — phải accept invite bên
hãng). Khi *chính người đó* đăng nhập và mở tab này, nút **"Xác nhận đã nhận &
kích hoạt"** hiện ra. Người khác mở chỉ thấy chip *"Chờ nhân sự kích hoạt"* —
không ai xác nhận hộ được.

### Offboarding — nhân sự nghỉ việc

Bấm nút **Offboarding** (đỏ, góc phải). Hộp thoại chia 3 nhóm:

**Nhóm 1 — Thiết bị hữu hình.** Ghi tình trạng máy khi nhận lại.

**Nhóm 2 — Bản quyền gắn trên máy.** Chọn một trong hai:

- **Giữ bản quyền trên máy** — máy giao nguyên trạng cho người kế nhiệm. Phiếu
  chuyển *Tạm ngưng*, key **không** trả về kho, chỗ vẫn bị chiếm.
- **Format máy, thu key về kho** — key quay lại kho, cấp được cho máy khác.

**Nhóm 3 — Bản quyền theo nhân sự.** Luôn bị thu hồi hết, seat trả về kho ngay.

**Chặn an toàn:** nếu nhân sự đang giữ tài khoản dùng chung, nút *Hoàn tất* bị
khoá cho tới khi bạn tick *"Tôi xác nhận đã đổi mật khẩu gốc"*. Cố bấm thì
server trả lỗi 409.

Xong việc, hệ thống nhắc: *"Nhớ vào Admin Center của hãng cắt quyền truy cập
cho …"* — phần đó hệ thống không làm thay được.

---

## 5. Cấp phát trọn gói (Onboarding)

Nút **Cấp phát trọn gói** ở góc trên phải mở drawer 4 bước:

1. **Nhân sự nhận** — gõ không dấu được
2. **Thiết bị** (không bắt buộc) — chỉ liệt kê máy đang *Trong kho*
3. **Bản quyền & tài khoản** — chia hai nhóm *Theo người* / *Theo máy*
4. **Tình trạng khi bàn giao**

Bước 2 là chỗ hệ thống chủ động giúp:

- Chọn máy **có OEM** → báo xanh *"Máy đã kèm Windows 11 Pro OEM — không cần cấp
  thêm key"*
- Chọn máy **chưa có OEM** → báo vàng kèm danh sách **key Windows đang trống
  trong kho**, bấm thẳng vào chip để thêm vào gói cấp phát

Nhóm *Theo máy* bị mờ cho tới khi chọn máy ở bước 2 — bản quyền cài trên máy thì
phải biết máy nào.

Bấm **Cấp phát**: tất cả chạy trong **một giao dịch**. Lỗi ở bất kỳ bước nào
(hết chỗ, máy vừa bị người khác lấy) thì **không có gì thay đổi** — không bao
giờ có cảnh máy đã chuyển sang *Đang sử dụng* mà seat M365 chưa trừ.

---

## 6. Ba quy tắc dễ nhầm

**Windows OEM không phải tài sản số.** Nó gắn chết theo mainboard, hiện như một
badge trên hồ sơ máy, không nằm trong kho bản quyền nào và không bao giờ trừ chỗ.

**Thu hồi máy ≠ thu hồi bản quyền trên máy.** Hai việc tách rời có chủ đích: đa
số trường hợp máy đổi tay nhưng Windows vẫn ở nguyên đó.

**Phiếu cấp phát không bao giờ bị sửa người nhận.** Đổi người giữ = thu hồi
phiếu cũ + tạo phiếu mới. Nhờ vậy câu hỏi *"tháng 3/2026 máy LAP-001 do ai
dùng?"* luôn trả lời được.

---

## 7. Thao tác chưa có nút trên giao diện

Những việc sau API đã có và đã kiểm thử, nhưng **chưa có form**, tạm thời phải
gọi trực tiếp:

| Việc | Endpoint |
|---|---|
| Nhập kho thiết bị mới | `POST /api/assets/physical` |
| Nhập kho bản quyền mới | `POST /api/assets/digital` |
| Sửa thông tin thiết bị | `PUT /api/assets/physical/:id` |
| Cấp phát đơn lẻ (không trọn gói) | `POST /api/assignments/physical` · `/digital` |
| Chuyển máy nguyên trạng sang người khác | `POST /api/assignments/transfer-device` |
| Xoá tài sản số | `DELETE /api/assets/digital/:id` |

`actorId` là `_id` của người thao tác. Lấy nhanh:

```bash
curl -s http://localhost:5000/api/chat/contacts
```

Ví dụ nhập một máy mới có kèm Windows OEM:

```bash
curl -X POST http://localhost:5000/api/assets/physical -H "Content-Type: application/json" -d "{\"actorId\":\"<id-admin>\",\"assetCode\":\"LAP-2026-010\",\"serialNumber\":\"SN123456\",\"name\":\"Dell Latitude 5450\",\"category\":\"laptop\",\"specs\":\"i7/16GB/512GB\",\"cost\":29000000,\"bundledOemLicense\":{\"hasOem\":true,\"osName\":\"Windows 11 Pro OEM\",\"productKey\":\"XXXXX-XXXXX-XXXXX-XXXXX-XXXXX\"}}"
```

Ví dụ nhập một lô key FPP:

```bash
curl -X POST http://localhost:5000/api/assets/digital -H "Content-Type: application/json" -d "{\"actorId\":\"<id-admin>\",\"name\":\"Lô 3 hộp Windows 11 Pro FPP\",\"provider\":\"Microsoft\",\"packagingType\":\"physical_box_fpp\",\"fulfillmentMethod\":\"discrete_key_pool\",\"bindingTarget\":\"device\",\"ownerId\":\"<id-it-lead>\",\"physicalStorageLocation\":\"Tủ IT - Ngăn B3\",\"cost\":14700000,\"billingCycle\":\"one_time\",\"keys\":[\"AAAAA-BBBBB-CCCCC-DDDDD-11111\",\"AAAAA-BBBBB-CCCCC-DDDDD-22222\",\"AAAAA-BBBBB-CCCCC-DDDDD-33333\"]}"
```

---

## 8. Tự động hằng ngày

Cron chạy **08:00 mỗi sáng** (đổi bằng `ASSET_CRON_HOUR` trong `.env`):

- Gói còn đúng **30 ngày** hoặc **7 ngày** là hết hạn → báo cho người quản lý gói
- Gói quá hạn và `autoRenew = false` → tự chuyển trạng thái **expired**
- Phiếu *Chờ kích hoạt* quá **3 ngày** → nhắc nhân sự

Thông báo đi qua socket, hiện ngay trong app nếu người nhận đang mở.

---

## 9. Nạp lại dữ liệu mẫu

Nghịch lung tung muốn làm lại từ đầu:

```bash
cd backend; npm run migrate:fresh
```

Lệnh này **xoá sạch cả 20 collection**, kể cả chat. Muốn giữ chat thì chỉ nạp
lại phần tài sản:

```bash
cd backend; node migrate.js --fresh --seed --only=physicalAssets,digitalAssets,assetAssignments
```
