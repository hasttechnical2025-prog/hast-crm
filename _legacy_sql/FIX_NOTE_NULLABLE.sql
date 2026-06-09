-- Gỡ bỏ ràng buộc bắt buộc nhập (NOT NULL) cho hai cột related_type và related_id trong bảng crm_notes
ALTER TABLE public.crm_notes ALTER COLUMN related_type DROP NOT NULL;
ALTER TABLE public.crm_notes ALTER COLUMN related_id DROP NOT NULL;
