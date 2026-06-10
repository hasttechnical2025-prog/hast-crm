# BACKUP — Kanban / Workflow cũ (Phase 4B)

Ngày: **2026-06-10**
Nhánh git: `feature/kanban-rebuild-2026-06-10`
Tham chiếu: [INVENTORY_2026-06-10.md](../INVENTORY_2026-06-10.md), `plans/kanban_rebuild_spec.md`

## Nội dung folder này

```
old_kanban_2026-06-10/
├── README.md                           ← file này
├── src_controllers/
│   └── workflowController.js           ← copy nguyên file (đã XÓA khỏi src/controllers/)
│                                          (tên thư mục là src_controllers thay vì backend
│                                           vì .gitignore có dòng "backend/" nuốt mất)
├── frontend/
│   ├── kanban.js                       ← copy nguyên js/modules/kanban.js (đã REWRITE)
│   ├── index_html_workflow_block.html  ← khối UI cũ trong index.html (đã THAY)
│   └── style_phase4b_kanban_block.css  ← khối CSS cũ trong style.css (đã XÓA)
└── db/
    ├── backup_crm_workflows.sh         ← script BASH chạy pg_dump + psql \copy
    ├── backup_crm_workflows.ps1        ← script PowerShell tương đương cho Windows
    ├── backup_crm_workflows.sql        ← chỉ là HƯỚNG DẪN + SQL fallback dùng Supabase Studio
    ├── 005_drop_crm_workflows.sql      ← LỆNH DROP — chạy THỦ CÔNG ở bước cuối,
    │                                     KHÔNG nằm trong supabase/migrations/
    │
    ├── (chưa có) crm_workflows_data.sql   ← sinh ra sau khi DK chạy script backup
    ├── (chưa có) crm_workflows_data.csv
    ├── (chưa có) crm_workflows_schema.sql
    └── (chưa có) crm_workflows_count.txt
```

## Thứ tự thực thi (BẮT BUỘC)

### Bước A — Push 001→004 + verify live

> Migration 005 (DROP) **không** nằm trong `supabase/migrations/` nữa →
> `supabase db push` sẽ CHỈ áp 001→004, không drop bảng cũ. An toàn.

1. `git push -u origin feature/kanban-rebuild-2026-06-10` (chưa merge vào main).
2. Chạy `supabase db push` để áp 4 migration **THÊM** (001 schema, 002 seed, 003 RLS, 004 pg_cron).
3. Nếu **migration 004 fail** (pg_cron không bật được): vào Supabase Dashboard → Database → Extensions → bật `pg_cron`, rerun. Nếu plan không hỗ trợ → báo lại để chuyển sang GitHub Actions cron.
4. Verify live (xem `archive/ACCEPTANCE_REPORT_2026-06-10.md` để biết chi tiết kiểm thử):
   - **Tiêu chí 9**: trong DevTools Console của frontend `hast-crm.vercel.app`, chạy `await supabase.from('crm_kanban_financials').select('*')` → kết quả phải rỗng hoặc lỗi 401/permission denied.
   - **Tiêu chí 12**: chạy `SELECT * FROM fn_debt_reminder_scan();` trong Supabase SQL Editor.
   - **Tiêu chí 1-2**: đăng nhập 1 user `staff/KD` và 1 user `staff/KT`. Mở Network tab khi click vào Kanban → response `kanban.board.get` **KHÔNG** chứa `cost_price` hoặc `costPrice` cho 2 user này. KT cũng không thấy `total_amount` của thẻ `ban_may`.
   - **Vai boss**: đăng nhập user role=`boss` → xem được mọi cột/thẻ; thử kéo thẻ hoặc bấm "Lưu" trong drawer → phải nhận **403 "Boss chỉ có quyền xem"**.

### Bước B — DROP `crm_workflows` (chỉ khi bước A xanh)

1. Set biến môi trường `SUPABASE_DB_URL` (Supabase Dashboard → Settings → Database → Connection string → URI).
2. Chạy backup THẬT:
   - Linux/macOS: `bash archive/old_kanban_2026-06-10/db/backup_crm_workflows.sh`
   - Windows: `powershell -File archive\old_kanban_2026-06-10\db\backup_crm_workflows.ps1`
3. Verify 4 file output xuất hiện trong `db/` (data.sql + data.csv + schema.sql + count.txt). Mở `count.txt` xem tổng số dòng — đối chiếu với UI Supabase Studio.
4. Commit các file output này (`git add archive/old_kanban_2026-06-10/db/crm_workflows_*` rồi commit).
5. Chỉ sau khi backup commit xong, mới chạy lệnh DROP **thủ công**:
   ```
   psql -v ON_ERROR_STOP=1 -f archive/old_kanban_2026-06-10/db/005_drop_crm_workflows.sql "$SUPABASE_DB_URL"
   ```
   hoặc copy 2 dòng SQL trong file 005 vào Supabase Studio → SQL Editor → Run.
6. Xác nhận `crm_workflows` đã biến mất: `\dt` trong psql hoặc kiểm tra Table Editor trên Studio.

### KHÔNG được làm

- ❌ Chạy 001→005 một lượt — phải tách 2 bước.
- ❌ Merge nhánh này vào `main` trước khi verify xong toàn bộ 14 tiêu chí.
- ❌ Deploy production trước khi merge.
- ❌ Khôi phục logic từ file `backend/workflowController.js` hay `frontend/kanban.js` trong folder này vào codebase mới — đó là code cũ có lỗi phân quyền.

### Sau khi xong

Giữ folder này NGUYÊN VẸN làm dấu vết audit, kể cả sau khi migration 005 chạy.
