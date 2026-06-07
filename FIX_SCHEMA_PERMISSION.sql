-- 1. Cấp quyền truy cập (USAGE) vào schema hast_crm cho các vai trò của Supabase API
GRANT USAGE ON SCHEMA hast_crm TO anon, authenticated, service_role;

-- 2. Cấp toàn quyền thao tác (Select, Insert, Update, Delete) trên tất cả các bảng hiện tại
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA hast_crm TO anon, authenticated, service_role;

-- 3. Thiết lập tự động cấp quyền cho bất kỳ bảng nào được tạo mới trong tương lai
ALTER DEFAULT PRIVILEGES IN SCHEMA hast_crm GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated, service_role;

-- 4. Ép máy chủ API của Supabase (PostgREST) tải lại bộ nhớ đệm ngay lập tức
NOTIFY pgrst, 'reload schema';