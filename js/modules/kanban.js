/**
 * Kanban v2 — frontend module.
 * Tham chiếu: plans/kanban_rebuild_spec.md §8.
 *
 * NGUYÊN TẮC:
 *   - Frontend KHÔNG suy luận quyền. Server quyết: cột nào hiện, thẻ nào hiện,
 *     field nào có. FE chỉ vẽ cái server trả.
 *   - Cột readOnly: hiện mờ, không cho thả vào.
 *   - Drag-drop: khi thả → gọi kanban.move. Nếu lỗi 4xx → toast + reload.
 *   - Financials: chỉ render field có trong payload; field _modes[group]='read' → input disabled.
 *   - Chuông 🔔: gọi kanban.notifications.list, click 1 mục → mở thẻ + đánh dấu đã đọc.
 */
import { state } from '../state.js';
import { api } from '../api.js';
import {
  toast,
  confirmDialog,
  openModal,
  closeModal,
  formatDateVN,
  formatDateTimeVN,
  formatVND,
  escapeHtml,
  timeAgo,
} from '../utils.js';

// ============================================================================
// STATE
// ============================================================================

state.kanban = {
  data: null,                  // last board response
  filterCardType: '',          // '' = tất cả, hoặc 1 trong ban_may/ban_vat_tu/thue_may/thue_may_ky
  notifPollTimer: null,
  config: null,                // { stages, transitions, me }
};

let _draggedCardId = null;
let _draggedFromStage = null;

// ============================================================================
// PUBLIC: load board
// ============================================================================

export async function loadKanbanBoard(opts = {}) {
  const board = document.getElementById('kanban-board');
  if (board && !opts.silent) {
    board.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="spinner dark"></div> Đang tải Kanban...</div>';
  }
  try {
    // Lazy-load config 1 lần
    if (!state.kanban.config) {
      state.kanban.config = await api('kanban.config.get', null, null, { silent: true });
    }
    const r = await api('kanban.board.get', null, { cardType: state.kanban.filterCardType || undefined }, opts);
    state.kanban.data = r;
    renderKanbanBoard();
    // Refresh notif badge ngay sau khi load board
    refreshKanbanNotifBadge();
    if (!state.kanban.notifPollTimer) startKanbanNotifPolling();
  } catch (e) {
    if (board && !opts.silent) {
      board.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
    }
    if (e.code === 'UNAUTHORIZED') { window.clearSession?.(); window.showLogin?.(); }
  }
}

// ============================================================================
// RENDER
// ============================================================================

function deptCssClass(dept) {
  return dept === 'KD' ? 'kd' : dept === 'KT' ? 'kt' : dept === 'KTHC' ? 'kthc' : 'done';
}

export function renderKanbanBoard() {
  const data = state.kanban.data;
  const board = document.getElementById('kanban-board');
  if (!board || !data) return;

  const cols = data.columns || [];
  if (cols.length === 0) {
    board.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:40px"><p><strong>Không có cột nào trong tầm nhìn của bạn</strong></p><p style="font-size:12.5px;color:var(--ink-3)">Liên hệ Trưởng phòng/Boss nếu cần được giao thẻ.</p></div>`;
    return;
  }

  // Tổng số thẻ
  let totalCards = 0;
  cols.forEach((c) => { totalCards += (c.cards || []).length; });

  board.innerHTML = cols.map((col) => renderColumn(col)).join('');
  if (window.lucide) window.lucide.createIcons();

  // Cập nhật badge tổng
  const counter = document.getElementById('kanban-total-count');
  if (counter) counter.textContent = totalCards;
}

function renderColumn(col) {
  const stage = col.stage;
  const cards = col.cards || [];
  const deptCls = deptCssClass(stage.ownerDept);
  const readOnlyAttr = col.readOnly ? 'data-readonly="true"' : '';
  const readOnlyCls = col.readOnly ? 'kanban-column--readonly' : '';
  return `
    <div class="kanban-column ${readOnlyCls}" ${readOnlyAttr}>
      <div class="kanban-column-header">
        <div class="kanban-column-title">
          <span class="dept-tag ${deptCls}">${escapeHtml(stage.ownerDept || '')}</span>
          ${escapeHtml(stage.name)}
        </div>
        <div class="kanban-column-count">${cards.length}</div>
      </div>
      <div class="kanban-column-body"
           data-stage-id="${escapeHtml(stage.id)}"
           data-readonly="${col.readOnly ? '1' : '0'}"
           ondragover="kanbanDragOver(event)"
           ondragleave="kanbanDragLeave(event)"
           ondrop="kanbanDrop(event)">
        ${cards.length === 0
          ? '<div class="kanban-empty">Không có thẻ nào</div>'
          : cards.map((card) => renderCard(card, col.readOnly)).join('')}
      </div>
    </div>
  `;
}

function renderCard(card, columnReadOnly) {
  const fin = card.financials || null;
  const modes = (fin && fin._modes) || {};
  const cardTypeLabel = ({
    ban_may: 'Bán máy',
    thue_may: 'Cho thuê máy',
    thue_may_ky: 'Kỳ thuê',
    ban_vat_tu: 'Bán vật tư',
  })[card.cardType] || card.cardType;

  const cardClass = `kanban-card kanban-card--${card.cardType} ${columnReadOnly ? 'kanban-card--readonly' : ''}`;
  // Draggable nếu cột không read-only và status active
  const draggable = !columnReadOnly && card.status === 'active';
  const dragAttrs = draggable
    ? `draggable="true" ondragstart="kanbanDragStart(event,'${card.id}','${card.currentStage}')" ondragend="kanbanDragEnd(event)"`
    : '';

  const totalAmount = fin && (fin.total_amount ?? fin.totalAmount);
  const paymentStatus = fin && (fin.payment_status ?? fin.paymentStatus);
  const dueDate = fin && (fin.due_date ?? fin.dueDate);

  return `
    <div class="${cardClass}" data-card-id="${card.id}" ${dragAttrs} onclick="openKanbanCard('${card.id}')">
      <div class="kanban-card-header">
        <span class="kanban-card-type">${escapeHtml(cardTypeLabel)}</span>
        ${card.assignedTo ? `<span class="kanban-card-assignee" title="Đã giao"><i data-lucide="user" style="width:11px;height:11px"></i></span>` : ''}
      </div>
      <div class="kanban-card-title">${escapeHtml(card.title || '(không tiêu đề)')}</div>
      ${card.customerName ? `<div class="kanban-card-customer">${escapeHtml(card.customerName)}</div>` : ''}
      ${card.periodLabel ? `<div class="kanban-card-period"><i data-lucide="calendar" style="width:11px;height:11px"></i> ${escapeHtml(card.periodLabel)}</div>` : ''}
      ${totalAmount != null ? `<div class="kanban-card-amount">${formatVND(totalAmount)}</div>` : ''}
      ${paymentStatus ? `<div class="kanban-card-paystatus paystatus--${paymentStatus}">${escapeHtml(paymentStatus)}</div>` : ''}
      ${dueDate ? `<div class="kanban-card-meta"><i data-lucide="clock" style="width:11px;height:11px"></i> ${formatDateVN(dueDate)}</div>` : ''}
    </div>
  `;
}

// ============================================================================
// DRAG & DROP
// ============================================================================

export function kanbanDragStart(event, cardId, fromStage) {
  _draggedCardId = cardId;
  _draggedFromStage = fromStage;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', cardId);
  event.currentTarget.classList.add('dragging');
}

export function kanbanDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.kanban-column-body.drag-over,.kanban-column-body.drag-forbidden')
    .forEach((el) => el.classList.remove('drag-over', 'drag-forbidden'));
  _draggedCardId = null;
  _draggedFromStage = null;
}

export function kanbanDragOver(event) {
  if (!_draggedCardId) return;
  event.preventDefault();
  const body = event.currentTarget;
  const targetStage = body.dataset.stageId;
  const readonly = body.dataset.readonly === '1';

  document.querySelectorAll('.kanban-column-body').forEach((el) => {
    if (el !== body) el.classList.remove('drag-over', 'drag-forbidden');
  });

  if (readonly || targetStage === _draggedFromStage) {
    body.classList.add('drag-forbidden');
    body.classList.remove('drag-over');
    event.dataTransfer.dropEffect = 'none';
    return;
  }
  body.classList.add('drag-over');
  body.classList.remove('drag-forbidden');
  event.dataTransfer.dropEffect = 'move';
}

export function kanbanDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove('drag-over', 'drag-forbidden');
}

export async function kanbanDrop(event) {
  event.preventDefault();
  if (!_draggedCardId) return;

  const body = event.currentTarget;
  body.classList.remove('drag-over', 'drag-forbidden');
  const targetStage = body.dataset.stageId;
  const readonly = body.dataset.readonly === '1';
  const cardId = _draggedCardId;
  const fromStage = _draggedFromStage;

  _draggedCardId = null;
  _draggedFromStage = null;

  if (readonly) {
    toast('Cột này là read-only, không thể thả vào.', 'error');
    return;
  }
  if (targetStage === fromStage) return;

  // Optimistic UI: move DOM ngay
  const cardEl = document.querySelector(`.kanban-card[data-card-id="${cardId}"]`);
  if (cardEl) body.appendChild(cardEl);

  try {
    await api('kanban.move', { cardId, toStage: targetStage });
    toast('Đã chuyển stage', 'success');
    loadKanbanBoard({ silent: true });
  } catch (e) {
    toast(e.message || 'Không chuyển được', 'error');
    loadKanbanBoard({ silent: true }); // rollback bằng cách reload
  }
}

// ============================================================================
// CARD DRAWER (chi tiết + sửa)
// ============================================================================

export async function openKanbanCard(cardId) {
  let drawer = document.getElementById('drawer-kanban-card');
  if (!drawer) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="drawer" id="drawer-kanban-card">
        <div class="drawer-header">
          <div>
            <h3 id="kbd-title">Chi tiết thẻ</h3>
            <div class="drawer-sub" id="kbd-sub"></div>
          </div>
          <button class="modal-close" onclick="closeAllDrawers && closeAllDrawers()"><i data-lucide="x" style="width:18px;height:18px"></i></button>
        </div>
        <div class="drawer-body" id="kbd-body">
          <div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>
        </div>
        <div class="drawer-footer">
          <button type="button" class="btn btn-ghost" onclick="closeAllDrawers && closeAllDrawers()">Đóng</button>
          <button type="button" class="btn btn-primary" id="kbd-save-btn" onclick="saveKanbanCardEdits()">Lưu thay đổi</button>
        </div>
      </div>
    `);
    if (window.lucide) window.lucide.createIcons();
  }
  window.openDrawer && window.openDrawer('drawer-kanban-card');
  document.getElementById('kbd-body').innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>';

  try {
    const r = await api('kanban.card.get', null, { id: cardId });
    const card = r.card;
    const cfg = state.kanban.config;
    const stageRow = (cfg?.stages || []).find((s) => s.id === card.currentStage);
    document.getElementById('kbd-title').textContent = card.title || '(không tiêu đề)';
    document.getElementById('kbd-sub').textContent = `${card.cardType} · ${stageRow ? stageRow.name : card.currentStage}` + (card.customerName ? ` · ${card.customerName}` : '');

    document.getElementById('drawer-kanban-card').dataset.cardId = card.id;

    const modes = (card.financials && card.financials._modes) || {};
    const isReadOnlyCol = state.kanban.data?.columns?.find((c) => c.stage.id === card.currentStage)?.readOnly;
    const lockedAll = !!isReadOnlyCol || state.kanban.config?.me?.isReadOnly;

    document.getElementById('kbd-save-btn').style.display = lockedAll ? 'none' : '';

    const fin = card.financials || {};
    const showGroup = (g) => modes[g] === 'write' || modes[g] === 'read';
    const lockField = (g) => modes[g] !== 'write' || lockedAll;

    const ftext = (key, group, label, type = 'text') => {
      if (!showGroup(group)) return '';
      const v = fin[key] != null ? fin[key] : '';
      const disabled = lockField(group) ? 'disabled' : '';
      return `<label class="kbd-field"><span>${label}</span><input type="${type}" data-fin-key="${key}" value="${escapeHtml(String(v))}" ${disabled}></label>`;
    };

    const itemsHtml = (card.items && card.items.length > 0) ? `
      <div class="kbd-section">
        <h4>Sản phẩm (${card.items.length})</h4>
        <table class="kbd-items">
          <thead><tr><th>Mã/Tên</th><th>SL</th><th>ĐVT</th>
            ${showGroup('selling') ? '<th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th>' : ''}
            ${showGroup('cost') ? '<th class="text-right">Giá vốn</th>' : ''}
          </tr></thead>
          <tbody>
            ${card.items.map((it) => `
              <tr>
                <td>${escapeHtml(it.productCode || '')} ${escapeHtml(it.productName || '')}</td>
                <td class="text-right">${escapeHtml(String(it.quantity ?? ''))}</td>
                <td>${escapeHtml(it.unit || '')}</td>
                ${showGroup('selling') ? `<td class="text-right">${it.unitPrice != null ? formatVND(it.unitPrice) : '-'}</td><td class="text-right">${it.lineSubtotal != null ? formatVND(it.lineSubtotal) : '-'}</td>` : ''}
                ${showGroup('cost') ? `<td class="text-right">${it.costPrice != null ? formatVND(it.costPrice) : '-'}</td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : '';

    const logsHtml = (r.logs && r.logs.length > 0) ? `
      <div class="kbd-section">
        <h4>Lịch sử (${r.logs.length})</h4>
        <ul class="kbd-logs">
          ${r.logs.map((l) => `
            <li>
              <strong>${escapeHtml(l.action)}</strong>
              ${l.fromStage && l.toStage ? `· ${escapeHtml(l.fromStage)} → ${escapeHtml(l.toStage)}` : ''}
              <span class="kbd-log-time">${formatDateTimeVN(l.at)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : '';

    // Nút "Tạo kỳ thuê" cho thẻ thue_may ở RENTAL_ACTIVE
    let rentalBtn = '';
    const me = state.kanban.config?.me;
    const allowRentalBtn = me && !me.isReadOnly && (me.isAdmin || me.deptCode === 'KTHC');
    if (card.cardType === 'thue_may' && card.currentStage === 'RENTAL_ACTIVE' && allowRentalBtn) {
      rentalBtn = `<button class="btn btn-outline" style="margin-bottom:12px" onclick="openCreateRentalPeriod('${card.id}')"><i data-lucide="calendar-plus" style="width:14px;height:14px"></i> Tạo kỳ thuê mới</button>`;
    }

    document.getElementById('kbd-body').innerHTML = `
      ${rentalBtn}
      ${lockedAll ? '<div class="kbd-banner-info"><i data-lucide="lock" style="width:14px;height:14px"></i> Thẻ ở chế độ chỉ-đọc cho vai trò của bạn.</div>' : ''}
      <div class="kbd-section">
        <h4>Thông tin chung</h4>
        <label class="kbd-field"><span>Tiêu đề</span>
          <input type="text" data-card-key="title" value="${escapeHtml(card.title || '')}" ${lockedAll ? 'disabled' : ''}>
        </label>
        <label class="kbd-field"><span>Khách hàng</span>
          <input type="text" data-card-key="customerName" value="${escapeHtml(card.customerName || '')}" ${lockedAll ? 'disabled' : ''}>
        </label>
      </div>
      ${(showGroup('selling') || showGroup('cost') || showGroup('billing') || showGroup('debt')) ? `
      <div class="kbd-section">
        <h4>Tài chính</h4>
        ${ftext('unit_price', 'selling', 'Đơn giá', 'number')}
        ${ftext('quantity', 'selling', 'Số lượng', 'number')}
        ${ftext('subtotal', 'selling', 'Tạm tính', 'number')}
        ${ftext('total_amount', 'selling', 'Tổng tiền', 'number')}
        ${ftext('cost_price', 'cost', 'Giá vốn (tổng)', 'number')}
        ${ftext('margin', 'cost', 'Lợi nhuận biên', 'number')}
        ${ftext('invoice_no', 'billing', 'Số hóa đơn')}
        ${ftext('invoice_date', 'billing', 'Ngày hóa đơn', 'date')}
        ${ftext('debt_amount', 'debt', 'Số tiền còn nợ', 'number')}
        ${ftext('due_date', 'debt', 'Hạn thanh toán', 'date')}
        ${ftext('paid_amount', 'debt', 'Đã thu', 'number')}
        ${showGroup('debt') ? `<label class="kbd-field"><span>Trạng thái thanh toán</span>
          <select data-fin-key="payment_status" ${lockField('debt') ? 'disabled' : ''}>
            ${['unpaid', 'partial', 'paid'].map((v) => `<option value="${v}" ${fin.payment_status === v ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>` : ''}
      </div>
      ` : '<div class="kbd-banner-info"><i data-lucide="lock" style="width:14px;height:14px"></i> Bạn không có quyền xem tài chính của thẻ này.</div>'}
      ${itemsHtml}
      ${logsHtml}
    `;
    if (window.lucide) window.lucide.createIcons();
  } catch (e) {
    document.getElementById('kbd-body').innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

export async function saveKanbanCardEdits() {
  const drawer = document.getElementById('drawer-kanban-card');
  const cardId = drawer?.dataset?.cardId;
  if (!cardId) return;
  const payload = { id: cardId };

  drawer.querySelectorAll('[data-card-key]').forEach((el) => {
    if (el.disabled) return;
    payload[el.dataset.cardKey] = el.value;
  });

  const fin = {};
  drawer.querySelectorAll('[data-fin-key]').forEach((el) => {
    if (el.disabled) return;
    const k = el.dataset.finKey;
    let v = el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    if (el.type === 'date' && !v) v = null;
    fin[snakeToCamelKey(k)] = v;
  });
  if (Object.keys(fin).length > 0) payload.financials = fin;

  try {
    await api('kanban.card.update', payload);
    toast('Đã lưu', 'success');
    loadKanbanBoard({ silent: true });
    openKanbanCard(cardId);
  } catch (e) {
    toast(e.message || 'Không lưu được', 'error');
  }
}

function snakeToCamelKey(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// ============================================================================
// TẠO THẺ MỚI
// ============================================================================

export async function openCreateKanbanCardForm() {
  const me = state.kanban.config?.me;
  if (!me || me.isReadOnly) { toast('Vai trò của bạn không tạo được thẻ', 'error'); return; }

  // Chọn cardType theo phòng của user
  const allowedTypes = [];
  if (me.isAdmin || me.deptCode === 'KD') { allowedTypes.push({ key: 'ban_may', label: 'Bán máy' }, { key: 'thue_may', label: 'Cho thuê máy (hợp đồng)' }); }
  if (me.isAdmin || me.deptCode === 'KT') { allowedTypes.push({ key: 'ban_vat_tu', label: 'Bán vật tư' }); }
  if (allowedTypes.length === 0) { toast('Phòng của bạn không tạo được thẻ ở đây', 'error'); return; }

  let modal = document.getElementById('modal-new-kanban-card');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop" id="modal-new-kanban-card">
        <div class="modal" style="max-width:520px">
          <div class="modal-header">
            <h3>Tạo thẻ Kanban mới</h3>
            <button class="modal-close" onclick="closeModal('modal-new-kanban-card')"><i data-lucide="x" style="width:18px;height:18px"></i></button>
          </div>
          <div class="modal-body">
            <label class="kbd-field"><span>Loại thẻ</span>
              <select id="new-kbn-type"></select>
            </label>
            <label class="kbd-field"><span>Tiêu đề</span>
              <input type="text" id="new-kbn-title" placeholder="Ví dụ: Báo giá máy XYZ cho KH ABC">
            </label>
            <label class="kbd-field"><span>Tên khách hàng</span>
              <input type="text" id="new-kbn-customer" placeholder="(tuỳ chọn)">
            </label>
            <label class="kbd-field"><span>Sản phẩm (ID, tuỳ chọn)</span>
              <input type="text" id="new-kbn-product-id" placeholder="UUID của crm_products">
            </label>
            <label class="kbd-field"><span>Số lượng</span>
              <input type="number" id="new-kbn-qty" value="1">
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="closeModal('modal-new-kanban-card')">Huỷ</button>
            <button class="btn btn-primary" onclick="submitNewKanbanCard()">Tạo thẻ</button>
          </div>
        </div>
      </div>
    `);
    if (window.lucide) window.lucide.createIcons();
  }
  const sel = document.getElementById('new-kbn-type');
  sel.innerHTML = allowedTypes.map((t) => `<option value="${t.key}">${t.label}</option>`).join('');
  document.getElementById('new-kbn-title').value = '';
  document.getElementById('new-kbn-customer').value = '';
  document.getElementById('new-kbn-product-id').value = '';
  document.getElementById('new-kbn-qty').value = '1';
  openModal('modal-new-kanban-card');
}

export async function submitNewKanbanCard() {
  const cardType = document.getElementById('new-kbn-type').value;
  const title = document.getElementById('new-kbn-title').value.trim();
  const customerName = document.getElementById('new-kbn-customer').value.trim();
  const productId = document.getElementById('new-kbn-product-id').value.trim();
  const quantity = parseFloat(document.getElementById('new-kbn-qty').value) || 1;
  if (!title) { toast('Cần tiêu đề', 'error'); return; }

  const payload = { cardType, title };
  if (customerName) payload.customerName = customerName;
  if (productId) {
    payload.items = [{ productId, quantity }];
  }
  try {
    await api('kanban.card.create', payload);
    closeModal('modal-new-kanban-card');
    toast('Đã tạo thẻ', 'success');
    loadKanbanBoard({ silent: true });
  } catch (e) {
    toast(e.message || 'Không tạo được thẻ', 'error');
  }
}

// ============================================================================
// TẠO KỲ THUÊ (từ thẻ thue_may)
// ============================================================================

export async function openCreateRentalPeriod(contractCardId) {
  const label = window.prompt('Nhãn kỳ (vd "Kỳ 2026-06"):', '');
  if (label === null) return;
  const start = window.prompt('Ngày bắt đầu kỳ (yyyy-mm-dd, tuỳ chọn):', '');
  const end = window.prompt('Ngày kết thúc kỳ (yyyy-mm-dd, tuỳ chọn):', '');
  try {
    await api('kanban.rentalPeriod.create', {
      contractCardId,
      periodLabel: label || null,
      periodStart: start || null,
      periodEnd: end || null,
    });
    toast('Đã tạo kỳ thuê', 'success');
    loadKanbanBoard({ silent: true });
  } catch (e) {
    toast(e.message || 'Không tạo được kỳ thuê', 'error');
  }
}

// ============================================================================
// FILTER cardType
// ============================================================================

export function setKanbanCardTypeFilter(value) {
  state.kanban.filterCardType = value || '';
  loadKanbanBoard();
}

// ============================================================================
// CHUÔNG 🔔 — Kanban notifications
// ============================================================================

async function refreshKanbanNotifBadge() {
  const badge = document.getElementById('kanban-notif-badge');
  if (!badge) return;
  try {
    const r = await api('kanban.notifications.list', null, { limit: 1 }, { silent: true });
    const n = r.unreadCount || 0;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (e) { /* ignore */ }
}

function startKanbanNotifPolling() {
  if (state.kanban.notifPollTimer) return;
  state.kanban.notifPollTimer = setInterval(refreshKanbanNotifBadge, 60000); // 60s
}

export async function openKanbanNotifPanel() {
  let panel = document.getElementById('modal-kanban-notif');
  if (!panel) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop" id="modal-kanban-notif">
        <div class="modal" style="max-width:520px">
          <div class="modal-header">
            <h3><i data-lucide="bell" style="width:18px;height:18px"></i> Thông báo Kanban</h3>
            <button class="modal-close" onclick="closeModal('modal-kanban-notif')"><i data-lucide="x" style="width:18px;height:18px"></i></button>
          </div>
          <div class="modal-body">
            <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
              <button class="btn btn-ghost btn-sm" onclick="markAllKanbanNotifRead()">Đánh dấu tất cả đã đọc</button>
            </div>
            <div id="kanban-notif-list"><div class="empty-state"><div class="spinner dark"></div> Đang tải...</div></div>
          </div>
        </div>
      </div>
    `);
    if (window.lucide) window.lucide.createIcons();
  }
  openModal('modal-kanban-notif');
  try {
    const r = await api('kanban.notifications.list', null, { limit: 50 }, { silent: true });
    const items = r.items || [];
    const list = document.getElementById('kanban-notif-list');
    // Chỉ lọc notification liên quan kanban (theo type)
    const kanbanTypes = ['card_assigned', 'card_handoff', 'card_returned', 'debt_overdue'];
    const kanbanItems = items.filter((n) => kanbanTypes.includes(n.type));
    if (kanbanItems.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Không có thông báo Kanban.</p></div>';
    } else {
      list.innerHTML = kanbanItems.map((n) => `
        <div class="kbd-notif-item ${n.isRead ? 'read' : 'unread'}" data-id="${n.id}" onclick="onKanbanNotifClick('${n.id}','${n.cardId || n.entityId || ''}')">
          <div class="kbd-notif-title">${escapeHtml(n.title)}</div>
          <div class="kbd-notif-body">${escapeHtml(n.message || '')}</div>
          <div class="kbd-notif-meta">${timeAgo(n.createdAt)} · ${escapeHtml(n.type)}</div>
        </div>
      `).join('');
    }
    refreshKanbanNotifBadge();
  } catch (e) {
    document.getElementById('kanban-notif-list').innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

export async function onKanbanNotifClick(notifId, cardId) {
  try {
    await api('kanban.notifications.read', { ids: [notifId] }, null, { silent: true });
  } catch (e) { /* ignore */ }
  closeModal('modal-kanban-notif');
  if (cardId) openKanbanCard(cardId);
  refreshKanbanNotifBadge();
}

export async function markAllKanbanNotifRead() {
  try {
    await api('kanban.notifications.read', { all: true }, null, { silent: true });
    toast('Đã đánh dấu tất cả', 'success');
    openKanbanNotifPanel(); // refresh
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ============================================================================
// EXPOSE TO WINDOW
// ============================================================================
window.loadKanbanBoard = loadKanbanBoard;
window.renderKanbanBoard = renderKanbanBoard;
window.kanbanDragStart = kanbanDragStart;
window.kanbanDragEnd = kanbanDragEnd;
window.kanbanDragOver = kanbanDragOver;
window.kanbanDragLeave = kanbanDragLeave;
window.kanbanDrop = kanbanDrop;
window.openKanbanCard = openKanbanCard;
window.saveKanbanCardEdits = saveKanbanCardEdits;
window.openCreateKanbanCardForm = openCreateKanbanCardForm;
window.submitNewKanbanCard = submitNewKanbanCard;
window.openCreateRentalPeriod = openCreateRentalPeriod;
window.setKanbanCardTypeFilter = setKanbanCardTypeFilter;
window.openKanbanNotifPanel = openKanbanNotifPanel;
window.onKanbanNotifClick = onKanbanNotifClick;
window.markAllKanbanNotifRead = markAllKanbanNotifRead;

// Backward-compat (main.js gọi loadWorkflows() khi switch tab "workflow")
window.loadWorkflows = loadKanbanBoard;
