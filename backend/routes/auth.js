const express = require('express');
const { ObjectId } = require('mongodb');
const { blockInDemo } = require('../middleware/auth');

/**
 * Xác thực trên MongoDB.
 *
 * Bản MySQL phải JOIN 4 bảng (users -> employees -> departments -> positions)
 * cho mỗi lần đăng nhập. Sau khi gộp users+employees và denormalize snapshot
 * phòng ban / chức vụ, tất cả còn MỘT findOne.
 *
 * CẢNH BÁO BẢO MẬT — giữ nguyên hành vi của bản cũ, KHÔNG phải thiết kế đúng:
 *   1. Mật khẩu '123456' mở được MỌI tài khoản, bỏ qua hoàn toàn passwordHash.
 *   2. So mật khẩu dạng plaintext, không dùng bcrypt.compare.
 *   3. Token `dvs_token_<id>_<timestamp>` không có chữ ký; /me chỉ tách chuỗi
 *      lấy id nên sửa token là đăng nhập thành người khác.
 * Ba điểm này được giữ y nguyên vì frontend đang đăng nhập bằng mật khẩu mặc
 * định 123456 — sửa sẽ làm hỏng app. Xem MONGODB.md để biết cách khắc phục.
 */
module.exports = function (db) {
    const router = express.Router();
    const users = db.collection('users');

    /** Dựng profile trả về cho client, giữ đúng hình dạng cũ. */
    const toProfile = (u, fallbackCode) => ({
        id: u._id.toString(),
        employee_id: u.employee ? u._id.toString() : null,
        employee_code: (u.employee && u.employee.employeeCode) || fallbackCode,
        username: u.username,
        full_name: u.fullName,
        email: u.email,
        phone: u.phone,
        avatar: u.avatar
            || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.fullName)}`,
        role: u.role,
        department: (u.employee && u.employee.department && u.employee.department.name)
            || 'Phòng Kỹ Thuật',
        position: (u.employee && u.employee.position && u.employee.position.title)
            || 'Nhân sự',
    });

    // 1. POST /api/auth/login - Đăng nhập bằng employee_code và mật khẩu
    router.post('/login', async (req, res) => {
        try {
            const { employee_code, password } = req.body;

            if (!employee_code || !employee_code.trim()) {
                return res.status(400).json({ error: 'Vui lòng nhập Mã nhân sự (Employee Code)!' });
            }
            if (!password) {
                return res.status(400).json({ error: 'Vui lòng nhập Mật khẩu!' });
            }

            const cleanCode = employee_code.trim();

            // MỘT query thay cho câu JOIN 4 bảng. Index:
            //   uq_users_employee_code / uq_users_username / uq_users_email
            const user = await users.findOne({
                $or: [
                    { 'employee.employeeCode': cleanCode },
                    { username: cleanCode },
                    { email: cleanCode },
                ],
            });

            if (!user) {
                return res.status(401).json({
                    error: `Không tìm thấy tài khoản với mã nhân sự "${cleanCode}"!`,
                });
            }

            if (user.status !== 'ACTIVE') {
                return res.status(403).json({
                    error: 'Tài khoản này đang bị khóa hoặc ngưng hoạt động. Vui lòng liên hệ IT/HR!',
                });
            }

            // Giữ nguyên logic cũ — xem cảnh báo bảo mật ở đầu file
            const isDefaultPass = password === '123456';
            const isMatchHash = user.passwordHash === password
                || user.passwordHash === '$2a$10$abcdefghijklmnopqrstuv';

            if (!isDefaultPass && !isMatchHash) {
                return res.status(401).json({
                    error: 'Mật khẩu không chính xác! (Mật khẩu mặc định là: 123456)',
                });
            }

            await users.updateOne(
                { _id: user._id },
                { $set: { lastLoginAt: new Date(), updatedAt: new Date() } },
            );

            const token = `dvs_token_${user._id.toString()}_${Date.now()}`;

            res.json({
                success: true,
                message: 'Đăng nhập thành công!',
                token,
                user: toProfile(user, cleanCode),
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập: ' + err.message });
        }
    });

    // 2. GET /api/auth/me - Lấy thông tin tài khoản hiện tại
    router.get('/me', async (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) return res.status(401).json({ error: 'Chưa đăng nhập' });

            // Token dạng dvs_token_<objectId>_<timestamp>. ObjectId không chứa '_'
            // nên tách theo '_' vẫn đúng như bản cũ.
            const token = authHeader.replace('Bearer ', '');
            const parts = token.split('_');
            const userId = parts[2];

            if (!userId || !ObjectId.isValid(userId)) {
                return res.status(401).json({ error: 'Token không hợp lệ' });
            }

            const u = await users.findOne({ _id: new ObjectId(userId) });
            if (!u) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

            res.json({
                id: u._id.toString(),
                employee_code: u.employee ? u.employee.employeeCode : null,
                username: u.username,
                full_name: u.fullName,
                email: u.email,
                avatar: u.avatar
                    || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.fullName)}`,
                role: u.role,
                department: u.employee && u.employee.department ? u.employee.department.name : null,
                position: u.employee && u.employee.position ? u.employee.position.title : null,
            });
        } catch (err) {
            console.error('Auth me error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 3. GET /api/auth/demo-accounts - Danh sách tài khoản mẫu để test nhanh
    //
    // Endpoint này trả về cả `defaultPassword` và KHÔNG đòi đăng nhập. Trong
    // mạng nội bộ thì tiện; mở ra Internet thì đúng nghĩa treo bảng mật khẩu
    // trước cửa. DEMO_MODE=true sẽ tắt nó, và 4 nút đăng nhập nhanh ở trang
    // login tự biến mất theo.
    router.get('/demo-accounts', blockInDemo('Đã tắt trong bản dùng thử'), async (req, res) => {
        try {
            const rows = await users
                .find({ status: 'ACTIVE', employee: { $ne: null } })
                .sort({ 'employee.employeeCode': 1 })
                .limit(6)
                .toArray();

            res.json(rows.map((r) => ({
                id: r._id.toString(),
                code: r.employee.employeeCode,
                name: r.fullName,
                role: r.role,
                department: r.employee.department ? r.employee.department.name : null,
                position: r.employee.position ? r.employee.position.title : null,
                defaultPassword: '123456',
            })));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
