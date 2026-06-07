-- Xóa cột name thừa trong bảng crm_support_tickets (nếu có cả subject và name)
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='name')
     AND EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='subject') THEN
    ALTER TABLE public.crm_support_tickets DROP COLUMN name;
  ELSIF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='name')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='subject') THEN
    ALTER TABLE public.crm_support_tickets RENAME COLUMN name TO subject;
  END IF;

  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='title')
     AND EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='subject') THEN
    ALTER TABLE public.crm_support_tickets DROP COLUMN title;
  ELSIF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='title')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_support_tickets' AND column_name='subject') THEN
    ALTER TABLE public.crm_support_tickets RENAME COLUMN title TO subject;
  END IF;
END $$;