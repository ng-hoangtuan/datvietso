/**
 * Mật khẩu cổng vào — lớp khoá đặt TRƯỚC cả trang đăng nhập.
 *
 * Mục đích hẹp và rõ: khi mở app ra Internet qua ngrok để khách xem thử, link
 * sẽ bị bot quét trong vài phút. Lớp này chặn mọi thứ chưa biết mã, nên bot
 * dừng ngay ở đây thay vì đi tới trang đăng nhập (nơi mật khẩu `123456` mở được
 * mọi tài khoản và token thì chưa ký).
 *
 * KHÔNG phải cơ chế xác thực người dùng. Nó là một mật khẩu chung cho cả bản
 * demo, giống khoá cửa toà nhà — ai vào được cũng vẫn phải đăng nhập tiếp.
 *
 * Tắt bằng cách bỏ trống GATE_PASSWORD trong .env.
 */
const crypto = require('crypto');

const COOKIE = 'dvs_gate';
const MAX_AGE_DAYS = 7;

/**
 * Giá trị cookie = HMAC của mật khẩu cổng. Không lưu mật khẩu thẳng vào cookie,
 * và đổi GATE_PASSWORD là mọi cookie cũ tự hết hiệu lực.
 */
function gateToken(password) {
    const secret = process.env.ASSET_SECRET_KEY || 'dvs-gate-fallback';

    return crypto.createHmac('sha256', secret).update(String(password)).digest('hex');
}

/** So sánh chống timing attack. Độ dài khác nhau thì trả false ngay. */
function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    if (x.length !== y.length) return false;

    return crypto.timingSafeEqual(x, y);
}

/** Đọc một cookie từ header, không cần thư viện cookie-parser. */
function readCookie(req, name) {
    const raw = req.headers.cookie;
    if (!raw) return null;

    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i === -1) continue;
        if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }

    return null;
}

/** Trang nhập mã. Tự chứa, không phụ thuộc frontend đã build hay chưa. */
function gatePage(error = '') {
    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Đất Việt Số — Bản dùng thử</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #f4f5fa; padding: 16px;
    font-family: "Segoe UI", Roboto, system-ui, sans-serif; color: #2e384d;
  }
  .card {
    background: #fff; border-radius: 12px; padding: 36px 32px;
    box-shadow: 0 4px 24px rgba(46,56,77,.1); width: 100%; max-width: 380px;
  }
  h1 { margin: 0 0 6px; font-size: 1.25rem; letter-spacing: .5px; color: #7367f0; }
  p  { margin: 0 0 22px; font-size: .875rem; color: #6b7280; line-height: 1.5; }
  label { display: block; font-size: .8125rem; font-weight: 600; margin-bottom: 6px; }
  input {
    width: 100%; padding: 11px 13px; font-size: 1rem; border-radius: 8px;
    border: 1px solid #d8d9e0; outline: none;
  }
  input:focus { border-color: #7367f0; box-shadow: 0 0 0 3px rgba(115,103,240,.14); }
  button {
    width: 100%; margin-top: 18px; padding: 11px; font-size: .9375rem; font-weight: 600;
    color: #fff; background: #7367f0; border: 0; border-radius: 8px; cursor: pointer;
  }
  button:hover { background: #685dd8; }
  .err {
    background: #ffe9e9; color: #c0392b; border-radius: 8px;
    padding: 9px 12px; font-size: .8125rem; margin-bottom: 16px;
  }
  .note { margin: 20px 0 0; font-size: .75rem; color: #9aa0ad; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <h1>DATVIETSO</h1>
    <p>Bản dùng thử nội bộ. Nhập mã truy cập được cấp để tiếp tục.</p>
    ${error ? `<div class="err">${error}</div>` : ''}
    <form method="POST" action="/__gate">
      <label for="p">Mã truy cập</label>
      <input id="p" name="password" type="password" autocomplete="off" autofocus required>
      <button type="submit">Vào hệ thống</button>
    </form>
    <p class="note">Chưa có mã? Liên hệ người gửi đường dẫn này.</p>
  </div>
</body>
</html>`;
}

/**
 * Gắn cổng vào app. Phải gắn TRƯỚC mọi route khác, kể cả static.
 *
 * @param {import('express').Express} app
 * @param {import('express').Router} express dùng express.urlencoded cho form
 */
function mountGate(app, express) {
    const password = (process.env.GATE_PASSWORD || '').trim();

    if (!password) {
        console.log('  Cổng vào: TẮT (GATE_PASSWORD trống)');

        return false;
    }

    const expected = gateToken(password);

    // Form đăng nhập cổng
    app.post('/__gate', express.urlencoded({ extended: false }), (req, res) => {
        const given = (req.body && req.body.password) || '';

        if (!safeEqual(gateToken(given), expected)) {
            // Trả 401 kèm lại trang, không chuyển hướng: giữ nguyên URL cho dễ thử lại
            return res.status(401).send(gatePage('Mã truy cập không đúng.'));
        }

        res.cookie(COOKIE, expected, {
            httpOnly: true, // JS trong trang không đọc được, giảm rủi ro XSS
            sameSite: 'lax',
            path: '/',
            maxAge: MAX_AGE_DAYS * 86400 * 1000,
        });

        res.redirect('/');
    });

    app.use((req, res, next) => {
        if (req.path === '/__gate') return next();

        const cookie = readCookie(req, COOKIE);
        if (cookie && safeEqual(cookie, expected)) return next();

        // Request của API trả JSON, không trả HTML — để fetch bên frontend
        // hiểu được chuyện gì xảy ra thay vì nhận một đống thẻ <html>.
        if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
            return res.status(401).json({ error: 'Chưa nhập mã truy cập bản dùng thử', gate: true });
        }

        return res.status(401).send(gatePage());
    });

    console.log(`  Cổng vào: BẬT (mã ${password.length} ký tự, cookie sống ${MAX_AGE_DAYS} ngày)`);

    return true;
}

module.exports = { mountGate, gateToken, COOKIE };
