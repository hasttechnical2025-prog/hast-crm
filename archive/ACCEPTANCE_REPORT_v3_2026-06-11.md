# BÁO CÁO NGHIỆM THU — Kanban v3 (mô hình hai luồng)

> Ngày: **2026-06-11** · Nhánh: `feature/kanban-rebuild-2026-06-10`
> Tham chiếu: `plans/kanban_rebuild_spec.md` v3 §10 (15 tiêu chí).

## Trạng thái

- ✅ **PASS-CODE** — code đã hiện thực; chứng cứ file:dòng.
- ⏳ **PASS-PENDING-DB** — đúng nhưng cần DK chạy `supabase db push` (migration 006) + test UI 4 vai.

## Quyết định DK đã chốt (2026-06-11) — đã bake vào code
1. **Payments là nguồn sự thật**, confirmed → sync `crm_orders.paid_amount/remaining_amount/payment_status`. → [kanbanController.js `recomputeBalanceAndMaybeClose`](../src/controllers/kanbanController.js).
2. **Kỳ thuê tạo tay** (KT-NV), pg_cron để sau. → `kanbanRentalPeriodCreate`.
3. **Bỏ bước Thu hồi máy** (TECH_RECOVER) — luồng thuê kỹ thuật 3 bước. → migration 006 seed.
4. **KT vào tab Bán hàng nhưng server lọc đơn** theo phòng. → [crudController `isKTRestricted`](../src/controllers/crudController.js).

---

| # | Tiêu chí | Trạng thái | Chứng cứ |
|---|---|---|---|
| 1 | Đơn bán máy (KD) → tự sinh 2 thẻ: thương mại COM_NEW (có giá) + kỹ thuật TECH_TODO (không giá, không cột "Đơn mới") | ✅ PASS-CODE | `createCardsFromOrder` sinh com + tech; tech card không cột COM_NEW (vào thẳng TECH_TODO) |
| 2 | KD kéo COM_NEW→COM_INVOICE; KTHC kéo COM_INVOICE→COM_DEBT (bắt số/ngày HĐ); số dư=0 → **TỰ ĐỘNG** COM_DONE | ✅ PASS-CODE | seed transitions + `kanbanMove` chặn kéo tay COM_DONE; `recomputeBalanceAndMaybeClose` auto-move |
| 3 | Thanh toán xác nhận: KD nhập→pending (nợ chưa giảm); KTHC xác nhận→giảm. KTHC nhập→giảm luôn | ✅ PASS-CODE | `kanbanPaymentAdd` (confirmed = isAdmin\|\|KTHC); `kanbanPaymentConfirm` |
| 4 | Đóng tay/xóa nợ: admin + KTHC-TP force-đóng (ghi lý do); vai khác không | ✅ PASS-CODE | `kanbanCardForceClose` check `isAdmin \|\| (KTHC && truong_phong)`; reason bắt buộc |
| 5 | Kéo lùi: TP/admin 1 bước; cấm về COM_NEW; NV không lùi | ✅ PASS-CODE | seed: backward chỉ `[TP,admin]`, không có đích COM_NEW; move check role |
| 6 | KT kéo TECH độc lập; thẻ kỹ thuật payload KHÔNG có giá | ✅ PASS-CODE | `maskCardForView`: track='technical' → financials=null, items bỏ unit/cost_price |
| 7 | KD THẤY thẻ kỹ thuật nhưng KHÔNG kéo; KT không thấy thương mại máy; KTHC thấy mọi thương mại | ✅ PASS-CODE | `visibleColumnsFor` (KD technical readOnly) + `canSeeCard` (KT commercial chỉ owner=KT; KTHC all) |
| 8 | Đơn vật tư (KT) → chỉ 1 thẻ thương mại (KT thấy giá); KHÔNG sinh kỹ thuật | ✅ PASS-CODE | `createCardsFromOrder`: tech card chỉ khi ban_may/thue_may |
| 9 | KT mở đơn bán máy / tab Bán hàng KD → **bị chặn** | ✅ PASS-CODE | `isKTRestricted` hard-filter `department_id` ở crudList + 403 ở crudGet |
| 10 | Snapshot: đổi giá SP danh mục → thẻ cũ vẫn giá lúc tạo đơn | ✅ PASS-CODE | snapshot cost_price/unit_price vào card_items + financials lúc tạo; đọc tĩnh |
| 11 | boss xem cả 2 track; mọi kéo/sửa/ghi → 403 | ✅ PASS-CODE | `requireWritable` chặn isReadOnly; visibleColumns boss readOnly |
| 12 | Bỏ nút "Tạo thẻ mới"; chỉ sinh từ đơn (giữ "Tạo kỳ thuê") | ✅ PASS-CODE | HTML bỏ nút + `kanban.card.create` gỡ khỏi mainController; rentalPeriod giữ |
| 13 | Công nợ quá hạn 15 ngày (COM_DEBT) → KTHC + người tạo đơn nhận `debt_overdue` | ⏳ PASS-PENDING-DB | `fn_debt_reminder_scan` cập nhật cột COM_DEBT (migration 006); cần push + chạy thử |
| 14 | RLS chặn anon đọc thẳng financials/items/cards/**payments** | ⏳ PASS-PENDING-DB | migration 006 revoke payments; cần push rồi verify (cards/fin/items đã verify v2) |
| 15 | Thuê máy: thẻ kỹ thuật giao→thuê→hoàn thành; KT-NV "Tạo kỳ thuê"→thẻ thương mại kỳ COM_NEW (owner KT)→KTHC→tự đóng; KT thấy phí, không thấy giá vốn máy | ✅ PASS-CODE | seed thue_may technical 3 bước; `kanbanRentalPeriodCreate` (KT, từ TECH_ACTIVE) |

→ **13/15 PASS-CODE**, **2/15 PASS-PENDING-DB** (#13, #14 — cần migration 006 push).

---

## DK cần làm

### Bước A — push code (Vercel rebuild) + migration 006
1. `git push` (đã làm) → Vercel rebuild preview.
2. **`supabase db push`** — áp migration `20260611000006_kanban_v3.sql`:
   - Thêm cột track/order_id/customer_address; tạo `crm_kanban_payments` + RLS.
   - **TRUNCATE thẻ test v2** (DELETE FROM crm_kanban_cards — chưa có dữ liệu thật).
   - Seed lại 8 stages + transitions hai luồng.
   - Cập nhật `fn_debt_reminder_scan` → cột COM_DEBT.

### Bước B — verify UI 4 vai (sau khi push)
- Tạo 1 đơn bán máy (user KD) → kiểm tra board: 2 thẻ (commercial COM_NEW + technical TECH_TODO).
- Đăng nhập KT → thấy thẻ kỹ thuật (không giá), KHÔNG thấy thẻ thương mại máy; mở đơn bán máy của KD → 403.
- KD nhập 1 khoản thanh toán → pending; KTHC xác nhận → nợ giảm; nhập đủ → thẻ tự sang COM_DONE.
- boss → xem hết, kéo/ghi → 403.
- Chạy `SELECT * FROM fn_debt_reminder_scan();` verify #13.

### CHƯA làm
- Migration 005 (DROP crm_workflows) — vẫn giữ chờ.
- Chưa merge main.

## Lưu ý kỹ thuật
- **Auto-create chỉ từ `crm_orders`** (không từ báo giá/ticket). Móc ở [crudController.crudCreate](../src/controllers/crudController.js) sau khi insert order + items.
- **Phân loại card_type** từ category sản phẩm: máy photocopy + is_for_rent → thue_may; máy → ban_may; còn lại → ban_vat_tu. Nếu danh mục có category khác "máy photocopy/máy in", cần chỉnh regex `classifyCardType`.
- **Đồng bộ tiền:** payments confirmed là nguồn; backend ghi đè paid_amount/remaining_amount/payment_status trên crm_orders. Nếu module Bán hàng có form sửa tay paid_amount, **nên khóa** field này với đơn đã có thẻ Kanban (chưa làm — cần DK xác nhận có form đó không để siết).
