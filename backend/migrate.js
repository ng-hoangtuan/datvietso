const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function runMigration() {
    console.log('--- ĐANG BẮT ĐẦU MIGRATION CƠ SỞ DỮ LIỆU DATVIETSO ---');
    console.log(`Kết nối tới DB: ${process.env.DB_HOST}:${process.env.DB_PORT || 3306} | Database: ${process.env.DB_NAME}`);

    // Kết nối không chỉ định database trước để tạo database nếu chưa có
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        multipleStatements: true,
    });

    try {
        const dbName = process.env.DB_NAME || 'datvietso';
        const isFresh = process.argv.includes('--fresh');

        if (isFresh) {
            console.log(`-> Đang làm mới database (--fresh): Xóa database cũ '${dbName}'...`);
            await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\`;`);
            console.log(`✔ Đã xóa database cũ.`);
        }

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        await connection.query(`USE \`${dbName}\`;`);
        console.log(`✔ Đã chọn cơ sở dữ liệu: ${dbName}`);

        // 1. Chạy Full Schema
        const schemaPath = path.join(__dirname, 'migrations', '20261109_full_schema_datvietso.sql');
        if (fs.existsSync(schemaPath)) {
            console.log('-> Đang thực thi: 20261109_full_schema_datvietso.sql...');
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await connection.query(schemaSql);
            console.log('✔ Hoàn thành tạo cấu trúc bảng (Schema)!');
        }

        // 2. Chạy Seed Data (nếu có tham số --seed)
        const shouldSeed = process.argv.includes('--seed');
        if (shouldSeed) {
            const seedPath = path.join(__dirname, 'migrations', '20261109_seed_data.sql');
            if (fs.existsSync(seedPath)) {
                console.log('-> Đang nạp dữ liệu mẫu: 20261109_seed_data.sql...');
                const seedSql = fs.readFileSync(seedPath, 'utf8');
                await connection.query(seedSql);
                console.log('✔ Nạp dữ liệu mẫu (Seed Data) thành công!');
            }
        }

        // Hiển thị danh sách các bảng đã tạo thành công
        const [tables] = await connection.query('SHOW TABLES');
        console.log('\n=== DANH SÁCH BẢNG TRONG DATABASE ===');
        tables.forEach((row, idx) => {
            console.log(`${idx + 1}. ${Object.values(row)[0]}`);
        });

        console.log('\n✔ MIGRATION THÀNH CÔNG RỰC RỠ!');
    } catch (error) {
        console.error('❌ Lỗi khi thực thi Migration:', error.message);
    } finally {
        await connection.end();
    }
}

runMigration();
