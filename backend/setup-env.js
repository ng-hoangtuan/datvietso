#!/usr/bin/env node
/**
 * Tạo backend/.env cho máy mới.
 *
 *   npm run setup
 *
 * `.env` nằm trong .gitignore (chứa khoá bí mật) nên clone repo về là không có,
 * và backend dừng ngay với "Thiếu MONGO_URI trong .env". Script này chép từ
 * `.env.example` rồi tự sinh ASSET_SECRET_KEY.
 *
 * Viết bằng Node chứ không phải lệnh shell: chép file rồi chèn chuỗi 64 ký tự
 * vào đúng dòng, làm bằng PowerShell hay bash đều vướng chuyện trích dẫn và
 * BOM — mỗi máy một kiểu hỏng.
 *
 * Chạy lại nhiều lần vô hại: đã có `.env` thì không ghi đè, chỉ điền nốt khoá
 * nếu còn trống.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV = path.join(__dirname, '.env');
const EXAMPLE = path.join(__dirname, '.env.example');

const newKey = () => crypto.randomBytes(32).toString('hex');

/** Điền giá trị cho một biến còn trống. Trả về [nội dung mới, đã sửa hay chưa]. */
function fillIfEmpty(content, key, value) {
    const re = new RegExp(`^${key}=\\s*$`, 'm');
    if (!re.test(content)) return [content, false];

    return [content.replace(re, `${key}=${value}`), true];
}

function main() {
    if (!fs.existsSync(EXAMPLE)) {
        console.error('❌ Không tìm thấy .env.example — chạy script này trong thư mục backend/');
        process.exitCode = 1;

        return;
    }

    const created = !fs.existsSync(ENV);

    // Không bao giờ ghi đè .env đang có: trong đó có thể là khoá đã dùng để mã
    // hoá dữ liệu thật, mất khoá là mất luôn key bản quyền đã lưu.
    let content = created
        ? fs.readFileSync(EXAMPLE, 'utf8')
        : fs.readFileSync(ENV, 'utf8');

    const changes = [];

    const [withKey, keyFilled] = fillIfEmpty(content, 'ASSET_SECRET_KEY', newKey());
    content = withKey;
    if (keyFilled) changes.push('sinh ASSET_SECRET_KEY mới');

    if (created) {
        fs.writeFileSync(ENV, content, 'utf8');
        console.log('✔ Đã tạo backend/.env từ .env.example');
        for (const c of changes) console.log(`  - ${c}`);
    } else if (changes.length > 0) {
        fs.writeFileSync(ENV, content, 'utf8');
        console.log('✔ backend/.env đã có sẵn, chỉ điền thêm:');
        for (const c of changes) console.log(`  - ${c}`);
    } else {
        console.log('✔ backend/.env đã đầy đủ, không cần sửa gì');
    }

    // Soát lại những biến bắt buộc, để lỗi lộ ra ngay bây giờ chứ không phải
    // lúc khởi động server
    const missing = ['MONGO_URI', 'ASSET_SECRET_KEY'].filter(k => {
        const m = content.match(new RegExp(`^${k}=(.*)$`, 'm'));

        return !m || !m[1].trim();
    });

    if (missing.length > 0) {
        console.error(`\n❌ Còn thiếu giá trị cho: ${missing.join(', ')}`);
        console.error('   Mở backend/.env điền nốt rồi chạy lại.');
        process.exitCode = 1;

        return;
    }

    console.log('\nTiếp theo:');
    console.log('  docker compose up -d        (ở thư mục gốc repo)');
    console.log('  npm run migrate:fresh       (tạo collection + dữ liệu mẫu)');
    console.log('  npm run dev                 (chạy backend)');
}

main();
