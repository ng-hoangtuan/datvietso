-- Migration: Create Unified Asset Management Schema (Physical & Digital)
-- Generated for DatVietSo IT & Asset Management

-- 1. Bảng chính: assets (Hỗ trợ cả Physical và Digital Assets qua Hybrid Schema)
CREATE TABLE IF NOT EXISTS `assets` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_kind` ENUM('PHYSICAL', 'DIGITAL') NOT NULL DEFAULT 'PHYSICAL' COMMENT 'Phân loại tài sản',
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã định danh (VD: TS-PHY-001, TS-DIG-001)',
  `name` VARCHAR(255) NOT NULL COMMENT 'Tên hiển thị tài sản',
  `category` VARCHAR(100) NOT NULL COMMENT 'Danh mục',
  `status` ENUM(
    'AVAILABLE',            -- Sẵn sàng cấp phát
    'PENDING_ACTIVATION',   -- Đang chờ kích hoạt
    'ACTIVE',               -- Đang được sử dụng
    'MAINTENANCE',          -- Đang bảo trì (thiết bị)
    'SUSPENDED',            -- Tạm khóa
    'REVOKED',              -- Đã thu hồi
    'EXPIRED',              -- Hết hạn bản quyền
    'LIQUIDATED'            -- Đã thanh lý
  ) NOT NULL DEFAULT 'AVAILABLE',
  `manager` VARCHAR(100) NULL COMMENT 'Người phụ trách / Lead',
  `physical_meta` JSON NULL COMMENT 'Serial number, model, location, condition',
  `metadata` JSON NULL COMMENT 'Lưu trữ linh hoạt digital attributes: provider, license_key, username, total_seats, expires_at...',
  
  -- Virtual Generated Column giúp index và lọc provider cực nhanh
  `provider` VARCHAR(100) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.provider'))) VIRTUAL,
  
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX `idx_asset_kind` (`asset_kind`),
  INDEX `idx_asset_status` (`status`),
  INDEX `idx_asset_provider` (`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 2. Bảng trung gian: asset_allocations (Quan hệ cấp phát linh hoạt 1-1, 1-N seats, và M-N shared)
CREATE TABLE IF NOT EXISTS `asset_allocations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_id` INT NOT NULL COMMENT 'Liên kết bảng assets',
  `employee_name` VARCHAR(100) NOT NULL COMMENT 'Họ tên nhân sự nhận tài sản',
  `employee_email` VARCHAR(100) NOT NULL COMMENT 'Email nhân sự',
  `department` VARCHAR(100) NOT NULL COMMENT 'Phòng ban',
  `allocated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Ngày cấp phát',
  `revoked_at` DATETIME NULL COMMENT 'Ngày thu hồi (nếu có)',
  `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái cấp phát',
  `allocated_by` INT NULL COMMENT 'ID của Admin/IT thực hiện',
  `revoked_by` INT NULL COMMENT 'ID của Admin/IT thu hồi',
  `note` TEXT NULL COMMENT 'Ghi chú lý do cấp phát hoặc thu hồi',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  CONSTRAINT `fk_allocations_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  INDEX `idx_alloc_asset_id` (`asset_id`),
  INDEX `idx_alloc_status` (`status`),
  INDEX `idx_alloc_email` (`employee_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 3. Bảng audit logs: asset_audit_logs (Lịch sử truy vết vòng đời tài sản)
CREATE TABLE IF NOT EXISTS `asset_audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_id` INT NOT NULL,
  `action` ENUM('CREATE', 'UPDATE', 'ALLOCATE', 'REVOKE', 'STATUS_CHANGE', 'VIEW_SECRET') NOT NULL,
  `actor_name` VARCHAR(100) NOT NULL,
  `details` TEXT NULL,
  `snapshot` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT `fk_audit_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  INDEX `idx_audit_asset_id` (`asset_id`),
  INDEX `idx_audit_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

