const express = require('express');

module.exports = function(pool) {
    const router = express.Router();

    // 1. POST /api/auth/login - Đăng nhập bằng employee_code và mật khẩu (mặc định 123456)
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

            // Truy vấn thông tin user kèm nhân sự, phòng ban, chức vụ
            const [rows] = await pool.query(`
                SELECT 
                    u.id, 
                    u.username, 
                    u.email, 
                    u.password_hash, 
                    u.full_name, 
                    u.phone, 
                    u.avatar, 
                    u.role, 
                    u.status,
                    e.id as employee_id,
                    e.employee_code,
                    e.gender,
                    e.join_date,
                    d.name as department_name,
                    p.title as position_title
                FROM users u
                LEFT JOIN employees e ON u.id = e.user_id
                LEFT JOIN departments d ON e.department_id = d.id
                LEFT JOIN positions p ON e.position_id = p.id
                WHERE e.employee_code = ? OR u.username = ? OR u.email = ?
                LIMIT 1
            `, [cleanCode, cleanCode, cleanCode]);

            if (rows.length === 0) {
                return res.status(401).json({ 
                    error: `Không tìm thấy tài khoản với mã nhân sự "${cleanCode}"!` 
                });
            }

            const user = rows[0];

            // Kiểm tra trạng thái tài khoản
            if (user.status !== 'ACTIVE') {
                return res.status(403).json({ 
                    error: 'Tài khoản này đang bị khóa hoặc ngưng hoạt động. Vui lòng liên hệ IT/HR!' 
                });
            }

            // Kiểm tra mật khẩu (Hỗ trợ mật khẩu mặc định 123456 hoặc khớp password_hash)
            const isDefaultPass = password === '123456';
            const isMatchHash = user.password_hash === password || user.password_hash === '$2a$10$abcdefghijklmnopqrstuv';

            if (!isDefaultPass && !isMatchHash) {
                return res.status(401).json({ 
                    error: 'Mật khẩu không chính xác! (Mật khẩu mặc định là: 123456)' 
                });
            }

            // Cập nhật thời gian đăng nhập gần nhất
            await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

            // Sinh token phiên đăng nhập đơn giản
            const token = `dvs_token_${user.id}_${Date.now()}`;

            const userProfile = {
                id: user.id.toString(),
                employee_id: user.employee_id ? user.employee_id.toString() : null,
                employee_code: user.employee_code || cleanCode,
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                phone: user.phone,
                avatar: user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.full_name)}`,
                role: user.role,
                department: user.department_name || 'Phòng Kỹ Thuật',
                position: user.position_title || 'Nhân sự'
            };

            res.json({
                success: true,
                message: 'Đăng nhập thành công!',
                token,
                user: userProfile
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

            const token = authHeader.replace('Bearer ', '');
            const parts = token.split('_');
            const userId = parts[2];

            if (!userId) return res.status(401).json({ error: 'Token không hợp lệ' });

            const [rows] = await pool.query(`
                SELECT 
                    u.id, u.username, u.email, u.full_name, u.phone, u.avatar, u.role, u.status,
                    e.employee_code, d.name as department_name, p.title as position_title
                FROM users u
                LEFT JOIN employees e ON u.id = e.user_id
                LEFT JOIN departments d ON e.department_id = d.id
                LEFT JOIN positions p ON e.position_id = p.id
                WHERE u.id = ?
            `, [userId]);

            if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy người dùng' });

            const u = rows[0];
            res.json({
                id: u.id.toString(),
                employee_code: u.employee_code,
                username: u.username,
                full_name: u.full_name,
                email: u.email,
                avatar: u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.full_name)}`,
                role: u.role,
                department: u.department_name,
                position: u.position_title
            });
        } catch (err) {
            console.error('Auth me error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // 3. GET /api/auth/demo-accounts - Danh sách tài khoản mẫu để test nhanh
    router.get('/demo-accounts', async (req, res) => {
        try {
            const [rows] = await pool.query(`
                SELECT 
                    u.id, u.full_name, u.role, u.avatar,
                    e.employee_code, d.name as department_name, p.title as position_title
                FROM users u
                JOIN employees e ON u.id = e.user_id
                LEFT JOIN departments d ON e.department_id = d.id
                LEFT JOIN positions p ON e.position_id = p.id
                WHERE u.status = 'ACTIVE'
                ORDER BY e.employee_code ASC
                LIMIT 6
            `);

            res.json(rows.map(r => ({
                id: r.id.toString(),
                code: r.employee_code,
                name: r.full_name,
                role: r.role,
                department: r.department_name,
                position: r.position_title,
                defaultPassword: '123456'
            })));
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};

