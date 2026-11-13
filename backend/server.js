const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Toàn bộ dữ liệu nằm trên MongoDB. Không còn MySQL.
const { ObjectId } = require('mongodb');
const { connectMongo, closeMongo } = require('./db/mongo');
const { toSocketMessage, emitToConversation } = require('./services/chat');
const { scheduleAssetMonitor } = require('./jobs/assetMonitor');
const { requireAuth, isDemoMode } = require('./middleware/auth');
const { mountGate } = require('./middleware/gate');

process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Cấu hình Multer để upload ảnh, video, file
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    // Bỏ ký tự đường dẫn khỏi tên file: originalname do client gửi, "../" trong đó
    // sẽ ghi ra ngoài thư mục uploads.
    filename: (req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname)}`)
});
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

// API Upload File / Media
// Upload BẮT BUỘC đăng nhập. Trước đây bất kỳ ai cũng POST file lên được, mỗi
// file tới 25MB và không giới hạn số lần — trong LAN thì không sao, mở ra
// Internet là ai cũng ghi đầy ổ đĩa máy chủ được.
// `uploadGuard` gán sau khi có handle Mongo (xem start()).
let uploadGuard = (req, res, next) => res.status(503).json({ error: 'Server chưa sẵn sàng' });

app.post('/api/upload', (req, res, next) => uploadGuard(req, res, next), (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            // Vượt giới hạn dung lượng thì trả 413 thay vì để multer ném ra 500
            const tooBig = err.code === 'LIMIT_FILE_SIZE';

            return res.status(tooBig ? 413 : 400).json({
                error: tooBig ? `Tệp vượt quá ${MAX_UPLOAD_MB}MB` : err.message,
            });
        }
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Lấy host từ request thay vì cứng localhost, để máy khác trong mạng LAN
        // (hoặc frontend chạy ở domain khác) tải được file về.
        const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
        res.json({
            url: `${base}/uploads/${req.file.filename}`,
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
        });
    });
});

// Mọi route đều cần handle MongoDB nên được gắn trong start() ở cuối file, sau
// khi kết nối xong. `mongoDb` cũng được socket handler dùng.
let mongoDb = null;
let chatRoutes = null;
/** Tầng nghiệp vụ chat dùng chung với REST — xem services/chat.js */
let chat = null;
/** Bộ hẹn giờ quét hạn tài sản, cần giữ tham chiếu để tắt lúc shutdown. */
let assetMonitor = null;

/**
 * Ai đang online: userId -> Set các socketId của người đó.
 *
 * Bản cũ lưu userId -> MỘT socketId. Mở hai tab thì tab sau ghi đè tab trước, và
 * khi đóng tab nào trước thì cả hệ thống thấy người đó offline dù tab kia vẫn mở.
 * Set khiến chỉ khi socket CUỐI CÙNG rời đi mới phát trạng thái offline.
 */
const onlineUsers = new Map();

const isOnline = (userId) => {
    const set = onlineUsers.get(String(userId));

    return !!set && set.size > 0;
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Đăng ký Online Status
    socket.on('user_online', (userId) => {
        if (!userId) return;

        const uidStr = String(userId);
        // Gán đồng bộ, ngay dòng đầu: client emit 'join_rooms' ngay sau
        // 'user_online' và handler đó cần biết socket này là của ai.
        socket.data.userId = uidStr;

        const wasOnline = isOnline(uidStr);
        if (!onlineUsers.has(uidStr)) onlineUsers.set(uidStr, new Set());
        onlineUsers.get(uidStr).add(socket.id);

        socket.join(`user_${uidStr}`);

        // Chỉ phát khi thực sự chuyển từ offline sang online (tab thứ hai thì không)
        if (!wasOnline) io.emit('user_status_change', { userId: uidStr, status: 'online' });

        // Gửi danh sách tất cả user đang online cho client mới kết nối
        socket.emit('active_users', Array.from(onlineUsers.keys()));
    });

    // 2. Tham gia phòng chat (Conversation)
    //
    // Chỉ cho vào phòng mà mình là thành viên. Bản cũ join thẳng theo id client
    // gửi lên, nên biết một conversationId là nghe được toàn bộ tin nhắn realtime
    // của phòng đó dù không ở trong nhóm.
    async function joinAllowed(ids) {
        const uid = socket.data.userId;
        if (!uid) {
            console.warn('[Socket] join trước khi user_online, bỏ qua:', socket.id);

            return [];
        }
        if (!mongoDb) return [];

        const objectIds = ids
            .filter((id) => id && ObjectId.isValid(String(id)))
            .map((id) => new ObjectId(String(id)));
        if (objectIds.length === 0) return [];

        // Một query cho cả danh sách phòng, không phải mỗi phòng một query
        const allowed = await mongoDb.collection('conversations')
            .find(
                { _id: { $in: objectIds }, 'members.userId': uid },
                { projection: { _id: 1 } },
            )
            .toArray();

        for (const c of allowed) socket.join(String(c._id));

        return allowed.map((c) => String(c._id));
    }

    socket.on('join_room', async (conversationId) => {
        try {
            await joinAllowed([conversationId]);
        } catch (err) {
            console.error('[Socket] join_room error:', err.message);
        }
    });

    socket.on('join_rooms', async (conversationIds) => {
        try {
            if (Array.isArray(conversationIds)) await joinAllowed(conversationIds);
        } catch (err) {
            console.error('[Socket] join_rooms error:', err.message);
        }
    });

    // 3. Gửi tin nhắn Realtime
    //
    // Toàn bộ phần ghi nằm ở chat.appendMessage(): đọc members (để chặn người
    // ngoài phòng và parse @mention theo người thật), ghi message, cập nhật
    // lastMessage + updatedAt. Bản MySQL chạy 4 query mỗi tin (INSERT, UPDATE
    // updated_at, SELECT groupmembers, COUNT(*) toàn bảng chỉ để biết có phải tin
    // đầu tiên) — ở đây là 3 lệnh và không có lệnh nào quét cả collection.
    socket.on('send_message', async (data) => {
        const {
            conversation_id, sender_id, sender_name, sender_avatar,
            type, content, metadata, client_temp_id,
        } = data || {};

        try {
            if (!chat) return console.error('[Socket] Mongo chưa sẵn sàng, bỏ qua send_message');
            if (!ObjectId.isValid(String(conversation_id))) {
                return console.error('[Socket] conversation_id không hợp lệ:', conversation_id);
            }

            // Gửi dưới danh nghĩa người khác: chặn tại đây. socket.data.userId do
            // 'user_online' đặt, không phải do payload của tin nhắn.
            const authedId = socket.data.userId;
            if (authedId && String(sender_id) !== authedId) {
                return socket.emit('message_error', {
                    conversationId: String(conversation_id),
                    clientTempId: client_temp_id || null,
                    error: 'sender_id không khớp người đang đăng nhập',
                });
            }

            const convId = new ObjectId(String(conversation_id));
            const result = await chat.appendMessage(
                convId,
                { id: sender_id, name: sender_name, avatar: sender_avatar },
                { type: type || 'text', content: content || '', metadata: metadata || null },
            );

            if (result.error) {
                const reason = result.error === 'not_found'
                    ? 'Cuộc trò chuyện không tồn tại'
                    : 'Bạn không phải thành viên của cuộc trò chuyện này';
                console.warn(`[Socket] send_message bị từ chối (${result.error}) bởi ${sender_id}`);

                return socket.emit('message_error', {
                    conversationId: String(conversation_id),
                    clientTempId: client_temp_id || null,
                    error: reason,
                });
            }

            const { message, members, isFirstMessage } = result;
            const payload = toSocketMessage(message, client_temp_id || null);

            // Một lệnh emit tới phòng conversation VÀ phòng cá nhân của từng thành
            // viên. Bản cũ emit riêng từng nơi nên ai đang mở phòng nhận hai lần.
            emitToConversation(io, convId, members, 'receive_message', payload);

            // Tin đầu tiên của cuộc trò chuyện -> báo thành viên nạp phòng mới
            // (phòng direct chỉ hiện ở phía người nhận sau tin đầu tiên)
            if (isFirstMessage) {
                for (const m of members) {
                    io.to(`user_${m.userId}`).emit('direct_chat_created', {
                        conversationId: String(conversation_id),
                    });
                }
            }

            // Thông báo riêng cho người bị @ (Task 4.1). Server tự parse theo danh
            // sách thành viên thật, không tin mảng mentions client gửi lên.
            for (const uid of message.mentions || []) {
                io.to(`user_${uid}`).emit('mention_notification', {
                    conversationId: String(conversation_id),
                    messageId: String(message._id),
                    conversationName: result.conversation.name || null,
                    isGroup: result.conversation.type === 'group',
                    senderId: String(sender_id),
                    senderName: sender_name || null,
                    senderAvatar: sender_avatar || null,
                    content: message.content,
                    createdAt: message.createdAt,
                });
            }
        } catch (err) {
            console.error('Error saving message:', err);
            socket.emit('message_error', {
                conversationId: String(conversation_id || ''),
                clientTempId: client_temp_id || null,
                error: 'Không gửi được tin nhắn, thử lại sau',
            });
        }
    });

    // 4. Xóa tin nhắn (Soft delete)
    //
    // Chỉ người gửi được xóa tin của mình (bảng quyền Task 1.4: "Gửi / Xóa tin
    // nhắn cá nhân"). Bản cũ xóa theo message_id mà không kiểm tra gì: ai biết id
    // là xóa được tin của người khác.
    socket.on('delete_message', async ({ message_id, conversation_id, user_id } = {}) => {
        try {
            if (!chat) return console.error('[Socket] Mongo chưa sẵn sàng, bỏ qua delete_message');
            if (!ObjectId.isValid(String(message_id)) || !ObjectId.isValid(String(conversation_id))) {
                return console.error('[Socket] id không hợp lệ khi xóa tin nhắn');
            }

            const requesterId = socket.data.userId || (user_id ? String(user_id) : null);
            if (!requesterId) {
                return socket.emit('message_error', { error: 'Chưa xác định được người dùng' });
            }

            const convId = new ObjectId(String(conversation_id));
            const msgId = new ObjectId(String(message_id));

            // Điều kiện 'sender.id' nằm ngay trong filter: không khớp thì
            // modifiedCount = 0, không cần đọc trước rồi mới ghi.
            const r = await chat.messages.updateOne(
                { _id: msgId, conversationId: convId, 'sender.id': requesterId, deletedAt: null },
                { $set: { deletedAt: new Date() } },
            );

            if (r.matchedCount === 0) {
                console.warn(`[Socket] delete_message bị từ chối: ${requesterId} / ${message_id}`);

                return socket.emit('message_error', {
                    conversationId: String(conversation_id),
                    error: 'Chỉ xóa được tin nhắn của chính bạn',
                });
            }

            // Giữ bất biến: lastMessage luôn là tin CHƯA XÓA mới nhất. Nếu vừa xóa
            // đúng tin cuối mà không tính lại thì sidebar sẽ hiện tin đã xóa.
            await chat.recomputeLastMessage(convId);

            const conv = await chat.conversations.findOne(
                { _id: convId },
                { projection: { members: 1 } },
            );
            emitToConversation(io, convId, conv ? conv.members : [], 'message_deleted', {
                message_id: String(message_id),
                conversation_id: String(conversation_id),
            });
        } catch (err) {
            console.error('Error deleting message:', err);
        }
    });

    // 5. Trạng thái Typing
    // Chỉ phát đúng trong phòng conversation_id (phòng mà người đó đang gõ)
    socket.on('typing', ({ conversation_id, user_id, user_name } = {}) => {
        if (conversation_id) {
            socket.to(String(conversation_id)).emit('display_typing', {
                conversation_id: String(conversation_id),
                user_id: String(user_id),
                user_name
            });
        }
    });

    socket.on('stop_typing', ({ conversation_id, user_id, user_name } = {}) => {
        if (conversation_id) {
            socket.to(String(conversation_id)).emit('hide_typing', {
                conversation_id: String(conversation_id),
                user_id: String(user_id),
                user_name
            });
        }
    });

    // 6. Đánh dấu đã đọc qua socket (REST POST /conversations/:id/read làm cùng việc)
    //
    // Mốc lastReadAt nằm trong conversations.members[] nên badge chưa đọc sống qua
    // F5 và đồng bộ giữa các thiết bị — bản cũ chỉ giữ số đó trong state Pinia.
    socket.on('mark_read', async ({ conversation_id, user_id } = {}) => {
        try {
            if (!chat) return;
            if (!ObjectId.isValid(String(conversation_id))) return;

            const uid = socket.data.userId || (user_id ? String(user_id) : null);
            if (!uid) return;

            const readAt = new Date();
            await chat.conversations.updateOne(
                { _id: new ObjectId(String(conversation_id)), 'members.userId': uid },
                { $set: { 'members.$[m].lastReadAt': readAt } },
                { arrayFilters: [{ 'm.userId': uid }] },
            );

            // Các tab khác của cùng người dùng cũng tắt badge
            io.to(`user_${uid}`).emit('conversation_read', {
                conversationId: String(conversation_id),
                userId: uid,
                lastReadAt: readAt,
            });
        } catch (err) {
            console.error('Error marking read:', err);
        }
    });

    // 7. Ngắt kết nối (Offline)
    socket.on('disconnect', () => {
        const uid = socket.data.userId;
        if (uid && onlineUsers.has(uid)) {
            const sockets = onlineUsers.get(uid);
            sockets.delete(socket.id);

            // Chỉ offline khi tab/thiết bị CUỐI CÙNG của người đó rời đi
            if (sockets.size === 0) {
                onlineUsers.delete(uid);
                io.emit('user_status_change', { userId: uid, status: 'offline' });
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;

/**
 * Kết nối MongoDB TRƯỚC khi mở cổng, để không có request chat nào rơi vào lúc
 * `mongoDb` còn null. Router chat cũng chỉ gắn được sau khi có handle db.
 */
async function start() {
    mongoDb = await connectMongo();

    // Cổng vào phải đứng TRƯỚC mọi route, kể cả file tĩnh — xem middleware/gate.js
    mountGate(app, express);

    uploadGuard = requireAuth(mongoDb);

    // Cấu hình công khai cho frontend. CHỈ chứa cờ bật/tắt, không có bí mật nào.
    // Nhờ nó trang đăng nhập biết đang ở bản demo để giấu gợi ý tài khoản mẫu —
    // tắt endpoint demo-accounts là chưa đủ, vì 4 nút đó vốn viết cứng trong
    // giao diện chứ không lấy từ API.
    app.get('/api/config', (req, res) => {
        res.json({
            demoMode: isDemoMode(),
            gateEnabled: !!(process.env.GATE_PASSWORD || '').trim(),
        });
    });

    app.use('/api/auth', require('./routes/auth')(mongoDb));

    // Phân hệ tài sản: ba nhóm URL theo đặc tả mục 5.1
    //   /api/assets       kho thiết bị + kho bản quyền
    //   /api/assignments  phiếu cấp phát / thu hồi
    //   /api/employees    offboarding theo nhân sự
    app.use('/api/assets', require('./routes/assets')(mongoDb));
    app.use('/api/assignments', require('./routes/assignments')(mongoDb, io));
    app.use('/api/employees', require('./routes/employees')(mongoDb, io));

    chatRoutes = require('./routes/chat')(mongoDb, io);
    chat = chatRoutes.chat; // cùng một tầng nghiệp vụ cho REST và socket
    app.use('/api/chat', chatRoutes);

    // Luồng 6: quét hạn bản quyền và phiếu chờ kích hoạt, 08:00 mỗi sáng
    assetMonitor = scheduleAssetMonitor(mongoDb, io, { hour: Number(process.env.ASSET_CRON_HOUR || 8) });

    // --- Phục vụ luôn frontend đã build, để cả hệ thống chỉ cần MỘT cổng ------
    //
    // Cần khi đưa ra ngoài qua ngrok: gói miễn phí chỉ mở được một đường hầm.
    // Nếu giao diện ở 5173 còn API ở 5000 thì khách tải được trang nhưng trang
    // đó gọi API về một địa chỉ chỉ tồn tại trong mạng nội bộ -> trắng trơn.
    //
    // Khi dist/ chưa tồn tại thì bỏ qua, chạy như cũ (dev dùng vite riêng).
    const distDir = path.join(__dirname, '..', 'frontend', 'typescript-version', 'dist');
    const hasFrontend = fs.existsSync(path.join(distDir, 'index.html'));

    if (hasFrontend) {
        // redirect:false rất quan trọng ở đây. Vite đặt file tĩnh vào
        // dist/assets/, trùng tên với route /assets của app. Mặc định
        // express.static thấy có thư mục cùng tên sẽ trả 301 về '/assets/',
        // nên vào trang Quản lý Tài sản bị nhảy URL một nhịp thừa. Tắt đi thì
        // '/assets' rơi xuống SPA fallback đúng như mọi route khác, còn
        // '/assets/index-xxx.js' vẫn phục vụ bình thường vì đó là file có thật.
        app.use(express.static(distDir, { redirect: false }));

        // SPA fallback: mọi đường dẫn KHÔNG phải API/upload/socket đều trả
        // index.html để vue-router tự xử lý. Dùng middleware thay cho
        // `app.get('*')` vì Express 5 không nhận '*' trần nữa.
        app.use((req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            if (req.path.startsWith('/api/')
                || req.path.startsWith('/uploads/')
                || req.path.startsWith('/socket.io/')) return next();

            return res.sendFile(path.join(distDir, 'index.html'));
        });
    }

    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log('  MongoDB: 20 collection (nhân sự, tài sản, chat, kanban, lịch, CRM)');
        console.log(`  Upload: tối đa ${MAX_UPLOAD_MB}MB/tệp -> ${uploadDir} (cần đăng nhập)`);
        console.log(hasFrontend
            ? '  Frontend: phục vụ từ dist/ — chỉ cần mở MỘT cổng ra ngoài'
            : '  Frontend: chưa build (chạy vite riêng, hoặc npm run build để gộp)');
        if (isDemoMode()) {
            console.log('  DEMO_MODE: BẬT — đã tắt /api/auth/demo-accounts và reveal-secret');
        }
    });
}

async function shutdown(signal) {
    console.log(`\n[${signal}] Đang đóng kết nối...`);
    server.close();
    await closeMongo();
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((err) => {
    console.error('❌ Không khởi động được server:', err.message);
    if (err.name === 'MongoServerSelectionError') {
        console.error('   MongoDB chưa chạy. Đã `docker compose up -d` chưa?');
    }
    process.exit(1);
});
