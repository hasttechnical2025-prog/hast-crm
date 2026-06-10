-- ============================================================================
-- Migration 003: RLS + GRANTS cho Kanban v2
-- Tham chiếu: plans/kanban_rebuild_spec.md §7
-- ============================================================================
-- Mô hình bảo mật:
--   - Backend (Express, service_role) bypass RLS → đọc/ghi mọi bảng được.
--   - Client (anon/authenticated) KHÔNG được đọc thẳng:
--       * crm_kanban_financials (giá vốn — nhạy cảm nhất)
--       * crm_kanban_card_items (snapshot cost_price từng dòng)
--       * crm_kanban_cards, crm_kanban_logs (dữ liệu nghiệp vụ qua endpoint)
--   - Client ĐƯỢC đọc qua endpoint duy nhất `/api` (action kanban.*).
--   - Cấu hình (stages, transitions): cho phép đọc public (chỉ là metadata).
-- ============================================================================

-- ====== BẬT RLS ======
alter table public.crm_kanban_cards       enable row level security;
alter table public.crm_kanban_financials  enable row level security;
alter table public.crm_kanban_card_items  enable row level security;
alter table public.crm_kanban_logs        enable row level security;
alter table public.crm_kanban_stages      enable row level security;
alter table public.crm_kanban_transitions enable row level security;

-- ====== REVOKE quyền mặc định ======
-- service_role vẫn full access (Supabase mặc định). anon/authenticated bị chặn.
revoke all on public.crm_kanban_cards       from anon, authenticated;
revoke all on public.crm_kanban_financials  from anon, authenticated;
revoke all on public.crm_kanban_card_items  from anon, authenticated;
revoke all on public.crm_kanban_logs        from anon, authenticated;

-- ====== KHÔNG tạo policy cho anon/authenticated trên bảng nhạy cảm ======
-- → khi client gọi thẳng REST API Supabase với anon/authenticated key:
--   - SELECT bị chặn (không policy → empty result).
--   - INSERT/UPDATE/DELETE bị chặn.
-- → BUỘC mọi truy cập đi qua endpoint backend.

-- ====== STAGES + TRANSITIONS: cho phép đọc (chỉ là cấu hình, không nhạy cảm) ======
-- Để frontend có thể fetch trực tiếp nếu cần biết tên cột.
grant select on public.crm_kanban_stages      to anon, authenticated;
grant select on public.crm_kanban_transitions to anon, authenticated;

drop policy if exists kanban_stages_read on public.crm_kanban_stages;
create policy kanban_stages_read
  on public.crm_kanban_stages
  for select
  to anon, authenticated
  using (true);

drop policy if exists kanban_transitions_read on public.crm_kanban_transitions;
create policy kanban_transitions_read
  on public.crm_kanban_transitions
  for select
  to anon, authenticated
  using (true);

-- ====== crm_notifications: bảng DÙNG CHUNG ======
-- Spec §7: bật RLS, chỉ cho user đọc notification của chính mình.
-- Vì dự án dùng JWT custom (KHÔNG phải Supabase Auth) → auth.uid() sẽ NULL.
-- → Đặt policy có vẻ chặt nhưng thực tế client cũng không đọc trực tiếp;
--   notification đi qua endpoint backend (service_role) cũng được.
do $$
begin
  if exists (
    select 1 from pg_tables where schemaname='public' and tablename='crm_notifications'
  ) then
    execute 'alter table public.crm_notifications enable row level security';
    execute 'revoke all on public.crm_notifications from anon, authenticated';
  end if;
end $$;

drop policy if exists notif_read_own on public.crm_notifications;
create policy notif_read_own
  on public.crm_notifications
  for select
  to authenticated
  using ( user_id = auth.uid() );  -- non-Supabase-Auth setups: kết quả = empty → vẫn an toàn.

-- ====== Comment policy intent ======
comment on policy kanban_stages_read      on public.crm_kanban_stages       is 'Cấu hình cột — public-readable (metadata, không nhạy cảm).';
comment on policy kanban_transitions_read on public.crm_kanban_transitions  is 'Luật chuyển stage — public-readable (frontend cần biết để vẽ UI).';
