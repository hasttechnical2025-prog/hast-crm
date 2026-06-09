-- Đổi tên cột trong bảng crm_notes để đồng bộ với dữ liệu giao diện gửi lên
DO $$
BEGIN
  -- 1. Đổi parent_type thành related_type
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_notes' AND column_name='parent_type')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_notes' AND column_name='related_type') THEN
    ALTER TABLE public.crm_notes RENAME COLUMN parent_type TO related_type;
  END IF;

  -- 2. Đổi parent_id thành related_id
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_notes' AND column_name='parent_id')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_notes' AND column_name='related_id') THEN
    ALTER TABLE public.crm_notes RENAME COLUMN parent_id TO related_id;
  END IF;
END $$;