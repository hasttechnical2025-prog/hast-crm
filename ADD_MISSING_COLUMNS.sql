-- 1. CUSTOMERS
ALTER TABLE public.crm_customers
ADD COLUMN IF NOT EXISTS external_code TEXT,
ADD COLUMN IF NOT EXISTS customer_type TEXT DEFAULT 'organization',
ADD COLUMN IF NOT EXISTS tax_code TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS province TEXT,
ADD COLUMN IF NOT EXISTS district TEXT,
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS rating_stars INT DEFAULT 3,
ADD COLUMN IF NOT EXISTS rating_points INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS credit_limit NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS purchase_cycle INT DEFAULT 30,
ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_revenue NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_debt NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS approved_by TEXT,
ADD COLUMN IF NOT EXISTS approved_at TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. CONTACTS
-- Đổi tên cột name thành full_name để khớp với dữ liệu giao diện
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_contacts' AND column_name='name')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_contacts' AND column_name='full_name') THEN
    ALTER TABLE public.crm_contacts RENAME COLUMN name TO full_name;
  ELSIF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_contacts' AND column_name='name')
     AND EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_contacts' AND column_name='full_name') THEN
    ALTER TABLE public.crm_contacts DROP COLUMN name;
  END IF;
END $$;

ALTER TABLE public.crm_contacts
ADD COLUMN IF NOT EXISTS gender TEXT,
ADD COLUMN IF NOT EXISTS birthday TEXT,
ADD COLUMN IF NOT EXISTS position TEXT,
ADD COLUMN IF NOT EXISTS department TEXT,
ADD COLUMN IF NOT EXISTS mobile TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS social_zalo TEXT,
ADD COLUMN IF NOT EXISTS social_facebook TEXT,
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. OPPORTUNITIES
-- Đổi tên cột title thành name để khớp với giao diện
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_opportunities' AND column_name='title')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_opportunities' AND column_name='name') THEN
    ALTER TABLE public.crm_opportunities RENAME COLUMN title TO name;
  ELSIF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_opportunities' AND column_name='title')
     AND EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_opportunities' AND column_name='name') THEN
    ALTER TABLE public.crm_opportunities DROP COLUMN title;
  END IF;
END $$;

ALTER TABLE public.crm_opportunities
ADD COLUMN IF NOT EXISTS estimated_value NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS expected_close_date TEXT,
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS competitor TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. QUOTES
-- Loại bỏ thuộc tính NOT NULL cho title vì form không gửi title
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_quotes' AND column_name='title') THEN
    ALTER TABLE public.crm_quotes ALTER COLUMN title DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.crm_quotes
ADD COLUMN IF NOT EXISTS issue_date TEXT,
ADD COLUMN IF NOT EXISTS valid_until TEXT,
ADD COLUMN IF NOT EXISTS payment_terms TEXT,
ADD COLUMN IF NOT EXISTS delivery_terms TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_amount NUMERIC DEFAULT 0;

-- 5. ORDERS
-- Loại bỏ thuộc tính NOT NULL cho title vì form không gửi title
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_orders' AND column_name='title') THEN
    ALTER TABLE public.crm_orders ALTER COLUMN title DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.crm_orders
ADD COLUMN IF NOT EXISTS order_date TEXT,
ADD COLUMN IF NOT EXISTS delivery_date TEXT,
ADD COLUMN IF NOT EXISTS payment_terms TEXT,
ADD COLUMN IF NOT EXISTS delivery_terms TEXT,
ADD COLUMN IF NOT EXISTS shipping_address TEXT,
ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC DEFAULT 0;

-- 6. ORDER_ITEMS
ALTER TABLE public.crm_order_items
ADD COLUMN IF NOT EXISTS product_name TEXT,
ADD COLUMN IF NOT EXISTS unit TEXT,
ADD COLUMN IF NOT EXISTS discount_percent NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS line_total NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 0;

-- 7. PRODUCTS
ALTER TABLE public.crm_products
ADD COLUMN IF NOT EXISTS brand TEXT,
ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'Chiếc',
ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 10,
ADD COLUMN IF NOT EXISTS stock_qty NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 8. SUPPORT_TICKETS
-- Đổi tên cột title (hoặc name) thành subject để khớp với giao diện
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

ALTER TABLE public.crm_support_tickets
ADD COLUMN IF NOT EXISTS issue_date TEXT,
ADD COLUMN IF NOT EXISTS resolved_date TEXT,
ADD COLUMN IF NOT EXISTS contact_name TEXT,
ADD COLUMN IF NOT EXISTS contact_phone TEXT,
ADD COLUMN IF NOT EXISTS product_name TEXT,
ADD COLUMN IF NOT EXISTS resolution TEXT,
ADD COLUMN IF NOT EXISTS serial_number TEXT,
ADD COLUMN IF NOT EXISTS satisfaction_rating INT;

-- 9. ACTIVITIES
-- Đổi tên cột subject thành title để khớp với giao diện
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_activities' AND column_name='subject')
     AND NOT EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_activities' AND column_name='title') THEN
    ALTER TABLE public.crm_activities RENAME COLUMN subject TO title;
  ELSIF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_activities' AND column_name='subject')
     AND EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_activities' AND column_name='title') THEN
    ALTER TABLE public.crm_activities DROP COLUMN subject;
  END IF;
END $$;

ALTER TABLE public.crm_activities
ADD COLUMN IF NOT EXISTS start_time TEXT,
ADD COLUMN IF NOT EXISTS end_time TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS result TEXT,
ADD COLUMN IF NOT EXISTS related_type TEXT,
ADD COLUMN IF NOT EXISTS related_id TEXT;

-- 10. CAMPAIGNS
ALTER TABLE public.crm_campaigns
ADD COLUMN IF NOT EXISTS target_audience TEXT,
ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS message_template TEXT,
ADD COLUMN IF NOT EXISTS customer_ids TEXT,
ADD COLUMN IF NOT EXISTS sent_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS open_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS click_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS converted_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS goal TEXT;

-- 11. NOTES
DO $$
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_notes' AND column_name='related_type') THEN
    ALTER TABLE public.crm_notes ALTER COLUMN related_type DROP NOT NULL;
  END IF;
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='crm_notes' AND column_name='related_id') THEN
    ALTER TABLE public.crm_notes ALTER COLUMN related_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.crm_notes
ADD COLUMN IF NOT EXISTS attachment_url TEXT,
ADD COLUMN IF NOT EXISTS attachment_name TEXT,
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- 12. MESSAGES
ALTER TABLE public.crm_messages
ADD COLUMN IF NOT EXISTS subject TEXT,
ADD COLUMN IF NOT EXISTS customer_id TEXT;
