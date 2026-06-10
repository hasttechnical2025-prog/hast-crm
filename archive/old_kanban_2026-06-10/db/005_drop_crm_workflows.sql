-- ============================================================================
-- BƯỚC PHÁ HỦY DUY NHẤT: DROP bảng Kanban cũ public.crm_workflows
-- Tham chiếu: plans/kanban_rebuild_spec.md §9.4
-- ============================================================================
-- ⚠️  FILE NÀY KHÔNG NẰM TRONG supabase/migrations/ — KHÔNG chạy qua `supabase db push`.
--     DK chạy THỦ CÔNG ở bước cuối, sau khi:
--     1) Đã backup THẬT bằng script backup_crm_workflows.sh / .ps1 trong cùng thư mục.
--        Verify 4 file output (crm_workflows_data.sql/.csv, schema.sql, count.txt) đã sinh.
--     2) Migration 001–004 đã `supabase db push` thành công + Kanban v2 verify ổn.
--     3) Đã commit các file backup vào git để có dấu vết.
--
-- Cách chạy (chọn 1):
--   A) psql -v ON_ERROR_STOP=1 -f archive/old_kanban_2026-06-10/db/005_drop_crm_workflows.sql "$SUPABASE_DB_URL"
--   B) Copy 2 dòng SQL phía dưới vào Supabase Studio → SQL Editor → Run.
--
-- Idempotent: dùng IF EXISTS. Chạy lại không lỗi.
-- ============================================================================

-- Drop bảng crm_workflows. Mọi FK/INDEX/POLICY của bảng này sẽ tự drop theo.
drop table if exists public.crm_workflows cascade;

-- Comment dấu vết
do $$
begin
  raise notice 'Bảng public.crm_workflows đã được DROP (Kanban v1 — Phase 4B). Backup tại archive/old_kanban_2026-06-10/.';
end $$;
