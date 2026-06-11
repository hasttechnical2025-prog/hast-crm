# ĐẶC TẢ KANBAN LIÊN PHÒNG — v3 (MÔ HÌNH HAI LUỒNG, SINH TỪ ĐƠN HÀNG)

> **Cho Claude Code.** Đây là bản v3, **đại tu** Kanban v2 vừa dựng. Nền móng bảo mật của v2 giữ lại; phần luồng/cột/sinh-thẻ thay đổi lớn theo nghiệp vụ Siêu Thanh. Đọc hết trước khi sửa. Thiếu thông tin thì hỏi DK.

## 0. NGUYÊN TẮC BẤT BIẾN
1. **Kanban chỉ phục vụ theo dõi HÀNG HÓA + TIỀN.** Tác vụ không liên quan dòng tiền/hàng → không đưa vào Kanban.
2. **Bảo mật ở server.** Mọi quyết định "thấy field gì, kéo thẻ nào" do backend (Express action `kanban.*` trên Vercel, service_role) quyết; client chỉ vẽ thứ server trả. Gọi same-origin `/api` (không áp rule Apps Script).
3. **Thẻ sinh TỪ ĐƠN HÀNG, không tạo tay.** Bỏ nút "Tạo thẻ mới". Tạo đơn → tự sinh thẻ.
4. **Snapshot để kiểm toán.** Giá/giá vốn/SP/khách trên thẻ là **bản chụp tại thời điểm tạo đơn**; danh mục sản phẩm đổi giá về sau **không** ảnh hưởng thẻ cũ. (Trạng thái thanh toán/công nợ thì cập nhật động.)
5. **Kéo-nhả không tự do** — qua `kanban.move`, kiểm transition + role/phòng + điều kiện.
6. Bảng prefix `crm_kanban_`. Job nhắc nợ chạy `pg_cron` trong Supabase.

## 1. MÔ HÌNH HAI LUỒNG (cốt lõi v3)

Một đơn hàng phát sinh **hai loại công việc song song, độc lập**, nên sinh **hai thẻ tách biệt** (trừ vật tư):

- **Thẻ THƯƠNG MẠI** (track=`commercial`): theo dòng tiền — đơn → lên hóa đơn → thu công nợ → đóng. Phòng tạo đơn + KTHC + admin/boss thấy.
- **Thẻ KỸ THUẬT** (track=`technical`): theo việc lắp/giao máy — chỉ KT + admin/boss thấy, **chỉ chứa tên + địa chỉ khách + tên máy/SL, KHÔNG có giá**.

Hai thẻ đóng **riêng** ("đóng case bán máy" do phòng tạo đơn; "đóng case kỹ thuật" do KT).

### 1.1. Theo loại đơn
| Loại (`card_type`) | Phòng tạo đơn | Thẻ thương mại | Thẻ kỹ thuật |
|---|---|---|---|
| `ban_may` (bán máy) | KD | ✓ (KD↔KTHC) | ✓ (KT lắp) |
| `thue_may` (thuê máy) | KD | ✓ qua **kỳ thuê** (xem 1.3) | ✓ (KT giao → đang thuê → thu hồi) |
| `ban_vat_tu` (bán vật tư, gồm cả công sửa/bảo trì = bán sức lao động) | KT | ✓ (KT↔KTHC) | ✗ (không có lắp đặt) |

> **Không có luồng "bảo trì" riêng** — sửa chữa/bảo trì coi như bán vật tư (bán công). Bỏ.

### 1.2. Cột (stages)

**Luồng THƯƠNG MẠI** (4 cột):
| code | Tên | Dept phụ trách cột |
|---|---|---|
| `COM_NEW` | Đơn mới | phòng tạo đơn (KD hoặc KT-vật tư) |
| `COM_INVOICE` | KTHC – Cần lên hóa đơn | KTHC |
| `COM_DEBT` | KTHC – Đã lên hóa đơn / Thu hồi công nợ | KTHC |
| `COM_DONE` | Hoàn tất | (terminal; phòng tạo đơn đóng) |

**Luồng KỸ THUẬT** (bán máy — 3 cột):
| code | Tên | Dept |
|---|---|---|
| `TECH_TODO` | Cần lắp máy | KT |
| `TECH_INSTALLED` | Đã lắp / chạy tốt | KT |
| `TECH_DONE` | Hoàn tất | (terminal; KT đóng) |

**Luồng KỸ THUẬT (thuê máy)** dùng thêm: `TECH_ACTIVE` (Đang cho thuê), `TECH_RECOVER` (Thu hồi máy). Đường đi: `TECH_TODO → TECH_ACTIVE → TECH_RECOVER → TECH_DONE`.

> Bỏ hẳn cột "Cơ hội / Báo giá" (xác suất bán ~0%, không theo dõi).

### 1.3. Thuê máy & kỳ thuê
- Đơn thuê (KD) → sinh **thẻ kỹ thuật** (giao→đang thuê→thu hồi→hoàn tất). **Không** sinh một thẻ thương mại lớn.
- Mỗi **kỳ thanh toán** sinh một **thẻ thương mại** `thue_may_ky` (COM_INVOICE → COM_DEBT → COM_DONE) — gắn `parent_card_id` = thẻ kỹ thuật thuê. Sinh bằng nút "Tạo kỳ thuê" trên thẻ kỹ thuật khi đang `TECH_ACTIVE` (về sau có thể tự động bằng pg_cron). *(Nút này KHÁC nút "Tạo thẻ mới" đã bỏ — nó tạo kỳ billing, không tạo thẻ mồ côi.)*

## 1A. CHỐT CƠ CHẾ THẤY / KÉO / THANH TOÁN (từ ma trận DK + xác nhận — ƯU TIÊN CAO NHẤT)

**Ai THẤY (visibility):**
- *Luồng thương mại:* phòng tạo đơn (KD bán máy; KT vật tư/thuê) thấy cả 4 cột. KTHC thấy từ "Lên hóa đơn" trở đi (KHÔNG thấy "Đơn mới"). KT không thấy luồng thương mại máy.
- *Luồng kỹ thuật* (bán máy/thuê máy): **KD thấy để theo dõi nhưng KHÔNG kéo**; **KT thấy & kéo**; KTHC không thấy. Bỏ cột "Đơn mới" — thẻ kỹ thuật vào thẳng "Lắp máy".
- NV chỉ thấy thẻ `assigned_to=mình` / chưa giao trong phòng mình.

**Ai KÉO (action):**
- `Đơn mới → Lên hóa đơn`: phòng tạo đơn kéo (KD bán máy; KT vật tư/thuê).
- `Lên hóa đơn → Đã lên hóa đơn`: KTHC kéo (bắt buộc đã có số/ngày hóa đơn).
- `Đã lên hóa đơn → Hoàn thành`: **TỰ ĐỘNG khi số dư công nợ = 0** (không ai kéo).
- Kỹ thuật `Lắp máy → Hoàn thành`: KT kéo tay khi máy chạy tốt.
- **Kéo lùi:** chỉ TP/admin, tối đa **1 bước**, **cấm về "Đơn mới"**.
- **Đóng tay / "Xóa nợ" (nợ xấu):** chỉ **admin + KTHC-TP** được force-đóng (bỏ qua điều kiện thu đủ), ghi lý do.

**THANH TOÁN — sổ thanh toán có xác nhận (CƠ CHẾ MỚI):**
- Khách có thể trả cho **KD hoặc KTHC** → cả hai được **ghi nhận khoản thanh toán** (số tiền) vào thẻ.
- Khoản **KD nhập = "chờ xác nhận"**, CHƯA trừ công nợ. **KTHC xác nhận** mới đối trừ. Khoản KTHC nhập = xác nhận luôn.
- `Số dư công nợ = tổng tiền (snapshot) − tổng khoản ĐÃ xác nhận`. **Số dư = 0 → thẻ tự động sang "Hoàn thành".**
- Bảng mới `crm_kanban_payments (id, card_id, amount, recorded_by, recorded_dept, status['pending'|'confirmed'], confirmed_by, confirmed_at, note, created_at)`. KD chỉ INSERT `pending`; KTHC confirm/insert.
- **Nguồn sự thật tiền nên gắn với đơn/hóa đơn (kế toán)** — CC quyết cách đồng bộ `crm_kanban_payments` ↔ công nợ trên `crm_orders` và **hỏi DK** trước khi code phần này.

**THUÊ MÁY:**
- Đơn thuê do **KD** tạo → sinh **thẻ kỹ thuật** (KT): `Lắp/giao máy → Đang cho thuê → Thu hồi máy → Hoàn thành` (tương tự lắp máy, thêm bước thu hồi cuối kỳ hợp đồng).
- **Billing theo kỳ do KT-NV phụ trách** (giống vật tư): KT-NV bấm **"Tạo kỳ thuê"** trên thẻ kỹ thuật đang cho thuê → sinh thẻ thương mại `thue_may_ky` ở "Đơn mới" (owner=KT) → KT đẩy sang KTHC → lên hóa đơn → thu nợ → tự đóng khi số dư=0. KT thấy **phí thuê** (như giá vật tư), KHÔNG thấy giá trị/giá vốn máy.

> Mục 1A này **ưu tiên hơn** mọi mô tả cũ ở §4/§5 nếu mâu thuẫn. CC cập nhật §4 (transitions: drag owner + auto-complete + backward-1 + write-off) và §5 (KD được thêm khoản thanh toán `pending`) cho khớp 1A.

---

## 2. SINH THẺ TỪ ĐƠN HÀNG (auto-create)

Khi `crudCreate` tạo một dòng `crm_orders`:
1. Xác định `card_type` từ sản phẩm trên đơn: máy photocopy + thuê → `thue_may`; máy + bán → `ban_may`; còn lại → `ban_vat_tu`. (Đơn KD = máy/thuê; đơn KT = vật tư.)
2. **Snapshot** từ đơn + danh mục SP tại thời điểm đó vào thẻ:
   - `customer_name`, `customer_address`.
   - các dòng `crm_kanban_card_items` từ `crm_order_items`: `product_name`, `quantity`, `unit_price` (từ đơn), `cost_price` (từ `crm_products` lúc này), `subtotal`.
   - `crm_kanban_financials`: `total_amount`, `total_cost`, `margin` (tổng hợp). Đây là **bản chụp**, không đọc động.
3. Tạo **thẻ thương mại** ở `COM_NEW`, `owner_dept` = phòng tạo đơn, `assigned_to` = người tạo đơn, `order_id` trỏ về đơn.
4. Nếu là **máy (ban_may/thue_may)**: tạo thêm **thẻ kỹ thuật** ở `TECH_TODO`, `owner_dept`='KT', `order_id` trỏ về đơn, `assigned_to`=null (chờ KT-TP phân công). Thẻ kỹ thuật **chỉ** snapshot `customer_name`, `customer_address`, và tên+SL máy (KHÔNG `unit_price`/`cost_price`).
5. Trạng thái thanh toán (`payment_status`, `paid_amount`, `debt_amount`) cập nhật động do KTHC trong quá trình thu nợ (không snapshot cứng).
6. Ghi log + emit notification cho người phụ trách phòng nhận.

> **Không** xóa/sửa module Bán hàng; chỉ móc hook tạo thẻ vào sau khi đơn được tạo.

## 3. SCHEMA (sửa từ v2)

Thêm/sửa migration **mới** (không viết đè migration đã áp). Bảng cấu hình stages/transitions cần **xóa seed cũ và seed lại** theo mô hình hai luồng.

```sql
-- stages: thêm cột track
alter table public.crm_kanban_stages add column if not exists track text; -- 'commercial' | 'technical'

-- cards: thêm liên kết đơn + track + snapshot khách
alter table public.crm_kanban_cards
  add column if not exists order_id uuid references public.crm_orders(id),
  add column if not exists track text check (track in ('commercial','technical')),
  add column if not exists customer_address text;
-- (customer_name đã có)

-- card_items giữ nguyên: với thẻ kỹ thuật, unit_price/cost_price để NULL.
-- financials = snapshot tổng hợp (total_amount/total_cost/margin) + thanh toán động (payment_status/paid_amount/debt_amount/last_reminded_at).
```

> Thẻ test "abc" và mọi thẻ v2 trong `crm_kanban_cards` nên **xóa sạch** (TRUNCATE) trước khi seed lại — chưa có dữ liệu thật.

## 4. SEED STAGES + TRANSITIONS (seed lại)

Stages (track):
```
COM_NEW(commercial,10) COM_INVOICE(commercial,20) COM_DEBT(commercial,30) COM_DONE(commercial,40,terminal)
TECH_TODO(technical,10) TECH_INSTALLED(technical,20) TECH_ACTIVE(technical,25) TECH_RECOVER(technical,30) TECH_DONE(technical,40,terminal)
```

Quy ước vai (vai SPEC; `boss` KHÔNG có trong allowed_roles vì chỉ-xem):
- forward cùng phòng: `[nhan_vien,truong_phong,admin]`
- forward vượt phòng / đóng case: `[truong_phong,admin]`

Transitions chính:
```
# THƯƠNG MẠI — ban_may (origin KD)
ban_may COM_NEW→COM_INVOICE  acting=KD   roles[TP,admin]
ban_may COM_INVOICE→COM_DEBT acting=KTHC roles[NV,TP,admin] require[invoice_no,invoice_date]
ban_may COM_DEBT→COM_DONE    acting=KD   roles[TP,admin] require[payment_status=paid]   # phòng tạo đơn đóng
# (+ backward TP/admin)

# THƯƠNG MẠI — ban_vat_tu (origin KT) : như ban_may nhưng acting COM_NEW→COM_INVOICE = KT, đóng = KT
# THƯƠNG MẠI — thue_may_ky (kỳ thuê) : COM_INVOICE→COM_DEBT→COM_DONE (origin = KD), require như trên

# KỸ THUẬT — ban_may
ban_may TECH_TODO→TECH_INSTALLED acting=KT roles[NV,TP,admin]
ban_may TECH_INSTALLED→TECH_DONE acting=KT roles[TP,admin]

# KỸ THUẬT — thue_may
thue_may TECH_TODO→TECH_ACTIVE   acting=KT roles[TP,admin]
thue_may TECH_ACTIVE→TECH_RECOVER acting=KT roles[TP,admin]
thue_may TECH_RECOVER→TECH_DONE  acting=KT roles[TP,admin]
```
> `COM_DEBT→COM_DONE` vẫn bắt buộc `payment_status='paid'` (đóng khi thu đủ).

## 5. PHÂN QUYỀN & HIỂN THỊ

### 5.0. Vai (4 vai, ánh xạ ở server, không đổi `crm_users`)
`admin`→admin (toàn quyền, bỏ qua check phòng) · `boss`→boss (CHỈ XEM mọi thứ, mọi ghi→403) · `manager`→truong_phong · `staff`→nhan_vien. Phòng đọc động từ `crm_departments.code`.

### 5.1. Thấy CỘT/THẺ theo track + phòng
- **KD** (TP/NV): chỉ thấy **cột thương mại** của thẻ `owner_dept=KD` (máy/thuê). KHÔNG thấy thẻ kỹ thuật.
- **KTHC** (TP/NV): thấy **mọi thẻ thương mại** (máy, vật tư, kỳ thuê) để lên hóa đơn/thu nợ. Không thấy thẻ kỹ thuật.
- **KT** (TP/NV): thấy **thẻ kỹ thuật** (cột lắp/giao/thu hồi) + **thẻ thương mại vật tư của chính KT** (KT là người bán vật tư). KHÔNG thấy luồng thương mại máy (KD↔KTHC). TP Kỹ thuật cũng vậy.
- **admin**: thấy hết, kéo được. **boss**: thấy hết, read-only.
- **NV**: trong phạm vi trên, chỉ thấy thẻ `assigned_to=mình` hoặc chưa giao trong phòng mình.

### 5.2. Thấy FIELD (ẩn giá)
- **Thẻ kỹ thuật:** KHÔNG chứa field tài chính (chỉ tên/địa chỉ khách + tên máy/SL). KT không bao giờ thấy giá máy.
- **Thẻ thương mại** — ma trận theo nhóm (`selling`=giá bán/tổng; `cost`=giá vốn/margin; `billing`=hóa đơn; `debt`=công nợ/thanh toán):

| nhóm | admin | phòng-tạo-đơn (KD máy / KT vật tư) | KTHC | boss |
|---|---|---|---|---|
| selling | ✓ | ✓ | ✓ | ✓ (đọc) |
| cost | ✓ | ✗ | ✓ | ✓ (đọc) |
| billing | ✓ | đọc | ✓ | ✓ (đọc) |
| debt | ✓ | đọc | ✓ | ✓ (đọc) |

"✗" = server không gửi field. "đọc" = gửi nhưng khóa sửa. `boss` = mọi field nhưng khóa sửa toàn bộ.

### 5.3. ⚠️ Đồng bộ bảo mật ngoài Kanban
KT **không được thấy giá máy ở bất cứ đâu**. Vì giá nằm ở đơn hàng, phải đảm bảo **KT không truy cập được đơn bán máy / tab Bán hàng của KD**. KT chỉ thấy/tạo **đơn vật tư của KT** + khách hàng (tên/địa chỉ). **Kiểm tra & siết quyền tab "Bán hàng" cho vai KT** như một phần của task này (báo DK nếu cần đổi menu/route guard).

## 6. SECURE ENDPOINTS (action `kanban.*`, Express)
- `kanban.board` — trả board đã lọc theo track + phòng + role; mask field thẻ thương mại; thẻ kỹ thuật không kèm tài chính. Không bao giờ trả field chưa mask.
- `kanban.move` — cổng kéo-nhả: `boss`→403; kiểm transition + role + acting_dept (admin bỏ qua) + NV chỉ kéo thẻ của mình + require_fields; `→COM_DONE` bắt `payment_status='paid'`; ghi log + emit notification.
- **Auto-create hook** (trong `crudController` sau khi tạo `crm_orders`) — sinh thẻ theo §2. (Đây là phiên bản SẠCH thay cho `autoCreateWorkflowsForEntity` cũ đã gỡ.)
- `kanban.rentalPeriod.create` — nút "Tạo kỳ thuê" trên thẻ kỹ thuật `thue_may` đang `TECH_ACTIVE`: sinh thẻ thương mại `thue_may_ky` ở `COM_INVOICE`. Vai KTHC/admin.
- `kanban.card.update` — cập nhật field theo `editableGroupsFor` (KTHC cập nhật hóa đơn/thanh toán). **Bỏ** `kanban.card.create` thủ công (không còn tạo tay).
- `kanban.notifications.list/read` — chuông in-app (dùng chung bảng `crm_notifications`, `entity_type='kanban_card'`).
- `kanban.config.get` — trả cấu hình stages/track cho frontend (đảm bảo có action này, khớp tên FE↔BE).
- `pg_cron` nhắc công nợ quá hạn 15 ngày (thẻ thương mại ở `COM_DEBT`) → notification cho KTHC + người tạo đơn (`created_by`/`assigned_to`).

## 7. RLS — như v2: revoke `anon/authenticated` SELECT trên `crm_kanban_card_items`, `crm_kanban_financials`, `crm_kanban_cards`, `crm_kanban_logs`; truy cập qua action (service_role). `crm_notifications` giữ RLS hiện có.

## 8. FRONTEND
- Tab giữ tên **"Quy trình"**. Board render từ `kanban.board` — **board mỗi vai chỉ hiện track của họ** (KD/KTHC: cột thương mại; KT: cột kỹ thuật). Bỏ dropdown loại thẻ nếu gây rối, hoặc lọc trong phạm vi đã được phép.
- **Bỏ nút "Tạo thẻ mới".** Thêm nút "Tạo kỳ thuê" chỉ trên thẻ kỹ thuật thuê đang `TECH_ACTIVE` (vai KTHC/admin).
- Kéo-nhả qua `kanban.move`; 4xx → trả thẻ về chỗ cũ + toast lý do.
- Thẻ thương mại hiện field theo server gửi (ẩn giá vốn với KD); thẻ kỹ thuật chỉ hiện khách + máy/SL.
- Chuông 🔔 dùng lại UI sẵn có; type `card_assigned/handoff/returned/debt_overdue`.
- `js/config.js` giữ same-origin `/api` (đã sửa ở 1582c54).

## 9. THỰC HIỆN (đại tu v2→v3, KHÔNG đập lại từ đầu)
**Giữ lại từ v2:** cơ chế bảo mật server, `kanban-auth`/`kanban-visibility`, RLS, chuông, pg_cron, máy trạng thái, ánh xạ vai.
**Sửa:** schema (thêm order_id/track/customer_address, §3); seed lại stages/transitions hai luồng (§4); thêm auto-create hook từ đơn (§2); bỏ tạo thẻ tay; sửa visibility theo track (§5); siết quyền tab Bán hàng cho KT (§5.3); frontend board theo track (§8); thêm/khớp `kanban.config.get`.
**Dọn:** TRUNCATE thẻ test v2. `crm_workflows` cũ vẫn **chưa drop** (migration 005 giữ chờ DK).
**Backup branch riêng, chưa merge main.**

## 10. NGHIỆM THU
1. Tạo đơn bán máy (KD) → tự sinh **2 thẻ**: 1 thương mại ở `COM_NEW` (KD thấy, có giá), 1 kỹ thuật ở **`Lắp máy`** (KT thấy, KHÔNG giá; không có cột "Đơn mới").
2. KD kéo thẻ thương mại `Đơn mới→Lên hóa đơn`; KTHC kéo `Lên hóa đơn→Đã lên hóa đơn` (bắt buộc có số/ngày HĐ); KD/KTHC ghi thanh toán → khi **số dư công nợ = 0 → thẻ TỰ ĐỘNG sang Hoàn thành** (không ai kéo).
3. **Thanh toán có xác nhận:** KD nhập 1 khoản → trạng thái `pending`, công nợ CHƯA giảm; KTHC xác nhận → công nợ giảm đúng số. KTHC nhập trực tiếp → giảm luôn.
4. **Đóng tay/xóa nợ:** admin và KTHC-TP force-đóng được thẻ còn nợ (ghi lý do); vai khác không.
5. **Kéo lùi:** TP/admin lùi được 1 bước (vd `Đã lên hóa đơn→Lên hóa đơn`); cấm về `Đơn mới`; NV không lùi được.
6. KT kéo thẻ kỹ thuật `Lắp máy→Hoàn thành` độc lập; KT-NV mở thẻ kỹ thuật chỉ thấy tên/địa chỉ khách + máy/SL, **payload Network không có giá**.
7. **KD THẤY thẻ kỹ thuật để theo dõi nhưng KHÔNG kéo được** (chỉ KT kéo). KT **không** thấy thẻ thương mại máy. KTHC thấy mọi thẻ thương mại.
8. Tạo đơn vật tư (KT) → chỉ 1 thẻ thương mại (KT thấy giá vật tư) → KTHC; KHÔNG sinh thẻ kỹ thuật.
9. KT mở/đọc đơn bán máy hoặc tab Bán hàng KD → **bị chặn** (không thấy giá máy ở bất kỳ đâu).
10. Snapshot: đổi giá sản phẩm trong danh mục → mở thẻ cũ vẫn hiện giá lúc tạo đơn.
11. `boss` xem hết (cả 2 track), mọi kéo/sửa/ghi → 403.
12. Bỏ được nút "Tạo thẻ mới"; thẻ chỉ sinh từ đơn (riêng "Tạo kỳ thuê" vẫn còn).
13. Công nợ quá hạn 15 ngày (thẻ ở `Đã lên hóa đơn`) → KTHC + người tạo đơn nhận `debt_overdue`.
14. RLS chặn anon đọc thẳng bảng tài chính/items/cards/payments.
15. **Thuê máy:** đơn (KD) → thẻ kỹ thuật `Lắp/giao → Đang cho thuê → Thu hồi → Hoàn thành`; **KT-NV** bấm "Tạo kỳ thuê" → sinh thẻ thương mại kỳ ở `Đơn mới` (owner KT) → đẩy sang KTHC → tự đóng khi thu đủ. KT thấy phí thuê, không thấy giá vốn máy.

## 11. QUYẾT ĐỊNH ĐÃ CHỐT
- Hai thẻ/đơn máy (thương mại + kỹ thuật), độc lập, đóng riêng.
- Sinh từ đơn hàng; bỏ tạo thẻ tay (giữ "Tạo kỳ thuê").
- Snapshot giá/giá vốn/SP/khách tại thời điểm tạo đơn; thanh toán/công nợ cập nhật động.
- Bỏ cột Cơ hội/Báo giá. Bỏ luồng bảo trì (coi là bán vật tư).
- KT cô lập tuyệt đối khỏi giá máy (Kanban + tab Bán hàng).
- **Kéo:** KD đẩy Đơn mới→Lên hóa đơn; KTHC Lên→Đã lên hóa đơn; auto Hoàn thành khi số dư=0; KT kéo luồng kỹ thuật. KD chỉ XEM luồng kỹ thuật.
- **Thanh toán:** KD nhập khoản `pending` → KTHC xác nhận mới trừ công nợ; số dư=0 → tự đóng.
- **Đóng tay/xóa nợ:** admin + KTHC-TP. **Kéo lùi:** TP/admin 1 bước, cấm về Đơn mới.
- **Thuê máy:** thẻ kỹ thuật KT (giao→thuê→thu hồi); billing kỳ do KT-NV phụ trách (như vật tư).

**Điểm CC cần hỏi DK khi build:** nguồn sự thật thanh toán (sổ `crm_kanban_payments` vs công nợ trên `crm_orders`) & cách đồng bộ; chu kỳ tạo kỳ thuê (tay/pg_cron); cách guard tab Bán hàng cho KT; có cần bước "Thu hồi máy" cuối kỳ thuê hay giữ đơn giản như lắp máy.
