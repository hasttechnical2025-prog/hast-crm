-- ============================================================================
-- Migration 001: Kanban Schema
-- Tham chiếu: plans/kanban_rebuild_spec.md §3 + §6.7 + §6.10
-- ============================================================================
-- Quyết định khác spec mặc định (đã chốt với DK):
--  - KHÔNG hardcode CHECK owner_dept/department vào ('KD','KT','KTHC');
--    dept đọc động từ public.crm_departments.code → cho phép thêm phòng mới về sau.
--  - Hỗ trợ NHIỀU dòng sản phẩm/thẻ: bảng phụ public.crm_kanban_card_items;
--    financials giữ tổng hợp (subtotal/total_amount/cost tổng).
--  - Migration idempotent — chạy lại không vỡ.
-- ============================================================================

-- ====== EXTENSIONS ======
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ====== STAGES (cấu hình cột) ======
create table if not exists public.crm_kanban_stages (
  id            text primary key,            -- vd 'KD_OPEN'
  name          text not null,
  owner_dept    text not null,               -- không CHECK; resolve qua crm_departments.code
  sort_order    int  not null,
  is_terminal   boolean not null default false
);

-- ====== TRANSITIONS (luật kéo-nhả) ======
create table if not exists public.crm_kanban_transitions (
  id                 bigint generated always as identity primary key,
  card_type          text not null check (card_type in ('ban_may','thue_may','thue_may_ky','ban_vat_tu')),
  from_stage         text not null references public.crm_kanban_stages(id),
  to_stage           text not null references public.crm_kanban_stages(id),
  direction          text not null check (direction in ('forward','backward')),
  allowed_roles      jsonb not null,                 -- vd '["nhan_vien","truong_phong","boss"]'
  acting_dept        text not null,                  -- code phòng được phép thực hiện
  require_fields     jsonb not null default '[]'::jsonb,
  constraint crm_kanban_transitions_uniq unique (card_type, from_stage, to_stage)
);

-- ====== CARDS (thẻ) ======
create table if not exists public.crm_kanban_cards (
  id              uuid primary key default gen_random_uuid(),
  card_type       text not null check (card_type in ('ban_may','thue_may','thue_may_ky','ban_vat_tu')),
  title           text not null,
  current_stage   text not null references public.crm_kanban_stages(id),
  owner_dept      text not null,                       -- code phòng (KD/KT/KTHC...)
  assigned_to     uuid,                                -- crm_users.id (logical FK)
  customer_id     uuid,                                -- crm_customers.id (logical FK)
  customer_name   text,
  parent_card_id  uuid references public.crm_kanban_cards(id) on delete set null,
  period_label    text,
  period_start    date,
  period_end      date,
  status          text not null default 'active'
                  check (status in ('active','done','cancelled')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ====== CARD ITEMS (nhiều dòng sản phẩm trên 1 thẻ) ======
create table if not exists public.crm_kanban_card_items (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references public.crm_kanban_cards(id) on delete cascade,
  product_id    uuid,                              -- crm_products.id (logical FK)
  product_name  text,                              -- snapshot tại lúc thêm
  product_code  text,                              -- snapshot
  unit          text,
  quantity      numeric(18,2) not null default 1,
  unit_price    numeric(18,2),                     -- giá bán (snapshot từ crm_products.list_price/price)
  cost_price    numeric(18,2),                     -- giá vốn (snapshot từ crm_products.cost_price) — NHẠY CẢM
  line_subtotal numeric(18,2),                     -- quantity * unit_price (server tự tính, có thể lưu lại)
  position      int not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_kanban_card_items_card on public.crm_kanban_card_items(card_id);

-- ====== FINANCIALS (tổng hợp tài chính của thẻ — TÁCH RIÊNG, nhạy cảm) ======
create table if not exists public.crm_kanban_financials (
  card_id            uuid primary key references public.crm_kanban_cards(id) on delete cascade,
  currency           text not null default 'VND',
  unit_price         numeric(18,2),                 -- nhóm: selling (dùng khi 1 sản phẩm/thẻ)
  quantity           numeric(18,2),                 -- nhóm: selling
  subtotal           numeric(18,2),                 -- nhóm: selling
  total_amount       numeric(18,2),                 -- nhóm: selling
  cost_price         numeric(18,2),                 -- nhóm: cost — TỔNG giá vốn của thẻ
  margin             numeric(18,2),                 -- nhóm: cost
  invoice_no         text,                          -- nhóm: billing
  invoice_date       date,                          -- nhóm: billing
  debt_amount        numeric(18,2),                 -- nhóm: debt
  due_date           date,                          -- nhóm: debt
  paid_amount        numeric(18,2),                 -- nhóm: debt
  payment_status     text default 'unpaid'
                     check (payment_status in ('unpaid','partial','paid')),
  last_reminded_at   date                           -- phục vụ pg_cron §6.8
);

-- ====== LOGS (truy vết move/create) ======
create table if not exists public.crm_kanban_logs (
  id          bigint generated always as identity primary key,
  card_id     uuid references public.crm_kanban_cards(id) on delete cascade,
  actor_id    uuid,
  action      text not null,                       -- 'create' | 'move' | 'update' | 'rental_period_create' | 'debt_reminder'
  from_stage  text,
  to_stage    text,
  meta        jsonb,
  at          timestamptz not null default now()
);
create index if not exists idx_kanban_logs_card on public.crm_kanban_logs(card_id, at desc);

-- ====== INDEXES trên cards ======
create index if not exists idx_kanban_cards_stage   on public.crm_kanban_cards(current_stage) where status='active';
create index if not exists idx_kanban_cards_dept    on public.crm_kanban_cards(owner_dept);
create index if not exists idx_kanban_cards_assignee on public.crm_kanban_cards(assigned_to);
create index if not exists idx_kanban_cards_parent  on public.crm_kanban_cards(parent_card_id);
create index if not exists idx_kanban_cards_created_by on public.crm_kanban_cards(created_by);

-- ====== TRIGGER updated_at ======
create or replace function public.tg_kanban_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

drop trigger if exists trg_kanban_cards_touch on public.crm_kanban_cards;
create trigger trg_kanban_cards_touch
  before update on public.crm_kanban_cards
  for each row execute function public.tg_kanban_touch_updated_at();

drop trigger if exists trg_kanban_card_items_touch on public.crm_kanban_card_items;
create trigger trg_kanban_card_items_touch
  before update on public.crm_kanban_card_items
  for each row execute function public.tg_kanban_touch_updated_at();

-- ====== EXTEND crm_notifications (dùng chung, KHÔNG drop) ======
-- Spec §6.9 cần card_id nullable để chuông Kanban hoạt động.
-- Bảng cũ có entity_type/entity_id (đa hình). Thêm card_id cho nhanh + nguyên vẹn FK.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='crm_notifications' and column_name='card_id'
  ) then
    alter table public.crm_notifications
      add column card_id uuid references public.crm_kanban_cards(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_notif_user_unread
  on public.crm_notifications(user_id, is_read, created_at desc)
  where is_deleted = false;

create index if not exists idx_notif_card
  on public.crm_notifications(card_id)
  where card_id is not null;

-- ====== Comment để DK đọc nhanh schema ======
comment on table public.crm_kanban_cards       is 'Kanban v2 — thẻ độc lập, không gắn cứng vào order/ticket.';
comment on table public.crm_kanban_financials  is 'Kanban v2 — tài chính TÁCH RIÊNG, RLS chặn anon/authenticated; chỉ Edge Function (service_role) đọc.';
comment on table public.crm_kanban_card_items  is 'Kanban v2 — nhiều dòng sản phẩm/thẻ; snapshot cost_price từ crm_products tại lúc thêm.';
comment on table public.crm_kanban_stages      is 'Kanban v2 — cấu hình cột (KD_OPEN, KD_WON, ...). Public-readable.';
comment on table public.crm_kanban_transitions is 'Kanban v2 — luật kéo-nhả (card_type × from→to + role/dept/require_fields).';
comment on table public.crm_kanban_logs        is 'Kanban v2 — audit log move/create/reminder.';
comment on column public.crm_notifications.card_id is 'Kanban v2 — FK tới crm_kanban_cards. Cho phép null vì bảng dùng chung với module khác.';
