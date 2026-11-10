const express = require('express');

function safeJsonParse(val, defaultVal = {}) {
    if (!val) return defaultVal;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch (e) {
        return defaultVal;
    }
}

module.exports = function(pool, io) {
    const router = express.Router();

    // 1. GET /api/chat/conversations?userId=... - Lấy danh sách cuộc trò chuyện
    router.get('/conversations', async (req, res) => {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'Missing userId parameter' });

            // Lấy các conversation mà user tham gia:
            // - Với group: luôn hiển thị
            // - Với direct: người kia chỉ thấy khi đã có ít nhất 1 tin nhắn; người khởi tạo (created_by) thấy để soạn tin
            const [conversations] = await pool.query(`
                SELECT c.*, gm.role as my_role
                FROM conversations c
                JOIN groupmembers gm ON c.id = gm.conversation_id
                WHERE gm.user_id = ?
                  AND (
                    c.type = 'group'
                    OR c.created_by = ?
                    OR EXISTS (
                      SELECT 1 FROM messages m 
                      WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
                    )
                  )
                ORDER BY c.updated_at DESC
            `, [userId, userId]);

            // Lấy tin nhắn cuối cùng và danh sách thành viên cho mỗi conversation
            const detailed = await Promise.all(conversations.map(async (conv) => {
                const [lastMsg] = await pool.query(`
                    SELECT * FROM messages 
                    WHERE conversation_id = ? AND deleted_at IS NULL 
                    ORDER BY created_at DESC LIMIT 1
                `, [conv.id]);

                const [members] = await pool.query(`
                    SELECT user_id, user_name, avatar, role FROM groupmembers WHERE conversation_id = ?
                `, [conv.id]);

                let pinned = false;
                if (conv.pinned_by) {
                    const pinnedList = safeJsonParse(conv.pinned_by, []);
                    pinned = Array.isArray(pinnedList) && pinnedList.includes(userId);
                }

                let convName = conv.name;
                let convAvatar = conv.avatar;
                if (conv.type === 'direct') {
                    // Chat 1-1: Hiển thị tên và avatar của người đối diện (partner)
                    const partner = members.find(m => String(m.user_id) !== String(userId));
                    if (partner) {
                        convName = partner.user_name || convName;
                        convAvatar = partner.avatar || convAvatar;
                    }
                }

                return {
                    id: conv.id,
                    type: conv.type,
                    name: convName,
                    avatar: convAvatar,
                    isGroup: conv.type === 'group',
                    isPinned: pinned,
                    myRole: conv.my_role,
                    members: members.map(m => ({
                        userId: m.user_id,
                        name: m.user_name,
                        avatar: m.avatar,
                        role: m.role
                    })),
                    lastMessage: lastMsg.length > 0 ? {
                        id: lastMsg[0].id,
                        content: lastMsg[0].content,
                        type: lastMsg[0].type,
                        time: lastMsg[0].created_at ? new Date(lastMsg[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                        createdAt: lastMsg[0].created_at
                    } : null,
                    updatedAt: lastMsg.length > 0 && lastMsg[0].created_at ? lastMsg[0].created_at : conv.updated_at
                };
            }));

            res.json(detailed);
        } catch (err) {
            console.error('Error fetching conversations:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 2. GET /api/chat/messages/:conversationId - Lấy lịch sử tin nhắn
    router.get('/messages/:conversationId', async (req, res) => {
        try {
            const { conversationId } = req.params;
            const [messages] = await pool.query(`
                SELECT * FROM messages 
                WHERE conversation_id = ?
                ORDER BY created_at ASC
            `, [conversationId]);

            const parsed = messages.map(m => ({
                id: m.id,
                conversationId: m.conversation_id,
                senderId: m.sender_id,
                senderName: m.sender_name,
                senderAvatar: m.sender_avatar,
                type: m.type,
                content: m.deleted_at ? 'Tin nhắn này đã bị xóa' : m.content,
                metadata: safeJsonParse(m.metadata, {}),
                isDeleted: !!m.deleted_at,
                createdAt: m.created_at,
                time: m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
            }));

            res.json(parsed);
        } catch (err) {
            console.error('Error fetching messages:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 3. POST /api/chat/groups - Khởi tạo nhóm chat (Validation: tối thiểu 3 thành viên)
    router.post('/groups', async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { name, avatar, members, createdBy } = req.body;

            // Ràng buộc tối thiểu 3 thành viên theo Task 1.3
            if (!members || members.length < 3) {
                await connection.rollback();
                return res.status(400).json({ error: 'Nhóm chat phải có tối thiểu 3 thành viên!' });
            }

            if (!name || !name.trim()) {
                await connection.rollback();
                return res.status(400).json({ error: 'Tên nhóm không được để trống!' });
            }

            // Tạo Conversation
            const [convResult] = await connection.query(
                `INSERT INTO conversations (type, name, avatar, created_by) VALUES ('group', ?, ?, ?)`,
                [name.trim(), avatar || 'https://cdn.vuetifyjs.com/images/logos/vuetify-logo-300.png', createdBy.userId]
            );
            const conversationId = convResult.insertId;

            // Thêm các thành viên vào bảng groupmembers
            for (const member of members) {
                const role = member.userId === createdBy.userId ? 'owner' : (member.role || 'member');
                await connection.query(
                    `INSERT INTO groupmembers (conversation_id, user_id, user_name, avatar, role) VALUES (?, ?, ?, ?, ?)`,
                    [conversationId, member.userId, member.name, member.avatar || null, role]
                );
            }

            // Ghi tin nhắn hệ thống chào mừng
            await connection.query(
                `INSERT INTO messages (conversation_id, sender_id, sender_name, type, content) VALUES (?, 'system', 'Hệ thống', 'text', ?)`,
                [conversationId, `${createdBy.name} đã tạo nhóm "${name}" với ${members.length} thành viên.`]
            );

            await connection.commit();

            io.emit('group_created', { conversationId, name });
            res.status(201).json({ conversationId, message: 'Tạo nhóm thành công' });
        } catch (err) {
            await connection.rollback();
            console.error('Error creating group:', err);
            res.status(500).json({ error: err.message });
        } finally {
            connection.release();
        }
    });

    // 4. POST /api/chat/groups/:id/members - Thêm thành viên mới
    router.post('/groups/:id/members', async (req, res) => {
        try {
            const conversationId = req.params.id;
            const { members } = req.body;

            if (!members || members.length === 0) {
                return res.status(400).json({ error: 'Danh sách thành viên cần thêm trống!' });
            }

            for (const m of members) {
                await pool.query(
                    `INSERT IGNORE INTO groupmembers (conversation_id, user_id, user_name, avatar, role) VALUES (?, ?, ?, ?, 'member')`,
                    [conversationId, m.userId, m.name, m.avatar || null]
                );
            }

            io.to(conversationId).emit('members_updated', { conversationId });
            res.json({ message: 'Thêm thành viên thành công' });
        } catch (err) {
            console.error('Error adding members:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 5. PUT /api/chat/groups/:id/role - Phân quyền / Nhường quyền (Owner/Admin)
    router.put('/groups/:id/role', async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const conversationId = req.params.id;
            const { targetUserId, newRole, requesterUserId } = req.body;

            // Kiểm tra quyền của người yêu cầu
            const [reqMember] = await connection.query(
                'SELECT role FROM groupmembers WHERE conversation_id = ? AND user_id = ?',
                [conversationId, requesterUserId]
            );
            if (reqMember.length === 0 || reqMember[0].role !== 'owner') {
                await connection.rollback();
                return res.status(403).json({ error: 'Chỉ Trưởng nhóm (Owner) mới có quyền đổi vai trò hoặc nhường quyền!' });
            }

            if (newRole === 'owner') {
                // Nhường quyền Trưởng nhóm: Người cũ thành admin, người mới thành owner
                await connection.query(
                    "UPDATE groupmembers SET role = 'admin' WHERE conversation_id = ? AND user_id = ?",
                    [conversationId, requesterUserId]
                );
                await connection.query(
                    "UPDATE groupmembers SET role = 'owner' WHERE conversation_id = ? AND user_id = ?",
                    [conversationId, targetUserId]
                );
            } else {
                // Bổ nhiệm / Miễn nhiệm Phó nhóm (admin / member)
                await connection.query(
                    "UPDATE groupmembers SET role = ? WHERE conversation_id = ? AND user_id = ?",
                    [newRole, conversationId, targetUserId]
                );
            }

            await connection.commit();
            io.to(conversationId).emit('role_changed', { conversationId, targetUserId, newRole });
            res.json({ message: 'Cập nhật phân quyền thành công' });
        } catch (err) {
            await connection.rollback();
            console.error('Error changing role:', err);
            res.status(500).json({ error: err.message });
        } finally {
            connection.release();
        }
    });

    // 6. DELETE /api/chat/groups/:id/members/:userId - Xóa thành viên khỏi nhóm
    router.delete('/groups/:id/members/:userId', async (req, res) => {
        try {
            const { id: conversationId, userId } = req.params;
            const { requesterUserId } = req.query;

            // Kiểm tra quyền: Chỉ Owner mới được xóa thành viên
            const [reqMember] = await pool.query(
                'SELECT role FROM groupmembers WHERE conversation_id = ? AND user_id = ?',
                [conversationId, requesterUserId]
            );
            if (reqMember.length === 0 || reqMember[0].role !== 'owner') {
                return res.status(403).json({ error: 'Chỉ Trưởng nhóm (Owner) mới được xóa thành viên khỏi nhóm!' });
            }

            await pool.query(
                'DELETE FROM groupmembers WHERE conversation_id = ? AND user_id = ?',
                [conversationId, userId]
            );

            io.to(conversationId).emit('member_removed', { conversationId, userId });
            res.json({ message: 'Xóa thành viên khỏi nhóm thành công' });
        } catch (err) {
            console.error('Error removing member:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 7. POST /api/chat/conversations/:id/pin - Ghim / Bỏ ghim cuộc trò chuyện
    router.post('/conversations/:id/pin', async (req, res) => {
        try {
            const conversationId = req.params.id;
            const { userId, isPinned } = req.body;

            const [rows] = await pool.query('SELECT pinned_by FROM conversations WHERE id = ?', [conversationId]);
            if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện' });

            let pinnedList = [];
            if (rows[0].pinned_by) {
                pinnedList = safeJsonParse(rows[0].pinned_by, []);
            }

            if (isPinned) {
                if (!pinnedList.includes(userId)) pinnedList.push(userId);
            } else {
                pinnedList = pinnedList.filter(id => id !== userId);
            }

            await pool.query('UPDATE conversations SET pinned_by = ? WHERE id = ?', [JSON.stringify(pinnedList), conversationId]);
            res.json({ isPinned, message: isPinned ? 'Đã ghim cuộc trò chuyện' : 'Đã bỏ ghim' });
        } catch (err) {
            console.error('Error pinning conversation:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 8. GET /api/chat/contacts - Lấy danh bạ tất cả nhân sự để tìm kiếm và nhắn tin 1-1
    router.get('/contacts', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT 
                    u.id as userId,
                    u.full_name as name,
                    u.email,
                    u.avatar,
                    u.role,
                    e.employee_code as employeeCode,
                    d.name as department,
                    p.title as position
                FROM users u
                LEFT JOIN employees e ON u.id = e.user_id
                LEFT JOIN departments d ON e.department_id = d.id
                LEFT JOIN positions p ON e.position_id = p.id
                WHERE u.status = 'ACTIVE'
                ORDER BY u.id ASC
            `);

            res.json(rows.map(r => ({
                userId: r.userId.toString(),
                name: r.name,
                email: r.email,
                avatar: r.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(r.name)}`,
                role: r.role,
                employeeCode: r.employeeCode,
                department: r.department || 'Phòng Kỹ Thuật',
                position: r.position || 'Nhân sự'
            })));
        } catch (err) {
            console.error('Error fetching chat contacts:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 9. POST /api/chat/direct - Khởi tạo hoặc lấy cuộc trò chuyện trực tiếp 1-1
    router.post('/direct', async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { currentUserId, targetUserId } = req.body;
            if (!currentUserId || !targetUserId) {
                await connection.rollback();
                return res.status(400).json({ error: 'Missing currentUserId or targetUserId' });
            }

            // Kiểm tra xem đã có cuộc trò chuyện direct giữa 2 người này chưa
            const [existing] = await connection.query(`
                SELECT c.id 
                FROM conversations c
                JOIN groupmembers gm1 ON c.id = gm1.conversation_id AND gm1.user_id = ?
                JOIN groupmembers gm2 ON c.id = gm2.conversation_id AND gm2.user_id = ?
                WHERE c.type = 'direct'
                LIMIT 1
            `, [currentUserId, targetUserId]);

            if (existing.length > 0) {
                await connection.commit();
                return res.json({ conversationId: existing[0].id, isNew: false });
            }

            // Lấy thông tin cả 2 user
            const [users] = await connection.query(
                'SELECT id, full_name, avatar FROM users WHERE id IN (?, ?)',
                [currentUserId, targetUserId]
            );

            const targetUser = users.find(u => String(u.id) === String(targetUserId)) || { full_name: 'Đồng nghiệp', avatar: null };
            const currentUser = users.find(u => String(u.id) === String(currentUserId)) || { full_name: 'Tôi', avatar: null };

            // Tạo conversation direct
            const [convResult] = await connection.query(
                `INSERT INTO conversations (type, name, avatar, created_by) VALUES ('direct', ?, ?, ?)`,
                [targetUser.full_name, targetUser.avatar || null, currentUserId]
            );
            const conversationId = convResult.insertId;

            // Thêm 2 thành viên vào groupmembers
            await connection.query(
                `INSERT INTO groupmembers (conversation_id, user_id, user_name, avatar, role) VALUES 
                 (?, ?, ?, ?, 'member'),
                 (?, ?, ?, ?, 'member')`,
                [
                    conversationId, currentUserId, currentUser.full_name, currentUser.avatar,
                    conversationId, targetUserId, targetUser.full_name, targetUser.avatar
                ]
            );

            await connection.commit();

            // Không phát sự kiện cho targetUser ở đây. Chỉ khi người gửi gửi tin nhắn đầu tiên thì targetUser mới nhận được cuộc trò chuyện.
            res.status(201).json({ conversationId, isNew: true });
        } catch (err) {
            await connection.rollback();
            console.error('Error creating direct chat:', err);
            res.status(500).json({ error: err.message });
        } finally {
            connection.release();
        }
    });

    return router;
};
