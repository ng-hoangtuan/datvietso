const express = require('express');
const { ObjectId } = require('mongodb');
const { getClient } = require('../db/mongo');
const {
    chatService,
    toApiMessage,
    toSocketMessage,
    emitToConversation,
    lastMessageSnapshot,
    buildSystemMessage,
    toId,
    hhmm,
    REACTIONS,
} = require('../services/chat');

/**
 * REST API cho hệ chat trên MongoDB. Logic dùng chung với socket nằm ở
 * `services/chat.js` — route chỉ còn kiểm tra quyền, dựng response và phát event.
 *
 * `userId` và `sender.id` là hex của `users._id` ở dạng CHUỖI — bảng gốc dùng
 * VARCHAR(100) nên giữ nguyên quy ước đó. Chỉ `_id` của conversation và message
 * mới là ObjectId. Đừng `new ObjectId()` lên userId.
 *
 * BẢNG QUYỀN (Task 1.4 trong kế hoạch):
 *
 *   Hành động                        | owner | admin | member
 *   ---------------------------------|-------|-------|-------
 *   Gửi / xóa tin nhắn CỦA MÌNH      |  x    |  x    |  x
 *   Chia sẻ file / media / vị trí    |  x    |  x    |  x
 *   Thêm thành viên mới              |  x    |  x    |   -
 *   Đổi tên nhóm / ảnh đại diện      |  x    |  x    |   -
 *   Bổ nhiệm / miễn nhiệm admin      |  x    |   -   |   -
 *   Nhường quyền owner               |  x    |   -   |   -
 *   Xóa thành viên khỏi nhóm         |  x    |   -   |   -
 *   Xóa cả nhóm                      |  x    |   -   |   -
 *
 * BẤT BIẾN: `conversation.lastMessage` luôn là tin **chưa xóa** mới nhất, hoặc
 * null nếu không còn tin nào. Danh sách cuộc trò chuyện dựa hoàn toàn vào nó thay
 * vì đi đếm collection messages như bản MySQL.
 */
module.exports = function (db, io) {
    const router = express.Router();
    const chat = chatService(db);
    const { conversations, messages } = chat;
    const users = db.collection('users');

    const badId = (res) => res.status(400).json({ error: 'conversationId không hợp lệ' });
    const notFound = (res) => res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện' });

    /** Số tin tối đa trả về mỗi lần tải lịch sử. Chặn client xin cả chục nghìn tin. */
    const PAGE_SIZE = 50;
    const MAX_PAGE_SIZE = 200;

    /**
     * Kiểm tra quyền cho một hành động trong phòng.
     * Trả về `{ conv, me }` nếu đạt, hoặc đã tự `res.status(...)` và trả null.
     *
     * @param {string[]} allowedRoles vai trò được phép; [] = chỉ cần là thành viên
     */
    async function requireRole(res, conversationId, requesterUserId, allowedRoles, actionLabel) {
        if (!requesterUserId) {
            res.status(400).json({ error: 'Thiếu requesterUserId' });
            return null;
        }

        const { conv, me } = await chat.getMembership(conversationId, requesterUserId);
        if (!conv) {
            notFound(res);
            return null;
        }
        if (!me) {
            res.status(403).json({ error: 'Bạn không phải thành viên của cuộc trò chuyện này!' });
            return null;
        }
        if (allowedRoles.length > 0 && !allowedRoles.includes(me.role)) {
            res.status(403).json({ error: actionLabel });
            return null;
        }

        return { conv, me };
    }

    /**
     * Ghi tin hệ thống rồi phát realtime. Mọi thay đổi cấu trúc nhóm đều đi qua
     * đây, nên nhóm luôn có vết trong lịch sử chat.
     *
     * Bản cũ để FRONTEND gọi sendMessage() sau mỗi hành động quản trị, nên dòng
     * "A đã thêm B vào nhóm" hiện ra như tin nhắn thường của chính A (bong bóng
     * tím, có nút xóa), và ai tắt tab trước khi API xong thì không có dòng nào.
     */
    async function systemEvent(conversationId, members, content) {
        const doc = await chat.appendSystemMessage(conversationId, content);
        emitToConversation(io, conversationId, members, 'receive_message', toSocketMessage(doc));

        return doc;
    }

    // -----------------------------------------------------------------------
    // 1. GET /api/chat/conversations?userId=... — danh sách cuộc trò chuyện
    //
    // Bản MySQL cần 1 + 2N query (1 câu JOIN, rồi mỗi conversation thêm 1 câu lấy
    // tin cuối + 1 câu lấy thành viên). Ở đây members đã embed và lastMessage là
    // snapshot, nên còn HAI query: một lấy phòng, một đếm chưa đọc cho tất cả phòng.
    // -----------------------------------------------------------------------
    router.get('/conversations', async (req, res) => {
        try {
            const { userId } = req.query;
            if (!userId) return res.status(400).json({ error: 'Missing userId parameter' });

            const uid = String(userId);

            // Giữ nguyên luật hiển thị của bản cũ:
            //  - group: luôn hiện
            //  - direct: người khởi tạo luôn thấy (để soạn tin), người kia chỉ thấy
            //    khi đã có ít nhất một tin chưa xóa
            const docs = await conversations
                .find({
                    'members.userId': uid,
                    $or: [
                        { type: 'group' },
                        { createdBy: uid },
                        { lastMessage: { $ne: null } },
                    ],
                })
                .sort({ updatedAt: -1 })
                .toArray();

            // Badge chưa đọc / có người nhắc tên (Task 1.2 + 4.1): một aggregate cho
            // toàn bộ phòng, thay vì N câu đếm.
            const marks = docs.map((c) => {
                const me = c.members.find((m) => m.userId === uid);

                return { _id: c._id, lastReadAt: (me && me.lastReadAt) || null };
            });
            const counts = await chat.countUnread(marks, uid);

            const result = docs.map((conv) => {
                const me = conv.members.find((m) => m.userId === uid);
                const count = counts.get(String(conv._id)) || { unread: 0, mentions: 0 };

                let name = conv.name;
                let avatar = conv.avatar;
                let partnerId = null;
                if (conv.type === 'direct') {
                    // Chat 1-1: hiển thị tên và avatar của người đối diện
                    const partner = conv.members.find((m) => m.userId !== uid);
                    if (partner) {
                        name = partner.userName || name;
                        avatar = partner.avatar || avatar;
                        partnerId = partner.userId;
                    }
                }

                const lm = conv.lastMessage;

                return {
                    id: String(conv._id),
                    type: conv.type,
                    name,
                    avatar,
                    isGroup: conv.type === 'group',
                    isPinned: (conv.pinnedBy || []).includes(uid),
                    myRole: me ? me.role : null,
                    partnerId,
                    createdBy: conv.createdBy || null,
                    unreadCount: count.unread,
                    mentionCount: count.mentions,
                    lastReadAt: (me && me.lastReadAt) || null,
                    members: conv.members.map((m) => ({
                        userId: m.userId,
                        name: m.userName,
                        avatar: m.avatar,
                        role: m.role,
                    })),
                    lastMessage: lm
                        ? {
                            id: String(lm.id),
                            content: lm.content,
                            type: lm.type,
                            senderId: lm.senderId,
                            senderName: lm.senderName,
                            time: hhmm(lm.createdAt),
                            createdAt: lm.createdAt,
                        }
                        : null,
                    updatedAt: lm ? lm.createdAt : conv.updatedAt,
                };
            });

            res.json(result);
        } catch (err) {
            console.error('Error fetching conversations:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 2. GET /api/chat/messages/:conversationId?limit=50&before=<messageId>
    //
    // Có phân trang: bản cũ trả về TOÀN BỘ tin của phòng, phòng chạy lâu là mỗi
    // lần mở chat tải cả nghìn tin. `before` là _id của tin cũ nhất đang có trên
    // client — ObjectId tăng dần theo thời gian nên so sánh `_id < before` đi đúng
    // index ix_msg_conv_id, không cần OFFSET.
    //
    // Lấy theo thứ tự MỚI -> CŨ để cắt đúng N tin cuối, rồi đảo lại trước khi trả.
    // -----------------------------------------------------------------------
    router.get('/messages/:conversationId', async (req, res) => {
        try {
            const cid = toId(req.params.conversationId);
            if (!cid) return badId(res);

            const limit = Math.min(
                Math.max(parseInt(req.query.limit, 10) || PAGE_SIZE, 1),
                MAX_PAGE_SIZE,
            );
            const before = toId(req.query.before);

            const filter = { conversationId: cid };
            if (before) filter._id = { $lt: before };

            // Lấy thừa 1 tin để biết còn tin cũ hơn hay không, khỏi cần countDocuments
            const batch = await messages
                .find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .limit(limit + 1)
                .toArray();

            const hasMore = batch.length > limit;
            const page = hasMore ? batch.slice(0, limit) : batch;
            page.reverse(); // trả về cũ -> mới để ChatLog render trực tiếp

            res.json({
                messages: page.map(toApiMessage),
                hasMore,
                // Con trỏ cho lần tải tiếp: _id của tin cũ nhất vừa trả
                oldestId: page.length > 0 ? String(page[0]._id) : null,
            });
        } catch (err) {
            console.error('Error fetching messages:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 3. POST /api/chat/groups — khởi tạo nhóm chat (tối thiểu 3 thành viên)
    // -----------------------------------------------------------------------
    router.post('/groups', async (req, res) => {
        const { name, avatar, members, createdBy } = req.body;

        // Ràng buộc tối thiểu 3 thành viên theo Task 1.3
        if (!members || members.length < 3) {
            return res.status(400).json({ error: 'Nhóm chat phải có tối thiểu 3 thành viên!' });
        }
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Tên nhóm không được để trống!' });
        }
        if (!createdBy || !createdBy.userId) {
            return res.status(400).json({ error: 'Thiếu thông tin người tạo nhóm!' });
        }

        // Loại trùng userId trước khi ghi: unique index không ép được bên trong
        // array embed (MONGODB.md mục 5), và 3 thành viên trùng nhau không phải nhóm.
        const seen = new Set();
        const uniqueMembers = members.filter((m) => {
            const key = String(m.userId);
            if (!m.userId || seen.has(key)) return false;
            seen.add(key);

            return true;
        });
        if (uniqueMembers.length < 3) {
            return res.status(400).json({ error: 'Nhóm chat phải có tối thiểu 3 thành viên khác nhau!' });
        }

        const session = getClient().startSession();
        try {
            const now = new Date();
            const conversationId = new ObjectId();
            const ownerId = String(createdBy.userId);

            const systemContent =
                `${createdBy.name} đã tạo nhóm "${name.trim()}" với ${uniqueMembers.length} thành viên.`;
            const systemMessage = buildSystemMessage(conversationId, systemContent, now);

            const memberDocs = uniqueMembers.map((m) => ({
                userId: String(m.userId),
                userName: m.name,
                avatar: m.avatar || null,
                role: String(m.userId) === ownerId ? 'owner' : (m.role === 'admin' ? 'admin' : 'member'),
                joinedAt: now,
                // Người tạo coi như đã đọc tin hệ thống của chính mình
                lastReadAt: String(m.userId) === ownerId ? now : null,
            }));

            // Hai collection nên dùng transaction cho nguyên tử (cần replica set)
            await session.withTransaction(async () => {
                await conversations.insertOne(
                    {
                        _id: conversationId,
                        type: 'group',
                        name: name.trim(),
                        avatar: avatar || 'https://cdn.vuetifyjs.com/images/logos/vuetify-logo-300.png',
                        pinnedBy: [],
                        createdBy: ownerId,
                        members: memberDocs,
                        lastMessage: lastMessageSnapshot(systemMessage),
                        createdAt: now,
                        updatedAt: now,
                    },
                    { session },
                );
                await messages.insertOne(systemMessage, { session });
            });

            // Chỉ báo cho người trong nhóm, không `io.emit` ra toàn hệ thống như bản cũ
            for (const m of memberDocs) {
                io.to(`user_${m.userId}`).emit('group_created', {
                    conversationId: String(conversationId),
                    name: name.trim(),
                });
            }

            res.status(201).json({
                conversationId: String(conversationId),
                message: 'Tạo nhóm thành công',
            });
        } catch (err) {
            console.error('Error creating group:', err);
            res.status(500).json({ error: err.message });
        } finally {
            await session.endSession();
        }
    });

    // -----------------------------------------------------------------------
    // 4. PUT /api/chat/groups/:id — đổi tên nhóm / ảnh đại diện (owner + admin)
    //    Task 1.4 có dòng "Đổi tên nhóm / Ảnh đại diện" nhưng bản cũ không có
    //    endpoint nào cho việc này.
    // -----------------------------------------------------------------------
    router.put('/groups/:id', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { name, avatar, requesterUserId } = req.body;
            const ok = await requireRole(res, cid, requesterUserId, ['owner', 'admin'],
                'Chỉ Trưởng nhóm hoặc Phó nhóm mới được đổi tên và ảnh nhóm!');
            if (!ok) return;

            const { conv, me } = ok;
            if (conv.type !== 'group') {
                return res.status(400).json({ error: 'Chỉ nhóm chat mới đổi được tên và ảnh đại diện' });
            }

            const nextName = typeof name === 'string' ? name.trim() : null;
            if (nextName !== null && nextName.length === 0) {
                return res.status(400).json({ error: 'Tên nhóm không được để trống!' });
            }

            const $set = { updatedAt: new Date() };
            const changes = [];
            if (nextName && nextName !== conv.name) {
                $set.name = nextName;
                changes.push(`đổi tên nhóm thành "${nextName}"`);
            }
            if (typeof avatar === 'string' && avatar && avatar !== conv.avatar) {
                $set.avatar = avatar;
                changes.push('đổi ảnh đại diện nhóm');
            }

            if (changes.length === 0) {
                return res.json({ message: 'Không có thay đổi nào', changed: false });
            }

            await conversations.updateOne({ _id: cid }, { $set });
            await systemEvent(cid, conv.members, `${me.userName} đã ${changes.join(' và ')}.`);

            emitToConversation(io, cid, conv.members, 'conversation_updated', {
                conversationId: String(cid),
                name: $set.name || conv.name,
                avatar: $set.avatar || conv.avatar,
            });

            res.json({
                message: 'Cập nhật thông tin nhóm thành công',
                changed: true,
                name: $set.name || conv.name,
                avatar: $set.avatar || conv.avatar,
            });
        } catch (err) {
            console.error('Error updating group:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 5. POST /api/chat/groups/:id/members — thêm thành viên (owner + admin)
    //    Bản cũ KHÔNG kiểm tra quyền: member thường cũng thêm được người vào nhóm,
    //    trái bảng quyền Task 1.4.
    // -----------------------------------------------------------------------
    router.post('/groups/:id/members', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { members, requesterUserId } = req.body;
            if (!members || members.length === 0) {
                return res.status(400).json({ error: 'Danh sách thành viên cần thêm trống!' });
            }

            const ok = await requireRole(res, cid, requesterUserId, ['owner', 'admin'],
                'Chỉ Trưởng nhóm hoặc Phó nhóm mới được thêm thành viên!');
            if (!ok) return;

            const { conv, me } = ok;
            if (conv.type !== 'group') {
                return res.status(400).json({ error: 'Chỉ nhóm chat mới thêm được thành viên' });
            }

            const now = new Date();
            const addedNames = [];

            // Thay cho INSERT IGNORE của bản MySQL: điều kiện $ne đảm bảo không thêm
            // trùng userId. Unique index không ép được bên trong array embed.
            for (const m of members) {
                if (!m.userId) continue;

                const r = await conversations.updateOne(
                    { _id: cid, 'members.userId': { $ne: String(m.userId) } },
                    {
                        $push: {
                            members: {
                                userId: String(m.userId),
                                userName: m.name,
                                avatar: m.avatar || null,
                                role: 'member',
                                joinedAt: now,
                                lastReadAt: null,
                            },
                        },
                        $set: { updatedAt: now },
                    },
                );
                if (r.modifiedCount > 0) addedNames.push(m.name);
            }

            if (addedNames.length === 0) {
                return res.json({ message: 'Những người này đã ở trong nhóm', added: 0 });
            }

            // Người mới cũng cần nhận event -> lấy lại danh sách members sau khi thêm
            const after = await conversations.findOne({ _id: cid }, { projection: { members: 1 } });
            await systemEvent(cid, after.members,
                `${me.userName} đã thêm ${addedNames.join(', ')} vào nhóm.`);

            emitToConversation(io, cid, after.members, 'members_updated', {
                conversationId: String(cid),
            });

            res.json({ message: 'Thêm thành viên thành công', added: addedNames.length });
        } catch (err) {
            console.error('Error adding members:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 6. PUT /api/chat/groups/:id/role — phân quyền / nhường quyền (chỉ owner)
    // -----------------------------------------------------------------------
    router.put('/groups/:id/role', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { targetUserId, newRole, requesterUserId } = req.body;
            if (!['owner', 'admin', 'member'].includes(newRole)) {
                return res.status(400).json({ error: 'Vai trò không hợp lệ!' });
            }

            const ok = await requireRole(res, cid, requesterUserId, ['owner'],
                'Chỉ Trưởng nhóm (Owner) mới có quyền đổi vai trò hoặc nhường quyền!');
            if (!ok) return;

            const { conv, me } = ok;
            const target = conv.members.find((m) => m.userId === String(targetUserId));
            if (!target) {
                return res.status(404).json({ error: 'Người được chỉ định không có trong nhóm' });
            }
            if (target.userId === me.userId) {
                return res.status(400).json({ error: 'Không thể tự đổi vai trò của chính mình' });
            }

            if (newRole === 'owner') {
                // Nhường quyền: owner cũ thành admin, người mới thành owner.
                // arrayFilters cho phép sửa hai phần tử trong MỘT lệnh update, nên
                // nguyên tử sẵn — không cần transaction như bản MySQL.
                await conversations.updateOne(
                    { _id: cid },
                    {
                        $set: {
                            'members.$[prev].role': 'admin',
                            'members.$[next].role': 'owner',
                            updatedAt: new Date(),
                        },
                    },
                    {
                        arrayFilters: [
                            { 'prev.userId': me.userId },
                            { 'next.userId': target.userId },
                        ],
                    },
                );
                await systemEvent(cid, conv.members,
                    `${me.userName} đã nhường quyền Trưởng nhóm cho ${target.userName}.`);
            } else {
                await conversations.updateOne(
                    { _id: cid },
                    { $set: { 'members.$[t].role': newRole, updatedAt: new Date() } },
                    { arrayFilters: [{ 't.userId': target.userId }] },
                );
                const roleText = newRole === 'admin' ? 'Phó nhóm (Admin)' : 'Thành viên';
                const verb = newRole === 'admin' ? 'bổ nhiệm' : 'miễn nhiệm';
                await systemEvent(cid, conv.members,
                    `${me.userName} đã ${verb} ${target.userName} làm ${roleText}.`);
            }

            emitToConversation(io, cid, conv.members, 'role_changed', {
                conversationId: String(cid),
                targetUserId: target.userId,
                newRole,
            });

            res.json({ message: 'Cập nhật phân quyền thành công' });
        } catch (err) {
            console.error('Error changing role:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 7. DELETE /api/chat/groups/:id/members/:userId — xóa thành viên (chỉ owner)
    // -----------------------------------------------------------------------
    router.delete('/groups/:id/members/:userId', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { userId } = req.params;
            const { requesterUserId } = req.query;

            const ok = await requireRole(res, cid, requesterUserId, ['owner'],
                'Chỉ Trưởng nhóm (Owner) mới được xóa thành viên khỏi nhóm!');
            if (!ok) return;

            const { conv, me } = ok;
            const target = conv.members.find((m) => m.userId === String(userId));
            if (!target) {
                return res.status(404).json({ error: 'Người này không có trong nhóm' });
            }
            if (target.userId === me.userId) {
                return res.status(400).json({
                    error: 'Trưởng nhóm không tự xóa mình — hãy nhường quyền rồi rời nhóm.',
                });
            }

            await conversations.updateOne(
                { _id: cid },
                { $pull: { members: { userId: target.userId } }, $set: { updatedAt: new Date() } },
            );

            // Phát khi người bị xóa VẪN còn trong danh sách cũ, để client của họ
            // cũng nhận được và tự bỏ phòng khỏi sidebar
            await systemEvent(cid, conv.members,
                `${me.userName} đã xóa ${target.userName} khỏi nhóm.`);
            emitToConversation(io, cid, conv.members, 'member_removed', {
                conversationId: String(cid),
                userId: target.userId,
            });

            res.json({ message: 'Xóa thành viên khỏi nhóm thành công' });
        } catch (err) {
            console.error('Error removing member:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 8. POST /api/chat/groups/:id/leave — tự rời nhóm
    //
    // Owner rời nhóm thì phải có người thay, nếu không nhóm còn lại không ai đổi
    // được tên hay thêm người: ưu tiên admin lâu nhất, không có thì member lâu nhất.
    // Người cuối cùng rời đi -> xóa luôn nhóm kèm toàn bộ tin nhắn (cascade).
    // -----------------------------------------------------------------------
    router.post('/groups/:id/leave', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { userId } = req.body;
            const ok = await requireRole(res, cid, userId, [], '');
            if (!ok) return;

            const { conv, me } = ok;
            if (conv.type !== 'group') {
                return res.status(400).json({ error: 'Chat 1-1 không rời được, hãy xóa cuộc trò chuyện' });
            }

            const others = conv.members.filter((m) => m.userId !== me.userId);

            // Người cuối cùng -> xóa nhóm kèm tin nhắn
            if (others.length === 0) {
                const del = await chat.cascadeDeleteConversation(cid, getClient());
                io.to(`user_${me.userId}`).emit('conversation_deleted', {
                    conversationId: String(cid),
                });

                return res.json({
                    message: 'Bạn là người cuối cùng, nhóm đã được xóa',
                    deleted: true,
                    deletedMessages: del.messages,
                });
            }

            const byJoined = (a, b) => new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0);
            let successor = null;
            if (me.role === 'owner') {
                const admins = others.filter((m) => m.role === 'admin').sort(byJoined);
                successor = admins[0] || others.slice().sort(byJoined)[0];
            }

            await conversations.updateOne(
                { _id: cid },
                { $pull: { members: { userId: me.userId } }, $set: { updatedAt: new Date() } },
            );
            if (successor) {
                await conversations.updateOne(
                    { _id: cid },
                    { $set: { 'members.$[s].role': 'owner' } },
                    { arrayFilters: [{ 's.userId': successor.userId }] },
                );
            }

            const note = successor
                ? `${me.userName} đã rời nhóm. ${successor.userName} trở thành Trưởng nhóm.`
                : `${me.userName} đã rời nhóm.`;
            await systemEvent(cid, conv.members, note);

            emitToConversation(io, cid, conv.members, 'member_removed', {
                conversationId: String(cid),
                userId: me.userId,
                newOwnerId: successor ? successor.userId : null,
            });

            res.json({
                message: 'Đã rời nhóm',
                deleted: false,
                newOwnerId: successor ? successor.userId : null,
            });
        } catch (err) {
            console.error('Error leaving group:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 9. DELETE /api/chat/conversations/:id — xóa phòng kèm toàn bộ tin nhắn
    //
    // MONGODB.md mục 5 ghi đây là nợ kỹ thuật: không có endpoint xóa phòng nên
    // cascade `messages` chưa ai viết. Giờ cả hai cùng có.
    // Nhóm: chỉ owner. Chat 1-1: thành viên nào cũng được.
    // -----------------------------------------------------------------------
    router.delete('/conversations/:id', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const requesterUserId = req.query.requesterUserId || req.body?.requesterUserId;
            const { conv, me } = await chat.getMembership(cid, requesterUserId);
            if (!conv) return notFound(res);
            if (!me) {
                return res.status(403).json({ error: 'Bạn không phải thành viên của cuộc trò chuyện này!' });
            }
            if (conv.type === 'group' && me.role !== 'owner') {
                return res.status(403).json({ error: 'Chỉ Trưởng nhóm (Owner) mới được xóa nhóm!' });
            }

            const del = await chat.cascadeDeleteConversation(cid, getClient());

            emitToConversation(io, cid, conv.members, 'conversation_deleted', {
                conversationId: String(cid),
            });

            res.json({
                message: 'Đã xóa cuộc trò chuyện',
                deletedMessages: del.messages,
            });
        } catch (err) {
            console.error('Error deleting conversation:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 10. POST /api/chat/conversations/:id/pin — ghim / bỏ ghim (theo từng user)
    // -----------------------------------------------------------------------
    router.post('/conversations/:id/pin', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { userId, isPinned } = req.body;
            if (!userId) return res.status(400).json({ error: 'Missing userId' });

            // $addToSet / $pull thay cho đọc JSON -> sửa mảng -> ghi lại của bản MySQL.
            // Một lệnh, không bị mất cập nhật khi hai request chạy song song.
            const r = await conversations.updateOne(
                { _id: cid, 'members.userId': String(userId) },
                isPinned
                    ? { $addToSet: { pinnedBy: String(userId) } }
                    : { $pull: { pinnedBy: String(userId) } },
            );
            if (r.matchedCount === 0) {
                return res.status(404).json({
                    error: 'Không tìm thấy cuộc trò chuyện, hoặc bạn không phải thành viên',
                });
            }

            res.json({ isPinned, message: isPinned ? 'Đã ghim cuộc trò chuyện' : 'Đã bỏ ghim' });
        } catch (err) {
            console.error('Error pinning conversation:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 11. POST /api/chat/conversations/:id/read — đánh dấu đã đọc
    //
    // Badge chưa đọc của bản cũ chỉ nằm trong state Pinia: F5 là mất sạch, và mở
    // trên máy khác thì không thấy gì. Mốc `lastReadAt` nằm trong members[] nên
    // trạng thái đọc theo người, bền và đồng bộ giữa các thiết bị.
    // -----------------------------------------------------------------------
    router.post('/conversations/:id/read', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const { userId } = req.body;
            if (!userId) return res.status(400).json({ error: 'Missing userId' });

            const readAt = new Date();
            const r = await conversations.updateOne(
                { _id: cid, 'members.userId': String(userId) },
                { $set: { 'members.$[m].lastReadAt': readAt } },
                { arrayFilters: [{ 'm.userId': String(userId) }] },
            );
            if (r.matchedCount === 0) {
                return res.status(404).json({
                    error: 'Không tìm thấy cuộc trò chuyện, hoặc bạn không phải thành viên',
                });
            }

            // Để tab khác của cùng người dùng cũng tắt badge
            io.to(`user_${String(userId)}`).emit('conversation_read', {
                conversationId: String(cid),
                userId: String(userId),
                lastReadAt: readAt,
            });

            res.json({ message: 'Đã đánh dấu đã đọc', lastReadAt: readAt });
        } catch (err) {
            console.error('Error marking conversation read:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 12. GET /api/chat/conversations/:id/attachments?kind=media|file|link|all
    //
    // Task 3.2 — panel "Bộ sưu tập" (ảnh / video / tệp / liên kết).
    // Bản cũ lọc từ mảng tin nhắn ĐANG LOAD trên client, nên sau khi có phân trang
    // thì chỉ thấy đính kèm trong vài chục tin gần nhất. Ở đây đọc thẳng DB qua
    // `attachmentKind` đã tính sẵn lúc ghi, dùng index ix_msg_conv_attachment.
    // -----------------------------------------------------------------------
    router.get('/conversations/:id/attachments', async (req, res) => {
        try {
            const cid = toId(req.params.id);
            if (!cid) return badId(res);

            const kind = String(req.query.kind || 'all');
            const limit = Math.min(
                Math.max(parseInt(req.query.limit, 10) || 100, 1),
                MAX_PAGE_SIZE,
            );

            const kindMap = {
                media: ['image', 'video'],
                image: ['image'],
                video: ['video'],
                file: ['file'],
                link: ['link'],
                all: ['image', 'video', 'file', 'link'],
            };
            const kinds = kindMap[kind];
            if (!kinds) {
                return res.status(400).json({
                    error: `kind không hợp lệ. Dùng: ${Object.keys(kindMap).join(' | ')}`,
                });
            }

            const docs = await messages
                .find({ conversationId: cid, attachmentKind: { $in: kinds }, deletedAt: null })
                .sort({ createdAt: -1 })
                .limit(limit)
                .toArray();

            const items = docs.map((m) => ({
                id: String(m._id),
                kind: m.attachmentKind,
                type: m.type,
                content: m.content,
                metadata: m.metadata || {},
                senderId: m.sender.id,
                senderName: m.sender.name,
                createdAt: m.createdAt,
                time: hhmm(m.createdAt),
            }));

            // Đếm từng loại trong một aggregate để panel hiện số trên mỗi tab
            const counts = await messages
                .aggregate([
                    {
                        $match: {
                            conversationId: cid,
                            attachmentKind: { $in: ['image', 'video', 'file', 'link'] },
                            deletedAt: null,
                        },
                    },
                    { $group: { _id: '$attachmentKind', n: { $sum: 1 } } },
                ])
                .toArray();

            const summary = { image: 0, video: 0, file: 0, link: 0 };
            for (const c of counts) summary[c._id] = c.n;

            res.json({ items, counts: summary, media: summary.image + summary.video });
        } catch (err) {
            console.error('Error fetching attachments:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 13. POST /api/chat/messages/:id/reactions — thả / bỏ cảm xúc
    //
    // Collection `messages` đã gộp bảng MessageReactions ngay từ đầu (schema có
    // `reactions[]`) nhưng chưa có endpoint nào ghi vào đó.
    //
    // UNIQUE cũ là (message_id, user_id, reaction): một người được thả nhiều loại
    // khác nhau trên cùng tin, chỉ không trùng cùng loại. $pull/$push có điều kiện
    // thay cho ràng buộc đó, vì unique index không ép được trong array embed.
    // -----------------------------------------------------------------------
    router.post('/messages/:id/reactions', async (req, res) => {
        try {
            const mid = toId(req.params.id);
            if (!mid) return res.status(400).json({ error: 'messageId không hợp lệ' });

            const { userId, reaction } = req.body;
            if (!userId) return res.status(400).json({ error: 'Missing userId' });
            if (!REACTIONS.includes(reaction)) {
                return res.status(400).json({
                    error: `Cảm xúc không hợp lệ. Dùng: ${REACTIONS.join(' | ')}`,
                });
            }

            const msg = await messages.findOne(
                { _id: mid },
                { projection: { conversationId: 1, reactions: 1, deletedAt: 1 } },
            );
            if (!msg) return res.status(404).json({ error: 'Không tìm thấy tin nhắn' });
            if (msg.deletedAt) {
                return res.status(400).json({ error: 'Không thả cảm xúc lên tin đã xóa' });
            }

            // Chỉ thành viên của phòng mới thả được cảm xúc
            const { conv, me } = await chat.getMembership(msg.conversationId, userId);
            if (!conv || !me) {
                return res.status(403).json({ error: 'Bạn không phải thành viên của cuộc trò chuyện này!' });
            }

            const uid = String(userId);
            const had = (msg.reactions || []).some(
                (r) => r.userId === uid && r.reaction === reaction,
            );

            // Bấm lại cùng một loại = bỏ (toggle)
            await messages.updateOne(
                { _id: mid },
                had
                    ? { $pull: { reactions: { userId: uid, reaction } } }
                    : { $push: { reactions: { userId: uid, reaction, createdAt: new Date() } } },
            );

            const after = await messages.findOne({ _id: mid }, { projection: { reactions: 1 } });
            const payload = {
                messageId: String(mid),
                conversationId: String(msg.conversationId),
                reactions: after.reactions || [],
            };
            emitToConversation(io, msg.conversationId, conv.members, 'message_reaction', payload);

            res.json({ ...payload, removed: had });
        } catch (err) {
            console.error('Error toggling reaction:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 14. GET /api/chat/contacts — danh bạ nhân sự
    //     Bản MySQL JOIN 4 bảng (users + employees + departments + positions).
    //     Sau khi gộp và denormalize snapshot, chỉ còn một find.
    // -----------------------------------------------------------------------
    router.get('/contacts', async (req, res) => {
        try {
            const rows = await users.find({ status: 'ACTIVE' }).sort({ _id: 1 }).toArray();

            res.json(rows.map((r) => ({
                userId: r._id.toString(),
                name: r.fullName,
                email: r.email,
                avatar: r.avatar
                    || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(r.fullName)}`,
                role: r.role,
                employeeCode: r.employee ? r.employee.employeeCode : null,
                department: (r.employee && r.employee.department && r.employee.department.name)
                    || 'Phòng Kỹ Thuật',
                position: (r.employee && r.employee.position && r.employee.position.title)
                    || 'Nhân sự',
            })));
        } catch (err) {
            console.error('Error fetching chat contacts:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // -----------------------------------------------------------------------
    // 15. POST /api/chat/direct — khởi tạo hoặc lấy cuộc trò chuyện 1-1
    // -----------------------------------------------------------------------
    router.post('/direct', async (req, res) => {
        try {
            const { currentUserId, targetUserId } = req.body;
            if (!currentUserId || !targetUserId) {
                return res.status(400).json({ error: 'Missing currentUserId or targetUserId' });
            }

            const me = String(currentUserId);
            const other = String(targetUserId);
            if (me === other) {
                return res.status(400).json({ error: 'Không thể tự mở cuộc trò chuyện với chính mình' });
            }

            // Đã có phòng direct giữa đúng hai người này chưa?
            // $all khớp phòng chứa CẢ HAI; thêm $size: 2 để không khớp phòng direct
            // ba người (dữ liệu lỗi) và không khớp nhóm có cả hai.
            const existing = await conversations.findOne({
                type: 'direct',
                'members.userId': { $all: [me, other] },
                members: { $size: 2 },
            });
            if (existing) {
                return res.json({ conversationId: String(existing._id), isNew: false });
            }

            // Tên và avatar lấy từ collection users. `me`/`other` là hex string nên
            // phải đổi ngược về ObjectId để tra — đây là chỗ duy nhất trong file này
            // cần chuyển đổi hai chiều.
            if (!ObjectId.isValid(me) || !ObjectId.isValid(other)) {
                return res.status(400).json({ error: 'userId không hợp lệ' });
            }
            const found = await users
                .find({ _id: { $in: [new ObjectId(me), new ObjectId(other)] } })
                .toArray();
            const targetUser = found.find((u) => u._id.toString() === other)
                || { fullName: 'Đồng nghiệp', avatar: null };
            const currentUser = found.find((u) => u._id.toString() === me)
                || { fullName: 'Tôi', avatar: null };

            const now = new Date();
            const doc = {
                _id: new ObjectId(),
                type: 'direct',
                name: targetUser.fullName,
                avatar: targetUser.avatar || null,
                pinnedBy: [],
                createdBy: me,
                members: [
                    { userId: me, userName: currentUser.fullName, avatar: currentUser.avatar || null, role: 'member', joinedAt: now, lastReadAt: now },
                    { userId: other, userName: targetUser.fullName, avatar: targetUser.avatar || null, role: 'member', joinedAt: now, lastReadAt: null },
                ],
                // null cho tới khi có tin đầu tiên — chính điều kiện khiến người kia
                // chưa nhìn thấy phòng trong danh sách (endpoint 1)
                lastMessage: null,
                createdAt: now,
                updatedAt: now,
            };
            await conversations.insertOne(doc);

            // Không phát sự kiện cho targetUser ở đây: chỉ khi có tin nhắn đầu tiên
            // thì phòng mới xuất hiện bên phía họ.
            res.status(201).json({ conversationId: String(doc._id), isNew: true });
        } catch (err) {
            console.error('Error creating direct chat:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // Socket handler trong server.js dùng lại tầng nghiệp vụ này
    router.chat = chat;
    router.recomputeLastMessage = chat.recomputeLastMessage;

    return router;
};
