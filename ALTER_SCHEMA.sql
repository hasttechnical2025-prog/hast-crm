-- SCRIPT BỔ SUNG CÁC CỘT CÒN THIẾU TỪ GIAO DIỆN FRONTEND HAST_CRM
-- Chạy script này trong SQL Editor của Supabase để sửa đổi cấu trúc bảng hiện tại

-- 1. Bảng Khách hàng (crm_customers)
ALTER TABLE public.crm_customers
ADD COLUMN IF NOT EXISTS external_code TEXT,
ADD COLUMN IF NOT EXISTS customer_type TEXT,
ADD COLUMN IF NOT EXISTS tax_code TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS website TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS province TEXT,
ADD COLUMN IF NOT EXISTS district TEXT,
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS rating_stars INT,
ADD COLUMN IF NOT EXISTS credit_limit NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS purchase_cycle TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Bảng Người liên hệ (crm_contacts)
ALTER TABLE public.crm_contacts
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS gender TEXT,
ADD COLUMN IF NOT EXISTS birthday DATE,
ADD COLUMN IF NOT EXISTS mobile TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS social_zalo TEXT,
ADD COLUMN IF NOT EXISTS social_facebook TEXT,
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;

-- 3. Bảng Hoạt động (crm_activities)
ALTER TABLE public.crm_activities
ADD COLUMN IF NOT EXISTS priority TEXT,
ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS duration INT,
ADD COLUMN IF NOT EXISTS result TEXT;

-- 4. Bảng Cơ hội bán hàng (crm_opportunities)
ALTER TABLE public.crm_opportunities
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS estimated_value NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS expected_close_date DATE,
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS competitor TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 5. Bảng Báo giá (crm_quotes)
ALTER TABLE public.crm_quotes
ADD COLUMN IF NOT EXISTS issue_date DATE,
ADD COLUMN IF NOT EXISTS valid_until DATE,
ADD COLUMN IF NOT EXISTS order_date DATE,
ADD COLUMN IF NOT EXISTS delivery_date DATE,
ADD COLUMN IF NOT EXISTS payment_terms TEXT,
ADD COLUMN IF NOT EXISTS delivery_terms TEXT,
ADD COLUMN IF NOT EXISTS shipping_address TEXT,
ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 6. Bảng Đơn hàng (crm_orders)
ALTER TABLE public.crm_orders
ADD COLUMN IF NOT EXISTS issue_date DATE,
ADD COLUMN IF NOT EXISTS valid_until DATE,
ADD COLUMN IF NOT EXISTS order_date DATE,
ADD COLUMN IF NOT EXISTS delivery_date DATE,
ADD COLUMN IF NOT EXISTS payment_terms TEXT,
ADD COLUMN IF NOT EXISTS delivery_terms TEXT,
ADD COLUMN IF NOT EXISTS shipping_address TEXT,
ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 7. Bảng Ticket hỗ trợ (crm_support_tickets)
ALTER TABLE public.crm_support_tickets
ADD COLUMN IF NOT EXISTS subject TEXT,
ADD COLUMN IF NOT EXISTS serial_number TEXT,
ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.crm_products(id) ON DELETE SET NULL;

-- 8. Bảng Chiến dịch (crm_campaigns)
ALTER TABLE public.crm_campaigns
ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS target_audience TEXT,
ADD COLUMN IF NOT EXISTS goal TEXT,
ADD COLUMN IF NOT EXISTS message_template TEXT,
ADD COLUMN IF NOT EXISTS customer_ids TEXT;

-- 9. Bảng Ghi chú (crm_notes)
ALTER TABLE public.crm_notes
ADD COLUMN IF NOT EXISTS related_type TEXT,
ADD COLUMN IF NOT EXISTS related_id UUID,
ADD COLUMN IF NOT EXISTS attachment_url TEXT,
ADD COLUMN IF NOT EXISTS attachment_name TEXT,
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- 10. Bảng Trao đổi tin nhắn (crm_messages)
ALTER TABLE public.crm_messages
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.crm_customers(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS subject TEXT;

-- 11. Bảng Phòng ban (crm_departments)
ALTER TABLE public.crm_departments
ADD COLUMN IF NOT EXISTS description TEXT;

-- 12. Bảng Sản phẩm (crm_products)
ALTER TABLE public.crm_products
ADD COLUMN IF NOT EXISTS brand TEXT,
ADD COLUMN IF NOT EXISTS sub_category TEXT,
ADD COLUMN IF NOT EXISTS model TEXT,
ADD COLUMN IF NOT EXISTS unit TEXT,
ADD COLUMN IF NOT EXISTS list_price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_price NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS vat_rate NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS stock_qty INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS is_for_rent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_for_cpc BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS rent_price_per_month NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS cpc_black_white NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS cpc_color NUMERIC DEFAULT 0;

-- 13. Bảng Thẻ phân loại (crm_tags)
ALTER TABLE public.crm_tags
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS description TEXT;

-- Yêu cầu Supabase tải lại bộ nhớ đệm (schema cache) ngay lập tức
NOTIFY pgrst, 'reload schema';
