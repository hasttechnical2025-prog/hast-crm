#!/usr/bin/env bash
# ============================================================================
# BACKUP THẬT — public.crm_workflows trước khi chạy migration 005 (DROP)
# Ngày: 2026-06-10
# ============================================================================
# Yêu cầu: pg_dump (≥ Postgres 13) và DATABASE_URL của Supabase project.
#
# Cách lấy DATABASE_URL:
#   Supabase Dashboard → Project Settings → Database → Connection string → URI
#   (chọn "Use connection pooling: Session" hoặc "Direct connection")
#
# Sử dụng:
#   export SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
#   bash archive/old_kanban_2026-06-10/db/backup_crm_workflows.sh
#
# Output (lưu trong cùng thư mục):
#   crm_workflows_data.sql    — INSERT statements (restore lại được)
#   crm_workflows_data.csv    — CSV để xem nhanh
#   crm_workflows_schema.sql  — CREATE TABLE definition
#   crm_workflows_count.txt   — số dòng + thống kê nhanh
# ============================================================================

set -euo pipefail

# Resolve thư mục chứa script (làm việc với cả relative path)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "❌ Thiếu biến môi trường SUPABASE_DB_URL"
  echo "   Ví dụ: export SUPABASE_DB_URL=\"postgresql://postgres:xxx@db.abc.supabase.co:5432/postgres\""
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"

echo "→ [1/4] Dump dữ liệu thành INSERT statements (data-only)..."
pg_dump "$SUPABASE_DB_URL" \
  --no-owner --no-acl \
  --data-only \
  --inserts \
  --column-inserts \
  --table=public.crm_workflows \
  --file="crm_workflows_data.sql"
echo "   ✓ crm_workflows_data.sql"

echo "→ [2/4] Dump CSV bằng psql \\copy..."
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -c "\copy (SELECT * FROM public.crm_workflows ORDER BY created_at) TO 'crm_workflows_data.csv' WITH (FORMAT csv, HEADER true)"
echo "   ✓ crm_workflows_data.csv"

echo "→ [3/4] Dump schema (CREATE TABLE definition)..."
pg_dump "$SUPABASE_DB_URL" \
  --no-owner --no-acl \
  --schema-only \
  --table=public.crm_workflows \
  --file="crm_workflows_schema.sql"
echo "   ✓ crm_workflows_schema.sql"

echo "→ [4/4] Thống kê nhanh..."
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  --no-psqlrc --quiet --tuples-only --no-align \
  -c "SELECT
        'Backup tại ${TS}' AS info
        UNION ALL SELECT 'Tổng số dòng: ' || COUNT(*) FROM public.crm_workflows
        UNION ALL SELECT 'Đang hoạt động (is_deleted=false): ' || COUNT(*) FROM public.crm_workflows WHERE is_deleted = false
        UNION ALL SELECT 'Đã xóa mềm (is_deleted=true): ' || COUNT(*) FROM public.crm_workflows WHERE is_deleted = true
        UNION ALL SELECT 'Số loại workflow_type: ' || COUNT(DISTINCT workflow_type) FROM public.crm_workflows
        UNION ALL SELECT 'Sớm nhất: ' || COALESCE(MIN(created_at)::text, 'N/A') FROM public.crm_workflows
        UNION ALL SELECT 'Mới nhất: ' || COALESCE(MAX(updated_at)::text, 'N/A') FROM public.crm_workflows;" \
  > "crm_workflows_count.txt"
cat "crm_workflows_count.txt"
echo "   ✓ crm_workflows_count.txt"

echo ""
echo "✅ HOÀN TẤT. Các file backup tại: $SCRIPT_DIR"
ls -lh "$SCRIPT_DIR"/crm_workflows_* 2>/dev/null || true
echo ""
echo "→ Bước tiếp theo: commit các file backup này (chúng KHÔNG bị gitignore — *.sql/*.csv tracked)."
echo "  Sau đó mới chạy migration 005 (DROP)."
