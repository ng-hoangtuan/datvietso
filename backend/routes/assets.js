const express = require('express');

function safeJsonParse(val, defaultVal = {}) {
    if (!val) return defaultVal;
    if (typeof val === 'object') return val;
    try {
        return JSON.parse(val);
    } catch (e) {
        return defaultVal;
    }
}

module.exports = function(pool) {
    const router = express.Router();

    // 1. GET /api/assets - Danh sách tài sản có phân trang và bộ lọc
    router.get('/', async (req, res) => {
        try {
            const { kind, provider, status, search, page = 1, limit = 50 } = req.query;
            const offset = (parseInt(page) - 1) * parseInt(limit);

            let conditions = ['1=1'];
            let params = [];

            if (kind && kind !== 'ALL') {
                conditions.push('a.asset_kind = ?');
                params.push(kind);
            }

            if (provider && provider !== 'ALL') {
                conditions.push("JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.provider')) = ?");
                params.push(provider);
            }

            if (status && status !== 'ALL') {
                conditions.push('a.status = ?');
                params.push(status);
            }

            if (search && search.trim() !== '') {
                conditions.push('(a.code LIKE ? OR a.name LIKE ? OR a.manager LIKE ?)');
                const searchKeyword = `%${search.trim()}%`;
                params.push(searchKeyword, searchKeyword, searchKeyword);
            }

            const whereClause = conditions.join(' AND ');

            // Truy vấn danh sách tài sản kèm các cấp phát đang active
            const [rows] = await pool.query(
                `SELECT a.*, 
                    (SELECT COUNT(*) FROM asset_allocations alloc WHERE alloc.asset_id = a.id AND alloc.status = 'ACTIVE') AS active_allocations_count
                 FROM assets a 
                 WHERE ${whereClause} 
                 ORDER BY a.updated_at DESC 
                 LIMIT ? OFFSET ?`,
                [...params, parseInt(limit), parseInt(offset)]
            );

            // Lấy danh sách allocations chi tiết cho các asset trả về
            const assetIds = rows.map(r => r.id);
            let allocationsByAsset = {};

            if (assetIds.length > 0) {
                const [allocations] = await pool.query(
                    `SELECT * FROM asset_allocations WHERE asset_id IN (?) ORDER BY allocated_at DESC`,
                    [assetIds]
                );
                allocations.forEach(alloc => {
                    if (!allocationsByAsset[alloc.asset_id]) {
                        allocationsByAsset[alloc.asset_id] = [];
                    }
                    allocationsByAsset[alloc.asset_id].push({
                        id: alloc.id.toString(),
                        assetId: alloc.asset_id.toString(),
                        employeeName: alloc.employee_name,
                        employeeEmail: alloc.employee_email,
                        department: alloc.department,
                        allocatedAt: alloc.allocated_at ? alloc.allocated_at.toISOString().slice(0, 10) : '',
                        revokedAt: alloc.revoked_at ? alloc.revoked_at.toISOString().slice(0, 10) : null,
                        status: alloc.status,
                        note: alloc.note
                    });
                });
            }

            const parsedRows = rows.map(r => ({
                id: r.id.toString(),
                assetKind: r.asset_kind,
                code: r.code,
                name: r.name,
                category: r.category,
                status: r.status,
                manager: r.manager,
                updatedAt: r.updated_at ? r.updated_at.toISOString().slice(0, 10) : '',
                digitalMeta: safeJsonParse(r.metadata, {}),
                physicalMeta: safeJsonParse(r.physical_meta, {}),
                allocations: allocationsByAsset[r.id] || []
            }));

            // Đếm tổng số bản ghi
            const [countResult] = await pool.query(
                `SELECT COUNT(*) as total FROM assets a WHERE ${whereClause}`,
                params
            );

            res.json({
                data: parsedRows,
                pagination: {
                    total: countResult[0].total,
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            });
        } catch (err) {
            console.error('Error fetching assets:', err);
            res.status(500).json({ error: 'Lỗi khi tải danh sách tài sản: ' + err.message });
        }
    });

    // 2. GET /api/assets/stats - Thống kê số lượng theo loại và trạng thái
    router.get('/stats', async (req, res) => {
        try {
            const [stats] = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN asset_kind = 'PHYSICAL' THEN 1 ELSE 0 END) as physicalCount,
                    SUM(CASE WHEN asset_kind = 'DIGITAL' THEN 1 ELSE 0 END) as digitalCount,
                    SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as availableCount,
                    SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as activeCount,
                    SUM(CASE WHEN status IN ('MAINTENANCE', 'EXPIRED', 'SUSPENDED') THEN 1 ELSE 0 END) as warningCount
                FROM assets
            `);
            res.json(stats[0]);
        } catch (err) {
            console.error('Error fetching asset stats:', err);
            res.status(500).json({ error: 'Lỗi khi lấy thống kê: ' + err.message });
        }
    });

    // 3. GET /api/assets/:id - Chi tiết 1 tài sản
    router.get('/:id', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM assets WHERE id = ?', [req.params.id]);
            if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài sản' });

            const asset = rows[0];
            const [allocations] = await pool.query(
                'SELECT * FROM asset_allocations WHERE asset_id = ? ORDER BY allocated_at DESC',
                [req.params.id]
            );

            const [logs] = await pool.query(
                'SELECT * FROM asset_audit_logs WHERE asset_id = ? ORDER BY created_at DESC',
                [req.params.id]
            );

            res.json({
                id: asset.id.toString(),
                assetKind: asset.asset_kind,
                code: asset.code,
                name: asset.name,
                category: asset.category,
                status: asset.status,
                manager: asset.manager,
                updatedAt: asset.updated_at ? asset.updated_at.toISOString().slice(0, 10) : '',
                digitalMeta: safeJsonParse(asset.metadata, {}),
                physicalMeta: safeJsonParse(asset.physical_meta, {}),
                allocations: allocations.map(a => ({
                    id: a.id.toString(),
                    assetId: a.asset_id.toString(),
                    employeeName: a.employee_name,
                    employeeEmail: a.employee_email,
                    department: a.department,
                    allocatedAt: a.allocated_at ? a.allocated_at.toISOString().slice(0, 10) : '',
                    revokedAt: a.revoked_at ? a.revoked_at.toISOString().slice(0, 10) : null,
                    status: a.status,
                    note: a.note
                })),
                logs: logs.map(l => ({
                    id: l.id.toString(),
                    assetId: l.asset_id.toString(),
                    action: l.action,
                    actorName: l.actor_name,
                    timestamp: l.created_at ? l.created_at.toLocaleString('vi-VN') : '',
                    details: l.details
                }))
            });
        } catch (err) {
            console.error('Error fetching asset detail:', err);
            res.status(500).json({ error: 'Lỗi máy chủ: ' + err.message });
        }
    });

    // 4. POST /api/assets - Thêm mới tài sản
    router.post('/', async (req, res) => {
        try {
            const { assetKind, code, name, category, status, manager, digitalMeta, physicalMeta } = req.body;
            
            const metadataJson = assetKind === 'DIGITAL' ? JSON.stringify(digitalMeta || {}) : null;
            const physicalMetaJson = assetKind === 'PHYSICAL' ? JSON.stringify(physicalMeta || {}) : null;

            const [result] = await pool.query(
                `INSERT INTO assets (asset_kind, code, name, category, status, manager, metadata, physical_meta) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [assetKind, code, name, category, status || 'AVAILABLE', manager || null, metadataJson, physicalMetaJson]
            );

            const insertedId = result.insertId;

            // Ghi audit log
            await pool.query(
                `INSERT INTO asset_audit_logs (asset_id, action, actor_name, details) VALUES (?, 'CREATE', ?, ?)`,
                [insertedId, manager || 'Admin', `Tạo mới tài sản ${assetKind}: ${name} (${code})`]
            );

            res.status(201).json({ id: insertedId, message: 'Tạo tài sản thành công' });
        } catch (err) {
            console.error('Error creating asset:', err);
            res.status(500).json({ error: 'Không thể thêm tài sản: ' + err.message });
        }
    });

    // 5. PUT /api/assets/:id - Cập nhật tài sản
    router.put('/:id', async (req, res) => {
        try {
            const { assetKind, code, name, category, status, manager, digitalMeta, physicalMeta } = req.body;
            const metadataJson = assetKind === 'DIGITAL' ? JSON.stringify(digitalMeta || {}) : null;
            const physicalMetaJson = assetKind === 'PHYSICAL' ? JSON.stringify(physicalMeta || {}) : null;

            await pool.query(
                `UPDATE assets SET code = ?, name = ?, category = ?, status = ?, manager = ?, metadata = ?, physical_meta = ?, updated_at = NOW() 
                 WHERE id = ?`,
                [code, name, category, status, manager, metadataJson, physicalMetaJson, req.params.id]
            );

            res.json({ message: 'Cập nhật tài sản thành công' });
        } catch (err) {
            console.error('Error updating asset:', err);
            res.status(500).json({ error: 'Không thể cập nhật tài sản: ' + err.message });
        }
    });

    // 6. DELETE /api/assets/:id - Xóa tài sản
    router.delete('/:id', async (req, res) => {
        try {
            await pool.query('DELETE FROM assets WHERE id = ?', [req.params.id]);
            res.json({ message: 'Xóa tài sản thành công' });
        } catch (err) {
            console.error('Error deleting asset:', err);
            res.status(500).json({ error: 'Không thể xóa tài sản: ' + err.message });
        }
    });

    // 7. POST /api/assets/:id/allocate - Cấp phát cho nhân sự
    router.post('/:id/allocate', async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const assetId = req.params.id;
            const { employeeName, employeeEmail, department, note, allocatedBy } = req.body;

            // Kiểm tra tài sản
            const [assets] = await connection.query('SELECT * FROM assets WHERE id = ? FOR UPDATE', [assetId]);
            if (assets.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Không tìm thấy tài sản' });
            }
            const asset = assets[0];

            // Nếu là digital asset có giới hạn seat, kiểm tra seat availability
            if (asset.asset_kind === 'DIGITAL' && asset.metadata) {
                const meta = safeJsonParse(asset.metadata, {});
                if (meta.totalSeats) {
                    const [allocCount] = await connection.query(
                        "SELECT COUNT(*) as count FROM asset_allocations WHERE asset_id = ? AND status = 'ACTIVE'",
                        [assetId]
                    );
                    if (allocCount[0].count >= meta.totalSeats) {
                        await connection.rollback();
                        return res.status(400).json({ error: `Tài nguyên đã hết ghế trống (Đã cấp ${allocCount[0].count}/${meta.totalSeats} seats)` });
                    }
                }
            }

            // Tạo allocation
            const [allocResult] = await connection.query(
                `INSERT INTO asset_allocations (asset_id, employee_name, employee_email, department, note, status, allocated_by) 
                 VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
                [assetId, employeeName, employeeEmail, department, note || null, allocatedBy || null]
            );

            // Cập nhật trạng thái asset sang ACTIVE
            await connection.query("UPDATE assets SET status = 'ACTIVE', updated_at = NOW() WHERE id = ?", [assetId]);

            // Ghi audit log
            await connection.query(
                `INSERT INTO asset_audit_logs (asset_id, action, actor_name, details) VALUES (?, 'ALLOCATE', ?, ?)`,
                [assetId, employeeName, `Cấp phát cho nhân sự: ${employeeName} (${employeeEmail}) - ${department}`]
            );

            await connection.commit();
            res.status(201).json({ id: allocResult.insertId, message: 'Cấp phát thành công' });
        } catch (err) {
            await connection.rollback();
            console.error('Error allocating asset:', err);
            res.status(500).json({ error: 'Lỗi cấp phát: ' + err.message });
        } finally {
            connection.release();
        }
    });

    // 8. POST /api/assets/:id/revoke - Thu hồi quyền sử dụng
    router.post('/:id/revoke', async (req, res) => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const assetId = req.params.id;
            const { allocationId, reason, revokedBy } = req.body;

            // Cập nhật bản ghi allocation sang REVOKED
            await connection.query(
                `UPDATE asset_allocations 
                 SET status = 'REVOKED', revoked_at = NOW(), note = CONCAT(IFNULL(note, ''), ' | Thu hồi: ', ?), revoked_by = ?
                 WHERE id = ? AND asset_id = ?`,
                [reason || 'Thu hồi theo quy trình', revokedBy || null, allocationId, assetId]
            );

            // Đếm số allocation active còn lại
            const [remaining] = await connection.query(
                "SELECT COUNT(*) as count FROM asset_allocations WHERE asset_id = ? AND status = 'ACTIVE'",
                [assetId]
            );

            // Nếu không còn ai dùng, chuyển status asset về AVAILABLE
            if (remaining[0].count === 0) {
                await connection.query("UPDATE assets SET status = 'AVAILABLE', updated_at = NOW() WHERE id = ?", [assetId]);
            }

            // Ghi audit log
            await connection.query(
                `INSERT INTO asset_audit_logs (asset_id, action, actor_name, details) VALUES (?, 'REVOKE', 'Admin', ?)`,
                [assetId, `Thu hồi quyền sử dụng của allocation ID ${allocationId}. Lý do: ${reason}`]
            );

            await connection.commit();
            res.json({ message: 'Thu hồi tài sản thành công' });
        } catch (err) {
            await connection.rollback();
            console.error('Error revoking asset:', err);
            res.status(500).json({ error: 'Lỗi thu hồi: ' + err.message });
        } finally {
            connection.release();
        }
    });

    return router;
};

