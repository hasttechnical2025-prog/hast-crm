-- 1. Thêm cột cho bảng Ghi chú (crm_notes)
ALTER TABLE public.crm_notes
ADD COLUMN IF NOT EXISTS attachment_url TEXT,
ADD COLUMN IF NOT EXISTS attachment_name TEXT,
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- 2. Thêm cột cho bảng Trao đổi/Tin nhắn (crm_messages)
ALTER TABLE public.crm_messages
ADD COLUMN IF NOT EXISTS subject TEXT,
ADD COLUMN IF NOT EXISTS customer_id TEXT;
