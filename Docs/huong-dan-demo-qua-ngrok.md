# Gửi link cho khách test qua ngrok

Dành cho đợt dùng thử ngắn trên **dữ liệu mẫu**. Đọc mục 5 trước khi gửi link.

## Tóm tắt 5 thay đổi đã làm

| # | Việc | Ở đâu |
|---|---|---|
| 1 | Backend phục vụ luôn frontend đã build → chỉ còn **một cổng** | `server.js` + `frontend/.env.production` |
| 2 | Tắt `/api/auth/demo-accounts`, và **giấu luôn gợi ý tài khoản trên trang đăng nhập** | `middleware/auth.js`, `login.vue` |
| 3 | Tắt `reveal-secret` (xem key bản quyền) | `routes/assets.js` |
| 4 | `/api/upload` bắt buộc đăng nhập | `middleware/auth.js` |
| 5 | Mã truy cập đặt trước trang đăng nhập | `middleware/gate.js` |

Mục 2, 3 bật/tắt bằng `DEMO_MODE`. Mục 5 bằng `GATE_PASSWORD`. Không phải sửa code.

> Mục 2 cần cả hai nửa. Endpoint `demo-accounts` thực ra **frontend chưa bao giờ
> gọi** — 4 nút đăng nhập nhanh và dòng "Mật khẩu mặc định: 123456" vốn viết cứng
> trong `login.vue`. Tắt mỗi endpoint thì trang vẫn in mật khẩu ra màn hình.

## 1. Cấu hình

`backend/.env`:

```
DEMO_MODE=true
GATE_PASSWORD=DVS-Demo-C47B38
```

Đổi mã truy cập bất cứ lúc nào — đổi xong mọi cookie cũ tự hết hiệu lực, khách
phải nhập lại.

## 2. Build frontend vào backend

```bash
cd frontend/typescript-version; npm run build
```

Sinh ra `dist/`, backend tự phát hiện và phục vụ. `frontend/.env.production` để
`VITE_API_URL=` trống, nghĩa là gọi API cùng origin — nhờ vậy chỉ cần mở một cổng.

Chạy lại lệnh này mỗi khi sửa frontend; `dist/` không tự cập nhật.

## 3. Chạy

```bash
docker compose up -d
```

```bash
cd backend; npm start
```

Log phải thấy đủ bốn dòng:

```
Cổng vào: BẬT (mã 15 ký tự, cookie sống 7 ngày)
Server is running on port 5000
  Frontend: phục vụ từ dist/ — chỉ cần mở MỘT cổng ra ngoài
  DEMO_MODE: BẬT — đã tắt /api/auth/demo-accounts và reveal-secret
```

Thiếu dòng "Frontend: phục vụ từ dist/" nghĩa là chưa build.

## 4. Mở ngrok

```bash
ngrok http 5000
```

Lấy dòng `Forwarding https://xxxx-xxx.ngrok-free.app`. Gửi khách **ba thứ**:

1. Đường dẫn ngrok
2. Mã truy cập (`GATE_PASSWORD`)
3. Tài khoản `DVS-001`, mật khẩu `123456`

Khách sẽ gặp trang chắn màu tím của ngrok ở lần vào đầu tiên (gói miễn phí),
bấm **Visit Site** là qua.

## 5. Phải biết trước khi gửi link

**Tầng đăng nhập vẫn là bản tạm.** Token `dvs_token_<id>_<timestamp>` không có
chữ ký, mật khẩu `123456` mở được mọi tài khoản. Nghĩa là ai **đã qua được mã
truy cập** vẫn có thể tự xưng là người khác. Mã truy cập ở mục 5 là thứ duy nhất
đứng giữa Internet và chỗ đó.

Vì vậy:

- **Đừng đăng mã truy cập ở nơi công khai.** Nhắn riêng cho khách.
- **Tắt ngrok khi không demo.** Đừng để tunnel chạy qua đêm.
- **Đừng nhập dữ liệu thật.** Key bản quyền thật, mật khẩu tài khoản thật của
  khách thì không được đưa vào bản này. Hiện trong hệ thống toàn dữ liệu mẫu bịa
  ra, lộ cũng không mất gì — giữ nguyên như vậy trong suốt đợt test.
- Nếu khách muốn nhập tài sản thật của họ để xem thử, **dừng lại** và làm tầng
  xác thực cho tử tế trước (bcrypt + JWT có ký). Lúc đó token không chữ ký là lỗ
  hổng thật chứ không còn là rủi ro lý thuyết.

## 6. Khách sẽ không bấm được gì

Trong bản demo, nút **xem key** (con mắt vàng ở tab Bản quyền) sẽ báo
*"Xem key bị tắt trong bản dùng thử"*. Mọi chức năng khác chạy bình thường: cấp
phát trọn gói, thu hồi, offboarding, tra cứu theo nhân sự.

Nếu khách cần xem thử cả luồng xem key, bật tạm `DEMO_MODE=false`, khởi động lại
backend, demo xong bật lại. Đừng để `false` qua đêm.

## 7. Demo xong

```bash
# Tat ngrok: Ctrl+C o cua so ngrok
```

Rồi trả cấu hình về chạy nội bộ trong `backend/.env`:

```
DEMO_MODE=false
GATE_PASSWORD=
```

Muốn quay lại cách chạy cũ (vite riêng ở cổng 5173) thì xoá thư mục
`frontend/typescript-version/dist` — backend thấy không có là tự bỏ qua.

## 8. Hỏng ở đâu thì xem đây

| Hiện tượng | Nguyên nhân |
|---|---|
| Khách thấy trang nhập mã nhưng nhập đúng vẫn không vào | Cookie bị chặn. Trình duyệt phải cho phép cookie của tên miền ngrok |
| Vào được nhưng trang trắng, không có dữ liệu | Chưa build lại sau khi sửa frontend, hoặc `VITE_API_URL` trong `.env.production` không để trống |
| Ảnh/tệp trong chat hỏng | Tệp nằm ở `backend/uploads/`. Địa chỉ tệp lấy theo host của request nên qua ngrok vẫn đúng — nếu hỏng thì kiểm tra tệp có thật trong thư mục không |
| Đăng nhập báo "Chưa nhập mã truy cập" | Cookie cổng hết hạn (7 ngày) hoặc `GATE_PASSWORD` vừa đổi. Mở lại trang gốc nhập mã |
| `EADDRINUSE: port 5000` | Còn tiến trình backend cũ. `netstat -ano \| findstr :5000` rồi `taskkill /PID <pid> /F` |
