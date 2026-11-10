-- Migration: Create Realtime Chat System Schema
-- DatVietSo - Materio Vuetify Chat

-- 1. Bảng Conversations (Direct Chat & Group Chat)
CREATE TABLE IF NOT EXISTS `Conversations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `type` ENUM('direct', 'group') NOT NULL DEFAULT 'direct',
  `name` VARCHAR(255) NULL COMMENT 'Tên nhóm (đối với group)',
  `avatar` VARCHAR(500) NULL COMMENT 'URL ảnh đại diện',
  `pinned_by` JSON NULL COMMENT 'Mảng user_id đã ghim cuộc trò chuyện này [user_1, user_2]',
  `created_by` VARCHAR(100) NULL COMMENT 'user_id người tạo nhóm',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_conv_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bảng GroupMembers (Quản lý thành viên & phân quyền: owner, admin, member)
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

-- 3. Bảng Messages (Văn bản, Media, Vị trí bản đồ, Xóa mềm)
CREATE TABLE IF NOT EXISTS `Messages` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` INT NOT NULL,
  `sender_id` VARCHAR(100) NOT NULL,
  `sender_name` VARCHAR(100) NULL,
  `sender_avatar` VARCHAR(500) NULL,
  `type` ENUM('text', 'media', 'location') NOT NULL DEFAULT 'text',
  `content` TEXT NULL,
  `metadata` JSON NULL COMMENT 'Chứa file url, mimetype, lat, lng, mentions...',
  `deleted_at` DATETIME NULL COMMENT 'Thời điểm xóa mềm',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_msg_conv` (`conversation_id`),
  INDEX `idx_msg_sender` (`sender_id`),
  INDEX `idx_msg_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

