-- Khắc phục lỗi kiểu dữ liệu UUID cho cột department_id trong các bảng bán hàng
-- Chuyển đổi cột department_id sang kiểu TEXT để khớp với mã phòng ban (VD: 'dept_kd')

DO $$
BEGIN
  -- Bảng crm_opportunities
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_opportunities' AND column_name='department_id' AND data_type='uuid') THEN
    ALTER TABLE public.crm_opportunities ALTER COLUMN department_id TYPE TEXT USING department_id::text;
  END IF;

  -- Bảng crm_quotes
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_quotes' AND column_name='department_id' AND data_type='uuid') THEN
    ALTER TABLE public.crm_quotes ALTER COLUMN department_id TYPE TEXT USING department_id::text;
  END IF;

  -- Bảng crm_orders
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_orders' AND column_name='department_id' AND data_type='uuid') THEN
    ALTER TABLE public.crm_orders ALTER COLUMN department_id TYPE TEXT USING department_id::text;
  END IF;
END $$;