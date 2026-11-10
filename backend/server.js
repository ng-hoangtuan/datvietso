const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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

// Cấu hình Database MySQL Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
});

// Cấu hình Multer để upload ảnh, video, file
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// API Upload File / Media
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `http://localhost:${process.env.PORT || 5000}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, filename: req.file.originalname, mimetype: req.file.mimetype });
});

// Authentication RESTful API
const authRoutes = require('./routes/auth')(pool);
app.use('/api/auth', authRoutes);

// Assets Management RESTful API
const assetRoutes = require('./routes/assets')(pool);
app.use('/api/assets', assetRoutes);

// Realtime Chat RESTful API
const chatRoutes = require('./routes/chat')(pool, io);
app.use('/api/chat', chatRoutes);

// Lưu danh sách user đang online dạng { userId: socketId }
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Đăng ký Online Status
    socket.on('user_online', (userId) => {
        const uidStr = String(userId);
        onlineUsers.set(uidStr, socket.id);
        socket.join(`user_${uidStr}`);
        io.emit('user_status_change', { userId: uidStr, status: 'online' });
        // Gửi danh sách tất cả user đang online cho client mới kết nối
        socket.emit('active_users', Array.from(onlineUsers.keys()));
    });

    // 2. Tham gia phòng chat (Conversation)
    socket.on('join_room', (conversationId) => {
        if (conversationId) {
            socket.join(String(conversationId));
        }
    });

    socket.on('join_rooms', (conversationIds) => {
        if (Array.isArray(conversationIds)) {
            conversationIds.forEach(id => {
                if (id) socket.join(String(id));
            });
        }
    });

    // 3. Gửi tin nhắn Realtime
    socket.on('send_message', async (data) => {
        const { conversation_id, sender_id, sender_name, sender_avatar, type, content, metadata, client_temp_id } = data;
        try {
            const [result] = await pool.query(
                'INSERT INTO messages (conversation_id, sender_id, sender_name, sender_avatar, type, content, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [conversation_id, sender_id, sender_name || null, sender_avatar || null, type || 'text', content || '', JSON.stringify(metadata || {})]
            );
            // Cập nhật updated_at cho conversation
            await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversation_id]);

            const messageId = result.insertId;
            const newMessage = { 
                id: messageId, 
                client_temp_id: client_temp_id || null,
                conversation_id: String(conversation_id), 
                sender_id, 
                sender_name, 
                sender_avatar, 
                type, 
                content, 
                metadata, 
                created_at: new Date() 
            };

            // 1. Phát tới room của conversation
            io.to(String(conversation_id)).emit('receive_message', newMessage);

            // 2. Phát tới tất cả các thành viên qua phòng cá nhân user_${uid}
            const [members] = await pool.query('SELECT user_id FROM groupmembers WHERE conversation_id = ?', [conversation_id]);
            for (const m of members) {
                io.to(`user_${m.user_id}`).emit('receive_message', newMessage);
            }

            // 3. Nếu là tin nhắn đầu tiên của cuộc trò chuyện, phát thông báo cho thành viên để nạp phòng mới vào danh sách
            const [countRes] = await pool.query('SELECT COUNT(*) as msgCount FROM messages WHERE conversation_id = ? AND deleted_at IS NULL', [conversation_id]);
            if (countRes.length > 0 && countRes[0].msgCount === 1) {
                for (const m of members) {
                    io.to(`user_${m.user_id}`).emit('direct_chat_created', { conversationId: String(conversation_id) });
                }
            }
        } catch (err) {
            console.error('Error saving message:', err);
        }
    });

    // 4. Xóa tin nhắn (Soft delete)
    socket.on('delete_message', async ({ message_id, conversation_id }) => {
        try {
            await pool.query('UPDATE messages SET deleted_at = NOW() WHERE id = ?', [message_id]);
            io.to(String(conversation_id)).emit('message_deleted', { message_id });
        } catch (err) {
            console.error('Error deleting message:', err);
        }
    });

    // 5. Trạng thái Typing
    // Chỉ phát đúng trong phòng conversation_id (phòng mà người đó đang gõ)
    socket.on('typing', ({ conversation_id, user_id, user_name }) => {
        if (conversation_id) {
            socket.to(String(conversation_id)).emit('display_typing', {
                conversation_id: String(conversation_id),
                user_id: String(user_id),
                user_name
            });
        }
    });

    socket.on('stop_typing', ({ conversation_id, user_id, user_name }) => {
        if (conversation_id) {
            socket.to(String(conversation_id)).emit('hide_typing', {
                conversation_id: String(conversation_id),
                user_id: String(user_id),
                user_name
            });
        }
    });

    // 6. Ngắt kết nối (Offline)
    socket.on('disconnect', () => {
        let disconnectedUserId = null;
        for (let [userId, sId] of onlineUsers.entries()) {
            if (sId === socket.id) {
                disconnectedUserId = userId;
                onlineUsers.delete(userId);
                break;
            }
        }
        if (disconnectedUserId) {
            io.emit('user_status_change', { userId: String(disconnectedUserId), status: 'offline' });
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});