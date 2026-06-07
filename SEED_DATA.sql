-- SCRIPT KHỞI TẠO DỮ LIỆU MẪU HAST_CRM
-- Chạy script này trong SQL Editor của Supabase để tạo các phòng ban và tài khoản đăng nhập mẫu

-- 1. Thêm phòng ban mẫu
INSERT INTO public.crm_departments (id, code, name) VALUES
  ('4623a188-3f5f-4527-a33c-cc6e66cbe20a', 'KD', 'Phòng Kinh doanh'),
  ('c8a7b712-e60d-4b13-8aec-65665a208093', 'KT', 'Phòng Kỹ thuật'),
  ('77296cd9-c863-48fa-b04c-507cdc5c2c90', 'KTHC', 'Phòng Kế toán - Hành chính');

-- 2. Thêm người dùng mẫu
INSERT INTO public.crm_users (id, username, password_hash, salt, full_name, role, department_id, status) VALUES
  ('57613dd0-1060-45b1-a0fb-02a3e7e7fdd8', 'admin', '6e226b99c733b67c6ded327823a32450a7482ebee4e7c6cd31231d7bc41864f7', '47af2a439c634eea', 'Quản trị viên', 'admin', NULL, 'active'),
  ('d32c57fe-a681-45aa-9d9e-58f10f62b697', 'boss', '72e3c3a5243306bc2c8e2a52588f64211ef7c205488afdcc5f6743ddbb891eb7', '5eb15db7df294193', 'Tổng Giám đốc', 'boss', NULL, 'active'),
  ('9944ca68-a58e-44d1-9851-1e583471c19b', 'manager_kd', 'd54fb6866317b06d4d0296b7f6438b85f84dc179f12e2bf036422468ae20238c', 'dcfd9328cf2246b3', 'Trưởng phòng Kinh doanh', 'manager', '4623a188-3f5f-4527-a33c-cc6e66cbe20a', 'active'),
  ('501cfce4-bf2e-49d9-952c-01a5e5cda527', 'manager_kt', 'a8f01dc824d00f998dceb0e3f4292fe82dc59adb5b192d06090aed08bdc9cf68', 'd820055334e148f3', 'Trưởng phòng Kỹ thuật', 'manager', 'c8a7b712-e60d-4b13-8aec-65665a208093', 'active'),
  ('f8759a5d-3952-4129-814a-b10afd66e6f7', 'manager_kthc', '9f35eb6aa37ba6dbb930264d5b38095fe52538c05d9f83be31bfaab2497fe34d', '60d89b34dded45ec', 'Trưởng phòng Kế toán', 'manager', '77296cd9-c863-48fa-b04c-507cdc5c2c90', 'active'),
  ('27691cab-2913-4e2c-96b9-ad194c6dc32b', 'staff_kd_01', 'b8f76901a9d0ef7896f64032fd955f7e4cd3e6af0f8f3103a4719d69e1de9d90', '63ade12ab7434633', 'Phạm Hoàng Hải Sơn', 'staff', '4623a188-3f5f-4527-a33c-cc6e66cbe20a', 'active'),
  ('fabe8cec-d3b7-4f55-af87-d2cc42951bd6', 'staff_kd_02', 'ca232ddbc1923493d1a1d7936dbec5eaaf1fcefec5dff98251d03e44d88f54cb', 'a132b653ed0e4fef', 'Nguyễn Văn Kinh Doanh 2', 'staff', '4623a188-3f5f-4527-a33c-cc6e66cbe20a', 'active'),
  ('f63da671-a633-44e7-9ab0-12ecde94280e', 'staff_kt_01', 'b910b4788cfe31d8c0ebe72d76c957208a0d1f0ceb17f19b78623132a3f5d9bb', '79a1deda4ede4f1c', 'Kỹ thuật viên 01', 'staff', 'c8a7b712-e60d-4b13-8aec-65665a208093', 'active'),
  ('6ddde39b-e9c5-461d-bbc5-b96ef7836144', 'staff_kthc_01', '031c018804673c5e8d88ea5e4f4290f0aaa57d4502902688d1b073b12d71d4fa', '1c474b3850424703', 'Kế toán viên 01', 'staff', '77296cd9-c863-48fa-b04c-507cdc5c2c90', 'active');

