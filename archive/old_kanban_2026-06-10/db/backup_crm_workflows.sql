-- ============================================================================
-- FILE NÀY KHÔNG PHẢI BACKUP — CHỈ LÀ HƯỚNG DẪN.
-- Backup THẬT chạy bằng script ngoài DB (pg_dump + psql).
-- ============================================================================
--
-- → Linux/macOS:    bash    archive/old_kanban_2026-06-10/db/backup_crm_workflows.sh
-- → Windows:        powershell -File archive/old_kanban_2026-06-10/db/backup_crm_workflows.ps1
--
-- Cả hai script đều tạo 4 file output trong thư mục archive/old_kanban_2026-06-10/db/:
--   crm_workflows_data.sql     ← INSERT statements, restore lại được
--   crm_workflows_data.csv     ← CSV để xem nhanh
--   crm_workflows_schema.sql   ← CREATE TABLE definition
--   crm_workflows_count.txt    ← thống kê (tổng dòng, sớm/mới nhất)
--
-- Trước khi chạy, set biến môi trường:
--   bash:        export SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
--   powershell:  $env:SUPABASE_DB_URL = "postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
--
-- Lấy connection string ở: Supabase Dashboard → Project Settings → Database → Connection string → URI.
--
-- ============================================================================
-- Nếu KHÔNG cài được pg_dump local, fallback bằng Supabase SQL Editor:
-- ============================================================================
-- Chạy lệnh dưới TRONG SQL Editor. Kết quả là 1 cột text — copy toàn bộ vào file
-- crm_workflows_data.sql trong thư mục này:
SELECT
  'INSERT INTO public.crm_workflows VALUES (' ||
    quote_literal(id::text) || '::uuid, ' ||
    quote_nullable(code) || ', ' ||
    quote_nullable(workflow_type) || ', ' ||
    quote_nullable(entity_type) || ', ' ||
    COALESCE(quote_literal(entity_id::text) || '::uuid', 'NULL') || ', ' ||
    quote_nullable(current_stage) || ', ' ||
    quote_nullable(current_dept) || ', ' ||
    COALESCE(quote_literal(assigned_to::text) || '::uuid', 'NULL') || ', ' ||
    quote_nullable(priority) || ', ' ||
    COALESCE(quote_literal(due_date::text) || '::date', 'NULL') || ', ' ||
    COALESCE(quote_literal(history::text) || '::jsonb', 'NULL') || ', ' ||
    quote_nullable(status) || ', ' ||
    quote_literal(created_at::text) || '::timestamptz, ' ||
    COALESCE(quote_literal(created_by::text) || '::uuid', 'NULL') || ', ' ||
    quote_literal(updated_at::text) || '::timestamptz, ' ||
    COALESCE(quote_literal(updated_by::text) || '::uuid', 'NULL') || ', ' ||
    COALESCE(is_deleted::text, 'false') ||
  ');' AS sql
FROM public.crm_workflows
ORDER BY created_at;
