# BÁO CÁO NGHIỆM THU — Kanban v2

> Ngày: **2026-06-10** · Nhánh: `feature/kanban-rebuild-2026-06-10`
> Tham chiếu spec: `plans/kanban_rebuild_spec.md §10` (13 tiêu chí) + 1 tiêu chí bổ sung cho NHIỀU dòng SP/thẻ (DK chốt khác mặc định) → tổng **14 tiêu chí**.

## Phân loại kết quả

- ✅ **PASS-CODE** — code đã hiện thực đúng theo spec. Nghiệm thu lần cuối sẽ chạy ở môi trường thật (DB Supabase + login 4 role); ở giai đoạn xây dựng này, chứng cứ là file/dòng code.
- ⏳ **PASS-PENDING-DB** — code đúng nhưng cần migrations 001-004 chạy trên DB rồi mới chứng thực được. DK chạy `supabase db push` trên nhánh này.
- ❌ **FAIL** — chưa làm hoặc còn thiếu (không có ở báo cáo này — nếu có sẽ liệt riêng).

---

## Tiêu chí 1 — NV phòng KD KHÔNG thấy `cost_price`/`margin`

**✅ PASS-CODE.** Hai lớp bảo vệ:

1. **Server lọc payload** trước khi trả:
   - [src/utils/kanban-visibility.js](../src/utils/kanban-visibility.js#L42-L60) — `MATRIX.may.nhan_vien.KD = { selling:'write_own', cost:null, billing:'read_own', debt:'read_own' }`. Group `cost` = `null` → server không gửi.
   - [src/controllers/kanbanController.js](../src/controllers/kanbanController.js#L173-L194) — `maskCardForView` chỉ thêm `costPrice` cho item khi `viewCost === true`; thêm `cost_price` trong financials khi group `cost` trong `view` set. KD-NV không có cost → field bị loại khỏi response.
2. **DB chặn truy cập thẳng**: [migration 003](../supabase/migrations/20260610000003_kanban_rls.sql) — `revoke all on public.crm_kanban_financials from anon, authenticated` + RLS bật, không có policy SELECT cho 2 role này.

**Cách kiểm tra DB-live**: đăng nhập NV-KD, mở Network tab → response của `kanban.board.get` không có `cost_price` hoặc `costPrice`. Gọi `supabase.from('crm_kanban_financials').select('*')` với anon key → empty array.

---

## Tiêu chí 2 — KT mở thẻ `ban_may`: không thấy field tài chính, nhưng vẫn đẩy được sang KTHC

**✅ PASS-CODE.**

- **Ẩn tài chính**: matrix `MATRIX.may.truong_phong.KT` và `.nhan_vien.KT` = tất cả 4 group `null` → `maskFinancials` trả `null`, `card.financials = null`, `card.items[].unitPrice/costPrice/lineSubtotal` bị bỏ. [kanban-visibility.js:46-49](../src/utils/kanban-visibility.js#L46-L49) + [kanbanController.js:173-194](../src/controllers/kanbanController.js#L173-L194).
- **Vẫn đẩy được nếu giá đã có**: server kiểm tra `require_fields` (vd `total_amount`) trên DB thật, KHÔNG cần gửi field xuống FE. [kanbanController.js:516-525](../src/controllers/kanbanController.js#L516-L525) — `kanbanMove` đọc financials từ DB và check `fin[f] != null`.

---

## Tiêu chí 3 — `ban_vat_tu`: KT-NV ẩn giá vốn, KT-TP thấy

**✅ PASS-CODE.** Matrix `vat_tu`:

```
truong_phong.KT  = { selling:'write', cost:'write',  billing:'read', debt:null }
nhan_vien.KT     = { selling:'write_own', cost:null,  billing:null,   debt:null }
```

→ KT-TP `cost='write'` → thấy + sửa được giá vốn. KT-NV `cost=null` → bị loại khỏi payload. [kanban-visibility.js:64-72](../src/utils/kanban-visibility.js#L64-L72).

---

## Tiêu chí 4 — NV chỉ thấy thẻ của mình; kéo thẻ người khác → 403

**✅ PASS-CODE.** Hai chỗ:

1. **`kanban.board.get`**: [canSeeCard](../src/utils/kanban-visibility.js#L160-L177) — nhan_vien chỉ thấy thẻ `assigned_to === userId` HOẶC `assigned_to IS NULL` (trong cột editable phòng mình).
2. **`kanban.move`**: [kanbanController.js:493-497](../src/controllers/kanbanController.js#L493-L497) — `if (ctx.role === 'nhan_vien' && card.assigned_to !== ctx.userId) → 403`. Cộng với NV không thể "kéo" thẻ NV không thấy (FE không render).

---

## Tiêu chí 5 — Kéo sai luồng → 403 "không có luồng hợp lệ"

**✅ PASS-CODE.** [kanbanController.js:477-482](../src/controllers/kanbanController.js#L477-L482) — `select * from crm_kanban_transitions where card_type=X and from_stage=Y and to_stage=Z limit 1`. Nếu không có row → `throw 'FORBIDDEN: Không có luồng hợp lệ'`. Bảng transitions seed chỉ có các cặp hợp lệ (migration 002).

---

## Tiêu chí 6 — `ban_may` `KD_WON → KT_PROCESS` chưa có `total_amount` → 422

**✅ PASS-CODE.**

- Seed (migration 002): `('ban_may','KD_WON','KT_PROCESS','forward', [...], 'KD', '["total_amount"]')`.
- Check: [kanbanController.js:516-525](../src/controllers/kanbanController.js#L516-L525) — `for f in require_fields → if v == null → throw 'VALIDATION: Thiếu điều kiện: <f>'` (statusCode = 422).

---

## Tiêu chí 7 — `KTHC_DEBT → DONE` khi `payment_status != 'paid'` → 422

**✅ PASS-CODE.** [kanbanController.js:527-535](../src/controllers/kanbanController.js#L527-L535):

```js
if (toStage === 'DONE' && ['ban_may','ban_vat_tu','thue_may_ky'].includes(card.card_type)) {
  if (!fin || fin.payment_status !== 'paid') {
    throw 'VALIDATION: Chưa thu đủ công nợ, không được đóng thẻ'; // 422
  }
}
```

Kèm seed transition `(ban_may, KTHC_DEBT, DONE) require_fields=["payment_status"]` cũng buộc payment_status phải có (dù 'unpaid' cũng pass require_fields, nhưng bước 7b ép giá trị phải = 'paid').

---

## Tiêu chí 8 — Nút "Tạo kỳ thuê" trên `thue_may` ở `RENTAL_ACTIVE`

**✅ PASS-CODE.**

- **FE**: [js/modules/kanban.js:251-256](../js/modules/kanban.js#L251-L256) — chỉ render nút nếu `card.cardType === 'thue_may' && card.currentStage === 'RENTAL_ACTIVE' && (isAdmin || deptCode === 'KTHC')`.
- **BE**: [kanbanController.js:626-650](../src/controllers/kanbanController.js#L626-L650) — `kanbanRentalPeriodCreate` check:
  - `contract.card_type === 'thue_may'` (else 400)
  - `contract.current_stage === 'RENTAL_ACTIVE'` (else 400)
  - `ctx.isAdmin || ctx.deptCode === 'KTHC'` (else 403)
  - Sinh card mới `card_type='thue_may_ky'`, `current_stage='KTHC_INVOICE'`, `parent_card_id=contractCardId`, copy customer.

---

## Tiêu chí 9 — Anon/authenticated gọi thẳng `crm_kanban_financials` → bị chặn

**⏳ PASS-PENDING-DB.** Code đã đặt RLS đúng:

[migration 003](../supabase/migrations/20260610000003_kanban_rls.sql):
- `alter table crm_kanban_financials enable row level security`
- `revoke all on crm_kanban_financials from anon, authenticated`
- KHÔNG có policy SELECT cho 2 role này.

→ Khi DK push migration, gọi `supabase.from('crm_kanban_financials').select('*')` từ FE với anon key sẽ trả về empty/permission denied. Cần verify live sau khi push.

---

## Tiêu chí 10 — Mọi move có 1 dòng `crm_kanban_logs`

**✅ PASS-CODE.** [kanbanController.js:561-563](../src/controllers/kanbanController.js#L561-L563):

```js
await logKanban(cardId, ctx.userId, 'move', card.current_stage, toStage, {
  direction: t.direction, cardType: card.card_type,
});
```

Cũng có log cho `create` (line 408) và `rental_period_create` (line 663).

---

## Tiêu chí 11 — Notification khi giao thẻ / bàn giao / kéo lùi

**✅ PASS-CODE.**

- **Giao thẻ (`card_assigned`)**: [kanbanController.js:330-343](../src/controllers/kanbanController.js#L330-L343) — `emitAssignedNotification` được gọi trong cả `create` và `update`. Nếu `card.assigned_to` đổi và != actor → insert notif type `card_assigned` cho người được giao.
- **Bàn giao sang phòng khác (`card_handoff`)**: [kanbanController.js:566-575](../src/controllers/kanbanController.js#L566-L575) — sau move, nếu `direction='forward'` và `newDept !== oldDept` → `notifyUsersOfDept(newDept, ...)` → insert notif `card_handoff` cho mọi user phòng nhận.
- **Kéo lùi (`card_returned`)**: [kanbanController.js:577-595](../src/controllers/kanbanController.js#L577-L595) — `direction='backward'` → notif `card_returned` cho phòng cũ + người được giao (nếu khác actor).
- **Lọc theo người nhận**: `kanban.notifications.list` chỉ trả notification có `user_id = currentUser.id` ([kanbanController.js:683-687](../src/controllers/kanbanController.js#L683-L687)). RLS trên `crm_notifications` cũng filter `user_id = auth.uid()` (migration 003 — chưa dùng vì non-Supabase-Auth, nhưng endpoint backend đã filter).

---

## Tiêu chí 12 — Công nợ quá hạn > 15 ngày → KTHC + creator nhận; chạy lại trong 15 ngày KHÔNG trùng

**⏳ PASS-PENDING-DB.** Logic SQL hoàn chỉnh trong [migration 004](../supabase/migrations/20260610000004_kanban_debt_reminder.sql):

- Quét: `WHERE current_stage='KTHC_DEBT' AND due_date < CURRENT_DATE AND payment_status != 'paid' AND (last_reminded_at IS NULL OR CURRENT_DATE - last_reminded_at >= 15)`.
- Người nhận: dynamic `array_agg(distinct u.id) WHERE department_id = (SELECT id FROM crm_departments WHERE code='KTHC')` + `card.created_by` (nếu khác).
- **Chống trùng 2 lớp**: (a) update `last_reminded_at = CURRENT_DATE` sau khi gửi; (b) trước khi insert, check `SELECT COUNT(*) FROM crm_notifications WHERE user_id=X AND card_id=Y AND type='debt_overdue' AND created_at >= now() - interval '15 days'` → bỏ qua nếu đã có.
- pg_cron: lịch `'0 1 * * *'` (08:00 ICT). Migration TRY bật extension; FAIL gracefully nếu project không cho phép → DK chuyển sang GitHub Actions gọi `kanban.debt.scan`.

DK chạy `select fn_debt_reminder_scan()` thủ công sau khi push migrations để verify.

---

## Tiêu chí 13 — Tạo thẻ chọn SP → `cost_price` tự điền

**✅ PASS-CODE.** [kanbanController.js:283-304](../src/controllers/kanbanController.js#L283-L304):

```js
if (productId) {
  const prod = await fetchProductSnapshot(productId); // SELECT từ crm_products
  if (prod) {
    if (unitPrice == null) unitPrice = prod.list_price || prod.price;
    if (costPrice == null) costPrice = prod.cost_price;  // ← Tự điền
    if (!productName) productName = prod.name;
    ...
  }
}
if (!canWriteCost) costPrice = null;  // Mask theo role: nếu user không được ghi cost → null
```

→ Snapshot vào `crm_kanban_card_items.cost_price` và rollup vào `crm_kanban_financials.cost_price` ([kanbanController.js:404-411](../src/controllers/kanbanController.js#L404-L411)).
→ KTHC-NV: matrix `cost='write'` → thấy được. KD/KT(máy): `cost=null` → không thấy (đã giải quyết ở tiêu chí 1+2).

---

## Tiêu chí 14 (BỔ SUNG — quyết định DK) — Nhiều dòng sản phẩm/thẻ

**✅ PASS-CODE.** Khác mặc định spec §6.10 (1 SP/thẻ):

- **Bảng phụ**: `public.crm_kanban_card_items` ([migration 001 line 60-77](../supabase/migrations/20260610000001_kanban_schema.sql)).
- **FE gửi mảng items**: `payload.items = [{productId, quantity, ...}]` (xem [kanban.js:411](../js/modules/kanban.js#L411)).
- **BE rollup tổng vào financials**: [kanbanController.js:316-322](../src/controllers/kanbanController.js#L316-L322) — `rollupItems` cộng dồn `quantity*unit_price` → `subtotal/total_amount`; `quantity*cost_price` → `cost_price` tổng.
- **Snapshot per row**: mỗi item lưu `cost_price` riêng (tại lúc thêm) — không phụ thuộc giá sản phẩm thay đổi sau này.

---

## Tổng kết

| Tiêu chí | Trạng thái |
|---|---|
| 1. NV-KD ẩn cost/margin | ✅ PASS-CODE |
| 2. KT ẩn tài chính `ban_may`, vẫn move được | ✅ PASS-CODE |
| 3. `ban_vat_tu`: KT-TP thấy cost, KT-NV không | ✅ PASS-CODE |
| 4. NV chỉ thấy thẻ của mình | ✅ PASS-CODE |
| 5. Kéo sai luồng → 403 | ✅ PASS-CODE |
| 6. Thiếu `total_amount` → 422 | ✅ PASS-CODE |
| 7. Đóng thẻ chưa thu đủ → 422 | ✅ PASS-CODE |
| 8. Nút "Tạo kỳ thuê" đúng vị trí | ✅ PASS-CODE |
| 9. RLS chặn anon/authenticated | ⏳ PASS-PENDING-DB |
| 10. Mọi move có 1 log | ✅ PASS-CODE |
| 11. Notification giao/bàn giao/kéo lùi | ✅ PASS-CODE |
| 12. Công nợ quá hạn 15 ngày | ⏳ PASS-PENDING-DB |
| 13. `cost_price` tự điền từ sản phẩm | ✅ PASS-CODE |
| 14. Nhiều dòng SP/thẻ | ✅ PASS-CODE |

→ **12/14 PASS-CODE ngay** (chứng cứ trong code).
→ **2/14 PASS-PENDING-DB** (#9 RLS + #12 pg_cron) — DK cần push migrations rồi verify ở môi trường thật.

---

## Việc DK cần làm tiếp tay

> **Tách 2 bước A → B.** Migration 005 (DROP) đã được di chuyển ra
> `archive/old_kanban_2026-06-10/db/005_drop_crm_workflows.sql` → **không** nằm
> trong `supabase/migrations/`. `supabase db push` sẽ CHỈ áp 001→004.

### Bước A — push 001→004 + verify

1. **Đảm bảo `crm_departments` có 3 dòng** `code='KD'`, `'KT'`, `'KTHC'` (case-sensitive). Nếu code khác (vd 'kthc' lowercase) thì update bảng departments. Sửa qua màn admin.
2. **Chạy `supabase db push`** — áp 4 migration THÊM.
3. **Nếu migration 004 fail vì `pg_cron` không bật được**: enable extension trên Supabase Dashboard (Database → Extensions → pg_cron) rồi rerun. Nếu project plan không hỗ trợ → báo lại để chuyển sang GitHub Actions cron gọi `kanban.debt.scan`.
4. **Tạo 1 user mỗi role** (admin/boss/manager/staff) trong mỗi phòng KD/KT/KTHC để verify ma trận hiển thị thực tế.
5. **Chạy `select * from fn_debt_reminder_scan()`** thủ công để verify tiêu chí 12.
6. **Verify tiêu chí 9** trong DevTools: console.log `await supabase.from('crm_kanban_financials').select('*')` với anon key → phải empty hoặc lỗi 401.

### Bước B — DROP bảng cũ (chỉ khi A xanh)

1. **Backup THẬT `crm_workflows`** bằng script `backup_crm_workflows.sh`/`.ps1` trong `archive/old_kanban_2026-06-10/db/` (cần `SUPABASE_DB_URL`).
2. **Verify + commit 4 file output** (`crm_workflows_data.sql`, `.csv`, `_schema.sql`, `_count.txt`).
3. **Chạy DROP thủ công**:
   ```
   psql -v ON_ERROR_STOP=1 -f archive/old_kanban_2026-06-10/db/005_drop_crm_workflows.sql "$SUPABASE_DB_URL"
   ```
   hoặc copy SQL trong file 005 vào Supabase Studio SQL Editor → Run.

---

## Câu hỏi nhỏ cho DK

- Có cần migrate dữ liệu `crm_workflows` thành thẻ Kanban mới không? DK đã chốt "không migrate", tôi giữ nguyên — chỉ confirm lại trước khi push migration 005.
