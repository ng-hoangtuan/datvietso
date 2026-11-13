/**
 * Mã hoá key bản quyền và mật khẩu tài khoản dùng chung.
 *
 * Đặc tả yêu cầu AES-256. Ở đây dùng **AES-256-GCM** chứ không phải CBC: GCM có
 * authentication tag nên phát hiện được dữ liệu bị sửa. Với CBC, ai sửa được
 * database có thể lật từng bit của bản mã mà lúc giải mã không có cách nào biết.
 *
 * ĐỌC TRƯỚC KHI TIN VÀO LỚP NÀY
 * -----------------------------
 * Mã hoá at-rest chỉ chặn người đọc thẳng file database. Nó KHÔNG chặn người gọi
 * API. Endpoint `reveal-secret` hiện đứng trên tầng xác thực có ba lỗ hổng đã
 * biết (MONGODB.md mục 7): mật khẩu `123456` mở mọi tài khoản, so sánh plaintext,
 * token không ký. Tức là hiện tại ai chạm được cổng 5000 đều lấy được toàn bộ
 * kho key qua API — lớp này không cứu được điều đó.
 *
 * Xem Docs/danh-gia-dac-ta-tai-san-so.md mục 2.1.
 *
 * Định dạng lưu: { ct, iv, tag } — đều là chuỗi hex. Lưu object chứ không phải
 * một chuỗi nối, để sau này đổi thuật toán hoặc xoay khoá còn nhận dạng được
 * bản ghi cũ.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bit — độ dài khuyến nghị cho GCM
const KEY_BYTES = 32; // AES-256

let cachedKey = null;

/**
 * Lấy khoá chủ từ `ASSET_SECRET_KEY` (64 ký tự hex = 32 byte).
 *
 * Cố ý ném lỗi khi thiếu hoặc sai độ dài, thay vì tự sinh khoá tạm: khoá tạm
 * nghĩa là mỗi lần khởi động lại server là toàn bộ key đã lưu thành rác không
 * giải mã được, mà lỗi chỉ lộ ra nhiều ngày sau.
 */
function getKey() {
    if (cachedKey) return cachedKey;

    const raw = process.env.ASSET_SECRET_KEY;
    if (!raw) {
        throw new Error(
            'Thiếu ASSET_SECRET_KEY trong backend/.env. '
            + 'Sinh khoá mới: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
    }

    const buf = Buffer.from(raw.trim(), 'hex');
    if (buf.length !== KEY_BYTES) {
        throw new Error(
            `ASSET_SECRET_KEY phải là ${KEY_BYTES} byte dạng hex (${KEY_BYTES * 2} ký tự), `
            + `đang có ${buf.length} byte.`,
        );
    }

    cachedKey = buf;

    return cachedKey;
}

/** true nếu đã cấu hình khoá hợp lệ — để server cảnh báo sớm lúc khởi động. */
function isConfigured() {
    try {
        getKey();

        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Mã hoá một chuỗi. Trả null nếu đầu vào rỗng, để field vắng mặt hẳn trong
 * document thay vì lưu bản mã của chuỗi rỗng.
 *
 * @param {string} plain
 * @returns {{ ct: string, iv: string, tag: string } | null}
 */
function encrypt(plain) {
    if (plain === undefined || plain === null || String(plain) === '') return null;

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);

    return {
        ct: ct.toString('hex'),
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
    };
}

/**
 * Giải mã. Ném lỗi nếu bản mã bị sửa (GCM tag không khớp) — không trả về rác.
 *
 * @param {{ ct: string, iv: string, tag: string } | null} blob
 * @returns {string | null}
 */
function decrypt(blob) {
    if (!blob || !blob.ct || !blob.iv || !blob.tag) return null;

    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(blob.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));

    try {
        return Buffer.concat([
            decipher.update(Buffer.from(blob.ct, 'hex')),
            decipher.final(),
        ]).toString('utf8');
    } catch (err) {
        // 'Unsupported state or unable to authenticate data' = tag sai
        throw new Error('Không giải mã được: dữ liệu đã bị thay đổi hoặc sai khoá');
    }
}

/**
 * Che bớt key để hiển thị trên bảng danh sách mà không cần gọi reveal-secret:
 * "XXXXX-XXXXX-XXXXX-XXXXX-7T8K9". Chỉ lộ 5 ký tự cuối.
 */
function maskKey(plain) {
    if (!plain) return '';

    const s = String(plain);
    const tail = s.slice(-5);

    // Giữ đúng hình dạng 5 nhóm của key Windows cho dễ nhận ra
    if (s.includes('-') && s.split('-').length === 5) return `XXXXX-XXXXX-XXXXX-XXXXX-${tail}`;

    return `${'•'.repeat(Math.max(s.length - 5, 4))}${tail}`;
}

/** Sinh khoá chủ mới — dùng cho tài liệu và script thiết lập. */
function generateMasterKey() {
    return crypto.randomBytes(KEY_BYTES).toString('hex');
}

module.exports = { encrypt, decrypt, maskKey, isConfigured, generateMasterKey, ALGO };
