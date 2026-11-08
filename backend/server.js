const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// API Upload File / Media
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `http://localhost:${process.env.PORT || 5000}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, filename: req.file.originalname, mimetype: req.file.mimetype });
});

// Lưu danh sách user đang online dạng { userId: socketId }
const onlineUsers = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Đăng ký Online Status
    socket.on('user_online', (userId) => {
        onlineUsers.set(userId, socket.id);
        io.emit('user_status_change', { userId, status: 'online' });
    });

    // 2. Tham gia phòng chat (Conversation)
    socket.on('join_room', (conversationId) => {
        socket.join(conversationId);
    });

    // 3. Gửi tin nhắn Realtime
    socket.on('send_message', async (data) => {
        const { conversation_id, sender_id, type, content, metadata } = data;
        try {
            const [result] = await pool.query(
                'INSERT INTO Messages (conversation_id, sender_id, type, content, metadata) VALUES (?, ?, ?, ?, ?)',
                [conversation_id, sender_id, type, content, JSON.stringify(metadata || {})]
            );
            const messageId = result.insertId;
            const newMessage = { id: messageId, conversation_id, sender_id, type, content, metadata, created_at: new Date() };

            io.to(conversation_id).emit('receive_message', newMessage);
        } catch (err) {
            console.error('Error saving message:', err);
        }
    });

    // 4. Xóa tin nhắn (Soft delete)
    socket.on('delete_message', async ({ message_id, conversation_id }) => {
        try {
            await pool.query('UPDATE Messages SET deleted_at = NOW() WHERE id = ?', [message_id]);
            io.to(conversation_id).emit('message_deleted', { message_id });
        } catch (err) {
            console.error('Error deleting message:', err);
        }
    });

    // 5. Trạng thái Typing
    socket.on('typing', ({ conversation_id, user_name }) => {
        socket.to(conversation_id).emit('display_typing', { user_name });
    });

    socket.on('stop_typing', ({ conversation_id }) => {
        socket.to(conversation_id).emit('hide_typing');
    });

    // 6. Ngắt kết nối (Offline)
    socket.on('disconnect', () => {
        for (let [userId, sId] of onlineUsers.entries()) {
            if (sId === socket.id) {
                onlineUsers.delete(userId);
                io.emit('user_status_change', { userId, status: 'offline' });
                break;
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});