-- Chuyển đổi kiểu dữ liệu cột department_id từ UUID sang TEXT để tương thích với mã phòng ban cũ
ALTER TABLE public.crm_opportunities ALTER COLUMN department_id TYPE text;
ALTER TABLE public.crm_quotes ALTER COLUMN department_id TYPE text;
ALTER TABLE public.crm_orders ALTER COLUMN department_id TYPE text;
ALTER TABLE public.crm_workflows ALTER COLUMN department_id TYPE text;

-- 2. Bổ sung các cột liên kết còn thiếu cho bảng crm_activities
ALTER TABLE public.crm_activities
ADD COLUMN IF NOT EXISTS related_type TEXT,
ADD COLUMN IF NOT EXISTS related_id TEXT;
