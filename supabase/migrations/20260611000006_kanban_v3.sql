-- ============================================================================
-- Migration 006: Kanban v3 — mô hình HAI LUỒNG (commercial / technical)
-- Tham chiếu: plans/kanban_rebuild_spec.md v3 (§1A ưu tiên cao nhất)
-- ============================================================================
-- Quyết định DK đã chốt (2026-06-11):
--  - crm_kanban_payments là NGUỒN SỰ THẬT thanh toán; confirmed → sync về crm_orders.
--  - Kỳ thuê: tạo tay (KT-NV), pg_cron để sau.
--  - BỎ bước "Thu hồi máy" (TECH_RECOVER) — luồng thuê kỹ thuật 3 bước.
--  - KT vào tab Bán hàng nhưng server lọc đơn theo phòng (guard ở crudController).
--
-- Migration idempotent. KHÔNG đè migration 001-004 đã áp.
-- ============================================================================

-- ====== 1. SCHEMA THÊM CỘT ======
alter table public.crm_kanban_stages
  add column if not exists track text check (track in ('commercial','technical'));

alter table public.crm_kanban_cards
  add column if not exists order_id uuid references public.crm_orders(id) on delete set null,
  add column if not exists track text check (track in ('commercial','technical')),
  add column if not exists customer_address text;

create index if not exists idx_kanban_cards_order on public.crm_kanban_cards(order_id);
create index if not exists idx_kanban_cards_track on public.crm_kanban_cards(track);

-- ====== 2. SỔ THANH TOÁN CÓ XÁC NHẬN (§1A) ======
create table if not exists public.crm_kanban_payments (
  id             uuid primary key default gen_random_uuid(),
  card_id        uuid not null references public.crm_kanban_cards(id) on delete cascade,
  amount         numeric(18,2) not null check (amount > 0),
  recorded_by    uuid not null,                 -- crm_users.id người ghi khoản
  recorded_dept  text not null,                 -- code phòng người ghi (KD/KTHC/...)
  status         text not null default 'pending' check (status in ('pending','confirmed')),
  confirmed_by   uuid,                          -- KTHC user xác nhận
  confirmed_at   timestamptz,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_kanban_payments_card on public.crm_kanban_payments(card_id, status);

alter table public.crm_kanban_payments enable row level security;
revoke all on public.crm_kanban_payments from anon, authenticated;

comment on table public.crm_kanban_payments is
  'Kanban v3 — sổ thanh toán có xác nhận. KD ghi pending (CHƯA trừ nợ); KTHC confirm mới đối trừ. Nguồn sự thật tiền; confirmed sync về crm_orders.';

-- ====== 3. DỌN DỮ LIỆU TEST v2 ======
-- Mọi thẻ v2 là thẻ test (chưa có dữ liệu thật — DK xác nhận trong spec §3).
-- DELETE cards → cascade: financials, card_items, logs, payments, notifications.card_id.
delete from public.crm_kanban_cards;

-- ====== 4. SEED LẠI STAGES + TRANSITIONS (hai luồng) ======
-- Transitions tham chiếu stages → xóa transitions trước, rồi stages.
delete from public.crm_kanban_transitions;
delete from public.crm_kanban_stages;

-- Stages v3. owner_dept='ORIGIN' = phòng tạo đơn (đọc từ card.owner_dept lúc runtime).
insert into public.crm_kanban_stages (id, name, owner_dept, sort_order, is_terminal, track) values
 ('COM_NEW',        'Đơn mới',                                  'ORIGIN', 10,  false, 'commercial'),
 ('COM_INVOICE',    'KTHC – Cần lên hóa đơn',                   'KTHC',   20,  false, 'commercial'),
 ('COM_DEBT',       'KTHC – Đã lên hóa đơn / Thu hồi công nợ',  'KTHC',   30,  false, 'commercial'),
 ('COM_DONE',       'Hoàn tất',                                 'ORIGIN', 40,  true,  'commercial'),
 ('TECH_TODO',      'KT – Cần lắp / giao máy',                  'KT',     110, false, 'technical'),
 ('TECH_INSTALLED', 'KT – Đã lắp / chạy tốt',                   'KT',     120, false, 'technical'),
 ('TECH_ACTIVE',    'Đang cho thuê',                            'KT',     125, false, 'technical'),
 ('TECH_DONE',      'Hoàn tất kỹ thuật',                        'KT',     140, true,  'technical')
on conflict (id) do update set
  name = excluded.name, owner_dept = excluded.owner_dept,
  sort_order = excluded.sort_order, is_terminal = excluded.is_terminal, track = excluded.track;

-- Transitions v3.
-- Quy ước: COM_DEBT→COM_DONE KHÔNG có transition kéo tay — auto khi số dư công nợ = 0
-- (server tự move) hoặc force-close (admin + KTHC-TP, action riêng kanban.card.forceClose).
-- Kéo lùi: TP/admin, đúng 1 bước, CẤM về COM_NEW (không seed transition nào về COM_NEW).

-- ===== THƯƠNG MẠI — ban_may (origin KD) =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('ban_may', 'COM_NEW',     'COM_INVOICE', 'forward',  '["truong_phong","admin"]'::jsonb,              'KD',   '[]'::jsonb),
 ('ban_may', 'COM_INVOICE', 'COM_DEBT',    'forward',  '["nhan_vien","truong_phong","admin"]'::jsonb,  'KTHC', '["invoice_no","invoice_date"]'::jsonb),
 ('ban_may', 'COM_DEBT',    'COM_INVOICE', 'backward', '["truong_phong","admin"]'::jsonb,              'KTHC', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction = excluded.direction, allowed_roles = excluded.allowed_roles,
  acting_dept = excluded.acting_dept, require_fields = excluded.require_fields;

-- ===== THƯƠNG MẠI — ban_vat_tu (origin KT) =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('ban_vat_tu', 'COM_NEW',     'COM_INVOICE', 'forward',  '["truong_phong","admin"]'::jsonb,              'KT',   '[]'::jsonb),
 ('ban_vat_tu', 'COM_INVOICE', 'COM_DEBT',    'forward',  '["nhan_vien","truong_phong","admin"]'::jsonb,  'KTHC', '["invoice_no","invoice_date"]'::jsonb),
 ('ban_vat_tu', 'COM_DEBT',    'COM_INVOICE', 'backward', '["truong_phong","admin"]'::jsonb,              'KTHC', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction = excluded.direction, allowed_roles = excluded.allowed_roles,
  acting_dept = excluded.acting_dept, require_fields = excluded.require_fields;

-- ===== THƯƠNG MẠI — thue_may_ky (kỳ thuê; origin KT theo §1A — KT-NV tạo, KT đẩy) =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('thue_may_ky', 'COM_NEW',     'COM_INVOICE', 'forward',  '["truong_phong","admin"]'::jsonb,              'KT',   '[]'::jsonb),
 ('thue_may_ky', 'COM_INVOICE', 'COM_DEBT',    'forward',  '["nhan_vien","truong_phong","admin"]'::jsonb,  'KTHC', '["invoice_no","invoice_date"]'::jsonb),
 ('thue_may_ky', 'COM_DEBT',    'COM_INVOICE', 'backward', '["truong_phong","admin"]'::jsonb,              'KTHC', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction = excluded.direction, allowed_roles = excluded.allowed_roles,
  acting_dept = excluded.acting_dept, require_fields = excluded.require_fields;

-- ===== KỸ THUẬT — ban_may =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('ban_may', 'TECH_TODO',      'TECH_INSTALLED', 'forward',  '["nhan_vien","truong_phong","admin"]'::jsonb, 'KT', '[]'::jsonb),
 ('ban_may', 'TECH_INSTALLED', 'TECH_DONE',      'forward',  '["truong_phong","admin"]'::jsonb,             'KT', '[]'::jsonb),
 ('ban_may', 'TECH_INSTALLED', 'TECH_TODO',      'backward', '["truong_phong","admin"]'::jsonb,             'KT', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction = excluded.direction, allowed_roles = excluded.allowed_roles,
  acting_dept = excluded.acting_dept, require_fields = excluded.require_fields;

-- ===== KỸ THUẬT — thue_may (3 bước, ĐÃ BỎ Thu hồi máy theo DK) =====
insert into public.crm_kanban_transitions (card_type, from_stage, to_stage, direction, allowed_roles, acting_dept, require_fields) values
 ('thue_may', 'TECH_TODO',   'TECH_ACTIVE', 'forward',  '["truong_phong","admin"]'::jsonb, 'KT', '[]'::jsonb),
 ('thue_may', 'TECH_ACTIVE', 'TECH_DONE',   'forward',  '["truong_phong","admin"]'::jsonb, 'KT', '[]'::jsonb),
 ('thue_may', 'TECH_ACTIVE', 'TECH_TODO',   'backward', '["truong_phong","admin"]'::jsonb, 'KT', '[]'::jsonb)
on conflict (card_type, from_stage, to_stage) do update set
  direction = excluded.direction, allowed_roles = excluded.allowed_roles,
  acting_dept = excluded.acting_dept, require_fields = excluded.require_fields;

-- ====== 5. CẬP NHẬT HÀM NHẮC NỢ → cột COM_DEBT ======
create or replace function public.fn_debt_reminder_scan()
returns table (
  cards_scanned    int,
  cards_overdue    int,
  notifications_in int
) language plpgsql as $$
declare
  v_card           record;
  v_kthc_dept_id   uuid;
  v_recipient      uuid;
  v_recipients     uuid[];
  v_days_overdue   int;
  v_notif_count    int := 0;
  v_overdue_count  int := 0;
  v_scan_count     int := 0;
  v_title          text;
  v_body           text;
  v_existing_count int;
begin
  select id into v_kthc_dept_id
    from public.crm_departments
    where upper(code) = 'KTHC' and coalesce(is_deleted, false) = false
    limit 1;

  for v_card in
    select c.*, f.due_date, f.payment_status, f.last_reminded_at, f.debt_amount
      from public.crm_kanban_cards c
      join public.crm_kanban_financials f on f.card_id = c.id
     where c.status = 'active'
       and c.current_stage = 'COM_DEBT'           -- v3: cột "Đã lên hóa đơn / Thu hồi công nợ"
       and f.due_date is not null
       and f.due_date < current_date
       and coalesce(f.payment_status, 'unpaid') <> 'paid'
       and (f.last_reminded_at is null
            or current_date - f.last_reminded_at >= 15)
  loop
    v_scan_count := v_scan_count + 1;
    v_overdue_count := v_overdue_count + 1;
    v_days_overdue := (current_date - v_card.due_date)::int;

    v_recipients := array[]::uuid[];
    if v_kthc_dept_id is not null then
      select coalesce(array_agg(distinct u.id), array[]::uuid[])
        into v_recipients
        from public.crm_users u
        where u.department_id = v_kthc_dept_id
          and coalesce(u.is_deleted, false) = false
          and coalesce(u.status, 'active') = 'active';
    end if;
    if v_card.created_by is not null
       and not (v_card.created_by = any(v_recipients)) then
      v_recipients := array_append(v_recipients, v_card.created_by);
    end if;

    v_title := 'Công nợ quá hạn ' || v_days_overdue || ' ngày';
    v_body  := 'Thẻ "' || v_card.title || '"'
            || coalesce(' của KH ' || v_card.customer_name, '')
            || ' đã quá hạn ' || v_days_overdue || ' ngày.'
            || coalesce(' Số tiền còn nợ: ' || v_card.debt_amount, '');

    foreach v_recipient in array v_recipients loop
      select count(*) into v_existing_count
        from public.crm_notifications
        where user_id = v_recipient
          and card_id = v_card.id
          and type    = 'debt_overdue'
          and created_at >= now() - interval '15 days';
      if v_existing_count = 0 then
        insert into public.crm_notifications
          (user_id, type, title, message, entity_type, entity_id, card_id, is_read, priority, created_at, updated_at)
        values
          (v_recipient, 'debt_overdue', v_title, v_body, 'kanban_card', v_card.id, v_card.id, false, 'high', now(), now());
        v_notif_count := v_notif_count + 1;
      end if;
    end loop;

    update public.crm_kanban_financials
       set last_reminded_at = current_date
     where card_id = v_card.id;

    insert into public.crm_kanban_logs (card_id, actor_id, action, from_stage, to_stage, meta)
    values (
      v_card.id, null, 'debt_reminder', v_card.current_stage, v_card.current_stage,
      jsonb_build_object('days_overdue', v_days_overdue,
                         'recipient_count', array_length(v_recipients, 1),
                         'due_date', v_card.due_date)
    );
  end loop;

  cards_scanned := v_scan_count;
  cards_overdue := v_overdue_count;
  notifications_in := v_notif_count;
  return next;
end $$;

-- ====== 6. Comment ======
comment on column public.crm_kanban_cards.track is 'commercial = thẻ thương mại (dòng tiền) | technical = thẻ kỹ thuật (lắp/giao máy, KHÔNG giá).';
comment on column public.crm_kanban_cards.order_id is 'Đơn hàng nguồn (crm_orders) — thẻ sinh từ đơn, không tạo tay.';
comment on column public.crm_kanban_stages.owner_dept is 'Code phòng phụ trách cột; ORIGIN = phòng tạo đơn (đọc card.owner_dept lúc runtime).';
