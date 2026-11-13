/**
 * Giám sát tự động tài sản số — Luồng 6 của đặc tả, chạy 08:00 mỗi sáng.
 *
 * Ba việc:
 *   1. Gói sắp hết hạn (còn 30 / 7 ngày) -> báo cho chủ sở hữu và nhóm IT
 *   2. Gói đã quá hạn và autoRenew = false -> chuyển sang 'expired'
 *   3. Phiếu pending_activation quá 3 ngày -> nhắc nhân sự kích hoạt
 *
 * Không dùng thư viện cron ngoài: chỉ cần một mốc giờ cố định mỗi ngày, mà thêm
 * dependency thì lại thêm thứ phải vá. setTimeout tính tới đúng 08:00 kế tiếp
 * rồi tự đặt lại — chịu được cả trường hợp máy ngủ qua đêm (lúc dậy sẽ chạy
 * ngay nếu đã quá giờ).
 */
const { ObjectId } = require('mongodb');

const DAY_MS = 86400000;

/** Mốc cảnh báo trước khi hết hạn, theo đúng đặc tả. */
const WARN_DAYS = [30, 7];

/** Phiếu chờ kích hoạt quá ngần này ngày thì nhắc. */
const PENDING_DAYS = 3;

/** 00:00 hôm nay theo giờ máy chủ — để so sánh theo NGÀY, không theo giây. */
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);

    return d;
}

/**
 * Quét một lượt. Tách riêng khỏi bộ hẹn giờ để test gọi thẳng được, và để có
 * endpoint chạy tay khi cần.
 *
 * @returns {Promise<{ expiring: Array, expired: number, pendingReminders: Array }>}
 */
async function runAssetMonitor(db, io = null, opts = {}) {
    const { verbose = true } = opts;
    const log = verbose ? (...a) => console.log('[assetMonitor]', ...a) : () => {};

    const digitalAssets = db.collection('digitalAssets');
    const assignments = db.collection('assetAssignments');
    const auditLogs = db.collection('assetAuditLogs');

    const today = startOfToday();
    const now = new Date();

    // --- 1. Sắp hết hạn -----------------------------------------------------
    const horizon = new Date(today.getTime() + Math.max(...WARN_DAYS) * DAY_MS);
    const soon = await digitalAssets.find({
        expiryDate: { $ne: null, $lte: horizon },
        status: { $nin: ['archived', 'expired'] },
    }).toArray();

    const expiring = [];
    for (const d of soon) {
        const days = Math.ceil((new Date(d.expiryDate) - today) / DAY_MS);
        if (days < 0) continue; // đã quá hạn, xử lý ở bước 2

        // Chỉ bắn đúng vào mốc 30 và 7 ngày, không spam mỗi ngày trong suốt tháng
        if (!WARN_DAYS.includes(days)) continue;

        expiring.push({
            id: String(d._id),
            name: d.name,
            provider: d.provider,
            daysLeft: days,
            expiryDate: d.expiryDate,
            ownerId: String(d.ownerId),
            autoRenew: !!d.autoRenew,
        });

        if (io) {
            io.to(`user_${String(d.ownerId)}`).emit('asset_notification', {
                title: `Bản quyền sắp hết hạn (còn ${days} ngày)`,
                lines: [
                    `${d.name} — ${d.provider}`,
                    `Hết hạn: ${new Date(d.expiryDate).toLocaleDateString('vi-VN')}`,
                    d.autoRenew ? 'Tự động gia hạn: BẬT' : 'Tự động gia hạn: TẮT — cần xử lý thủ công',
                ],
                severity: days <= 7 ? 'error' : 'warning',
                createdAt: now,
            });
        }
    }

    // --- 2. Quá hạn và không tự gia hạn -> expired --------------------------
    const overdue = await digitalAssets.find({
        expiryDate: { $ne: null, $lt: today },
        autoRenew: false,
        status: { $nin: ['expired', 'archived'] },
    }).toArray();

    let expiredCount = 0;
    for (const d of overdue) {
        await digitalAssets.updateOne(
            { _id: d._id },
            { $set: { status: 'expired', updatedAt: now } },
        );
        await auditLogs.insertOne({
            assetId: d._id,
            assetKind: 'digital',
            action: 'STATUS_CHANGE',
            actorId: null,
            actorName: 'Hệ thống (cron)',
            details: `Quá hạn ${new Date(d.expiryDate).toLocaleDateString('vi-VN')}, `
                + 'autoRenew tắt -> chuyển sang expired',
            snapshot: { from: d.status, to: 'expired' },
            createdAt: now,
        });
        expiredCount += 1;

        if (io) {
            io.to(`user_${String(d.ownerId)}`).emit('asset_notification', {
                title: 'Bản quyền đã hết hạn',
                lines: [`${d.name} — ${d.provider}`, 'Trạng thái đã chuyển sang "expired".'],
                severity: 'error',
                createdAt: now,
            });
        }
    }

    // --- 3. Phiếu chờ kích hoạt quá hạn -------------------------------------
    const pendingCutoff = new Date(now.getTime() - PENDING_DAYS * DAY_MS);
    const stale = await assignments.find({
        status: 'pending_activation',
        createdAt: { $lte: pendingCutoff },
    }).toArray();

    const pendingReminders = stale.map((a) => ({
        assignmentId: String(a._id),
        employeeId: String(a.employeeId),
        employeeName: a.employeeName,
        waitingDays: Math.floor((now - new Date(a.createdAt)) / DAY_MS),
    }));

    if (io) {
        for (const r of pendingReminders) {
            io.to(`user_${r.employeeId}`).emit('asset_notification', {
                title: 'Bạn có tài sản chờ xác nhận',
                lines: [
                    `Phiếu cấp phát đã chờ ${r.waitingDays} ngày.`,
                    'Mở trang Tài sản và bấm "Xác nhận đã nhận & kích hoạt".',
                ],
                severity: 'warning',
                createdAt: now,
            });
        }
    }

    log(
        `sắp hết hạn: ${expiring.length} · chuyển expired: ${expiredCount} · `
        + `nhắc kích hoạt: ${pendingReminders.length}`,
    );

    return { expiring, expired: expiredCount, pendingReminders, ranAt: now };
}

/**
 * Hẹn giờ chạy hằng ngày vào `hour`:00 giờ máy chủ.
 *
 * Dùng setTimeout tính tới mốc kế tiếp rồi tự đặt lại, thay vì setInterval 24h:
 * setInterval trôi dần theo thời gian xử lý và lệch hẳn sau khi máy ngủ/thức.
 *
 * @returns {{ stop: () => void }}
 */
function scheduleAssetMonitor(db, io, { hour = 8, verbose = true } = {}) {
    let timer = null;
    let stopped = false;

    const msUntilNextRun = () => {
        const next = new Date();
        next.setHours(hour, 0, 0, 0);
        if (next <= new Date()) next.setDate(next.getDate() + 1);

        return next - new Date();
    };

    const tick = async () => {
        if (stopped) return;

        try {
            await runAssetMonitor(db, io, { verbose });
        } catch (err) {
            // Cron hỏng không được làm sập server
            console.error('[assetMonitor] lỗi khi quét:', err.message);
        }
        if (!stopped) timer = setTimeout(tick, msUntilNextRun());
    };

    const wait = msUntilNextRun();
    timer = setTimeout(tick, wait);

    if (verbose) {
        const hrs = Math.floor(wait / 3600000);
        const mins = Math.round((wait % 3600000) / 60000);
        console.log(`  Cron tài sản: chạy lúc ${String(hour).padStart(2, '0')}:00 (sau ${hrs}h${mins}p nữa)`);
    }

    return {
        stop: () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        },
    };
}

module.exports = { runAssetMonitor, scheduleAssetMonitor, WARN_DAYS, PENDING_DAYS };
