-- ============================================================================
-- Migration 007: crm_orders.order_type — phân loại đơn TƯỜNG MINH (Kanban v3)
-- Tham chiếu: chốt DK 2026-06-11 (sửa spec §1A/§2/§5.3).
-- ============================================================================
-- Thay vì ĐOÁN card_type từ sản phẩm/is_for_rent, đơn hàng có cột order_type
-- do người tạo đơn chọn (radio bắt buộc): ban_may | thue_may | ban_vat_tu.
-- Hook createCardsFromOrder đọc thẳng cột này.
--
-- Idempotent. KHÔNG đè migration trước.
-- ============================================================================

alter table public.crm_orders
  add column if not exists order_type text
  check (order_type in ('ban_may','thue_may','ban_vat_tu'));

comment on column public.crm_orders.order_type is
  'Loại đơn (Kanban v3): ban_may=máy bán | thue_may=máy thuê | ban_vat_tu=vật tư/dịch vụ. Quyết định card_type khi sinh thẻ Kanban. Mọi phòng đều chọn được cả 3.';

-- Đơn cũ (nếu có) chưa có order_type → để NULL; hook bỏ qua đơn không có order_type
-- (chỉ đơn mới tạo từ form có radio mới sinh thẻ).
