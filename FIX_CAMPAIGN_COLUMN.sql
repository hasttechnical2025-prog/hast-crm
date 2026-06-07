-- Bổ sung cột mục tiêu (goal) còn thiếu vào bảng Chiến dịch
ALTER TABLE public.crm_campaigns
ADD COLUMN IF NOT EXISTS goal TEXT;