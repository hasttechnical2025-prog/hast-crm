-- ============================================================================
-- Migration 002: Seed stages + transitions
-- Tham chiếu: plans/kanban_rebuild_spec.md §4
-- ============================================================================
-- Idempotent (ON CONFLICT) — chạy lại không vỡ.
-- ============================================================================

-- ====== STAGES ======
insert into public.crm_kanban_stages (id, name, owner_dept, sort_order, is_terminal) values
 ('KD_OPEN',       'KD – Cơ hội / Báo giá',     'KD',   10, false),
 ('KD_WON',        'KD – Đã chốt',              'KD',   20, false),
 ('KT_PROCESS',    'KT – Xử lý hàng / máy',     'KT',   30, false),
 ('KTHC_INVOICE',  'KTHC – Lên hóa đơn',        'KTHC', 40, false),
 ('RENTAL_ACTIVE', 'Đang cho thuê',             'KT',   45, false),
 ('KTHC_DEBT',     'KTHC – Theo dõi công nợ',   'KTHC', 50, false),
 ('DONE',          'Hoàn tất',                  'KTHC', 99, true)
on conflict (id) do update set
  name        = excluded.name,
  owner_dept  = excluded.owner_dept,
  sort_order  = excluded.sort_order,
  is_terminal = excluded.is_terminal;

-- ====== TRANSITIONS ======
-- Để idempotent với UNIQUE (card_type, from_stage, to_stage), dùng ON CONFLICT.

-- ===== ban_may =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('ban_may', 'KD_OPEN',      'KD_WON',       'forward',  '["nhan_vien","truong_phong","boss"]'::jsonb, 'KD',   '[]'::jsonb),
 ('ban_may', 'KD_WON',       'KT_PROCESS',   'forward',  '["truong_phong","boss"]'::jsonb,             'KD',   '["total_amount"]'::jsonb),
 ('ban_may', 'KT_PROCESS',   'KTHC_INVOICE', 'forward',  '["truong_phong","boss"]'::jsonb,             'KT',   '["total_amount"]'::jsonb),
 ('ban_may', 'KTHC_INVOICE', 'KTHC_DEBT',    'forward',  '["nhan_vien","truong_phong","boss"]'::jsonb, 'KTHC', '["invoice_no","invoice_date"]'::jsonb),
 ('ban_may', 'KTHC_DEBT',    'DONE',         'forward',  '["truong_phong","boss"]'::jsonb,             'KTHC', '["payment_status"]'::jsonb),
 -- backward
 ('ban_may', 'KD_WON',       'KD_OPEN',      'backward', '["truong_phong","boss"]'::jsonb,             'KD',   '[]'::jsonb),
 ('ban_may', 'KT_PROCESS',   'KD_WON',       'backward', '["truong_phong","boss"]'::jsonb,             'KT',   '[]'::jsonb),
 ('ban_may', 'KTHC_INVOICE', 'KT_PROCESS',   'backward', '["truong_phong","boss"]'::jsonb,             'KTHC', '[]'::jsonb),
 ('ban_may', 'KTHC_DEBT',    'KTHC_INVOICE', 'backward', '["truong_phong","boss"]'::jsonb,             'KTHC', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction     = excluded.direction,
  allowed_roles = excluded.allowed_roles,
  acting_dept   = excluded.acting_dept,
  require_fields= excluded.require_fields;

-- ===== ban_vat_tu =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('ban_vat_tu', 'KT_PROCESS',   'KTHC_INVOICE', 'forward',  '["truong_phong","boss"]'::jsonb,             'KT',   '["total_amount"]'::jsonb),
 ('ban_vat_tu', 'KTHC_INVOICE', 'KTHC_DEBT',    'forward',  '["nhan_vien","truong_phong","boss"]'::jsonb, 'KTHC', '["invoice_no","invoice_date"]'::jsonb),
 ('ban_vat_tu', 'KTHC_DEBT',    'DONE',         'forward',  '["truong_phong","boss"]'::jsonb,             'KTHC', '["payment_status"]'::jsonb),
 ('ban_vat_tu', 'KTHC_INVOICE', 'KT_PROCESS',   'backward', '["truong_phong","boss"]'::jsonb,             'KTHC', '[]'::jsonb),
 ('ban_vat_tu', 'KTHC_DEBT',    'KTHC_INVOICE', 'backward', '["truong_phong","boss"]'::jsonb,             'KTHC', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction     = excluded.direction,
  allowed_roles = excluded.allowed_roles,
  acting_dept   = excluded.acting_dept,
  require_fields= excluded.require_fields;

-- ===== thue_may (hợp đồng) =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('thue_may', 'KD_OPEN',       'KD_WON',        'forward',  '["nhan_vien","truong_phong","boss"]'::jsonb, 'KD', '[]'::jsonb),
 ('thue_may', 'KD_WON',        'KT_PROCESS',    'forward',  '["truong_phong","boss"]'::jsonb,             'KD', '[]'::jsonb),
 ('thue_may', 'KT_PROCESS',    'RENTAL_ACTIVE', 'forward',  '["truong_phong","boss"]'::jsonb,             'KT', '[]'::jsonb),
 ('thue_may', 'RENTAL_ACTIVE', 'DONE',          'forward',  '["truong_phong","boss"]'::jsonb,             'KT', '[]'::jsonb),
 ('thue_may', 'KD_WON',        'KD_OPEN',       'backward', '["truong_phong","boss"]'::jsonb,             'KD', '[]'::jsonb),
 ('thue_may', 'KT_PROCESS',    'KD_WON',        'backward', '["truong_phong","boss"]'::jsonb,             'KT', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction     = excluded.direction,
  allowed_roles = excluded.allowed_roles,
  acting_dept   = excluded.acting_dept,
  require_fields= excluded.require_fields;

-- ===== thue_may_ky (kỳ thuê) =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('thue_may_ky', 'KTHC_INVOICE', 'KTHC_DEBT',    'forward',  '["nhan_vien","truong_phong","boss"]'::jsonb, 'KTHC', '["invoice_no","invoice_date"]'::jsonb),
 ('thue_may_ky', 'KTHC_DEBT',    'DONE',         'forward',  '["truong_phong","boss"]'::jsonb,             'KTHC', '["payment_status"]'::jsonb),
 ('thue_may_ky', 'KTHC_DEBT',    'KTHC_INVOICE', 'backward', '["truong_phong","boss"]'::jsonb,             'KTHC', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction     = excluded.direction,
  allowed_roles = excluded.allowed_roles,
  acting_dept   = excluded.acting_dept,
  require_fields= excluded.require_fields;
