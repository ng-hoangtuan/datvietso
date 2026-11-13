// Kết nối MongoDB dùng driver chính thức (không qua ORM) để khớp style raw-query
// quen thuộc. Giữ một client duy nhất cho cả process —
// MongoClient đã có connection pool sẵn bên trong, không tự tạo nhiều client.
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Kết nối Mongo một lần lúc server khởi động.
 * Gọi trước server.listen() để route nào cũng có db sẵn sàng.
 */
async function connectMongo() {
    if (db) return db;

    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('Thiếu MONGO_URI trong .env');

    client = new MongoClient(uri, {
        // Fail nhanh khi Mongo chưa chạy, thay vì treo 30s mặc định
        serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db(process.env.MONGO_DB || undefined); // undefined -> lấy db trong URI
    console.log(`[Mongo] Đã kết nối: ${db.databaseName}`);

    return db;
}

/** Lấy handle db ở bất kỳ đâu sau khi đã connectMongo(). */
function getDb() {
    if (!db) throw new Error('Chưa gọi connectMongo() — Mongo chưa kết nối');
    return db;
}

/**
 * Lấy MongoClient để mở session/transaction (client.startSession()).
 * Transaction cần replica set — docker-compose đã chạy mongo với --replSet rs0.
 */
function getClient() {
    if (!client) throw new Error('Chưa gọi connectMongo() — Mongo chưa kết nối');
    return client;
}

/** Đóng kết nối khi shutdown. */
async function closeMongo() {
    if (client) {
        await client.close();
        client = null;
        db = null;
        console.log('[Mongo] Đã đóng kết nối');
    }
}

module.exports = { connectMongo, getDb, getClient, closeMongo };
