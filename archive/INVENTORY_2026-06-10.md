# INVENTORY — Kanban cũ trong repo HAST_CRM

> Ngày khảo sát: **2026-06-10**
> Người thực hiện: Claude Code (theo `plans/kanban_rebuild_spec.md` §9.1)
> **Đây là báo cáo READ-ONLY.** Không có tệp/bảng/code nào bị sửa hoặc xóa trong giai đoạn này.

---

## 0. Tóm tắt cho DK (đọc cái này trước)

- Module cũ tên là **"Workflow / Quy trình liên phòng ban (Phase 4B)"**. Code dùng từ `workflow` nhưng UI/CSS gọi nó là **Kanban Board** → chính là module spec muốn đập bỏ.
- **Không có bảng/tệp nào trùng tên schema mới `crm_kanban_*`.** Schema mới có thể tạo trực tiếp không cần đổi tên.
- **Có 1 bảng dùng chung cần quan tâm:** `crm_notifications` đã tồn tại với cột khác spec §6.9 (`message`, `entity_type`, `entity_id`, `priority`, `read_at`, `code`, `is_deleted`…). Vì bảng này còn được nhiều module khác dùng (xem §6 bên dưới), **kiến nghị: KHÔNG drop, mà thêm cột `card_id uuid` rồi map `entity_type='kanban_card', entity_id=card_id` để dùng chung** (chi tiết §6 + Câu hỏi cho DK).
- **Bảng sản phẩm có sẵn = `public.crm_products`** — đã có cột `cost_price numeric`, `list_price`, `price`, `rent_price_per_month`, `category`, `is_for_rent`. Đủ để wire spec §6.10.
- Runtime gác cổng = **Express API route trên Vercel** (`api/index.js`), **không** phải Supabase Edge Functions (Deno). Lý do: dự án đã là backend Node.js (Express + service_role) — theo spec §0.5 thì đặt endpoint cùng nơi cho nhất quán.
- Old Kanban có **móc nối vào module Orders/Tickets** (tự sinh workflow khi tạo Order/Ticket). Đập bỏ cần ngắt 2 chỗ ở `crudController.js` (mục §6.2).

→ **Đề xuất danh sách CHO PHÉP BỎ** ở §10 cuối file này. Đề nghị DK duyệt rồi mới sang Giai đoạn 2.

---

## 1. Runtime / nơi đặt secure endpoints (spec §9.1b)

**Kết luận: Vercel API route (Node.js + Express) — KHÔNG dùng Supabase Edge Functions.**

Bằng chứng:
- `package.json` → `"main": "api/index.js"`, deps: `express`, `@supabase/supabase-js`, `cors`, `morgan`.
- `vercel.json` → `routes: [{src:"/api(.*)", dest:"api/index.js"}]` — Vercel route mọi `/api/*` về Express handler.
- `api/index.js` → một Express app duy nhất, `app.post('/api', handleRequest)` — toàn bộ RPC vào qua 1 endpoint.
- `src/config/index.js` → khởi tạo Supabase client với `SUPABASE_ANON_KEY` (CLAUDE.md ghi rõ trên Vercel biến này phải set = `service_role` để bypass RLS).
- `src/middlewares/auth.js` đã có JWT-based authentication.
- **Không có** `next.config.*`, `pages/api`, `app/api`. Không có thư mục `supabase/functions/`.

**Tác động lên spec mục 6:** Cài 4 "Edge Functions" (`kanban-board`, `kanban-move`, `kanban-card`, `rental-period-create`) + `kanban-notifications` thành **5 action mới trong `mainController.js`** (ví dụ `kanban.board`, `kanban.move`, `kanban.card.upsert`, `kanban.rentalPeriod.create`, `kanban.notifications.list/read`). Logic, input/output, kiểm tra quyền **giữ nguyên 100%** theo spec.

**`pg_cron` (spec §6.8):** không khảo sát được offline. Trong giai đoạn 3 sẽ thử `CREATE EXTENSION pg_cron` trong migration; nếu Supabase project plan không cho bật, sẽ báo DK chuyển sang GitHub Actions cron gọi endpoint.

---

## 2. Bảng DB liên quan Kanban cũ

> Nguồn: `supabase/migrations/00000000000000_baseline.sql` + `_legacy_sql/FIX_DEPT_UUID_TO_TEXT.sql`.
> Trong DB hiện tại **không có** schema mới `crm_kanban_*` → không xung đột tên.

### 2.1. `public.crm_workflows` (line 991) — BẢNG CHÍNH CỦA MODULE CŨ
- Cột: `id, code, workflow_type ('sales'|'installation'|'maintenance'), entity_type ('order'|'ticket'), entity_id, current_stage, current_dept, assigned_to, priority, due_date, history (jsonb), status, created_at/by, updated_at/by, is_deleted`.
- 1 thẻ workflow gắn cứng vào 1 Order hoặc 1 Ticket (1-1). Không phải kanban "thẻ độc lập" như spec mới.
- Đề xuất: **DROP sau khi backup** (xem §10).

### 2.2. `public.crm_notifications` (line 707) — **DÙNG CHUNG, KHÔNG NÊN DROP**
- Cột: `id, code, user_id, type, title, message, entity_type, entity_id, is_read, read_at, priority ('normal'|'high'), created_at/by, updated_at/by, is_deleted`.
- Đang được dùng bởi:
  - `src/controllers/notificationController.js` (3 action `notification.*`)
  - `src/controllers/workflowController.js` (`createNotification`, `createNotificationForDept`, `notifyWorkflowMoved`)
  - `js/modules/notifications.js` (UI chuông; mặt nạ icon cho `workflow_assigned`, `workflow_moved`)
- **Khác biệt với spec §6.9:**
  | Spec mới muốn | Bảng hiện có |
  |---|---|
  | `body text` | `message text` |
  | `card_id uuid FK crm_kanban_cards` | `entity_type text + entity_id uuid` (đa hình) |
  | type ∈ {`debt_overdue`,`card_assigned`,`card_handoff`,`card_returned`} | type free-form (đang có `workflow_assigned`, `workflow_moved`) |
- **Đề xuất:** KHÔNG drop bảng. Thêm cột nullable `card_id uuid references crm_kanban_cards(id) on delete cascade` để Kanban mới dùng riêng. Map `body → message`. Type mới (`card_assigned`, `card_handoff`, `card_returned`, `debt_overdue`) cùng tồn tại với type cũ. **Cần DK duyệt cách này** trước khi code.

### 2.3. `public.crm_users` (line 963)
- HIỆN CÓ `role text` với CHECK `('admin','boss','manager','staff')`.
- HIỆN CÓ `department_id uuid` → FK `crm_departments(id)`.
- **Khác spec §3:** spec yêu cầu `role ∈ ('boss','truong_phong','nhan_vien')` và `department text ∈ ('KD','KT','KTHC')`.
- **Đề xuất ánh xạ (KHÔNG đổi schema users, dịch ở Edge Function):**
  - `admin` → coi như `boss` (full access) — hoặc xử lý riêng "admin" như super-boss
  - `boss` → `boss`
  - `manager` → `truong_phong`
  - `staff` → `nhan_vien`
  - Phòng: resolve `user.department_id → crm_departments.code` (KD/KT/KTHC) — code này đã có constraint UNIQUE.
- **Cần DK xác nhận:** có 4 role hiện hành (admin/boss/manager/staff), spec chỉ định nghĩa 3 (boss/truong_phong/nhan_vien). Hỏi: "admin" được coi như "boss" (full quyền) đúng không?

### 2.4. `public.crm_departments` (line 648)
- Cột: `id uuid, code text UNIQUE, name, is_active, description, …`.
- Spec yêu cầu phòng = enum 'KD'|'KT'|'KTHC'. Trong DB phòng là bảng riêng có `code`.
- **Cần DK xác nhận:** trong DB hiện đã có 3 dòng với `code='KD'`, `'KT'`, `'KTHC'` (không phải `'KTHC'` viết khác). Code Kanban mới sẽ đọc `crm_departments.code` thay vì hardcode.

### 2.5. `public.crm_products` (line 825) — BẢNG SẢN PHẨM "THẬT" (spec §6.10)
- Cột giá: `price`, `list_price`, `cost_price` (✓ đúng tên spec cần), `rent_price_per_month`, `cpc_black_white`, `cpc_color`.
- Cột phân loại: `category`, `sub_category`, `brand`, `model`, `unit`, `is_for_rent`, `is_for_cpc`, `vat_rate`, `stock_qty`.
- Workflow cũ đã đọc `crm_products.category` để detect "máy photocopy" (workflowController.js:92).
- **Wire vào Kanban mới:**
  - `crm_kanban_cards.product_id uuid references crm_products(id)`.
  - Khi tạo thẻ chọn sản phẩm → `kanban-card` copy `crm_products.cost_price` + `list_price` (hoặc `price`) sang `crm_kanban_financials.cost_price`, `unit_price`.
  - Gợi ý `card_type`:
    - `category ~* 'máy photocopy'` AND `is_for_rent` → `thue_may`
    - `category ~* 'máy photocopy'` AND NOT `is_for_rent` → `ban_may`
    - khác → `ban_vat_tu`
- **HỎI DK (spec §6.10 yêu cầu):** mặc định 1 sản phẩm/thẻ — nghiệp vụ có cần nhiều dòng sản phẩm trên 1 thẻ Kanban không? (Nếu cần thì phải tách bảng `crm_kanban_card_items`.)

### 2.6. Các bảng KHÔNG liên quan trực tiếp Kanban nhưng cần đụng
- `crm_audit_log` — workflow cũ ghi log vào đây. Kanban mới sẽ có `crm_kanban_logs` riêng theo spec §6.7, **không** đụng audit log.
- `crm_orders`, `crm_support_tickets` — entity được workflow cũ móc theo. Kanban mới **không gắn vào order/ticket** (model dữ liệu khác hẳn — card độc lập). Không sửa các bảng này.
- `crm_quotes`, `crm_opportunities`, `crm_order_items` — không liên quan trực tiếp.

---

## 3. File backend (`src/`) cần đập bỏ / chỉnh

| File | Vai trò | Hành động đề xuất |
|---|---|---|
| `src/controllers/workflowController.js` (688 dòng) | Toàn bộ logic workflow cũ: `workflowList/Get/MoveStage/Update`, `autoCreateWorkflowsForEntity`, `createNotification*`, `notifyWorkflowMoved`, `WORKFLOW_STAGES` config | **Backup vào archive, sau đó XÓA HẲN.** Không tái sử dụng code. |
| `src/controllers/mainController.js` (253 dòng) | Router RPC có nhánh `entity === 'workflow'` (4 method) — line 104–117 | **Giữ file, gỡ nhánh `workflow`, thêm nhánh `kanban` mới.** |
| `src/controllers/crudController.js` | Hai chỗ tự gọi `autoCreateWorkflowsForEntity` khi Order/Ticket được create/update — line 469–473 và 590–606 | **Gỡ 2 block này.** Kanban mới không gắn vào Order/Ticket nữa. |
| `src/config/index.js` | `CODE_PREFIXES.crm_workflows = 'WF'` (line 32) | Gỡ entry; thêm prefix mới cho Kanban nếu cần (vd `KB`). |
| `src/controllers/notificationController.js` | Không liên quan trực tiếp (dùng `crm_notifications` chung). | **Giữ nguyên.** Kanban mới có thể tái dùng controller này hoặc thêm action `kanban.notifications.*` riêng (chốt sau). |
| `src/controllers/reportController.js` | KHÔNG có ref workflow/kanban (đã grep). | Giữ nguyên. |
| `src/controllers/authController.js`, `customerController.js`, `exportController.js` | KHÔNG ref Kanban. | Giữ nguyên. |
| `src/middlewares/auth.js` | KHÔNG ref Kanban. | Giữ nguyên — Kanban mới tái dùng `authenticateRequest`. |

---

## 4. File frontend cần đập bỏ / chỉnh

| File | Vai trò | Hành động đề xuất |
|---|---|---|
| `js/modules/kanban.js` (1123 dòng) | Toàn bộ FE Kanban cũ: render board, drag-drop, filter, drawer chi tiết, inline edit assignment. Có ~30 hàm + 24 `window.X = X` | **Backup vào `archive/old_kanban_2026-06-10/`, sau đó XÓA HẲN file.** Frontend mới viết lại theo spec §8, **không** copy-sửa. |
| `js/main.js` | Line 27 `import './modules/kanban.js'`; line 141, 310-311 gọi `loadWorkflows()` khi switch tab `workflow` | Gỡ import + đổi tên tab `workflow → kanban` (hoặc giữ tab nhưng wire vào module mới). |
| `index.html` | Line 168: button tab `data-tab="workflow"`. Line 859–920: toàn bộ section panel `workflow` (header + sub-tabs 3 loại + filter bar + `<div id="kanban-board">`). Line 916–917: `<div id="kanban-board">` | **Thay nguyên block 859–920** bằng layout Kanban mới theo spec §8. Đổi `data-tab="workflow"` → `data-tab="kanban"` cho nhất quán. |
| `css/style.css` | 50 dòng có chứa "kanban" — section "PHASE 4B - KANBAN WORKFLOW BOARD" từ line 1644. Cả `.kanban-board-grid`, `.kanban-column*`, `.workflow-filter-bar`, `.kanban-card*`, `.due-date-badge*`, v.v. | **Tách CSS Kanban mới ra `css/kanban.css`** (theo spec §8). CSS cũ block 1644-end-of-kanban-section có thể giữ tạm cho các class chung (vd `.dept-tag`) nhưng tốt nhất **xóa hẳn section cũ** sau khi style mới chạy ổn. Backup trước. |
| `js/modules/notifications.js` | Line 101–102 icon cho type `workflow_*`; line 268–270 mở tab `workflow` khi click notification có `entityType='workflow'` | **Cập nhật:** đổi/loại bỏ type `workflow_*`; thêm type `card_assigned`, `card_handoff`, `card_returned`, `debt_overdue` map vào tab `kanban` mới. |
| `js/api.js`, `js/state.js`, `js/utils.js`, `js/config.js` | Không ref kanban/workflow trực tiếp. | Giữ nguyên. |
| Module FE khác (`sales.js`, `customers.js`, `admin.js`, `dashboard.js`, `tickets.js`, `marketing.js`, `export.js`) | Không ref kanban/workflow. | Giữ nguyên. |

---

## 5. Edge Functions (Deno) cũ

**Không có.** Thư mục `supabase/functions/` không tồn tại. Toàn bộ logic backend cũ nằm trong Express ở `src/controllers/`. → Không có function Deno nào cần tắt/xóa.

---

## 6. Cross-module entanglement (móc nối sang module khác)

### 6.1. Nhận diện đã xong:
1. **`crudController.js` ← autoCreateWorkflowsForEntity** (2 chỗ):
   - Line 469–473: khi `crudCreate` tạo `crm_orders`/`crm_support_tickets` → tự sinh workflow `sales` (+ `installation` nếu có máy photocopy).
   - Line 590–606: khi `crudUpdate` mà chưa có workflow → tự sinh.
   - **Gỡ 2 block này.** Kanban mới không gắn vào order/ticket.

2. **`mainController.js`** entity `workflow` (4 action) — gỡ.

3. **`js/modules/notifications.js`** xử lý icon + click cho type `workflow_*` — chuyển sang `card_*` mới.

4. **`crm_notifications` (bảng)**: dùng chung 3 module (notification API, workflow cũ tự sinh, UI chuông). **KHÔNG drop bảng.**

5. **`_legacy_sql/FIX_DEPT_UUID_TO_TEXT.sql`** có 1 dòng `ALTER TABLE crm_workflows ALTER COLUMN department_id TYPE text` — di tích cũ. Không ảnh hưởng vì sẽ drop bảng `crm_workflows`. File legacy này không chạy lại.

### 6.2. KHÔNG phát hiện móc nối nào khác:
- Không có view/foreign key từ bảng khác trỏ tới `crm_workflows`.
- Không có report nào dùng `crm_workflows`.
- Không có file SQL nào trong `_legacy_sql/` khác động tới Kanban.

---

## 7. Biến môi trường (`.env`)

Không tìm thấy `.env` trong repo (đúng — không commit). Theo CLAUDE.md hiện dùng: `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (= service_role trên Vercel), `JWT_SECRET`. **Không cần thêm biến mới** cho Kanban mới (vẫn dùng các biến trên).

---

## 8. Routes / URL

Toàn bộ truy cập backend qua **1 route duy nhất** `POST /api` (RPC style, dispatch theo `action`). Không có URL riêng cho Kanban. → Kanban mới chỉ cần thêm các action `kanban.*` vào `mainController.js`. Không cần đụng `vercel.json`.

GET `/api/export` (export DOCX) — không liên quan Kanban.

---

## 9. Migration files cũ

- `supabase/migrations/00000000000000_baseline.sql` (2474 dòng) — snapshot DB hiện tại. **Giữ.**
- `_legacy_sql/*.sql` (19 file) — legacy patches, không phải migration chính thức. **Giữ trong archive.**

→ Migration mới sẽ tạo thẳng `001_kanban_schema.sql`, `002_kanban_seed.sql`, `003_kanban_rls.sql` trong `supabase/migrations/`. **Không** đụng baseline.

---

## 10. ĐỀ XUẤT DANH SÁCH CHO PHÉP BỎ — chờ DK duyệt

> Sau khi DK xác nhận, Giai đoạn 2 sẽ backup TẤT CẢ vào `archive/old_kanban_2026-06-10/` rồi mới xóa.

### A. DB — DROP sau backup CSV+SQL:
- [ ] `public.crm_workflows` (toàn bộ bảng + dữ liệu)

### B. Backend — XÓA file/đoạn code:
- [ ] `src/controllers/workflowController.js` (xóa cả file)
- [ ] `src/controllers/mainController.js`: gỡ nhánh `entity === 'workflow'` (line 104–117) + import line 7
- [ ] `src/controllers/crudController.js`: gỡ block auto-create workflow (line 469–473) và (line 590–606)
- [ ] `src/config/index.js`: gỡ `crm_workflows: 'WF'` (line 32)

### C. Frontend — XÓA file/đoạn code:
- [ ] `js/modules/kanban.js` (xóa cả file — viết lại từ đầu theo spec §8)
- [ ] `js/main.js`: gỡ `import './modules/kanban.js'` (line 27), sửa case `target === 'workflow'` (line 141, 310-311)
- [ ] `index.html`: thay block line 859–920 + đổi tab line 168
- [ ] `css/style.css`: gỡ section "PHASE 4B - KANBAN WORKFLOW BOARD" từ line 1644 (giữ class `.dept-tag` chung nếu dùng nơi khác)
- [ ] `js/modules/notifications.js`: cập nhật type map line 101–102, 268–270

### D. Bảng dùng chung — KHÔNG drop, chỉ THÊM cột:
- [ ] `public.crm_notifications`: ADD COLUMN `card_id uuid references crm_kanban_cards(id) on delete cascade`
- [ ] `public.crm_users`: **không đổi schema**; ánh xạ role/department ở Edge Function (xem §2.3)

### E. KHÔNG ĐỤNG:
- [ ] `crm_orders`, `crm_support_tickets`, `crm_quotes`, `crm_opportunities`, `crm_order_items`, `crm_customers`, `crm_contacts`, `crm_products`, `crm_audit_log`, `crm_departments` — không sửa cấu trúc
- [ ] `crm_products` chỉ ĐỌC tham chiếu (lấy `cost_price`)
- [ ] Toàn bộ module khác (auth, customer, sales, admin, export, dashboard, marketing, tickets)

---

## 11. CÂU HỎI CỤ THỂ CHO DK trước khi sang Giai đoạn 2 + 3

1. **Role mapping**: hệ thống đang có 4 role `(admin, boss, manager, staff)`. Spec dùng 3 role `(boss, truong_phong, nhan_vien)`. Có đúng `admin == boss` (full quyền, bỏ qua check phòng) không? -> `admin` full quyền. `boss` chỉ xem, không xem, sửa, xóa gì cả
2. **Department codes**: trong `crm_departments` có đúng 3 code `KD`, `KT`, `KTHC` không? (Kanban mới sẽ resolve qua bảng này; nếu code khác sẽ phải sửa.) -> hiện tại có 3 code `KD`, `KT`, `KTHC`, sau này có thể add thêm
3. **`crm_notifications` dùng chung**: đồng ý cách giữ bảng + thêm `card_id` nullable + tái dùng cùng cấu trúc `entity_type/entity_id` cho linh hoạt? Hay DK muốn 1 bảng riêng `crm_kanban_notifications`? ->
4. **Nhiều sản phẩm/thẻ (spec §6.10)**: 1 thẻ Kanban có thể có **nhiều** dòng sản phẩm (như order items), hay chỉ 1 sản phẩm/thẻ là đủ cho nghiệp vụ? (1 sản phẩm/thẻ → đơn giản hơn nhiều, không cần bảng line-items.) ->
5. **Tab cũ "workflow"**: thay nguyên tên tab thành "kanban" (`data-tab="kanban"`), hay giữ tên `workflow` cho user quen mắt? -> giữ nguyên tên tab như hiện tại
6. **Migrate dữ liệu cũ?** Có 0/n thẻ workflow trong `crm_workflows` đang dùng — DK có muốn migrate dữ liệu sang Kanban mới không, hay drop sạch và bắt đầu trắng? (Spec §9.4 nói "không migrate code", "chỉ migrate dữ liệu nếu DK cần".) -> dữ liệu mới trong giai đoạn thử nghiệm, có thể drop

---

**⏸ DỪNG TẠI ĐÂY.** Chờ DK duyệt §10 (danh sách được phép bỏ) và trả lời §11 (6 câu hỏi). Sau khi có duyệt, Giai đoạn 2 (backup + xóa) và Giai đoạn 3 (xây mới) sẽ chạy.
