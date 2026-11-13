#!/usr/bin/env node
/**
 * Migration MongoDB cho datvietso. Hệ thống không còn dùng MySQL.
 *
 *   npm run migrate         tạo/cập nhật 19 collection + validator + index
 *   npm run seed            nạp dữ liệu mẫu (giữ dữ liệu đang có)
 *   npm run migrate:fresh   xóa sạch rồi tạo lại và nạp dữ liệu mẫu
 *
 * Cờ:
 *   --fresh   DROP collection trước khi tạo lại. XÓA DỮ LIỆU THẬT.
 *   --seed    nạp dữ liệu mẫu từ db/seed.js
 *   --only=a,b  chỉ xử lý các collection này, không đụng phần còn lại
 *   --quiet   chỉ in dòng tổng kết
 *   --help    in hướng dẫn
 *
 * Làm mới riêng dữ liệu chat, giữ nguyên tài sản / CRM / kanban:
 *   node migrate.js --fresh --seed --only=conversations,messages
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { connectMongo, closeMongo } = require('./db/mongo');
const { syncSchema, COLLECTION_NAMES } = require('./db/schema');
const { seed } = require('./db/seed');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const isFresh = has('--fresh');
const shouldSeed = has('--seed');
const verbose = !has('--quiet');

/** --only=conversations,messages -> ['conversations', 'messages'] */
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : null;

function printHelp() {
  console.log(`
Migration MongoDB cho datvietso

  node migrate.js                  tạo/cập nhật collection, validator, index
  node migrate.js --seed           nạp thêm dữ liệu mẫu
  node migrate.js --fresh --seed   xóa sạch rồi tạo lại và nạp dữ liệu mẫu

  --fresh     DROP collection trước khi tạo lại (xóa dữ liệu)
  --seed      nạp dữ liệu mẫu
  --only=a,b  chỉ xử lý các collection này
  --quiet     chỉ in dòng tổng kết

Làm mới riêng dữ liệu chat, giữ nguyên tài sản / CRM / kanban:
  node migrate.js --fresh --seed --only=conversations,messages
`);
}

async function main() {
  if (has('--help') || has('-h')) return printHelp();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Thiếu MONGO_URI trong backend/.env — copy từ backend/.env.example rồi điền lại.');
  }

  // Che mật khẩu khi in connection string ra log
  const safeUri = uri.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');

  console.log('--- MIGRATION MONGODB CHO DATVIETSO ---');
  console.log(`Kết nối: ${safeUri}`);
  if (only) console.log(`CHẾ ĐỘ --only: chỉ xử lý ${only.join(', ')}.`);
  if (isFresh) {
    console.log(only
      ? `CHẾ ĐỘ --fresh: dữ liệu trong ${only.length} collection trên sẽ bị xóa.`
      : 'CHẾ ĐỘ --fresh: toàn bộ dữ liệu trong 19 collection sẽ bị xóa.');
  }

  const db = await connectMongo();

  // 1. Schema: collection + $jsonSchema validator + index
  console.log('\n-> Áp schema (collection / validator / index)');
  const schemaResult = await syncSchema(db, { drop: isFresh, verbose, only });

  // 2. Dữ liệu mẫu
  let seedResult = null;
  if (shouldSeed) {
    console.log('\n-> Nạp dữ liệu mẫu');
    seedResult = await seed(db, { replace: false, verbose, only });
  }

  // 3. Tổng kết: đếm thực tế trong DB
  console.log('\n=== TRẠNG THÁI DATABASE ===');
  const rows = [];
  for (const name of COLLECTION_NAMES) {
    const count = await db.collection(name).countDocuments();
    const indexes = await db.collection(name).indexes();
    rows.push({ name, count, indexes: indexes.length });
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(width)}  ${String(r.count).padStart(5)} doc   ${r.indexes} index`);
  }

  const totalDocs = rows.reduce((n, r) => n + r.count, 0);
  console.log(
    `\n✔ XONG: ${schemaResult.collections} collection, ${totalDocs} document, `
    + `${rows.reduce((n, r) => n + r.indexes, 0)} index (gồm _id).`,
  );
  if (seedResult && seedResult.skipped.length > 0) {
    console.log(
      `  Lưu ý: ${seedResult.skipped.length} collection đã có dữ liệu nên bị bỏ qua. `
      + 'Dùng --fresh nếu muốn nạp lại từ đầu.',
    );
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Migration thất bại:', err.message);
    if (err.code === 121) {
      console.error('   (lỗi 121: document không qua được validator — đối chiếu db/seed.js với db/schema.js)');
    }
    if (err.name === 'MongoServerSelectionError') {
      console.error('   Không kết nối được MongoDB. Đã chạy `docker compose up -d` chưa?');
    }
    if (process.env.DEBUG) console.error(err);
    // Bản MySQL cũ chỉ log lỗi rồi vẫn exit 0, khiến npm báo thành công khi đã fail.
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo();
  });
