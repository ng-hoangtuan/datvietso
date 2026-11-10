-- ==============================================================================
-- DATABASE SCHEMA TOÀN DIỆN CHO DATVIETSO
-- Phân hệ: 
--   1. Nhân sự & Tổ chức (HRM & Organization Core)
--   2. Quản lý tài sản (Physical & Digital Asset Management)
--   3. Trò chuyện & Chat Realtime (Chat System)
--   4. Quản lý dự án & công việc (Kanban Board & Tasks)
--   5. Lịch biểu & Cuộc họp (Calendar & Events)
--   6. Quản trị quan hệ khách hàng & Bán hàng (CRM & Sales Pipeline)
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Tự động dọn dẹp các bảng cũ (nếu có từ lần chạy dở dang) để tránh xung đột khóa ngoại
DROP TABLE IF EXISTS `crm_activities`;
DROP TABLE IF EXISTS `crm_deals`;
DROP TABLE IF EXISTS `crm_leads`;
DROP TABLE IF EXISTS `crm_contacts`;
DROP TABLE IF EXISTS `crm_customers`;

DROP TABLE IF EXISTS `calendar_event_reminders`;
DROP TABLE IF EXISTS `calendar_event_attendees`;
DROP TABLE IF EXISTS `calendar_events`;
DROP TABLE IF EXISTS `calendar_categories`;

DROP TABLE IF EXISTS `kanban_card_attachments`;
DROP TABLE IF EXISTS `kanban_card_comments`;
DROP TABLE IF EXISTS `kanban_card_checklists`;
DROP TABLE IF EXISTS `kanban_card_tags`;
DROP TABLE IF EXISTS `kanban_card_assignees`;
DROP TABLE IF EXISTS `kanban_cards`;
DROP TABLE IF EXISTS `kanban_tags`;
DROP TABLE IF EXISTS `kanban_columns`;
DROP TABLE IF EXISTS `kanban_board_members`;
DROP TABLE IF EXISTS `kanban_boards`;

DROP TABLE IF EXISTS `MessageReactions`;
DROP TABLE IF EXISTS `Messages`;
DROP TABLE IF EXISTS `GroupMembers`;
DROP TABLE IF EXISTS `Conversations`;

DROP TABLE IF EXISTS `asset_audit_logs`;
DROP TABLE IF EXISTS `asset_maintenances`;
DROP TABLE IF EXISTS `asset_allocations`;
DROP TABLE IF EXISTS `assets`;

DROP TABLE IF EXISTS `leave_requests`;
DROP TABLE IF EXISTS `attendances`;
DROP TABLE IF EXISTS `employees`;
DROP TABLE IF EXISTS `positions`;
DROP TABLE IF EXISTS `departments`;
DROP TABLE IF EXISTS `users`;

-- ------------------------------------------------------------------------------
-- PHẦN 1: NHÂN SỰ & HỆ THỐNG TÀI KHOẢN CỐT LÕI (HRM & CORE USERS)
-- ------------------------------------------------------------------------------

-- 1.1 Bảng Tài khoản người dùng (users)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(25) NULL,
  `avatar` VARCHAR(500) NULL,
  `role` ENUM('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'EMPLOYEE') NOT NULL DEFAULT 'EMPLOYEE',
  `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_users_email` (`email`),
  INDEX `idx_users_role` (`role`),
  INDEX `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.2 Bảng Phòng ban (departments)
CREATE TABLE IF NOT EXISTS `departments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã phòng ban (BGD, TECH, SALES, HR...)',
  `name` VARCHAR(150) NOT NULL COMMENT 'Tên phòng ban',
  `parent_id` INT NULL COMMENT 'Phòng ban cấp trên (nếu có cây phòng ban)',
  `manager_id` INT NULL COMMENT 'ID của Trưởng phòng',
  `description` TEXT NULL COMMENT 'Mô tả chức năng nhiệm vụ',
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_dept_parent` FOREIGN KEY (`parent_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_dept_manager` FOREIGN KEY (`manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_dept_code` (`code`),
  INDEX `idx_dept_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.3 Bảng Chức danh / Vị trí công việc (positions)
CREATE TABLE IF NOT EXISTS `positions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã chức vụ (CEO, DEV_SR, SALES_EXEC...)',
  `title` VARCHAR(150) NOT NULL COMMENT 'Tên chức danh',
  `department_id` INT NULL COMMENT 'Thuộc phòng ban nào',
  `level` VARCHAR(50) NULL COMMENT 'Cấp bậc (Intern, Junior, Senior, Leader, Manager)',
  `description` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_pos_dept` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL,
  INDEX `idx_pos_dept` (`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.4 Bảng Hồ sơ nhân viên (employees)
CREATE TABLE IF NOT EXISTS `employees` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL UNIQUE COMMENT 'Liên kết với tài khoản đăng nhập users',
  `employee_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã nhân sự (DVS-001, DVS-002...)',
  `department_id` INT NOT NULL COMMENT 'Phòng ban',
  `position_id` INT NOT NULL COMMENT 'Chức danh đảm nhiệm',
  `direct_manager_id` INT NULL COMMENT 'Người quản lý trực tiếp',
  `gender` ENUM('MALE', 'FEMALE', 'OTHER') NOT NULL DEFAULT 'MALE',
  `date_of_birth` DATE NULL,
  `id_card_number` VARCHAR(30) NULL COMMENT 'CCCD / CMND',
  `join_date` DATE NOT NULL COMMENT 'Ngày vào công ty',
  `contract_type` ENUM('PROBATION', 'OFFICIAL_1Y', 'OFFICIAL_3Y', 'INDEFINITE', 'INTERNSHIP') NOT NULL DEFAULT 'OFFICIAL_1Y',
  `base_salary` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `bank_account_number` VARCHAR(50) NULL,
  `bank_name` VARCHAR(100) NULL,
  `address` TEXT NULL,
  `emergency_contact` JSON NULL COMMENT 'Thông tin người thân {name, phone, relation}',
  `status` ENUM('PROBATION', 'WORKING', 'ON_LEAVE', 'RESIGNED') NOT NULL DEFAULT 'WORKING',
  `resigned_date` DATE NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_emp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_emp_dept` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_emp_pos` FOREIGN KEY (`position_id`) REFERENCES `positions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_emp_manager` FOREIGN KEY (`direct_manager_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  INDEX `idx_emp_code` (`employee_code`),
  INDEX `idx_emp_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.5 Bảng Chấm công (attendances)
CREATE TABLE IF NOT EXISTS `attendances` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `employee_id` INT NOT NULL,
  `date` DATE NOT NULL,
  `check_in` TIME NULL,
  `check_out` TIME NULL,
  `status` ENUM('ON_TIME', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'HOLIDAY', 'WEEKEND') NOT NULL DEFAULT 'ON_TIME',
  `work_hours` DECIMAL(4,2) NOT NULL DEFAULT 8.0,
  `note` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_att_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_emp_date` (`employee_id`, `date`),
  INDEX `idx_att_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1.6 Bảng Đơn xin nghỉ phép (leave_requests)
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `employee_id` INT NOT NULL,
  `leave_type` ENUM('ANNUAL', 'SICK', 'UNPAID', 'MATERNITY', 'COMPENSATORY') NOT NULL DEFAULT 'ANNUAL',
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `total_days` DECIMAL(4,1) NOT NULL DEFAULT 1.0,
  `reason` TEXT NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `approved_by` INT NULL COMMENT 'User ID duyệt đơn',
  `approved_at` DATETIME NULL,
  `reject_reason` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_leave_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_leave_approver` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_leave_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ------------------------------------------------------------------------------
-- PHẦN 2: QUẢN LÝ TÀI SẢN (ASSET MANAGEMENT - VẬT LÝ & KỸ THUẬT SỐ)
-- ------------------------------------------------------------------------------

-- 2.1 Bảng Tài sản (assets) - Tương thích hoàn toàn với schema hiện tại
CREATE TABLE IF NOT EXISTS `assets` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_kind` ENUM('PHYSICAL', 'DIGITAL') NOT NULL DEFAULT 'PHYSICAL' COMMENT 'Phân loại vật lý hay license số',
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã tài sản (TS-PHY-001, TS-DIG-001...)',
  `name` VARCHAR(255) NOT NULL COMMENT 'Tên tài sản',
  `category` VARCHAR(100) NOT NULL COMMENT 'Danh mục (Laptop, Màn hình, Bản quyền Canva...)',
  `status` ENUM(
    'AVAILABLE',            -- Sẵn sàng cấp phát
    'PENDING_ACTIVATION',   -- Đang chờ kích hoạt
    'ACTIVE',               -- Đang được sử dụng
    'MAINTENANCE',          -- Đang bảo trì
    'SUSPENDED',            -- Tạm khóa
    'REVOKED',              -- Đã thu hồi
    'EXPIRED',              -- Hết hạn bản quyền
    'LIQUIDATED'            -- Đã thanh lý
  ) NOT NULL DEFAULT 'AVAILABLE',
  `manager` VARCHAR(100) NULL COMMENT 'Người phụ trách quản lý',
  `purchase_cost` DECIMAL(15,2) NULL DEFAULT 0 COMMENT 'Nguyên giá mua vào',
  `purchase_date` DATE NULL COMMENT 'Ngày mua',
  `warranty_months` INT NULL DEFAULT 12 COMMENT 'Số tháng bảo hành',
  `supplier` VARCHAR(150) NULL COMMENT 'Nhà cung cấp',
  `physical_meta` JSON NULL COMMENT 'Serial number, model, vị trí phòng ban...',
  `metadata` JSON NULL COMMENT 'Lưu trữ digital: provider, license_key, seats...',
  `provider` VARCHAR(100) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.provider'))) VIRTUAL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_asset_kind` (`asset_kind`),
  INDEX `idx_asset_status` (`status`),
  INDEX `idx_asset_provider` (`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.2 Bảng Bàn giao & Thu hồi tài sản (asset_allocations)
CREATE TABLE IF NOT EXISTS `asset_allocations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_id` INT NOT NULL COMMENT 'ID tài sản',
  `employee_id` INT NULL COMMENT 'Liên kết hồ sơ nhân sự (nếu có)',
  `employee_name` VARCHAR(100) NOT NULL COMMENT 'Họ tên nhân sự nhận',
  `employee_email` VARCHAR(100) NOT NULL COMMENT 'Email nhân sự',
  `department` VARCHAR(100) NOT NULL COMMENT 'Phòng ban',
  `allocated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Ngày cấp phát',
  `revoked_at` DATETIME NULL COMMENT 'Ngày thu hồi',
  `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `allocated_by` INT NULL COMMENT 'ID Admin/IT cấp',
  `revoked_by` INT NULL COMMENT 'ID Admin/IT thu hồi',
  `handover_condition` TEXT NULL COMMENT 'Tình trạng khi bàn giao',
  `return_condition` TEXT NULL COMMENT 'Tình trạng khi thu hồi',
  `note` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_alloc_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_alloc_emp` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE SET NULL,
  INDEX `idx_alloc_asset_id` (`asset_id`),
  INDEX `idx_alloc_status` (`status`),
  INDEX `idx_alloc_email` (`employee_email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.3 Bảng Bảo dưỡng & Sửa chữa tài sản (asset_maintenances)
CREATE TABLE IF NOT EXISTS `asset_maintenances` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_id` INT NOT NULL,
  `maintenance_type` ENUM('ROUTINE', 'REPAIR', 'UPGRADE', 'WARRANTY') NOT NULL DEFAULT 'ROUTINE',
  `cost` DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Chi phí sửa chữa/bảo dưỡng',
  `performed_by` VARCHAR(150) NULL COMMENT 'Đơn vị thực hiện',
  `start_date` DATE NOT NULL,
  `completion_date` DATE NULL,
  `status` ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  `note` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_maint_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  INDEX `idx_maint_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2.4 Bảng Audit Logs vòng đời tài sản (asset_audit_logs)
CREATE TABLE IF NOT EXISTS `asset_audit_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `asset_id` INT NOT NULL,
  `action` ENUM('CREATE', 'UPDATE', 'ALLOCATE', 'REVOKE', 'STATUS_CHANGE', 'MAINTENANCE', 'VIEW_SECRET') NOT NULL,
  `actor_name` VARCHAR(100) NOT NULL,
  `details` TEXT NULL,
  `snapshot` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_audit_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`) ON DELETE CASCADE,
  INDEX `idx_audit_asset_id` (`asset_id`),
  INDEX `idx_audit_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ------------------------------------------------------------------------------
-- PHẦN 3: HỆ THỐNG TRÒ CHUYỆN REALTIME (CHAT SYSTEM)
-- Tương thích 100% với backend/routes/chat.js
-- ------------------------------------------------------------------------------

-- 3.1 Bảng Hội thoại (Conversations)
CREATE TABLE IF NOT EXISTS `Conversations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` ENUM('direct', 'group') NOT NULL DEFAULT 'direct',
  `name` VARCHAR(255) NULL COMMENT 'Tên nhóm chat',
  `avatar` VARCHAR(500) NULL,
  `pinned_by` JSON NULL COMMENT 'Mảng user_id đã ghim: [1, 2]',
  `created_by` VARCHAR(100) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_conv_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.2 Bảng Thành viên hội thoại (GroupMembers)
CREATE TABLE IF NOT EXISTS `GroupMembers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` INT NOT NULL,
  `user_id` VARCHAR(100) NOT NULL,
  `user_name` VARCHAR(100) NOT NULL,
  `avatar` VARCHAR(500) NULL,
  `role` ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member',
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_group_conversation` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_conv_user` (`conversation_id`, `user_id`),
  INDEX `idx_gm_user` (`user_id`),
  INDEX `idx_gm_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.3 Bảng Tin nhắn (Messages)
CREATE TABLE IF NOT EXISTS `Messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` INT NOT NULL,
  `sender_id` VARCHAR(100) NOT NULL,
  `sender_name` VARCHAR(100) NULL,
  `sender_avatar` VARCHAR(500) NULL,
  `type` ENUM('text', 'media', 'location', 'file') NOT NULL DEFAULT 'text',
  `content` TEXT NULL,
  `metadata` JSON NULL COMMENT 'URL file, mimetype, toạ độ lat/lng, reply_to_id...',
  `deleted_at` DATETIME NULL COMMENT 'Xóa mềm',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_msg_conv` FOREIGN KEY (`conversation_id`) REFERENCES `Conversations` (`id`) ON DELETE CASCADE,
  INDEX `idx_msg_conv` (`conversation_id`),
  INDEX `idx_msg_sender` (`sender_id`),
  INDEX `idx_msg_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3.4 Bảng Thả cảm xúc tin nhắn (MessageReactions)
CREATE TABLE IF NOT EXISTS `MessageReactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `message_id` INT NOT NULL,
  `user_id` VARCHAR(100) NOT NULL,
  `reaction` VARCHAR(20) NOT NULL COMMENT 'like, love, haha, wow, sad, angry',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_react_msg` FOREIGN KEY (`message_id`) REFERENCES `Messages` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_msg_user_react` (`message_id`, `user_id`, `reaction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ------------------------------------------------------------------------------
-- PHẦN 4: QUẢN LÝ DỰ ÁN & TIẾN ĐỘ THEO KANBAN (KANBAN BOARD & TASKS)
-- ------------------------------------------------------------------------------

-- 4.1 Bảng Bảng Kanban (kanban_boards)
CREATE TABLE IF NOT EXISTS `kanban_boards` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(150) NOT NULL COMMENT 'Tên bảng dự án (VD: Phát triển Website, Tuyển dụng...)',
  `description` TEXT NULL,
  `color` VARCHAR(20) NOT NULL DEFAULT '#7367F0',
  `icon` VARCHAR(50) NOT NULL DEFAULT 'tabler-layout-kanban',
  `department_id` INT NULL COMMENT 'Thuộc phòng ban nào (nếu có)',
  `owner_id` INT NOT NULL COMMENT 'Người tạo / Chủ trì dự án',
  `is_private` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Riêng tư hay công khai cho toàn công ty',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_kb_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kb_dept` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.2 Bảng Thành viên bảng Kanban (kanban_board_members)
CREATE TABLE IF NOT EXISTS `kanban_board_members` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `board_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `role` ENUM('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') NOT NULL DEFAULT 'MEMBER',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_kbm_board` FOREIGN KEY (`board_id`) REFERENCES `kanban_boards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kbm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_board_user` (`board_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.3 Bảng Cột quy trình (kanban_columns)
CREATE TABLE IF NOT EXISTS `kanban_columns` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `board_id` INT NOT NULL,
  `title` VARCHAR(100) NOT NULL COMMENT 'Tên cột: Cần làm (To Do), Đang làm (In Progress)...',
  `color` VARCHAR(20) NOT NULL DEFAULT '#A8AAAE',
  `position` INT NOT NULL DEFAULT 0 COMMENT 'Thứ tự hiển thị cột',
  `wip_limit` INT NOT NULL DEFAULT 0 COMMENT 'Giới hạn số thẻ đang làm cùng lúc (0 = không giới hạn)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_col_board` FOREIGN KEY (`board_id`) REFERENCES `kanban_boards` (`id`) ON DELETE CASCADE,
  INDEX `idx_col_pos` (`board_id`, `position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.4 Bảng Nhãn / Tag công việc (kanban_tags)
CREATE TABLE IF NOT EXISTS `kanban_tags` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `board_id` INT NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `color` VARCHAR(20) NOT NULL DEFAULT '#7367F0',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_tag_board` FOREIGN KEY (`board_id`) REFERENCES `kanban_boards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.5 Bảng Thẻ công việc (kanban_cards)
CREATE TABLE IF NOT EXISTS `kanban_cards` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `board_id` INT NOT NULL,
  `column_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL COMMENT 'Tiêu đề công việc',
  `description` LONGTEXT NULL COMMENT 'Mô tả chi tiết',
  `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
  `start_date` DATE NULL,
  `due_date` DATE NULL COMMENT 'Hạn chót hoàn thành',
  `estimated_hours` DECIMAL(5,1) NOT NULL DEFAULT 0,
  `actual_hours` DECIMAL(5,1) NOT NULL DEFAULT 0,
  `position` INT NOT NULL DEFAULT 0 COMMENT 'Vị trí thứ tự thẻ trong cột',
  `is_completed` BOOLEAN NOT NULL DEFAULT FALSE,
  `completed_at` DATETIME NULL,
  `created_by` INT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_card_board` FOREIGN KEY (`board_id`) REFERENCES `kanban_boards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_card_col` FOREIGN KEY (`column_id`) REFERENCES `kanban_columns` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_card_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `idx_card_col_pos` (`column_id`, `position`),
  INDEX `idx_card_priority` (`priority`),
  INDEX `idx_card_due_date` (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.6 Bảng Người được giao việc (kanban_card_assignees)
CREATE TABLE IF NOT EXISTS `kanban_card_assignees` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `card_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_kca_card` FOREIGN KEY (`card_id`) REFERENCES `kanban_cards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kca_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_card_assignee` (`card_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.7 Bảng Gán nhãn cho thẻ (kanban_card_tags)
CREATE TABLE IF NOT EXISTS `kanban_card_tags` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `card_id` INT NOT NULL,
  `tag_id` INT NOT NULL,
  CONSTRAINT `fk_kct_card` FOREIGN KEY (`card_id`) REFERENCES `kanban_cards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kct_tag` FOREIGN KEY (`tag_id`) REFERENCES `kanban_tags` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_card_tag` (`card_id`, `tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.8 Bảng Danh sách mục con / Checklist (kanban_card_checklists)
CREATE TABLE IF NOT EXISTS `kanban_card_checklists` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `card_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `is_completed` BOOLEAN NOT NULL DEFAULT FALSE,
  `position` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_kcl_card` FOREIGN KEY (`card_id`) REFERENCES `kanban_cards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.9 Bảng Bình luận trên thẻ (kanban_card_comments)
CREATE TABLE IF NOT EXISTS `kanban_card_comments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `card_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_kcc_card` FOREIGN KEY (`card_id`) REFERENCES `kanban_cards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kcc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4.10 Bảng Tệp đính kèm thẻ (kanban_card_attachments)
CREATE TABLE IF NOT EXISTS `kanban_card_attachments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `card_id` INT NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_url` VARCHAR(500) NOT NULL,
  `file_size` INT NOT NULL DEFAULT 0,
  `file_type` VARCHAR(50) NULL,
  `uploaded_by` INT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_kca_file_card` FOREIGN KEY (`card_id`) REFERENCES `kanban_cards` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kca_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ------------------------------------------------------------------------------
-- PHẦN 5: LỊCH BIỂU, CUỘC HỌP & SỰ KIỆN (CALENDAR & EVENTS)
-- ------------------------------------------------------------------------------

-- 5.1 Bảng Phân loại lịch biểu (calendar_categories)
CREATE TABLE IF NOT EXISTS `calendar_categories` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL COMMENT 'Họp nội bộ, Họp khách hàng, Phỏng vấn, Nghỉ phép, Sinh nhật...',
  `color` VARCHAR(20) NOT NULL DEFAULT '#7367F0',
  `description` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.2 Bảng Sự kiện lịch (calendar_events)
CREATE TABLE IF NOT EXISTS `calendar_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `category_id` INT NULL,
  `start_time` DATETIME NOT NULL,
  `end_time` DATETIME NOT NULL,
  `is_all_day` BOOLEAN NOT NULL DEFAULT FALSE,
  `location` VARCHAR(255) NULL COMMENT 'Phòng họp 1, Văn phòng tầng 3, ...',
  `meeting_url` VARCHAR(500) NULL COMMENT 'Link Google Meet / Zoom / MS Teams',
  `recurrence_rule` ENUM('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') NOT NULL DEFAULT 'NONE',
  `recurrence_end` DATE NULL,
  `related_type` ENUM('NONE', 'KANBAN_CARD', 'CRM_DEAL', 'CRM_CUSTOMER', 'ASSET_MAINTENANCE') NOT NULL DEFAULT 'NONE',
  `related_id` INT NULL COMMENT 'Liên kết id của bảng tương ứng',
  `created_by` INT NOT NULL COMMENT 'User tạo lịch',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_event_cat` FOREIGN KEY (`category_id`) REFERENCES `calendar_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_event_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_event_time` (`start_time`, `end_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.3 Bảng Người tham gia cuộc họp/sự kiện (calendar_event_attendees)
CREATE TABLE IF NOT EXISTS `calendar_event_attendees` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `status` ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE') NOT NULL DEFAULT 'PENDING',
  `response_note` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_att_event` FOREIGN KEY (`event_id`) REFERENCES `calendar_events` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_event_attendee` (`event_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5.4 Bảng Nhắc nhở sự kiện (calendar_event_reminders)
CREATE TABLE IF NOT EXISTS `calendar_event_reminders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_id` INT NOT NULL,
  `remind_before_minutes` INT NOT NULL DEFAULT 15 COMMENT 'Nhắc trước bao nhiêu phút (15, 30, 60, 1440...)',
  `channel` ENUM('IN_APP', 'EMAIL', 'CHAT') NOT NULL DEFAULT 'IN_APP',
  `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_remind_event` FOREIGN KEY (`event_id`) REFERENCES `calendar_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ------------------------------------------------------------------------------
-- PHẦN 6: QUẢN HỆ KHÁCH HÀNG & BÁN HÀNG (CRM & SALES PIPELINE)
-- ------------------------------------------------------------------------------

-- 6.1 Bảng Khách hàng (crm_customers)
CREATE TABLE IF NOT EXISTS `crm_customers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã khách hàng (KH-001...)',
  `company_name` VARCHAR(200) NOT NULL COMMENT 'Tên doanh nghiệp hoặc tên cá nhân',
  `contact_name` VARCHAR(100) NULL COMMENT 'Người đại diện giao dịch chính',
  `email` VARCHAR(100) NULL,
  `phone` VARCHAR(30) NULL,
  `tax_code` VARCHAR(50) NULL COMMENT 'Mã số thuế doanh nghiệp',
  `address` TEXT NULL,
  `website` VARCHAR(255) NULL,
  `industry` VARCHAR(100) NULL COMMENT 'Lĩnh vực kinh doanh (Bất động sản, Bán lẻ, IT...)',
  `customer_type` ENUM('ENTERPRISE', 'SME', 'INDIVIDUAL') NOT NULL DEFAULT 'ENTERPRISE',
  `customer_tier` ENUM('STANDARD', 'SILVER', 'GOLD', 'VIP') NOT NULL DEFAULT 'STANDARD',
  `assigned_to` INT NULL COMMENT 'Nhân sự phụ trách chăm sóc',
  `status` ENUM('PROSPECT', 'ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_cust_assigned` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  INDEX `idx_cust_code` (`code`),
  INDEX `idx_cust_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.2 Bảng Danh bạ người liên hệ thuộc khách hàng (crm_contacts)
CREATE TABLE IF NOT EXISTS `crm_contacts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `position` VARCHAR(100) NULL COMMENT 'Chức danh (Giám đốc, TP Mua hàng...)',
  `phone` VARCHAR(30) NULL,
  `email` VARCHAR(100) NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Liên hệ chính',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_contact_cust` FOREIGN KEY (`customer_id`) REFERENCES `crm_customers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.3 Bảng Khách hàng tiềm năng (crm_leads)
CREATE TABLE IF NOT EXISTS `crm_leads` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(100) NOT NULL,
  `company` VARCHAR(150) NULL,
  `email` VARCHAR(100) NULL,
  `phone` VARCHAR(30) NULL,
  `source` ENUM('WEBSITE', 'FACEBOOK', 'GOOGLE_ADS', 'REFERRAL', 'EVENT', 'COLD_CALL', 'OTHER') NOT NULL DEFAULT 'WEBSITE',
  `estimated_budget` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `status` ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED') NOT NULL DEFAULT 'NEW',
  `assigned_to` INT NULL COMMENT 'Nhân sự Sales phụ trách',
  `converted_customer_id` INT NULL COMMENT 'Sau khi chốt thì chuyển đổi sang khách hàng chính thức',
  `note` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_lead_assigned` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_lead_cust` FOREIGN KEY (`converted_customer_id`) REFERENCES `crm_customers` (`id`) ON DELETE SET NULL,
  INDEX `idx_lead_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.4 Bảng Cơ hội bán hàng / Phễu giao dịch (crm_deals)
CREATE TABLE IF NOT EXISTS `crm_deals` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT NOT NULL,
  `lead_id` INT NULL,
  `deal_name` VARCHAR(200) NOT NULL COMMENT 'Tên cơ hội / Dự án bán lẻ / Hợp đồng',
  `deal_value` DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'Giá trị dự kiến',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'VND',
  `pipeline_stage` ENUM('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST') NOT NULL DEFAULT 'DISCOVERY',
  `probability` INT NOT NULL DEFAULT 20 COMMENT 'Tỷ lệ chốt thành công %',
  `expected_close_date` DATE NULL,
  `actual_close_date` DATE NULL,
  `assigned_to` INT NOT NULL COMMENT 'Nhân viên chốt deal',
  `lost_reason` VARCHAR(255) NULL,
  `note` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_deal_cust` FOREIGN KEY (`customer_id`) REFERENCES `crm_customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deal_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_deal_assigned` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  INDEX `idx_deal_stage` (`pipeline_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6.5 Bảng Nhật ký tương tác & Hoạt động chăm sóc (crm_activities)
CREATE TABLE IF NOT EXISTS `crm_activities` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_id` INT NULL,
  `deal_id` INT NULL,
  `lead_id` INT NULL,
  `activity_type` ENUM('CALL', 'MEETING', 'EMAIL', 'NOTE', 'TASK') NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `scheduled_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `performed_by` INT NOT NULL COMMENT 'Nhân sự thực hiện',
  `status` ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_act_cust` FOREIGN KEY (`customer_id`) REFERENCES `crm_customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_act_deal` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_act_lead` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_act_performer` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  INDEX `idx_act_type` (`activity_type`),
  INDEX `idx_act_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
