# datvietso

Hệ thống quản trị nội bộ: Chat realtime, Quản lý tài sản, Kanban, Lịch, CRM.

Vue 3 (Materio Vuetify) · Node.js/Express · MongoDB · Socket.IO

## Cài trên máy mới

### 1. Node 18 trở lên — kiểm tra TRƯỚC

```bash
node --version
```

Phải là **v18, v20, v22 hoặc mới hơn**. Node cũ hơn sẽ hỏng với lỗi khó đoán:

```
vite.js:2
import { performance } from 'node:perf_hooks'
^^^^^^
SyntaxError: Unexpected token import
```

Lỗi đó **không phải do code**, mà do Node không hiểu cú pháp ESM. Thấy
`bootstrap_node.js` hay `vm.js` trong stack trace là chắc chắn Node quá cũ.

Cài bản mới: <https://nodejs.org> (chọn LTS), hoặc:

```bash
winget install OpenJS.NodeJS.LTS
```

Cài xong **đóng terminal mở lại** rồi kiểm tra lại `node --version`.

### 2. Docker Desktop

MongoDB chạy trong container. Tải tại <https://docker.com/products/docker-desktop>.

### 3. Cài thư viện — HAI thư mục riêng

```bash
cd backend; npm install
```

```bash
cd frontend/typescript-version; npm install
```

> Quên thư mục `backend` là gặp `'nodemon' is not recognized`. Lệnh `npm install`
> ở thư mục này không cài cho thư mục kia.

### 4. Tạo file cấu hình

`backend/.env` **không nằm trong git** (chứa khoá bí mật), nên clone về là không
có và backend dừng ngay với `Thiếu MONGO_URI trong .env`. Một lệnh là xong:

```bash
cd backend; npm run setup
```

Lệnh này chép từ `.env.example` và tự sinh `ASSET_SECRET_KEY`. Chạy lại nhiều
lần vô hại — đã có `.env` thì nó không ghi đè, chỉ điền nốt phần còn trống.

Kết quả là `backend/.env` với:

```
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/datvietso?replicaSet=rs0&directConnection=true
MONGO_DB=datvietso
ASSET_SECRET_KEY=<64 ký tự hex tự sinh>
```

> Mỗi máy một khoá riêng. Khoá khác nhau thì không giải mã được dữ liệu đã mã
> hoá trên máy kia — bình thường, vì mỗi máy có database riêng. Đừng xoá hay đổi
> khoá trên máy đã có dữ liệu thật: mọi key bản quyền đã lưu sẽ không đọc lại được.

### 5. Dựng database

```bash
docker compose up -d
```

Đợi khoảng 20 giây cho MongoDB tự khởi tạo replica set, rồi:

```bash
cd backend; npm run migrate:fresh
```

Tạo 20 collection và nạp dữ liệu mẫu.

### 6. Chạy

Hai cửa sổ terminal riêng:

```bash
cd backend; npm run dev
```

```bash
cd frontend/typescript-version; npm run dev
```

Mở <http://localhost:5173>. Đăng nhập `DVS-001`, mật khẩu `123456`.

## Gặp lỗi

| Lỗi | Nguyên nhân |
|---|---|
| `SyntaxError: Unexpected token import` | Node cũ hơn 18 — bước 1 |
| `'nodemon' is not recognized` | Chưa `npm install` trong `backend` — bước 3 |
| `Thiếu MONGO_URI trong .env` | Chưa chạy `npm run setup` trong `backend` — bước 4 |
| `MongoServerSelectionError` | Docker chưa chạy, hoặc chưa `docker compose up -d` |
| `Thiếu ASSET_SECRET_KEY` | Chưa chạy `npm run setup` — bước 4 |
| `EADDRINUSE: port 5000` | Còn tiến trình cũ: `netstat -ano \| findstr :5000` rồi `taskkill /PID <pid> /F` |
| Trang trắng, không có dữ liệu | Backend chưa chạy, hoặc chạy khác cổng 5000 |

## Tài liệu

| File | Nội dung |
|---|---|
| [MONGODB.md](MONGODB.md) | Kiến trúc 20 collection, quy ước dữ liệu, nợ kỹ thuật |
| [Docs/danh-gia-dac-ta-tai-san-so.md](Docs/danh-gia-dac-ta-tai-san-so.md) | Đánh giá đặc tả tài sản, những chỗ triển khai lệch và lý do |
| [Docs/huong-dan-su-dung-quan-ly-tai-san.md](Docs/huong-dan-su-dung-quan-ly-tai-san.md) | Hướng dẫn thao tác phân hệ tài sản |
| [Docs/huong-dan-demo-qua-ngrok.md](Docs/huong-dan-demo-qua-ngrok.md) | Mở bản dùng thử cho khách qua Internet |

## Lệnh hay dùng

| Lệnh | Tác dụng |
|---|---|
| `npm run setup` | Tạo `.env` và sinh khoá mã hoá (máy mới) |
| `npm run migrate` | Cập nhật schema, giữ nguyên dữ liệu |
| `npm run migrate:fresh` | **Xoá sạch** rồi tạo lại và nạp dữ liệu mẫu |
| `npm run seed` | Nạp dữ liệu mẫu vào collection đang trống |
| `npm run seed:chat` | Nạp lại riêng dữ liệu chat |

## Cảnh báo bảo mật

Tầng đăng nhập hiện là **bản tạm, chưa dùng thật được**:

1. Mật khẩu `123456` mở được mọi tài khoản
2. So mật khẩu dạng plaintext, chưa dùng bcrypt
3. Token `dvs_token_<id>_<timestamp>` **không có chữ ký** — sửa chuỗi là đăng
   nhập thành người khác

Chỉ chạy trong mạng nội bộ tin cậy. Muốn mở ra ngoài, đọc
[Docs/huong-dan-demo-qua-ngrok.md](Docs/huong-dan-demo-qua-ngrok.md) trước.
Chi tiết ở [MONGODB.md](MONGODB.md) mục 7.
