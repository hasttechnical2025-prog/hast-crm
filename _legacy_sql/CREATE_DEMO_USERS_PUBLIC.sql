CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tạo phòng ban Admin và Kinh Doanh trong crm_departments
INSERT INTO public.crm_departments (id, code, name)
VALUES ('dept_admin', 'ADMIN', 'Ban Giám Đốc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_departments (id, code, name)
VALUES ('dept_kd', 'KD', 'Phòng Kinh Doanh')
ON CONFLICT (id) DO NOTHING;

-- 2. Tạo/Cập nhật tài khoản admin với mật khẩu Admin@123 trong crm_users
INSERT INTO public.crm_users (id, username, password_hash, salt, full_name, role, department_id, status)
VALUES (
    'usr_admin',
    'admin',
    encode(digest('Admin@123' || 'salt123456', 'sha256'), 'hex'),
    'salt123456',
    'Quản trị viên',
    'admin',
    'dept_admin',
    'active'
)
ON CONFLICT (id) DO UPDATE
SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt, status = 'active';

-- 3. Tạo tài khoản demo manager_kd / Manager@123 trong crm_users
INSERT INTO public.crm_users (id, username, password_hash, salt, full_name, role, department_id, status)
VALUES (
    'usr_manager_kd',
    'manager_kd',
    encode(digest('Manager@123' || 'salt123456', 'sha256'), 'hex'),
    'salt123456',
    'Trưởng phòng KD',
    'manager',
    'dept_kd',
    'active'
)
ON CONFLICT (id) DO UPDATE
SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt, status = 'active';

-- 4. Tạo tài khoản demo staff_kd_01 / Staff@123 trong crm_users
INSERT INTO public.crm_users (id, username, password_hash, salt, full_name, role, department_id, status)
VALUES (
    'usr_staff_kd_01',
    'staff_kd_01',
    encode(digest('Staff@123' || 'salt123456', 'sha256'), 'hex'),
    'salt123456',
    'Nhân viên KD 01',
    'staff',
    'dept_kd',
    'active'
)
ON CONFLICT (id) DO UPDATE
SET password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt, status = 'active';
