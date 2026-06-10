# ĐẶC TẢ XÂY LẠI KANBAN LIÊN PHÒNG (CRM) — PHƯƠNG ÁN C

> **Cho Claude Code.** Đây là spec để **xây mới hoàn toàn** module Kanban. Code cũ có vấn đề về phân quyền và lộ dữ liệu, **phải bỏ và thay thế**. Đọc hết file này trước khi bắt đầu. Không tự suy diễn ngoài spec; chỗ nào thiếu thông tin thì hỏi lại chứ không đoán.

---

## 0. NGUYÊN TẮC BẤT BIẾN (đọc kỹ, đừng vi phạm)

1. **Bảo mật ở server, không phải client.** Việc ẩn cột/ẩn giá ở HTML chỉ là cho gọn mắt. Mọi quyết định "ai thấy field gì, ai kéo được thẻ nào" phải do **Edge Function (Supabase, Deno)** quyết định. Frontend KHÔNG bao giờ nhận field nhạy cảm nếu role không có quyền — server phải lọc payload trước khi trả.
2. **Mọi truy cập dữ liệu Kanban đi qua Edge Function**, không cho client query thẳng bảng tài chính. Edge Function dùng `service_role` để đọc/ghi; client chỉ gọi function kèm token để chứng minh danh tính.
3. **Kéo-nhả KHÔNG tự do.** Mỗi lần di chuyển thẻ phải qua hàm `kanban-move`, hàm này kiểm tra bảng `crm_stage_transitions` (có hợp lệ không) + role/phòng (có quyền không) + required fields (đủ điều kiện chưa). Frontend chặn trước cho UX, server chặn lại lần nữa cho chắc.
4. **Hosting & CORS:** Frontend chạy trên **Vercel** (`hast-crm.vercel.app`), KHÔNG phải GitHub Pages, KHÔNG phải Google Apps Script. **Quy tắc "GET-only, không gửi Content-Type" của Apps Script KHÔNG áp dụng ở dự án này.** Dùng `fetch` POST + JSON bình thường. Nếu lớp bảo mật là **API route cùng app Next.js trên Vercel** thì gọi same-origin (không cần CORS). Nếu là **Supabase Edge Functions** (khác origin) thì function trả CORS headers + xử lý preflight `OPTIONS` bình thường.
5. **Lớp bảo mật đặt ở đâu — XÁC ĐỊNH Ở BƯỚC KHẢO SÁT (mục 9.1):** spec mô tả các endpoint dưới tên "Edge Function", nhưng **logic giống hệt nhau dù đặt ở đâu**. Chọn theo thực tế app:
   - Nếu `hast-crm` là **Next.js có API routes / có backend Node** (dấu hiệu: có `supabaseClient.js`, thư mục `api/`, `pages/api` hoặc `app/api`) → **đặt các endpoint này thành API routes Node/TS trong chính app Vercel** (nhất quán với backend hiện có, không cần dựng thêm Deno).
   - Nếu app **chỉ là frontend tĩnh** đẩy lên Vercel, không có backend riêng → **dùng Supabase Edge Functions (Deno)** như mô tả.
   - **Dù chọn cách nào:** vẫn giữ nguyên nguyên tắc — service_role chỉ ở server, client không đọc thẳng bảng tài chính, mọi move qua một endpoint gác cổng duy nhất. Job `pg_cron` (mục 6.8) nằm trong Supabase, không đổi.
5. Tất cả bảng dùng prefix `crm_` trong schema `public`. Giữ đúng convention hiện có của dự án.

---

## 1. PHẠM VI & VIỆC CẦN LÀM

**Xây mới:**
- Schema Supabase: bảng cards, bảng tài chính tách riêng, bảng cấu hình stage + transition, seed dữ liệu cấu hình.
- 4 Edge Functions: `kanban-board` (đọc board đã lọc), `kanban-move` (cổng kiểm soát kéo-nhả), `kanban-card` (tạo/sửa thẻ), `rental-period-create` (sinh thẻ kỳ thuê).
- Frontend: `kanban.html` + JS render board, kéo-nhả, gọi các Edge Function.

**Đập bỏ:** Xem mục 9 (làm có backup, không xóa mù).

---

## 2. MÔ HÌNH NGHIỆP VỤ

3 phòng: **KD** (Kinh doanh), **KT** (Kỹ thuật), **KTHC** (Kế toán - Hành chính).
4 loại thẻ (`card_type`):

| card_type | Mô tả | Phòng khởi tạo |
|---|---|---|
| `ban_may` | Bán máy | KD |
| `thue_may` | Hợp đồng cho thuê máy (vòng đời hợp đồng) | KD |
| `thue_may_ky` | Một kỳ thanh toán của hợp đồng thuê (mỗi kỳ = 1 thẻ mới) | sinh tự động từ `thue_may` |
| `ban_vat_tu` | Bán vật tư | KT |

### 2.1. Bộ cột chung của board (1 board, 7 cột)

Vì là **một board**, định nghĩa **một bộ cột cố định**; mỗi `card_type` chỉ đi qua một tập con các cột. Cột nào không thuộc luồng của thẻ thì thẻ đó không bao giờ xuất hiện ở đó.

| code | Tên hiển thị | owner_dept | terminal |
|---|---|---|---|
| `KD_OPEN` | KD – Cơ hội / Báo giá | KD | no |
| `KD_WON` | KD – Đã chốt | KD | no |
| `KT_PROCESS` | KT – Xử lý hàng / máy | KT | no |
| `KTHC_INVOICE` | KTHC – Lên hóa đơn | KTHC | no |
| `KTHC_DEBT` | KTHC – Theo dõi công nợ | KTHC | no |
| `RENTAL_ACTIVE` | Đang cho thuê | KT | no |
| `DONE` | Hoàn tất | KTHC | yes |

### 2.2. Luồng hợp lệ theo từng loại thẻ

- **ban_may:** `KD_OPEN → KD_WON → KT_PROCESS → KTHC_INVOICE → KTHC_DEBT → DONE`
- **ban_vat_tu:** `KT_PROCESS → KTHC_INVOICE → KTHC_DEBT → DONE` (tạo thẳng ở `KT_PROCESS`)
- **thue_may (hợp đồng):** `KD_OPEN → KD_WON → KT_PROCESS → RENTAL_ACTIVE → DONE`
  - Tại `RENTAL_ACTIVE`: có nút **"Tạo kỳ thuê"** → sinh một thẻ `thue_may_ky` mới (xem mục 6).
  - `RENTAL_ACTIVE → DONE` = thu hồi máy / kết thúc hợp đồng.
- **thue_may_ky (kỳ thuê):** `KTHC_INVOICE → KTHC_DEBT → DONE` (sinh ra ở `KTHC_INVOICE`)

---

## 3. SCHEMA SQL

> File: `supabase/migrations/001_kanban_schema.sql`

```sql
-- ====== STAGES (cấu hình cột) ======
create table public.crm_kanban_stages (
  id            text primary key,            -- vd 'KD_OPEN'
  name          text not null,
  owner_dept    text not null check (owner_dept in ('KD','KT','KTHC')),
  sort_order    int  not null,
  is_terminal   boolean not null default false
);

-- ====== TRANSITIONS (luật kéo-nhả) ======
create table public.crm_kanban_transitions (
  id                 bigint generated always as identity primary key,
  card_type          text not null check (card_type in ('ban_may','thue_may','thue_may_ky','ban_vat_tu')),
  from_stage         text not null references public.crm_kanban_stages(id),
  to_stage           text not null references public.crm_kanban_stages(id),
  direction          text not null check (direction in ('forward','backward')),
  allowed_roles      jsonb not null,         -- vd '["nhan_vien","truong_phong","boss"]'
  acting_dept        text not null,          -- phòng được phép thực hiện (= phòng chịu trách nhiệm ở from_stage)
  require_fields     jsonb not null default '[]', -- field bắt buộc phải có trước khi chuyển
  unique (card_type, from_stage, to_stage)
);

-- ====== CARDS (thẻ) ======
create table public.crm_kanban_cards (
  id              uuid primary key default gen_random_uuid(),
  card_type       text not null check (card_type in ('ban_may','thue_may','thue_may_ky','ban_vat_tu')),
  title           text not null,
  current_stage   text not null references public.crm_kanban_stages(id),
  owner_dept      text not null check (owner_dept in ('KD','KT','KTHC')),
  assigned_to     uuid,                       -- crm_users.id (nhân viên phụ trách)
  customer_id     uuid,                       -- nếu có bảng khách hàng thì FK; tạm để uuid
  customer_name   text,
  -- liên kết kỳ thuê -> hợp đồng:
  parent_card_id  uuid references public.crm_kanban_cards(id),
  period_label    text,                       -- vd 'Kỳ 2025-06'
  period_start    date,
  period_end      date,
  status          text not null default 'active' check (status in ('active','done','cancelled')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ====== FINANCIALS (TÁCH RIÊNG — đây là phần nhạy cảm) ======
create table public.crm_kanban_financials (
  card_id        uuid primary key references public.crm_kanban_cards(id) on delete cascade,
  currency       text not null default 'VND',
  unit_price     numeric(18,2),   -- group: selling
  quantity       numeric(18,2),   -- group: selling
  subtotal       numeric(18,2),   -- group: selling
  total_amount   numeric(18,2),   -- group: selling
  cost_price     numeric(18,2),   -- group: cost  (GIÁ VỐN — nhạy cảm nhất)
  margin         numeric(18,2),   -- group: cost
  invoice_no     text,            -- group: billing
  invoice_date   date,            -- group: billing
  debt_amount    numeric(18,2),   -- group: debt
  due_date       date,            -- group: debt
  paid_amount    numeric(18,2),   -- group: debt
  payment_status text default 'unpaid' check (payment_status in ('unpaid','partial','paid'))
);

-- ====== INDEXES ======
create index idx_cards_stage   on public.crm_kanban_cards(current_stage) where status='active';
create index idx_cards_dept    on public.crm_kanban_cards(owner_dept);
create index idx_cards_assignee on public.crm_kanban_cards(assigned_to);
create index idx_cards_parent  on public.crm_kanban_cards(parent_card_id);

-- ====== updated_at trigger ======
create or replace function public.tg_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
create trigger trg_cards_touch before update on public.crm_kanban_cards
  for each row execute function public.tg_touch_updated_at();
```

> **crm_users:** đảm bảo có `role` (`'boss'|'truong_phong'|'nhan_vien'`) và `department` (`'KD'|'KT'|'KTHC'`, boss để `null`). Nếu schema hiện tại thiếu, thêm cột (không phá cột cũ).

---

## 4. SEED CẤU HÌNH

> File: `supabase/migrations/002_kanban_seed.sql`

```sql
insert into public.crm_kanban_stages (id, name, owner_dept, sort_order, is_terminal) values
 ('KD_OPEN','KD – Cơ hội / Báo giá','KD',10,false),
 ('KD_WON','KD – Đã chốt','KD',20,false),
 ('KT_PROCESS','KT – Xử lý hàng / máy','KT',30,false),
 ('KTHC_INVOICE','KTHC – Lên hóa đơn','KTHC',40,false),
 ('KTHC_DEBT','KTHC – Theo dõi công nợ','KTHC',50,false),
 ('RENTAL_ACTIVE','Đang cho thuê','KT',45,false),
 ('DONE','Hoàn tất','KTHC',99,true);

-- Quy ước quyền:
--  forward trong cùng phòng        -> [nhan_vien, truong_phong, boss]
--  forward vượt ranh giới phòng    -> [truong_phong, boss]   (quyền bàn giao của TP)
--  đóng thẻ (-> DONE)              -> [truong_phong, boss]
--  backward (kéo lùi)              -> [truong_phong, boss]

-- ===== ban_may =====
insert into public.crm_kanban_transitions (card_type,from_stage,to_stage,direction,allowed_roles,acting_dept,require_fields) values
 ('ban_may','KD_OPEN','KD_WON','forward','["nhan_vien","truong_phong","boss"]','KD','[]'),
 ('ban_may','KD_WON','KT_PROCESS','forward','["truong_phong","boss"]','KD','["total_amount"]'),
 ('ban_may','KT_PROCESS','KTHC_INVOICE','forward','["truong_phong","boss"]','KT','["total_amount"]'),
 ('ban_may','KTHC_INVOICE','KTHC_DEBT','forward','["nhan_vien","truong_phong","boss"]','KTHC','["invoice_no","invoice_date"]'),
 ('ban_may','KTHC_DEBT','DONE','forward','["truong_phong","boss"]','KTHC','["payment_status"]'),
 -- backward
 ('ban_may','KD_WON','KD_OPEN','backward','["truong_phong","boss"]','KD','[]'),
 ('ban_may','KT_PROCESS','KD_WON','backward','["truong_phong","boss"]','KT','[]'),
 ('ban_may','KTHC_INVOICE','KT_PROCESS','backward','["truong_phong","boss"]','KTHC','[]'),
 ('ban_may','KTHC_DEBT','KTHC_INVOICE','backward','["truong_phong","boss"]','KTHC','[]');

-- ===== ban_vat_tu =====
insert into public.crm_kanban_transitions (card_type,from_stage,to_stage,direction,allowed_roles,acting_dept,require_fields) values
 ('ban_vat_tu','KT_PROCESS','KTHC_INVOICE','forward','["truong_phong","boss"]','KT','["total_amount"]'),
 ('ban_vat_tu','KTHC_INVOICE','KTHC_DEBT','forward','["nhan_vien","truong_phong","boss"]','KTHC','["invoice_no","invoice_date"]'),
 ('ban_vat_tu','KTHC_DEBT','DONE','forward','["truong_phong","boss"]','KTHC','["payment_status"]'),
 ('ban_vat_tu','KTHC_INVOICE','KT_PROCESS','backward','["truong_phong","boss"]','KTHC','[]'),
 ('ban_vat_tu','KTHC_DEBT','KTHC_INVOICE','backward','["truong_phong","boss"]','KTHC','[]');

-- ===== thue_may (hợp đồng) =====
insert into public.crm_kanban_transitions (card_type,from_stage,to_stage,direction,allowed_roles,acting_dept,require_fields) values
 ('thue_may','KD_OPEN','KD_WON','forward','["nhan_vien","truong_phong","boss"]','KD','[]'),
 ('thue_may','KD_WON','KT_PROCESS','forward','["truong_phong","boss"]','KD','[]'),
 ('thue_may','KT_PROCESS','RENTAL_ACTIVE','forward','["truong_phong","boss"]','KT','[]'),
 ('thue_may','RENTAL_ACTIVE','DONE','forward','["truong_phong","boss"]','KT','[]'),
 ('thue_may','KD_WON','KD_OPEN','backward','["truong_phong","boss"]','KD','[]'),
 ('thue_may','KT_PROCESS','KD_WON','backward','["truong_phong","boss"]','KT','[]');

-- ===== thue_may_ky (kỳ thuê) =====
insert into public.crm_kanban_transitions (card_type,from_stage,to_stage,direction,allowed_roles,acting_dept,require_fields) values
 ('thue_may_ky','KTHC_INVOICE','KTHC_DEBT','forward','["nhan_vien","truong_phong","boss"]','KTHC','["invoice_no","invoice_date"]'),
 ('thue_may_ky','KTHC_DEBT','DONE','forward','["truong_phong","boss"]','KTHC','["payment_status"]'),
 ('thue_may_ky','KTHC_DEBT','KTHC_INVOICE','backward','["truong_phong","boss"]','KTHC','[]');
```

---

## 5. PHÂN QUYỀN & HIỂN THỊ (logic Edge Function)

### 5.1. Quyền xem CỘT (board)
Role chỉ thấy các cột mà:
- `owner_dept` = phòng của user, **HOẶC**
- là cột downstream/upstream liền kề trong luồng (hiển thị **read-only**, không kéo được), để biết "thẻ của mình giờ đang ở đâu".
- **Boss** thấy tất cả cột, tất cả phòng, kéo được mọi transition hợp lệ.

### 5.2. Quyền xem THẺ trong cột
- **Boss / Trưởng phòng:** thấy mọi thẻ thuộc phòng mình (TP) hoặc mọi phòng (Boss).
- **Nhân viên:** chỉ thấy thẻ `assigned_to = chính mình` HOẶC thẻ chưa giao (`assigned_to is null`) trong các cột phòng mình.

### 5.3. Quyền KÉO (đã định nghĩa ở bảng transitions). Edge Function `kanban-move` kiểm tra thêm:
- `user.role` ∈ `transition.allowed_roles`
- `user.department` = `transition.acting_dept` (Boss bỏ qua check này)
- nếu `user.role = 'nhan_vien'`: thẻ phải `assigned_to = user.id`
- mọi field trong `transition.require_fields` phải có giá trị (khác null/rỗng) trong `crm_kanban_financials`

### 5.4. Quyền xem FIELD (ẩn giá) — **ma trận lọc payload**

Field tài chính chia 4 nhóm: `selling` (đơn giá, SL, thành tiền, tổng tiền), `cost` (giá vốn, margin), `billing` (số/ngày hóa đơn), `debt` (công nợ, hạn, đã trả, trạng thái TT).

**Với thẻ máy (`ban_may`, `thue_may`, `thue_may_ky`):**

| Nhóm field | Boss | KD-TP | KD-NV | KT-TP | KT-NV | KTHC-TP | KTHC-NV |
|---|---|---|---|---|---|---|---|
| selling | ✓ | ✓ | ✓(thẻ của mình) | ✗ | ✗ | ✓ | ✓ |
| cost/margin | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| billing | ✓ | đọc | đọc(của mình) | ✗ | ✗ | ✓ | ✓ |
| debt | ✓ | đọc | đọc(của mình) | ✗ | ✗ | ✓ | ✓ |

**Với thẻ `ban_vat_tu`:**

| Nhóm field | Boss | KT-TP | KT-NV | KTHC-TP | KTHC-NV |
|---|---|---|---|---|---|
| selling | ✓ | ✓ | ✓(của mình) | ✓ | ✓ |
| cost/margin | ✓ | ✓ | ✗ | ✓ | ✓ |
| billing | ✓ | đọc | ✗ | ✓ | ✓ |
| debt | ✓ | ✗ | ✗ | ✓ | ✓ |

> **Điểm mấu chốt:** "✗" nghĩa là **server không gửi field đó xuống**, không phải ẩn bằng CSS. "đọc" = gửi xuống nhưng frontend khóa không cho sửa.
> Lưu ý hay: KT đẩy thẻ `ban_may` sang KTHC vẫn cần điều kiện `total_amount` đã có — server kiểm tra điều kiện này **mà không cần gửi giá xuống cho KT thấy**. Đây là lợi thế của việc kiểm tra ở server.
> **Giá vốn (`cost_price`):** lấy mặc định từ danh mục sản phẩm khi admin khởi tạo sản phẩm (xem mục 11 về bảng sản phẩm). **KTHC-NV được phép xem giá vốn** (đã phản ánh ở hai bảng trên).

---

## 6. EDGE FUNCTIONS (Deno)

> **Lưu ý runtime (xem mục 0 điểm 5):** nếu `hast-crm` là Next.js/Node trên Vercel, hãy cài đặt 4 endpoint dưới đây thành **API routes trong app Vercel** thay vì Edge Functions Deno — logic, input/output, kiểm tra quyền **giữ nguyên 100%**, chỉ khác cú pháp runtime. Tên "Edge Function" bên dưới đọc là "secure endpoint".

Thư mục: `supabase/functions/`. Tạo `_shared/` dùng chung.

### 6.1. `_shared/auth.ts`
```ts
// Trả về { userId, role, department } từ token gửi lên.
// GẮN VÀO HỆ AUTH HIỆN CÓ của dự án (crm_users + JWT_SECRET).
// Yêu cầu: KHÔNG tin role do client gửi; phải resolve từ token/DB bằng service_role.
export interface AuthCtx { userId: string; role: 'boss'|'truong_phong'|'nhan_vien'; department: 'KD'|'KT'|'KTHC'|null; }
export async function getAuthContext(req: Request, admin /* service_role client */): Promise<AuthCtx> { /* TODO theo auth dự án */ }
```

### 6.2. `_shared/visibility.ts`
```ts
// Cài đặt ma trận mục 5.4 dưới dạng config-driven.
// fieldGroupsFor(ctx, card) -> Set<'selling'|'cost'|'billing'|'debt'> mà user được XEM
// editableGroupsFor(ctx, card) -> tập group được SỬA
// maskFinancials(financialRow, allowedGroups) -> object chỉ còn field thuộc group được phép
// visibleColumnsFor(ctx) -> danh sách stage id; kèm cờ readOnly cho cột không phải phòng mình
```

### 6.3. `kanban-board` (GET) — đọc board đã lọc
- Input: token. Optional filter `card_type`.
- Logic: lấy stages → lọc theo `visibleColumnsFor` → lấy cards active hợp lệ theo mục 5.2 → join financials → **mask** theo mục 5.4 → trả `{ columns:[{stage, readOnly, cards:[{...card, financials: maskedOrNull}]}] }`.
- **Không bao giờ** trả financials chưa mask.

### 6.4. `kanban-move` (POST) — CỔNG KIỂM SOÁT kéo-nhả
```
Input: { cardId, toStage }
1. ctx = getAuthContext()
2. card = load(cardId);  if !card -> 404
3. t = transition where card_type=card.card_type, from=card.current_stage, to=toStage
      if !t -> 403 "Không có luồng hợp lệ"
4. if ctx.role not in t.allowed_roles -> 403
5. if ctx.role != 'boss' and ctx.department != t.acting_dept -> 403
6. if ctx.role == 'nhan_vien' and card.assigned_to != ctx.userId -> 403
7. fin = load financials(cardId)
   for f in t.require_fields: if empty(fin[f]) -> 422 "Thiếu điều kiện: <f>"
7b. NẾU to_stage = 'DONE' và card_type ∈ {ban_may, ban_vat_tu, thue_may_ky}:
      bắt buộc fin.payment_status = 'paid' -> nếu chưa thì 422 "Chưa thu đủ công nợ, không được đóng thẻ"
8. update card.current_stage = toStage (+ status='done' nếu stage terminal)
9. ghi log (xem 6.6) + trả card mới
```
> Đây là nơi DUY NHẤT được đổi `current_stage`. Không cho client update thẳng.

### 6.5. `kanban-card` (POST) — tạo/sửa thẻ + financials
- Tạo: set `current_stage` = cột đầu của loại thẻ (ban_may/thue_may → `KD_OPEN`; ban_vat_tu → `KT_PROCESS`). Check user thuộc đúng phòng khởi tạo.
- Sửa financials: chỉ ghi được các field thuộc group `editableGroupsFor`. Field ngoài quyền → bỏ qua, không lỗi mập mờ.

### 6.6. `rental-period-create` (POST) — sinh thẻ kỳ thuê
```
Input: { contractCardId, periodLabel, periodStart, periodEnd }
- Kiểm tra contract là thue_may và đang ở RENTAL_ACTIVE; user là KTHC/Boss (hoặc KD-TP tùy chính sách — mặc định KTHC + Boss).
- Tạo card mới: card_type='thue_may_ky', current_stage='KTHC_INVOICE',
  owner_dept='KTHC', parent_card_id=contractCardId, copy customer + period_*.
- (Tùy chọn về sau) thêm pg_cron sinh tự động hằng kỳ. Bản đầu: tạo bằng nút bấm thủ công.
```

### 6.7. Logging
Tạo `crm_kanban_logs (id, card_id, actor_id, action, from_stage, to_stage, at)` và ghi mỗi lần move/create. Dùng để truy vết và phục vụ nghiệm thu.

### 6.8. Nhắc công nợ quá hạn — chạy bằng `pg_cron` (in-app)
**Quy tắc:** thẻ `status='active'` ở cột `KTHC_DEBT` có `due_date < CURRENT_DATE` và `payment_status != 'paid'` là **quá hạn**. Cứ **15 ngày một lần**, tạo 1 notification in-app tới: **(1) tất cả user phòng KTHC** và **(2) người khởi tạo thẻ (`created_by`)**.

**Cách làm (thuần SQL, không gọi HTTP ra ngoài):**
- Thêm cột `crm_kanban_financials.last_reminded_at date`.
- Viết hàm `public.fn_debt_reminder_scan()` (PL/pgSQL):
  ```
  với mỗi thẻ quá hạn mà (last_reminded_at IS NULL OR CURRENT_DATE - last_reminded_at >= 15):
    - insert crm_notifications cho từng user KTHC + created_by
      (type='debt_overdue', card_id, title/body có số ngày quá hạn)
    - update financials.last_reminded_at = CURRENT_DATE
    - insert crm_kanban_logs (action='debt_reminder')
  ```
- Bật extension và lên lịch:
  ```sql
  create extension if not exists pg_cron;
  -- chạy 08:00 giờ VN = 01:00 UTC (Supabase chạy theo UTC)
  select cron.schedule('debt-reminder-daily', '0 1 * * *', $$ select public.fn_debt_reminder_scan(); $$);
  ```
- **Lưu ý timezone:** Postgres/Supabase chạy UTC; `'0 1 * * *'` = 08:00 ICT. So sánh quá hạn dùng `CURRENT_DATE` là đủ (theo ngày).

### 6.9. Hệ thống notification in-app (chuông 🔔)
Notification không chỉ cho công nợ — là **mọi phát sinh mới liên quan tới user**. Thiết kế bảng dùng chung:
```sql
create table public.crm_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                 -- người nhận (crm_users.id)
  type        text not null,                 -- 'debt_overdue'|'card_assigned'|'card_handoff'|'card_returned'
  title       text not null,
  body        text,
  card_id     uuid references public.crm_kanban_cards(id) on delete cascade,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_notif_user_unread on public.crm_notifications(user_id, is_read, created_at desc);
```
**Khi nào phát sinh notification (emit trong `kanban-move` / `kanban-card`):**
- Thẻ được **giao cho** một nhân viên (`assigned_to` thay đổi) → báo người được giao (`card_assigned`).
- Thẻ **bàn giao sang phòng khác** (forward vượt ranh giới phòng) → báo TP (và NV nếu có) của phòng nhận (`card_handoff`).
- Thẻ bị **kéo lùi** (backward) → báo phòng/người mà thẻ quay về (`card_returned`).
- Công nợ quá hạn (mục 6.8) → `debt_overdue`.

**Endpoint (Edge Function `kanban-notifications`):**
- `GET` action `list` → trả notifications của chính user (mới nhất trước) + `unread_count`.
- `POST` action `read` → đánh dấu đã đọc (1 cái hoặc tất cả).
- Resolve người nhận từ token; **chỉ trả notification của chính user đó.**

### 6.10. Lấy giá vốn mặc định từ danh mục sản phẩm
Đã có **màn admin quản trị sản phẩm** (máy photocopy cũ/mới, vật tư linh kiện) kèm giá sản phẩm. **Trong giai đoạn KHẢO SÁT (mục 9.1), xác định tên bảng sản phẩm thật trong DB.** Sau đó:
- Thêm cột `crm_kanban_cards.product_id uuid` (tham chiếu bảng sản phẩm) — có thể nhiều dòng sản phẩm/thẻ thì tách bảng line-item, nhưng bản đầu cho 1 sản phẩm/thẻ trước; **hỏi DK nếu cần nhiều dòng.**
- Khi `kanban-card` tạo thẻ và chọn sản phẩm: **copy `cost_price` (và giá bán mặc định nếu có) từ bảng sản phẩm sang `crm_kanban_financials`** làm giá trị khởi tạo (vẫn cho sửa theo quyền). Danh mục "máy" → gợi ý `card_type` bán/thuê máy; "vật tư" → `ban_vat_tu`.
- **Không** sửa màn admin sản phẩm hiện có; chỉ đọc tham chiếu từ nó.

---

## 7. RLS / GRANTS

> File: `supabase/migrations/003_kanban_rls.sql`

Mô hình: client KHÔNG đọc thẳng bảng nhạy cảm; mọi thứ qua Edge Function (service_role bypass RLS). RLS làm lớp chặn cuối:
```sql
alter table public.crm_kanban_cards       enable row level security;
alter table public.crm_kanban_financials  enable row level security;
alter table public.crm_kanban_logs        enable row level security;
-- KHÔNG tạo policy cho phép anon/authenticated SELECT financials.
-- => client gọi trực tiếp sẽ bị chặn; chỉ Edge Function (service_role) đọc được.
revoke all on public.crm_kanban_financials from anon, authenticated;
```
> Bảng `crm_kanban_stages` và `crm_kanban_transitions` có thể cho `authenticated` SELECT (chỉ là cấu hình, không nhạy cảm) để frontend biết tên cột.

`crm_notifications`: bật RLS, chỉ cho user đọc notification của chính mình (`user_id = <uid hiện tại>`); việc ghi do Edge Function (service_role) thực hiện. Nếu auth dự án không phải Supabase Auth thì cho client đọc qua Edge Function `kanban-notifications` thay vì query thẳng.

---

## 8. FRONTEND

Files: `kanban.html`, `js/kanban.js`, `js/api.js`, `css/kanban.css`.

- Render board từ output `kanban-board` (server đã quyết cột nào hiện, thẻ nào hiện, field nào có). **Frontend không tự suy luận quyền** — chỉ vẽ những gì server trả.
- Cột có `readOnly=true`: hiện thẻ mờ, **không cho kéo vào/ra**.
- Kéo-nhả: thư viện gợi ý SortableJS. Khi thả → gọi `kanban-move`. Nếu server trả 4xx → **bật lại thẻ về vị trí cũ** và hiện toast lý do (vd "Thiếu điều kiện: invoice_no").
- Thẻ chỉ hiện field financials nếu server có gửi; field "đọc" thì khóa input.
- Nút "Tạo kỳ thuê" chỉ hiện trên thẻ `thue_may` ở `RENTAL_ACTIVE` và với role được phép.
- Gọi API: `fetch(ENDPOINT_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify(...) })`. Nếu endpoint là API route same-origin trên Vercel thì dùng đường dẫn tương đối (`/api/kanban/move`…), không vướng CORS. Nếu là Supabase Edge Function thì dùng URL function. Dù cách nào cũng KHÔNG áp quy tắc GET-only của Apps Script.
- **Không lưu `service_role` key hay PAT ở localStorage.** Frontend chỉ giữ token phiên của user.
- **Chuông notification 🔔:** ở header board, hiển thị `unread_count`, mở ra danh sách (gọi `kanban-notifications` action `list`). Bấm vào 1 mục → mở thẻ liên quan (`card_id`) + đánh dấu đã đọc. Có thể poll mỗi 30–60 giây hoặc refresh khi đổi tab. Mỗi mục hiện title/body + thời gian.

---

## 9. ĐẬP BỎ CÁI CŨ — KỶ LUẬT CHỐNG NHẦM LẪN (ĐỌC KỸ)

> ⚠️ Module Kanban **đã từng tồn tại** và có vấn đề. Rủi ro lớn nhất là **trộn lẫn code cũ với code mới** rồi sửa nửa vời. Phải làm theo đúng trình tự "khảo sát → backup → DK duyệt → mới xóa → xây mới sạch".

### 9.1. Giai đoạn KHẢO SÁT trước (không sửa gì cả)
1. Quét toàn repo, **liệt kê đầy đủ** mọi thứ liên quan Kanban cũ: bảng DB (tên thật), Edge Functions, file HTML/JS/CSS, route, biến môi trường. Ghi ra `archive/INVENTORY_<ngày>.md`.
1b. **Xác định runtime của app** (mục 0 điểm 5): `hast-crm.vercel.app` là Next.js/Node có API routes (xem có `supabaseClient.js`, `api/`, `pages/api`, `app/api`, `next.config.*`) hay frontend tĩnh? Báo DK kết luận + nơi sẽ đặt secure endpoints (Vercel API routes vs Supabase Edge Functions). Cũng xác nhận `pg_cron` có bật được trên project Supabase không.
2. **Đừng tin tên gọi suy đoán.** Mở từng file/bảng kiểm tra nội dung thật trước khi kết luận "đây là cũ".
3. Trình danh sách này cho DK duyệt. **Chờ xác nhận. Không xóa/sửa gì trong giai đoạn này.**

### 9.2. Tránh nhầm lẫn cũ ↔ mới
- Schema mới dùng đúng tên trong spec: `crm_kanban_cards`, `crm_kanban_financials`, `crm_kanban_stages`, `crm_kanban_transitions`, `crm_kanban_logs`. **Nếu tên này TRÙNG với bảng cũ → KHÔNG ghi đè.** Báo DK; thống nhất đổi tên hoặc drop bảng cũ trước (sau khi backup).
- File frontend cũ: di chuyển vào `archive/old_kanban_<ngày>/`, **không** để lẫn trong thư mục đang chạy. Frontend mới là file mới hoàn toàn theo mục 8, **không** copy-sửa từ file cũ (dễ mang theo logic phân quyền sai của bản cũ).
- Edge Function cũ: vô hiệu hoá/xoá hẳn sau khi bản mới chạy được; **không** để hai function cùng đụng một bảng.
- **Không migrate logic cũ.** Xây lại từ móng theo spec này. Chỉ migrate **dữ liệu** (nếu DK cần), không migrate code.

### 9.3. Backup bắt buộc trước khi xóa
1. Export dữ liệu bảng Kanban cũ ra CSV/SQL dump, lưu `archive/old_kanban_<ngày>/`.
2. Copy toàn bộ file frontend/Edge Function cũ vào cùng thư mục archive. **Không xóa thẳng.**

### 9.4. Trình tự xóa (chỉ làm SAU khi DK xác nhận danh sách ở 9.1)
1. DK xác nhận tên bảng/file được phép bỏ.
2. Drop bảng cũ → xóa function cũ → thay file frontend.
3. Chạy migration mới (001→002→003), deploy function mới, deploy frontend mới.
4. Chạy checklist nghiệm thu mục 10.

### 9.5. Không đụng tới phần khác
Ngoài việc thêm cột `role`/`department` cho `crm_users` nếu thiếu, **không** sửa các module CRM khác (đăng nhập, khách hàng, sản phẩm…). Nếu phát hiện Kanban cũ móc nối vào module khác, **dừng lại hỏi DK** thay vì tự sửa lan ra.

---

## 10. TIÊU CHÍ NGHIỆM THU (phải pass hết)

1. NV phòng KD mở board → **không** thấy field giá vốn/margin của bất kỳ thẻ nào (kiểm tra cả tab Network, payload không chứa `cost_price`).
2. KT mở thẻ `ban_may` → **không** thấy bất kỳ field tài chính nào; payload không chứa giá. Nhưng KT vẫn đẩy được thẻ sang KTHC nếu giá đã được nhập (server tự kiểm).
3. KT mở thẻ `ban_vat_tu` → thấy giá bán vật tư; KT-NV không thấy giá vốn, KT-TP thấy.
4. NV chỉ thấy thẻ được giao cho mình; thử kéo thẻ của người khác → bị chặn 403.
5. Kéo thẻ vượt cột không liền kề / sai luồng → 403 "không có luồng hợp lệ".
6. Kéo `KD_WON → KT_PROCESS` (ban_may) khi chưa nhập `total_amount` → 422 thiếu điều kiện.
7. Kéo `KTHC_DEBT → DONE` khi `payment_status != 'paid'` → 422 "Chưa thu đủ công nợ". Chỉ khi đã thu đủ mới đóng được thẻ.
8. Nút "Tạo kỳ thuê" trên hợp đồng `RENTAL_ACTIVE` → sinh đúng 1 thẻ `thue_may_ky` mới ở `KTHC_INVOICE`, gắn `parent_card_id`.
9. Gọi thẳng `crm_kanban_financials` bằng anon/authenticated key từ client → bị RLS chặn.
10. Mọi move đều có 1 dòng trong `crm_kanban_logs`.
11. Khi giao thẻ cho NV / bàn giao sang phòng khác / kéo lùi → đúng user nhận được notification, chuông 🔔 tăng `unread_count`; user khác **không** thấy notification không phải của mình.
12. Thẻ công nợ quá hạn > 15 ngày → KTHC + người khởi tạo nhận notification `debt_overdue`; chạy lại job trong vòng 15 ngày **không** gửi trùng (nhờ `last_reminded_at`).
13. Tạo thẻ chọn sản phẩm → `cost_price` tự điền từ danh mục sản phẩm; KTHC-NV xem được, KD/KT(với máy) không thấy.

---

## 11. TRẠNG THÁI CÁC QUYẾT ĐỊNH

**Đã chốt:**
- Đóng thẻ về `DONE`: **bắt buộc đã thu đủ công nợ** (`payment_status='paid'`). Đã đưa vào `kanban-move` mục 6.4 (bước 7b).
- Công nợ quá hạn: cứ **15 ngày** nhắc 1 lần tới **KTHC + người khởi tạo thẻ**. Logic ở mục 6.8.
- **KTHC-NV được xem giá vốn** (mặc định từ danh mục sản phẩm). Đã phản ánh ở mục 5.4.
- Ai bấm "Tạo kỳ thuê": **KTHC + Boss**.

**CÒN CHỜ DK CHỐT (Claude Code KHÔNG code phần liên quan tới khi có xác nhận):**
1. ✅ **Kênh notification: in-app** (chuông 🔔, bảng `crm_notifications`, mục 6.9). Notification cho mọi phát sinh liên quan tới user, không chỉ công nợ.
2. ✅ **Cơ chế lịch: `pg_cron`** chạy hằng ngày, hàm SQL thuần (mục 6.8). Bật extension `pg_cron`. Nếu khi khảo sát phát hiện project không bật được `pg_cron`, **báo DK** để chuyển sang GitHub Actions cron gọi Edge Function.
3. ✅ **Giá vốn: lấy từ bảng danh mục sản phẩm có sẵn** (màn admin nhập máy/vật tư kèm giá). Mục 6.10. **Việc còn lại = KHẢO SÁT tìm tên bảng sản phẩm thật** ở giai đoạn 9.1, rồi wire `cost_price` mặc định. Nếu cần nhiều dòng sản phẩm trên một thẻ thì hỏi DK trước.

→ Tất cả quyết định đã chốt. Claude Code có thể làm trọn vẹn, chỉ cần dừng ở các checkpoint của mục 9 và xác nhận tên bảng sản phẩm.
```
