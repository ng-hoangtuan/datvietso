/**
 * Tầng nghiệp vụ dùng chung cho chat: REST (`routes/chat.js`) và Socket.IO
 * (`server.js`) phải tạo message giống hệt nhau, nên logic nằm ở một chỗ.
 *
 * MONGODB.md mục 5 đã ghi: cascade và các ràng buộc MySQL từng lo hộ nên gom vào
 * `backend/services/` thay vì rải trong route. Đây là lớp đó cho phần chat.
 *
 * QUY ƯỚC ID: `userId`, `sender.id`, `mentions[]` là hex của `users._id` ở dạng
 * CHUỖI. Chỉ `_id` của conversation và message là ObjectId.
 *
 * BẤT BIẾN: `conversations.lastMessage` luôn là tin CHƯA XÓA mới nhất, hoặc null.
 */
const { ObjectId } = require('mongodb');

/** Cảm xúc được phép thả. Chặn ở đây để không ai nhét chuỗi lạ / rất dài vào DB. */
const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

/** Nhận diện URL trong tin nhắn văn bản để xếp vào tab "Liên kết" (Task 3.2). */
const URL_RE = /https?:\/\/[^\s]+/i;

/** Mọi tin hệ thống đều mang sender này — không phải user thật. */
const SYSTEM_SENDER = { id: 'system', name: 'Hệ thống', avatar: null };

/** Ép chuỗi hex thành ObjectId; null nếu không hợp lệ (để route trả 400 thay vì 500). */
const toId = (v) => (v && ObjectId.isValid(v) ? new ObjectId(v) : null);

/** Giờ:phút cho sidebar — giữ đúng định dạng bản cũ. */
const hhmm = (d) =>
    d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Tìm những ai bị @ trong nội dung, dựa trên danh sách thành viên THẬT của phòng.
 *
 * Luôn parse ở server, không tin mảng `mentions` client gửi lên: nếu tin thì một
 * client sửa payload có thể bắn thông báo cho người không liên quan.
 *
 * Người gửi bị loại khỏi kết quả — tự @ mình thì không nên sinh badge cho mình.
 *
 * Tên có dấu cách ("Phạm Ngọc Lan") nên không tách được theo khoảng trắng. Cách
 * làm: với mỗi thành viên, kiểm tra nội dung có chứa "@" + tên hay không. Không
 * sinh dương tính giả giữa "Lan" và "Phạm Ngọc Lan", vì chuỗi "@Phạm Ngọc Lan"
 * không chứa "@Lan".
 */
function parseMentions(content, members = [], senderId = null) {
    if (!content || typeof content !== 'string') return [];

    const lower = content.toLowerCase();
    const ids = new Set();

    // @all / @everyone / @tatca -> nhắc toàn bộ thành viên
    if (/@(all|everyone|tatca)\b/i.test(content)) {
        for (const m of members) ids.add(String(m.userId));
    }

    for (const m of members) {
        const name = String(m.userName || '').trim().toLowerCase();
        if (name && lower.includes('@' + name)) ids.add(String(m.userId));
    }

    if (senderId) ids.delete(String(senderId));

    return [...ids];
}

/**
 * Xếp loại đính kèm NGAY LÚC GHI để panel "Bộ sưu tập" (Task 3.2) đọc bằng một
 * câu có index. Nếu để trống rồi lọc bằng regex lúc đọc thì mỗi lần mở panel
 * phải quét toàn bộ tin nhắn của phòng.
 *
 * Trả null khi tin không có gì để trưng ra — lúc đó field bị BỎ HẲN khỏi document,
 * vì partial index dùng $exists (xem phụ lục MONGODB.md).
 */
function classifyAttachment(type, metadata, content) {
    const mime = metadata && metadata.mimetype ? String(metadata.mimetype) : '';

    if (type === 'media' || type === 'file') {
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        return 'file';
    }

    // Vị trí nằm cùng tab "Liên kết" với link Google Maps — khớp cách sidebar cũ gom
    if (type === 'location') return 'link';
    if (type === 'text' && URL_RE.test(content || '')) return 'link';

    return null;
}

/**
 * Dựng document message hoàn chỉnh. Field không có giá trị thì BỎ HẲN, không set
 * null — partial index `$exists` sẽ nuốt hết nếu để null (phụ lục MONGODB.md).
 */
function buildMessage({
    conversationId,
    sender,
    type = 'text',
    content = '',
    metadata = null,
    members = [],
    createdAt = new Date(),
    _id = new ObjectId(),
}) {
    const kind = classifyAttachment(type, metadata, content);
    const mentions = type === 'system' ? [] : parseMentions(content, members, sender.id);

    const doc = {
        _id,
        conversationId,
        sender: {
            id: String(sender.id),
            name: sender.name || null,
            avatar: sender.avatar || null,
        },
        type,
        content: content || '',
        metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
        reactions: [],
        deletedAt: null,
        createdAt,
    };

    if (kind) doc.attachmentKind = kind;
    if (mentions.length > 0) doc.mentions = mentions;

    return doc;
}

/** Tin hệ thống: "X đã thêm Y vào nhóm", "X đã đổi tên nhóm"... */
function buildSystemMessage(conversationId, content, createdAt = new Date()) {
    return buildMessage({
        conversationId,
        sender: SYSTEM_SENDER,
        type: 'system',
        content,
        createdAt,
    });
}

/** Snapshot tin cuối cho sidebar — thay cho câu COUNT(*) + SELECT của bản MySQL. */
function lastMessageSnapshot(msg) {
    if (!msg) return null;

    return {
        id: msg._id,
        senderId: msg.sender.id,
        senderName: msg.sender.name,
        type: msg.type,
        content: msg.content,
        createdAt: msg.createdAt,
    };
}

/**
 * Hình dạng message trả về cho frontend. Tin đã xóa mềm vẫn được trả về nhưng
 * thay nội dung bằng placeholder và bỏ metadata — giống bản cũ, để ChatLog hiện
 * "Tin nhắn này đã bị xóa" đúng vị trí thay vì làm trống chỗ.
 */
function toApiMessage(m) {
    const deleted = !!m.deletedAt;

    return {
        id: String(m._id),
        conversationId: String(m.conversationId),
        senderId: m.sender.id,
        senderName: m.sender.name,
        senderAvatar: m.sender.avatar,
        type: m.type,
        content: deleted ? 'Tin nhắn này đã bị xóa' : m.content,
        metadata: deleted ? {} : (m.metadata || {}),
        mentions: m.mentions || [],
        attachmentKind: m.attachmentKind || null,
        reactions: deleted ? [] : (m.reactions || []),
        isDeleted: deleted,
        isSystem: m.type === 'system',
        createdAt: m.createdAt,
        time: hhmm(m.createdAt),
    };
}

/**
 * Hình dạng message phát qua Socket.IO. Giữ snake_case của bản cũ để frontend
 * đang chạy không phải sửa; nhờ đó tin hệ thống sinh từ REST (thêm thành viên,
 * đổi tên nhóm...) đi đúng cùng một kênh `receive_message` như tin người gửi.
 */
function toSocketMessage(m, clientTempId = null) {
    return {
        id: String(m._id),
        client_temp_id: clientTempId,
        conversation_id: String(m.conversationId),
        sender_id: m.sender.id,
        sender_name: m.sender.name,
        sender_avatar: m.sender.avatar,
        type: m.type,
        content: m.content,
        metadata: m.metadata || {},
        mentions: m.mentions || [],
        attachment_kind: m.attachmentKind || null,
        reactions: m.reactions || [],
        is_system: m.type === 'system',
        created_at: m.createdAt,
    };
}

/**
 * Phát một tin tới phòng conversation VÀ phòng cá nhân của từng thành viên,
 * trong MỘT lệnh emit.
 *
 * Bản cũ gọi `io.to(conv).emit(...)` rồi lặp `io.to(user_X).emit(...)`: ai đang
 * mở phòng sẽ nhận hai lần cùng một tin (frontend lọc trùng theo id nên không
 * hiện hai bong bóng, nhưng vẫn tốn một lượt gửi mỗi người). Socket.IO gộp
 * trùng khi các room được chain trong cùng một emit, nên cách này gửi đúng một lần.
 */
function emitToConversation(io, conversationId, members, event, payload) {
    let channel = io.to(String(conversationId));
    for (const m of members || []) channel = channel.to(`user_${m.userId}`);
    channel.emit(event, payload);
}

/**
 * Lớp nghiệp vụ chat, buộc vào một handle db. Dùng: `const chat = chatService(db)`.
 */
function chatService(db) {
    const conversations = db.collection('conversations');
    const messages = db.collection('messages');

    /**
     * Tính lại lastMessage từ tin chưa xóa mới nhất. Phải gọi sau khi xóa tin:
     * xóa đúng tin cuối mà không tính lại thì sidebar vẫn hiện tin đã xóa.
     */
    async function recomputeLastMessage(conversationId, session = undefined) {
        const last = await messages.findOne(
            { conversationId, deletedAt: null },
            { sort: { createdAt: -1, _id: -1 }, session },
        );
        const snapshot = lastMessageSnapshot(last);

        await conversations.updateOne(
            { _id: conversationId },
            { $set: { lastMessage: snapshot, updatedAt: new Date() } },
            { session },
        );

        return snapshot;
    }

    /**
     * Ghi một tin nhắn và cập nhật snapshot trong cùng luồng.
     *
     * Thứ tự: đọc members TRƯỚC (cần để parse @mention theo người thật và để chặn
     * người ngoài phòng), rồi ghi message, rồi cập nhật lastMessage. Nếu bước cập
     * nhật snapshot lỗi thì message đã nằm trong DB và recomputeLastMessage() ở
     * lần xóa sau sẽ chữa lại — không rơi vào trạng thái sidebar trỏ tới message
     * không tồn tại (nguy hiểm hơn).
     *
     * @returns {{ message, members, conversation, isFirstMessage }} hoặc
     *          `{ error: 'not_found' | 'forbidden' }`.
     */
    async function appendMessage(conversationId, sender, opts = {}) {
        const { type = 'text', content = '', metadata = null } = opts;

        const conv = await conversations.findOne(
            { _id: conversationId },
            { projection: { members: 1, lastMessage: 1, type: 1, name: 1 } },
        );
        if (!conv) return { error: 'not_found' };

        const senderId = String(sender.id);

        // Người ngoài phòng không được gửi vào. Bản cũ không kiểm tra chỗ này: biết
        // conversation_id là gửi được, dù không phải thành viên.
        if (senderId !== 'system' && !conv.members.some((m) => m.userId === senderId)) {
            return { error: 'forbidden' };
        }

        const doc = buildMessage({
            conversationId,
            sender,
            type,
            content,
            metadata,
            members: conv.members,
        });

        await messages.insertOne(doc);
        await conversations.updateOne(
            { _id: conversationId },
            { $set: { lastMessage: lastMessageSnapshot(doc), updatedAt: doc.createdAt } },
        );

        return {
            message: doc,
            members: conv.members,
            conversation: conv,
            // Tin đầu tiên của phòng -> phía người nhận cần nạp phòng mới vào sidebar
            isFirstMessage: !conv.lastMessage,
        };
    }

    /** Ghi tin hệ thống + cập nhật snapshot. Trả về document tin đã ghi. */
    async function appendSystemMessage(conversationId, content, session = undefined) {
        const doc = buildSystemMessage(conversationId, content);

        await messages.insertOne(doc, { session });
        await conversations.updateOne(
            { _id: conversationId },
            { $set: { lastMessage: lastMessageSnapshot(doc), updatedAt: doc.createdAt } },
            { session },
        );

        return doc;
    }

    /**
     * Đếm tin chưa đọc + tin có @tôi cho NHIỀU phòng trong MỘT câu aggregate.
     *
     * Mỗi phòng có mốc `lastReadAt` riêng nên không dùng được một điều kiện chung;
     * cách làm là dựng $or gồm từng cặp (conversationId, mốc thời gian). Vẫn đi
     * index ix_msg_conv_created vì mỗi nhánh $or là một khoảng trên cùng index đó.
     *
     * @param {Array<{ _id: ObjectId, lastReadAt: Date|null }>} marks
     * @param {string} userId
     * @returns {Promise<Map<string, { unread: number, mentions: number }>>}
     */
    async function countUnread(marks, userId) {
        const result = new Map();
        if (!marks || marks.length === 0) return result;

        const branches = marks.map(({ _id, lastReadAt }) =>
            (lastReadAt
                ? { conversationId: _id, createdAt: { $gt: lastReadAt } }
                : { conversationId: _id }));

        const rows = await messages
            .aggregate([
                {
                    $match: {
                        $or: branches,
                        deletedAt: null,
                        // Tin của chính mình và tin hệ thống không tính là chưa đọc
                        'sender.id': { $ne: String(userId) },
                        type: { $ne: 'system' },
                    },
                },
                {
                    $group: {
                        _id: '$conversationId',
                        unread: { $sum: 1 },
                        mentions: {
                            $sum: {
                                $cond: [
                                    { $in: [String(userId), { $ifNull: ['$mentions', []] }] },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
            ])
            .toArray();

        for (const r of rows) {
            result.set(String(r._id), { unread: r.unread, mentions: r.mentions });
        }

        return result;
    }

    /**
     * Xóa phòng kèm toàn bộ tin nhắn. MySQL từng làm việc này bằng
     * ON DELETE CASCADE; ở đây phải xóa tay (MONGODB.md mục 5).
     */
    async function cascadeDeleteConversation(conversationId, client = null) {
        const run = async (session) => {
            const delMsgs = await messages.deleteMany({ conversationId }, { session });
            const delConv = await conversations.deleteOne({ _id: conversationId }, { session });

            return { messages: delMsgs.deletedCount, conversations: delConv.deletedCount };
        };

        if (client && typeof client.startSession === 'function') {
            const session = client.startSession();
            try {
                let out;
                await session.withTransaction(async () => {
                    out = await run(session);
                });

                return out;
            } finally {
                await session.endSession();
            }
        }

        return run(undefined);
    }

    /** Phòng + vai trò của người yêu cầu. Dùng cho mọi kiểm tra quyền. */
    async function getMembership(conversationId, userId) {
        const conv = await conversations.findOne(
            { _id: conversationId },
            { projection: { members: 1, type: 1, name: 1, avatar: 1, createdBy: 1 } },
        );
        if (!conv) return { conv: null, me: null };

        const me = conv.members.find((m) => m.userId === String(userId)) || null;

        return { conv, me };
    }

    return {
        conversations,
        messages,
        recomputeLastMessage,
        appendMessage,
        appendSystemMessage,
        countUnread,
        cascadeDeleteConversation,
        getMembership,
    };
}

module.exports = {
    chatService,
    parseMentions,
    classifyAttachment,
    buildMessage,
    buildSystemMessage,
    lastMessageSnapshot,
    toApiMessage,
    toSocketMessage,
    emitToConversation,
    toId,
    hhmm,
    REACTIONS,
    SYSTEM_SENDER,
    URL_RE,
};
