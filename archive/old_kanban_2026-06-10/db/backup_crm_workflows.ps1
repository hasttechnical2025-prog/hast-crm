# =============================================================================
# BACKUP THẬT — public.crm_workflows trước khi chạy migration 005 (DROP)
# Phiên bản PowerShell (Windows). Tương đương backup_crm_workflows.sh
# Ngày: 2026-06-10
# =============================================================================
# Yêu cầu:
#   - pg_dump + psql trên PATH (cài Postgres client tools, ≥ 13).
#     Tải: https://www.postgresql.org/download/windows/
#   - Biến môi trường SUPABASE_DB_URL (Project Settings → Database → Connection string).
#
# Sử dụng:
#   $env:SUPABASE_DB_URL = "postgresql://postgres:[PASSWORD]@db.[ref].supabase.co:5432/postgres"
#   powershell -ExecutionPolicy Bypass -File archive/old_kanban_2026-06-10/db/backup_crm_workflows.ps1
# =============================================================================

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

if (-not $env:SUPABASE_DB_URL) {
  Write-Host "❌ Thiếu biến môi trường SUPABASE_DB_URL" -ForegroundColor Red
  Write-Host '   Ví dụ: $env:SUPABASE_DB_URL = "postgresql://postgres:xxx@db.abc.supabase.co:5432/postgres"'
  exit 1
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host "→ [1/4] Dump dữ liệu thành INSERT statements (data-only)..."
& pg_dump $env:SUPABASE_DB_URL `
  --no-owner --no-acl `
  --data-only `
  --inserts `
  --column-inserts `
  --table=public.crm_workflows `
  --file="crm_workflows_data.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump (data) failed" }
Write-Host "   ✓ crm_workflows_data.sql"

Write-Host "→ [2/4] Dump CSV..."
$copySql = "\copy (SELECT * FROM public.crm_workflows ORDER BY created_at) TO 'crm_workflows_data.csv' WITH (FORMAT csv, HEADER true)"
& psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -c $copySql
if ($LASTEXITCODE -ne 0) { throw "psql \copy failed" }
Write-Host "   ✓ crm_workflows_data.csv"

Write-Host "→ [3/4] Dump schema (CREATE TABLE)..."
& pg_dump $env:SUPABASE_DB_URL `
  --no-owner --no-acl `
  --schema-only `
  --table=public.crm_workflows `
  --file="crm_workflows_schema.sql"
if ($LASTEXITCODE -ne 0) { throw "pg_dump (schema) failed" }
Write-Host "   ✓ crm_workflows_schema.sql"

Write-Host "→ [4/4] Thống kê nhanh..."
$statsSql = @"
SELECT 'Backup tại $ts' AS info
UNION ALL SELECT 'Tổng số dòng: ' || COUNT(*) FROM public.crm_workflows
UNION ALL SELECT 'Đang hoạt động (is_deleted=false): ' || COUNT(*) FROM public.crm_workflows WHERE is_deleted = false
UNION ALL SELECT 'Đã xóa mềm (is_deleted=true): ' || COUNT(*) FROM public.crm_workflows WHERE is_deleted = true
UNION ALL SELECT 'Số loại workflow_type: ' || COUNT(DISTINCT workflow_type) FROM public.crm_workflows
UNION ALL SELECT 'Sớm nhất: ' || COALESCE(MIN(created_at)::text, 'N/A') FROM public.crm_workflows
UNION ALL SELECT 'Mới nhất: ' || COALESCE(MAX(updated_at)::text, 'N/A') FROM public.crm_workflows;
"@
& psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 --no-psqlrc --quiet --tuples-only --no-align -c $statsSql | Out-File -Encoding utf8 "crm_workflows_count.txt"
if ($LASTEXITCODE -ne 0) { throw "psql stats failed" }
Get-Content "crm_workflows_count.txt"
Write-Host "   ✓ crm_workflows_count.txt"

Write-Host ""
Write-Host "✅ HOÀN TẤT. Các file backup tại: $scriptDir" -ForegroundColor Green
Get-ChildItem "crm_workflows_*" | Format-Table Name, Length, LastWriteTime
Write-Host ""
Write-Host "→ Bước tiếp theo: commit các file backup này, rồi mới chạy migration 005 (DROP)."
