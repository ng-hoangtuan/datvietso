-- ==============================================================================
-- SEED DATA MẪU TOÀN DIỆN CHO DATVIETSO
-- Cung cấp sẵn bộ dữ liệu mẫu thực tế cho 6 phân hệ
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. PHÒNG BAN & CHỨC DANH
INSERT INTO `departments` (`id`, `code`, `name`, `parent_id`, `description`, `status`) VALUES
(1, 'BGD', 'Ban Giám Đốc', NULL, 'Điều hành chiến lược toàn công ty', 'ACTIVE'),
(2, 'TECH', 'Khối Kỹ Thuật & Công Nghệ', 1, 'Phát triển phần mềm, hạ tầng & bảo mật', 'ACTIVE'),
(3, 'SALES', 'Khối Kinh Doanh & CRM', 1, 'Tư vấn giải pháp, bán hàng và chăm sóc khách hàng', 'ACTIVE'),
(4, 'HR', 'Phòng Hành Chính & Nhân Sự', 1, 'Quản lý nhân sự, chế độ đãi ngộ & văn hóa doanh nghiệp', 'ACTIVE')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

INSERT INTO `positions` (`id`, `code`, `title`, `department_id`, `level`, `description`) VALUES
(1, 'CEO', 'Tổng Giám Đốc', 1, 'Manager', 'Điều hành tổng thể'),
(2, 'TECH_LEAD', 'Trưởng Phòng Kỹ Thuật', 2, 'Leader', 'Quản lý team kỹ thuật & kiến trúc hệ thống'),
(3, 'SENIOR_DEV', 'Kỹ Sư Phần Mềm Cao Cấp', 2, 'Senior', 'Lập trình Fullstack & DevOps'),
(4, 'SALES_LEAD', 'Trưởng Phòng Kinh Doanh', 3, 'Leader', 'Chỉ đạo kinh doanh & đối ngoại'),
(5, 'HR_LEAD', 'Trưởng Phòng Nhân Sự', 4, 'Leader', 'Tuyển dụng & Đào tạo')
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 2. TÀI KHOẢN NGƯỜI DÙNG & HỒ SƠ NHÂN SỰ
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `full_name`, `phone`, `avatar`, `role`, `status`) VALUES
(1, 'admin', 'admin@datvietso.vn', '$2a$10$abcdefghijklmnopqrstuv', 'Nguyễn Quản Trị', '0901234567', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin', 'SUPER_ADMIN', 'ACTIVE'),
(2, 'tuan.dev', 'tuan.tech@datvietso.vn', '$2a$10$abcdefghijklmnopqrstuv', 'Trần Anh Tuấn', '0912345678', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tuan', 'EMPLOYEE', 'ACTIVE'),
(3, 'hoa.sales', 'hoa.sales@datvietso.vn', '$2a$10$abcdefghijklmnopqrstuv', 'Lê Thị Mai Hoa', '0923456789', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hoa', 'EMPLOYEE', 'ACTIVE'),
(4, 'lan.hr', 'lan.hr@datvietso.vn', '$2a$10$abcdefghijklmnopqrstuv', 'Phạm Ngọc Lan', '0934567890', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lan', 'HR_MANAGER', 'ACTIVE')
ON DUPLICATE KEY UPDATE `full_name`=VALUES(`full_name`);

UPDATE `departments` SET `manager_id` = 1 WHERE `id` = 1;
UPDATE `departments` SET `manager_id` = 2 WHERE `id` = 2;
UPDATE `departments` SET `manager_id` = 3 WHERE `id` = 3;
UPDATE `departments` SET `manager_id` = 4 WHERE `id` = 4;

INSERT INTO `employees` (`id`, `user_id`, `employee_code`, `department_id`, `position_id`, `direct_manager_id`, `gender`, `date_of_birth`, `id_card_number`, `join_date`, `contract_type`, `base_salary`, `status`) VALUES
(1, 1, 'DVS-001', 1, 1, NULL, 'MALE', '1988-05-15', '001088001234', '2023-01-01', 'INDEFINITE', 50000000, 'WORKING'),
(2, 2, 'DVS-002', 2, 3, 1, 'MALE', '1995-10-20', '001095002345', '2023-06-01', 'OFFICIAL_3Y', 25000000, 'WORKING'),
(3, 3, 'DVS-003', 3, 4, 1, 'FEMALE', '1996-08-12', '001096003456', '2023-08-15', 'OFFICIAL_3Y', 22000000, 'WORKING'),
(4, 4, 'DVS-004', 4, 5, 1, 'FEMALE', '1994-03-25', '001094004567', '2023-03-10', 'INDEFINITE', 20000000, 'WORKING')
ON DUPLICATE KEY UPDATE `employee_code`=VALUES(`employee_code`);

-- 3. QUẢN LÝ TÀI SẢN (ASSETS)
INSERT INTO `assets` (`id`, `asset_kind`, `code`, `name`, `category`, `status`, `manager`, `purchase_cost`, `purchase_date`, `warranty_months`, `supplier`, `physical_meta`, `metadata`) VALUES
(1, 'PHYSICAL', 'TS-PHY-001', 'MacBook Pro 16 inch M3 Pro', 'Laptop', 'ACTIVE', 'Admin', 62000000, '2024-01-15', 24, 'ShopDunk', JSON_OBJECT('serial', 'C02G998877', 'model', 'MacBook Pro 16', 'color', 'Space Black'), NULL),
(2, 'PHYSICAL', 'TS-PHY-002', 'Màn hình Dell UltraSharp U2723QE 4K', 'Màn hình', 'ACTIVE', 'Admin', 13500000, '2024-02-10', 36, 'Hacom', JSON_OBJECT('serial', 'CN-05X992', 'screen_size', '27 inch 4K'), NULL),
(3, 'DIGITAL', 'TS-DIG-001', 'GitHub Enterprise Cloud', 'Bản quyền phần mềm', 'ACTIVE', 'Trần Anh Tuấn', 4800000, '2024-01-01', 12, 'GitHub Inc.', NULL, JSON_OBJECT('provider', 'GitHub', 'plan', 'Enterprise', 'total_seats', 20, 'assigned_seats', 15)),
(4, 'DIGITAL', 'TS-DIG-002', 'Canva Teams Business Pro', 'Bản quyền đồ họa', 'ACTIVE', 'Lê Thị Mai Hoa', 3500000, '2024-03-01', 12, 'Canva Pty Ltd', NULL, JSON_OBJECT('provider', 'Canva', 'plan', 'Pro Team', 'total_seats', 10, 'assigned_seats', 6))
ON DUPLICATE KEY UPDATE `code`=VALUES(`code`);

INSERT INTO `asset_allocations` (`id`, `asset_id`, `employee_id`, `employee_name`, `employee_email`, `department`, `allocated_at`, `status`, `allocated_by`, `note`) VALUES
(1, 1, 2, 'Trần Anh Tuấn', 'tuan.tech@datvietso.vn', 'Khối Kỹ Thuật & Công Nghệ', '2024-01-16 09:00:00', 'ACTIVE', 1, 'Cấp phát máy tính làm việc cho Kỹ sư phần mềm'),
(2, 2, 2, 'Trần Anh Tuấn', 'tuan.tech@datvietso.vn', 'Khối Kỹ Thuật & Công Nghệ', '2024-02-11 10:00:00', 'ACTIVE', 1, 'Cấp phát màn hình lập trình 4K')
ON DUPLICATE KEY UPDATE `status`=VALUES(`status`);

-- 4. CHAT SYSTEM
INSERT INTO `Conversations` (`id`, `type`, `name`, `avatar`, `created_by`) VALUES
(1, 'group', 'Đất Việt Số - Tổng Công Ty', 'https://api.dicebear.com/7.x/identicon/svg?seed=DatVietSo', '1'),
(2, 'direct', 'Trao đổi Kỹ Thuật - Kinh Doanh', NULL, '2')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

INSERT INTO `GroupMembers` (`id`, `conversation_id`, `user_id`, `user_name`, `avatar`, `role`) VALUES
(1, 1, '1', 'Nguyễn Quản Trị', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin', 'owner'),
(2, 1, '2', 'Trần Anh Tuấn', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tuan', 'admin'),
(3, 1, '3', 'Lê Thị Mai Hoa', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hoa', 'member'),
(4, 1, '4', 'Phạm Ngọc Lan', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lan', 'member'),
(5, 2, '2', 'Trần Anh Tuấn', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tuan', 'member'),
(6, 2, '3', 'Lê Thị Mai Hoa', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hoa', 'member')
ON DUPLICATE KEY UPDATE `user_name`=VALUES(`user_name`);

INSERT INTO `Messages` (`id`, `conversation_id`, `sender_id`, `sender_name`, `sender_avatar`, `type`, `content`) VALUES
(1, 1, '1', 'Nguyễn Quản Trị', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin', 'text', 'Chào mừng cả đội ngũ tham gia hệ thống quản trị DatVietSo!'),
(2, 1, '2', 'Trần Anh Tuấn', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tuan', 'text', 'Hệ thống đã triển khai đầy đủ Chat, Tài sản, Kanban, Lịch và CRM.'),
(3, 1, '3', 'Lê Thị Mai Hoa', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Hoa', 'text', 'Tuyệt vời, khối kinh doanh sẵn sàng cập nhật dữ liệu khách hàng!')
ON DUPLICATE KEY UPDATE `content`=VALUES(`content`);

-- 5. KANBAN DỰ ÁN & CÔNG VIỆC
INSERT INTO `kanban_boards` (`id`, `title`, `description`, `color`, `icon`, `department_id`, `owner_id`, `is_private`) VALUES
(1, 'Phát Triển Hệ Thống DatVietSo 2.0', 'Dự án số hóa quy trình quản trị nội bộ toàn diện', '#7367F0', 'tabler-brand-vue', 2, 1, FALSE)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

INSERT INTO `kanban_columns` (`id`, `board_id`, `title`, `color`, `position`, `wip_limit`) VALUES
(1, 1, 'Cần Làm (To Do)', '#EA5455', 0, 10),
(2, 1, 'Đang Thực Hiện (In Progress)', '#FF9F43', 1, 5),
(3, 1, 'Đang Kiểm Thử (In Review)', '#00CFE8', 2, 5),
(4, 1, 'Hoàn Thành (Done)', '#28C76F', 3, 0)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

INSERT INTO `kanban_tags` (`id`, `board_id`, `name`, `color`) VALUES
(1, 1, 'Backend API', '#7367F0'),
(2, 1, 'UI / UX', '#28C76F'),
(3, 1, 'High Priority', '#EA5455'),
(4, 1, 'Database', '#FF9F43')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

INSERT INTO `kanban_cards` (`id`, `board_id`, `column_id`, `title`, `description`, `priority`, `start_date`, `due_date`, `position`, `created_by`) VALUES
(1, 1, 4, 'Thiết kế cơ sở dữ liệu DatVietSo', 'Đầy đủ các module Chat, Assets, Kanban, Calendar, HRM, CRM với MySQL', 'HIGH', '2026-11-01', '2026-11-09', 0, 1),
(2, 1, 2, 'Hoàn thiện giao diện Kanban Vuetify', 'Tích hợp kéo thả v-drag-and-drop giữa các cột và lưu trạng thái vào DB', 'HIGH', '2026-11-09', '2026-11-15', 0, 2),
(3, 1, 1, 'Tích hợp Socket.io Realtime Chat với Vuetify', 'Đồng bộ tin nhắn tức thì, trạng thái online và gõ phím', 'MEDIUM', '2026-11-12', '2026-11-20', 0, 2)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

INSERT INTO `kanban_card_assignees` (`card_id`, `user_id`) VALUES
(1, 2),
(2, 2),
(3, 2)
ON DUPLICATE KEY UPDATE `card_id`=VALUES(`card_id`);

INSERT INTO `kanban_card_tags` (`card_id`, `tag_id`) VALUES
(1, 1),
(1, 4),
(2, 2),
(2, 3),
(3, 1)
ON DUPLICATE KEY UPDATE `card_id`=VALUES(`card_id`);

-- 6. LỊCH BIỂU & SỰ KIỆN (CALENDAR)
INSERT INTO `calendar_categories` (`id`, `name`, `color`, `description`) VALUES
(1, 'Cuộc Họp Nội Bộ', '#7367F0', 'Họp giao ban, retrospective, sprint planning'),
(2, 'Họp Với Khách Hàng', '#28C76F', 'Demo giải pháp, thương thảo hợp đồng'),
(3, 'Hạn Chót Dự Án', '#EA5455', 'Các mốc release hoặc deadline trọng điểm'),
(4, 'Sự Kiện & Kỷ Niệm', '#FF9F43', 'Sinh nhật, teambuilding, ngày lễ')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

INSERT INTO `calendar_events` (`id`, `title`, `description`, `category_id`, `start_time`, `end_time`, `is_all_day`, `location`, `meeting_url`, `created_by`) VALUES
(1, 'Họp Giao Ban Đầu Tuần DatVietSo', 'Đánh giá tiến độ các dự án và phân bổ công việc tuần mới', 1, '2026-11-10 09:00:00', '2026-11-10 10:30:00', FALSE, 'Phòng Họp Ban Giám Đốc', 'https://meet.google.com/dvs-corp-meet', 1),
(2, 'Demo Phần Mềm Cho Khách Hàng VIP', 'Trình bày giải pháp số hóa doanh nghiệp cho đối tác', 2, '2026-11-11 14:00:00', '2026-11-11 15:30:00', FALSE, 'Phòng Khách VIP Tầng 2', 'https://meet.google.com/dvs-demo-sales', 3)
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

-- 7. QUẢN HỆ KHÁCH HÀNG & BÁN HÀNG (CRM)
INSERT INTO `crm_customers` (`id`, `code`, `company_name`, `contact_name`, `email`, `phone`, `tax_code`, `address`, `industry`, `customer_type`, `customer_tier`, `assigned_to`, `status`) VALUES
(1, 'KH-001', 'Tập Đoàn Công Nghệ Số Sao Mai', 'Ông Trần Quốc Tuấn', 'contact@saomaitech.vn', '02838999888', '0315897645', 'Tòa nhà Sao Mai, Q.1, TP.HCM', 'Công nghệ thông tin', 'ENTERPRISE', 'VIP', 3, 'ACTIVE'),
(2, 'KH-002', 'Công Ty CP Bất Động Sản An Gia Phát', 'Bà Vũ Minh Châu', 'chau.vu@angiaphat.vn', '02437666555', '0108992341', 'Thanh Xuân, Hà Nội', 'Bất động sản', 'ENTERPRISE', 'GOLD', 3, 'ACTIVE')
ON DUPLICATE KEY UPDATE `company_name`=VALUES(`company_name`);

INSERT INTO `crm_deals` (`id`, `customer_id`, `deal_name`, `deal_value`, `pipeline_stage`, `probability`, `expected_close_date`, `assigned_to`, `note`) VALUES
(1, 1, 'Hợp Đồng Cung Cấp Nền Tảng DatVietSo ERP', 450000000, 'NEGOTIATION', 80, '2026-11-30', 3, 'Khách hàng đã duyệt demo, đang chốt điều khoản thanh toán'),
(2, 2, 'Phần Mềm Quản Lý Tài Sản & Chăm Sóc Khách Hàng', 180000000, 'PROPOSAL', 50, '2026-12-15', 3, 'Đang gửi bảng báo giá chi tiết và lộ trình triển khai')
ON DUPLICATE KEY UPDATE `deal_name`=VALUES(`deal_name`);

INSERT INTO `crm_activities` (`id`, `customer_id`, `deal_id`, `activity_type`, `title`, `description`, `scheduled_at`, `performed_by`, `status`) VALUES
(1, 1, 1, 'MEETING', 'Họp thống nhất bảng điều khoản hợp đồng', 'Đàm phán lịch thanh toán và thời hạn bàn giao bản quyền', '2026-11-08 14:00:00', 3, 'COMPLETED'),
(2, 2, 2, 'CALL', 'Gọi điện tư vấn phân hệ Quản lý tài sản', 'Khách hàng rất quan tâm đến tính năng phân bổ tài sản vật lý & bản quyền số', '2026-11-09 10:00:00', 3, 'COMPLETED')
ON DUPLICATE KEY UPDATE `title`=VALUES(`title`);

SET FOREIGN_KEY_CHECKS = 1;
