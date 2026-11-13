# Kiến trúc dữ liệu datvietso: MongoDB

Toàn bộ hệ thống chạy trên **MongoDB**, 19 collection. Không còn MySQL.

## 0. Lệch so với tài liệu — đọc trước

`Docs/datvietso_qlts.docx` chỉ định MySQL ở bốn chỗ, trong đó có hai ràng buộc
mà kiến trúc hiện tại **không đáp ứng**:

> Backend: Node.js, Express, Sequelize ORM (hoặc TypeORM), **MySQL**

> Data Integrity: Bảng `asset_allocations` phải duy trì ràng buộc **khóa ngoại
> (FOREIGN KEY)** với cả `assets` và `employees` để đảm bảo tính toàn vẹn khi audit log.

Dự án đã quyết định bỏ MySQL, chấp nhận mất 48 khóa ngoại và thay bằng cascade
viết tay ở tầng ứng dụng (mục 5). Ghi lại ở đây để người đọc sau không tưởng là
sót, và để biết cần giải trình gì nếu dự án được nghiệm thu theo tài liệu.

`Docs/Kế hoạch Triển khai Module Chat Realtime.docx` không ràng buộc hệ quản trị
nào — đã kiểm tra, không nhắc MySQL/SQL/ORM lần nào.

Spec cũng đòi **Sequelize ORM**. Repo dùng driver `mongodb` thuần, raw query —
giữ đúng style sẵn có của codebase (trước đây là `mysql2` raw SQL, cũng không
dùng ORM).

## 1. Bản đồ 33 bảng → 19 collection

Nguyên tắc: **embed** khi con có số lượng giới hạn và chỉ truy cập qua cha;
**reference** khi con truy vấn độc lập hoặc tăng không giới hạn.

| Collection | Gộp từ bảng | Cách làm |
|---|---|---|
| `users` | `users` + `employees` | `employees.user_id` UNIQUE → quan hệ 1:1, gộp một doc |
| `departments` | `departments` | Cây phòng ban: `parentId` + `ancestors[]` (materialized path) |
| `positions` | `positions` | Dữ liệu tham chiếu, truy vấn độc lập |
| `attendances` | `attendances` | Tăng không giới hạn theo thời gian → **không** embed |
| `leaveRequests` | `leave_requests` | Query theo `status` xuyên nhiều nhân sự |
| `assets` | `assets` | `physicalMeta`, `metadata` thành sub-document thật |
| `assetAllocations` | `asset_allocations` | Lịch sử, query độc lập theo email |
| `assetMaintenances` | `asset_maintenances` | Lịch sử bảo trì |
| `assetAuditLogs` | `asset_audit_logs` | Append-only (ứng viên tốt cho TTL index) |
| `conversations` | `Conversations` + `GroupMembers` | Embed `members[]` + `lastMessage` |
| `messages` | `Messages` + `MessageReactions` | Embed `reactions[]` |
| `kanbanBoards` | `kanban_boards` + `_board_members` + `_columns` + `_tags` | **4 → 1** |
| `kanbanCards` | `kanban_cards` + `_assignees` + `_card_tags` + `_checklists` + `_comments` + `_attachments` | **6 → 1** |
| `calendarCategories` | `calendar_categories` | Dữ liệu tham chiếu |
| `calendarEvents` | `calendar_events` + `_attendees` + `_reminders` | **3 → 1** |
| `crmCustomers` | `crm_customers` + `crm_contacts` | Embed `contacts[]` |
| `crmLeads` | `crm_leads` | Vòng đời riêng |
| `crmDeals` | `crm_deals` | Query theo `pipeline_stage` |
| `crmActivities` | `crm_activities` | Timeline, query xuyên customer/deal/lead |

Giảm nhiều nhất: kanban 11 → 2, chat 4 → 2.

## 2. Ba chỗ đáng chú ý

### `users` — gộp users + employees

Truy vấn login cũ JOIN **4 bảng**:

```sql
FROM users u
LEFT JOIN employees e ON u.id = e.user_id
LEFT JOIN departments d ON e.department_id = d.id
LEFT JOIN positions   p ON e.position_id   = p.id
WHERE e.employee_code = ? OR u.username = ? OR u.email = ?
```

Giờ là **một `findOne`**, nhờ snapshot phòng ban / chức vụ lưu thẳng trong doc:

```js
db.users.findOne({ $or: [
  { 'employee.employeeCode': code }, { username: code }, { email: code },
]});
```

Đổi lại: phòng ban đổi tên thì phải `updateMany` snapshot trong mọi user thuộc
phòng đó. Chấp nhận được vì tên phòng ban rất ít đổi.

### `kanbanCards` — gộp 6 bảng

`comments` là chỗ duy nhất có thể tăng không giới hạn. Vài chục comment mỗi thẻ
thì embed tốt hơn; nếu có thẻ vượt vài trăm thì tách riêng — giới hạn cứng của
một doc là 16MB.

### Chat — `members` embed, `lastMessage` snapshot

Handler `send_message` cũ chạy **4 query mỗi tin**: INSERT, UPDATE `updated_at`,
SELECT `groupmembers`, và `COUNT(*)` toàn bảng chỉ để biết "có phải tin đầu tiên
không". Giờ còn **2 lệnh**:

```js
await messages.insertOne(doc);
const prev = await conversations.findOneAndUpdate(
  { _id: convId },
  { $set: { lastMessage: {...}, updatedAt: now } },
  { returnDocument: 'before' },      // trả về doc TRƯỚC khi update
);
// prev.members              -> thay SELECT groupmembers
// prev.lastMessage === null -> tin đầu tiên, thay COUNT(*)
```

**Bất biến phải giữ:** `lastMessage` luôn là tin **chưa xóa** mới nhất, hoặc null.
Xóa tin cuối mà không tính lại thì sidebar hiện tin đã xóa — xem
`recomputeLastMessage()` trong `services/chat.js`.

Ba thứ nữa được **tính sẵn lúc ghi**, để lúc đọc chỉ còn một câu đi index:

| Field | Dùng cho | Nếu không có |
|---|---|---|
| `messages.mentions[]` | badge "@ bạn" ở sidebar, thông báo riêng (Task 4.1) | phải quét nội dung mọi tin để biết ai bị nhắc |
| `messages.attachmentKind` | panel Bộ sưu tập ảnh/video/file/link (Task 3.2) | mỗi lần mở panel phải regex toàn bộ tin của phòng |
| `conversations.members[].lastReadAt` | số tin chưa đọc theo từng người | cần collection `message_reads` riêng |

`mentions` **luôn được server parse** theo danh sách thành viên thật trong
`services/chat.js`, không lấy mảng client gửi lên — nếu tin client thì chỉ cần
sửa payload là bắn thông báo cho người không liên quan.

Số chưa đọc là `count(messages có createdAt > lastReadAt)`. Mỗi phòng một mốc
riêng nên `countUnread()` dựng `$or` gồm từng cặp (conversationId, mốc) và đếm
tất cả phòng trong **một** aggregate, thay vì N câu đếm.

Lưu ý ID: `userId` / `sender.id` trong chat là **hex của `users._id` dạng chuỗi**
(bảng gốc dùng `VARCHAR(100)`). Chỉ `_id` của conversation và message là ObjectId.

## 3. Tiền phải dùng `Decimal128`

Số của JavaScript là float64, **không an toàn cho tiền**. Năm trường bắt buộc
`Decimal128`, validator sẽ chặn nếu truyền `Number`:

`users.employee.baseSalary` · `assets.purchaseCost` · `assetMaintenances.cost`
· `crmLeads.estimatedBudget` · `crmDeals.dealValue`

```js
const { Decimal128 } = require('mongodb');
dealValue: Decimal128.fromString('450000000')
```

## 4. ENUM → `$jsonSchema` validator

32 cột ENUM của MySQL được giữ lại bằng validator trên từng collection. Không có
nó thì gõ nhầm `'ACITVE'` vẫn lưu được mà không báo gì. `validationLevel` để
`strict`, `validationAction: 'error'` — sai là lỗi ngay lúc insert.

## 5. Những gì MySQL từng lo hộ, giờ nằm ở tầng ứng dụng

### Khóa ngoại và `ON DELETE CASCADE`

33 ràng buộc cascade của MySQL giờ không còn. Chỗ nào embed thì cascade tự hết
(xóa board là mất luôn columns/tags/members). Chỗ nào còn reference thì phải
xóa tay:

| Xóa | Phải xóa theo | Đã làm |
|---|---|---|
| `assets` | `assetAllocations`, `assetMaintenances`, `assetAuditLogs` | ✔ `cascadeDeleteAsset()` trong `routes/assets.js` |
| `conversations` | `messages` cùng `conversationId` | ✔ `cascadeDeleteConversation()` trong `services/chat.js` |
| `users` | `attendances`, `leaveRequests`; gỡ khỏi `conversations.members`, `kanbanBoards.members`, `kanbanCards.assignees` | chưa (chưa có endpoint xóa user) |
| `kanbanBoards` | `kanbanCards` cùng `boardId` | chưa |
| `crmCustomers` | `crmDeals`, `crmActivities` | chưa |

Những dòng "chưa" là nợ kỹ thuật thật: khi thêm endpoint xóa tương ứng thì phải
viết cascade cùng lúc, nếu không sẽ sinh dữ liệu rác. Nên gom vào một lớp
`backend/services/` thay vì rải trong route.

### UNIQUE

Ép được bằng index: `users.username`, `users.email`, `employee.employeeCode`,
`departments.code`, `positions.code`, `assets.code`, `crmCustomers.code`,
`attendances {userId, date}`.

Phải ép bằng code vì nằm trong array embed: `conversations.members.userId`,
`messages.reactions`, `kanbanBoards.members.userId`, `kanbanCards.assignees.userId`,
`calendarEvents.attendees.userId`. Dùng `$addToSet` hoặc `updateOne` với điều
kiện `'members.userId': { $ne: userId }`.

### `ON UPDATE CURRENT_TIMESTAMP`

Không có tương đương. Phải `$set: { updatedAt: new Date() }` trong **mọi** lệnh update.

### Transactions

Dùng ở: tạo nhóm chat (2 collection), xóa phòng chat kèm tin nhắn, cấp phát tài
sản (asset + allocation + log), thu hồi, và xóa tài sản kèm cascade. Cần replica set — compose đã chạy `--replSet rs0`.

## 6. Chạy

```bash
docker compose up -d
```

```bash
cd backend && npm run migrate:fresh
```

`migrate.js` nhận `--fresh`, `--seed`, `--only=a,b`, `--quiet`, `--help`. Khi fail
thì exit code 1 — bản cũ chỉ log lỗi rồi vẫn exit 0, nên `npm run migrate` báo
thành công dù đã lỗi.

Nạp lại **riêng dữ liệu chat**, giữ nguyên tài sản / CRM / kanban:

```bash
cd backend && npm run seed:chat     # = migrate.js --fresh --seed --only=conversations,messages
```

> **Nạp một phần thì phải dùng lại `_id` của user đang có.** `buildSeed()` sinh
> ObjectId mới mỗi lần gọi. Nếu `--only` không bao gồm `users` mà cứ dùng id mới
> thì `conversations.members[].userId`, `messages.sender.id` và `mentions[]` sẽ
> trỏ vào user không tồn tại: migrate báo thành công, nhưng đăng nhập vào **không
> thấy phòng nào**. Nên `seed()` tra lại 4 user theo `username` (`SEED_USERNAMES`)
> và báo lỗi rõ ràng nếu thiếu, thay vì nạp ra dữ liệu mồ côi.

Mongo chạy **single-node replica set**; healthcheck trong compose tự `rs.initiate()`
ở lần chạy đầu.

## 7. Ba lỗi bảo mật trong `routes/auth.js` — giữ nguyên có chủ đích

Đã chuyển sang Mongo nhưng **giữ y nguyên hành vi**, vì frontend đang đăng nhập
bằng mật khẩu mặc định; sửa sẽ làm hỏng app:

1. **Mật khẩu `123456` mở được mọi tài khoản** — `password === '123456'` là cho qua,
   bỏ qua hoàn toàn `passwordHash`.
2. **So mật khẩu plaintext** — `user.passwordHash === password`. Nên `bcrypt.compare`.
3. **Token không có chữ ký** — `dvs_token_<id>_<timestamp>`, và `/me` chỉ tách chuỗi
   lấy id → sửa chuỗi là đăng nhập thành người khác. Nên dùng JWT có ký.

Sửa ba điểm này cần đổi cả frontend, nên tách thành việc riêng.

## 8. Module chat — trạng thái theo kế hoạch

`Docs/Kế hoạch Triển khai Module Chat Realtime.docx`:

| Task | Trạng thái | Nằm ở đâu |
|---|---|---|
| 1.1 Schema + WebSocket | ✔ | `db/schema.js`, `server.js` |
| 1.2 Online / Offline | ✔ | `server.js` — một user nhiều tab vẫn đúng |
| 1.3 Tạo nhóm (tối thiểu 3 người) | ✔ | `POST /groups`, đã lọc trùng userId |
| 1.4 Phân quyền + nhường quyền | ✔ | đủ 7 dòng bảng quyền, xem đầu `routes/chat.js` |
| 2.1 Gửi / xóa tin realtime | ✔ | chỉ người gửi xóa được tin của mình |
| 2.2 Typing indicator | ✔ | `server.js` + `useChatStore.ts` |
| 2.3 Ghim cuộc trò chuyện | ✔ | `pinnedBy[]` theo từng user |
| 3.1 Media + vị trí GPS | ✔ | `/api/upload` (giới hạn 25MB) + `type: 'location'` |
| 3.2 Bộ sưu tập file/media/link | ✔ | `GET /conversations/:id/attachments` |
| 4.1 Mention @name + thông báo | ✔ | parse ở server, `mention_notification` |
| 4.2 Lọc theo thời gian | — | backlog, kế hoạch ghi rõ "làm sau" |

Làm thêm ngoài kế hoạch, vì thiếu thì phần trên không chạy đúng:

- **Phân trang lịch sử tin nhắn** — `GET /messages/:id?limit=&before=`. Trước đây
  trả về toàn bộ tin của phòng.
- **Badge chưa đọc bền** — `lastReadAt` trong DB. Trước đây chỉ nằm trong state
  Pinia nên F5 là mất, mở máy khác không thấy.
- **Cảm xúc** — `messages.reactions[]` có trong schema từ đầu (gộp từ bảng
  `MessageReactions`) nhưng chưa có endpoint nào ghi vào.
- **Tin hệ thống** (`type: 'system'`) — "A đã thêm B vào nhóm" giờ do server sinh.
  Trước đây frontend gọi `sendMessage()` sau mỗi thao tác, nên dòng đó hiện như
  tin nhắn thường của người thao tác, và tắt tab giữa chừng thì không có dòng nào.
- **Rời nhóm / xóa phòng** — kèm cascade `messages` (mục 5).

### API chat

REST, tiền tố `/api/chat` (`routes/chat.js`):

| Method | Đường dẫn | Quyền |
|---|---|---|
| GET | `/conversations?userId=` | kèm `unreadCount` + `mentionCount` |
| GET | `/messages/:id?limit=&before=` | phân trang, mặc định 50, tối đa 200 |
| POST | `/groups` | tối thiểu 3 thành viên khác nhau |
| PUT | `/groups/:id` | đổi tên / ảnh — owner, admin |
| POST | `/groups/:id/members` | owner, admin |
| PUT | `/groups/:id/role` | owner |
| DELETE | `/groups/:id/members/:userId` | owner |
| POST | `/groups/:id/leave` | thành viên; owner rời thì tự chuyển quyền |
| DELETE | `/conversations/:id` | nhóm: owner · 1-1: thành viên · cascade messages |
| POST | `/conversations/:id/pin` | thành viên |
| POST | `/conversations/:id/read` | thành viên |
| GET | `/conversations/:id/attachments?kind=` | `media·image·video·file·link·all` |
| POST | `/messages/:id/reactions` | thành viên, bấm lại là bỏ |
| GET | `/contacts` | danh bạ nhân sự |
| POST | `/direct` | mở hoặc lấy lại phòng 1-1 |

Socket.IO (`server.js`) — client gửi: `user_online`, `join_room`, `join_rooms`,
`send_message`, `delete_message`, `typing`, `stop_typing`, `mark_read`.
Server phát: `active_users`, `user_status_change`, `receive_message`,
`message_deleted`, `message_reaction`, `message_error`, `mention_notification`,
`conversation_read`, `conversation_updated`, `conversation_deleted`,
`direct_chat_created`, `group_created`, `members_updated`, `member_removed`,
`role_changed`, `display_typing`, `hide_typing`.

### Những chỗ đã siết lại về quyền

Bản cũ tin vào client ở bốn chỗ; cả bốn đều kiểm tra ở server:

| Trước | Giờ |
|---|---|
| Biết `conversation_id` là gửi được tin, dù không ở trong phòng | `appendMessage()` chặn người ngoài |
| `delete_message` xóa theo id, không kiểm tra ai gửi | chỉ người gửi xóa được tin của mình |
| `join_room` vào được phòng bất kỳ → nghe trộm realtime | chỉ join phòng mình là thành viên |
| `POST /groups/:id/members` không kiểm tra vai trò | owner + admin, đúng bảng quyền 1.4 |

`sender_id` trong payload cũng được đối chiếu với `socket.data.userId` (đặt lúc
`user_online`), nên không gửi được dưới danh nghĩa người khác.

Ba lỗ hổng ở mục 7 (`routes/auth.js`) **vẫn còn** — chúng nằm ở tầng đăng nhập,
sửa phải đổi cả frontend nên tách thành việc riêng. Vì token chưa ký, mọi kiểm
tra quyền trên đây vẫn dựa vào `userId` client khai báo: nó chặn được lỗi logic
và người dùng nghịch ngợm, chưa chặn được người cố tình giả mạo token.

## 9. Việc còn lại

- Cascade cho các trường hợp còn đánh dấu "chưa" ở mục 5 (users, kanbanBoards,
  crmCustomers) — viết cùng lúc với endpoint xóa tương ứng
- Task 4.2 lọc tin nhắn theo thời gian (backlog)
- Ba lỗi bảo mật ở mục 7 + ký token, rồi bỏ `userId` do client khai báo
- Spec đòi Sequelize ORM (mục 0)

## 10. Phụ lục — những điều đã đo trên Mongo thật

**Partial index phải dùng `$exists`, không dùng `$type`.** Query planner chỉ dùng
partial index khi chứng minh được query là tập con của `partialFilterExpression`.
Nó suy ra được `{f:'x'}` ⟹ `{f:{$exists:true}}` nhưng **không** suy ra được ⟹
`{f:{$type:'string'}}`. Đo trên Mongo 7.0.45:

| partialFilterExpression | nhiều doc thiếu field | nhiều doc `null` | chặn trùng | query `=` | query `$or` |
|---|---|---|---|---|---|
| `{ $type: 'string' }` | OK | OK | ✓ | **COLLSCAN** | **COLLSCAN** |
| `{ $exists: true }` | OK | chặn | ✓ | IXSCAN | IXSCAN |
| `sparse: true` | OK | chặn | ✓ | IXSCAN | IXSCAN |

Hệ quả: field chưa có giá trị thì **bỏ hẳn** khỏi document, đừng set `null`.

**`bsonType: ['int','long']` sẽ từ chối số nguyên của JavaScript.** JS chỉ có một
kiểu số và driver ghi xuống thành `double`, nên `position: 0` cũng bị chặn. Phải
cho phép cả `'double'`.

**Regex thay cho `LIKE` cần escape.** Từ khóa tìm kiếm chứa `.` `*` `+` `[` sẽ làm
hỏng truy vấn nếu nhét thẳng vào `new RegExp()` — bản MySQL không gặp vấn đề này.
Xem `routes/assets.js`.
