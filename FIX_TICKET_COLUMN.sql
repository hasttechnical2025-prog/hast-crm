-- Sửa lỗi tên cột cho bảng Ticket (Đổi cột name hoặc title thành subject)
DO $$
BEGIN
  -- Nếu cột hiện tại đang là name (do chạy script nhầm đợt trước)
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='name')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='subject') THEN
    ALTER TABLE public.crm_support_tickets RENAME COLUMN name TO subject;

  -- Nếu cột hiện tại vẫn là title
  ELSIF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='title')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='subject') THEN
    ALTER TABLE public.crm_support_tickets RENAME COLUMN title TO subject;
  END IF;
END $$;