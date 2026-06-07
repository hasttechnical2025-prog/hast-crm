CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO hast_crm.departments (id, code, name)
VALUES ('dept_admin', 'ADMIN', 'Ban Giám Đốc')
ON CONFLICT (id) DO NOTHING;

INSERT INTO hast_crm.users (id, username, password_hash, salt, full_name, role, department_id, status)
VALUES (
    'usr_admin',
    'admin',
    encode(digest('admin123' || 'salt123456', 'sha256'), 'hex'),
    'salt123456',
    'Quản trị viên',
    'admin',
    'dept_admin',
    'active'
)
ON CONFLICT (id) DO NOTHING;