/**
 * Chặn request chưa đăng nhập.
 *
 * CẢNH BÁO — ĐÂY KHÔNG PHẢI XÁC THỰC THẬT.
 * Token hiện tại là `dvs_token_<userId>_<timestamp>`, KHÔNG có chữ ký. Ai cũng
 * tự gõ ra một chuỗi như vậy với userId của người khác. Middleware này chỉ bảo
 * đảm "có một người dùng tồn tại đứng sau request", đủ để chặn bot ẩn danh và
 * lỗi gọi nhầm — KHÔNG chặn được người cố tình giả mạo.
 *
 * Sửa tận gốc = ký JWT ở `routes/auth.js`. Khi làm việc đó thì chỉ cần thay
 * phần đọc token trong file này, mọi route đã gắn middleware giữ nguyên.
 * Xem MONGODB.md mục 7 và Docs/danh-gia-dac-ta-tai-san-so.md mục 2.1.
 */
const { ObjectId } = require('mongodb');

/** Lấy userId từ header Authorization. null nếu thiếu hoặc sai định dạng. */
function userIdFromRequest(req) {
    const header = req.headers.authorization;
    if (!header) return null;

    // ObjectId không chứa '_' nên tách theo '_' vẫn đúng, giống /api/auth/me
    const parts = String(header).replace('Bearer ', '').split('_');
    const userId = parts[2];

    return userId && ObjectId.isValid(userId) ? userId : null;
}

/**
 * Middleware: yêu cầu đăng nhập. Gắn `req.user` cho handler phía sau.
 *
 * @param {import('mongodb').Db} db
 * @param {string[]} [roles] giới hạn vai trò; bỏ trống = chỉ cần đăng nhập
 */
function requireAuth(db, roles = null) {
    const users = db.collection('users');

    return async function (req, res, next) {
        try {
            const userId = userIdFromRequest(req);
            if (!userId) {
                return res.status(401).json({ error: 'Cần đăng nhập để thực hiện thao tác này' });
            }

            const u = await users.findOne(
                { _id: new ObjectId(userId) },
                { projection: { fullName: 1, role: 1, status: 1, email: 1 } },
            );
            if (!u) return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
            if (u.status !== 'ACTIVE') return res.status(403).json({ error: 'Tài khoản đang bị khóa' });

            if (roles && !roles.includes(u.role)) {
                return res.status(403).json({ error: `Chỉ ${roles.join(' / ')} mới được thao tác` });
            }

            req.user = { id: u._id, name: u.fullName, role: u.role, email: u.email || null };

            return next();
        } catch (err) {
            console.error('[auth] lỗi kiểm tra token:', err.message);

            return res.status(500).json({ error: 'Lỗi xác thực' });
        }
    };
}

/**
 * Chặn một endpoint khi đang chạy bản demo.
 *
 * Dùng cho những endpoint an toàn trong mạng nội bộ nhưng không nên mở ra
 * Internet: danh sách tài khoản mẫu kèm mật khẩu, giải mã key bản quyền.
 * Bật/tắt bằng DEMO_MODE trong .env, không phải sửa code.
 */
function blockInDemo(reason) {
    return function (req, res, next) {
        if (isDemoMode()) {
            return res.status(403).json({
                error: reason,
                demoMode: true,
            });
        }

        return next();
    };
}

/** DEMO_MODE=true trong .env -> đang chạy bản cho khách xem. */
function isDemoMode() {
    return String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
}

module.exports = { requireAuth, blockInDemo, isDemoMode, userIdFromRequest };
