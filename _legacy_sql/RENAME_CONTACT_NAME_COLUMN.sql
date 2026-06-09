-- Lệnh SQL RENAME cột trong bảng contacts để khớp với dữ liệu từ frontend gửi lên
ALTER TABLE hast_crm.contacts RENAME COLUMN name TO full_name;
