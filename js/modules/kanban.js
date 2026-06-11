/**
 * Kanban v3 — frontend module. MÔ HÌNH HAI LUỒNG.
 * Tham chiếu: plans/kanban_rebuild_spec.md v3 (§1A, §8).
 *
 * NGUYÊN TẮC:
 *   - FE KHÔNG suy luận quyền. Server quyết cột/thẻ/field. FE chỉ vẽ thứ server trả.
 *   - Board mỗi vai chỉ hiện track của họ (server đã lọc cột theo track + phòng).
 *   - Bỏ nút "Tạo thẻ mới" — thẻ sinh từ đơn hàng. Giữ "Tạo kỳ thuê" trên thẻ kỹ thuật thuê.
 *   - COM_DONE không kéo tay (server auto khi số dư=0); có nút "Đóng tay/Xóa nợ" cho admin+KTHC-TP.
 *   - Sổ thanh toán: ghi khoản (KD→pending, KTHC→confirmed); KTHC xác nhận khoản pending.
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
  data: null,
  filterTrack: '',     // '' | 'commercial' | 'technical'
  notifPollTimer: null,
  config: null,
};

let _draggedCardId = null;
let _draggedFromStage = null;

// ============================================================================
// LOAD BOARD
// ============================================================================

export async function loadKanbanBoard(opts = {}) {
  const board = document.getElementById('kanban-board');
  if (board && !opts.silent) {
    board.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="spinner dark"></div> Đang tải Kanban...</div>';
  }
  try {
    if (!state.kanban.config) {
      state.kanban.config = await api('kanban.config.get', null, null, { silent: true });
    }
    const r = await api('kanban.board.get', null, { track: state.kanban.filterTrack || undefined }, opts);
    state.kanban.data = r;
    renderKanbanBoard();
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
  return dept === 'KD' ? 'kd' : dept === 'KT' ? 'kt' : dept === 'KTHC' ? 'kthc' : dept === 'ORIGIN' ? 'kd' : 'done';
}

const CARD_TYPE_LABEL = {
  ban_may: 'Bán máy',
  thue_may: 'Cho thuê máy',
  thue_may_ky: 'Kỳ thuê',
  ban_vat_tu: 'Bán vật tư',
};

export function renderKanbanBoard() {
  const data = state.kanban.data;
  const board = document.getElementById('kanban-board');
  if (!board || !data) return;

  const cols = data.columns || [];
  if (cols.length === 0) {
    board.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:40px"><p><strong>Không có cột nào trong tầm nhìn của bạn</strong></p></div>`;
    return;
  }

  // Nhóm cột theo track để hiện 2 khu vực (commercial + technical) nếu vai thấy cả hai.
  const byTrack = { commercial: [], technical: [] };
  cols.forEach((c) => {
    const tr = c.stage.track || 'commercial';
    (byTrack[tr] || (byTrack[tr] = [])).push(c);
  });

  let total = 0;
  cols.forEach((c) => { total += (c.cards || []).length; });

  let html = '';
  const trackTitle = { commercial: 'Luồng thương mại (dòng tiền)', technical: 'Luồng kỹ thuật (lắp / giao máy)' };
  for (const tr of ['commercial', 'technical']) {
    const group = byTrack[tr];
    if (!group || group.length === 0) continue;
    html += `<div class="kanban-track-section">
      <div class="kanban-track-title">${trackTitle[tr]}</div>
      <div class="kanban-track-grid">${group.map(renderColumn).join('')}</div>
    </div>`;
  }
  board.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();

  const counter = document.getElementById('kanban-total-count');
  if (counter) counter.textContent = total;
}

function renderColumn(col) {
  const stage = col.stage;
  const cards = col.cards || [];
  const deptCls = deptCssClass(stage.ownerDept);
  const roCls = col.readOnly ? 'kanban-column--readonly' : '';
  return `
    <div class="kanban-column ${roCls}">
      <div class="kanban-column-header">
        <div class="kanban-column-title">
          <span class="dept-tag ${deptCls}">${escapeHtml(stage.ownerDept === 'ORIGIN' ? '' : (stage.ownerDept || ''))}</span>
          ${escapeHtml(stage.name)}
        </div>
        <div class="kanban-column-count">${cards.length}</div>
      </div>
      <div class="kanban-column-body"
           data-stage-id="${escapeHtml(stage.id)}"
           data-readonly="${col.readOnly ? '1' : '0'}"
           ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event)">
        ${cards.length === 0
          ? '<div class="kanban-empty">Không có thẻ</div>'
          : cards.map((card) => renderCard(card, col.readOnly)).join('')}
      </div>
    </div>`;
}

function renderCard(card, columnReadOnly) {
  const fin = card.financials || null;
  const isTech = card.track === 'technical';
  const typeLabel = CARD_TYPE_LABEL[card.cardType] || card.cardType;

  const draggable = !columnReadOnly && card.status === 'active';
  const dragAttrs = draggable
    ? `draggable="true" ondragstart="kanbanDragStart(event,'${card.id}','${card.currentStage}')" ondragend="kanbanDragEnd(event)"`
    : '';

  const totalAmount = fin && (fin.total_amount ?? fin.totalAmount);
  const paymentStatus = fin && (fin.payment_status ?? fin.paymentStatus);
  const dueDate = fin && (fin.due_date ?? fin.dueDate);

  return `
    <div class="kanban-card kanban-card--${card.cardType} ${isTech ? 'kanban-card--tech' : ''} ${columnReadOnly ? 'kanban-card--readonly' : ''}"
         data-card-id="${card.id}" ${dragAttrs} onclick="openKanbanCard('${card.id}')">
      <div class="kanban-card-header">
        <span class="kanban-card-type">${escapeHtml(typeLabel)}${isTech ? ' · KT' : ''}</span>
        ${card.assignedTo ? '<span class="kanban-card-assignee" title="Đã giao"><i data-lucide="user" style="width:11px;height:11px"></i></span>' : ''}
      </div>
      <div class="kanban-card-title">${escapeHtml(card.title || '(không tiêu đề)')}</div>
      ${card.customerName ? `<div class="kanban-card-customer">${escapeHtml(card.customerName)}</div>` : ''}
      ${isTech && card.customerAddress ? `<div class="kanban-card-addr"><i data-lucide="map-pin" style="width:11px;height:11px"></i> ${escapeHtml(card.customerAddress)}</div>` : ''}
      ${card.periodLabel ? `<div class="kanban-card-period"><i data-lucide="calendar" style="width:11px;height:11px"></i> ${escapeHtml(card.periodLabel)}</div>` : ''}
      ${!isTech && totalAmount != null ? `<div class="kanban-card-amount">${formatVND(totalAmount)}</div>` : ''}
      ${!isTech && paymentStatus ? `<div class="kanban-card-paystatus paystatus--${paymentStatus}">${escapeHtml(paymentStatus)}</div>` : ''}
      ${!isTech && dueDate ? `<div class="kanban-card-meta"><i data-lucide="clock" style="width:11px;height:11px"></i> ${formatDateVN(dueDate)}</div>` : ''}
    </div>`;
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
  _draggedCardId = null; _draggedFromStage = null;
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
    body.classList.add('drag-forbidden'); body.classList.remove('drag-over');
    event.dataTransfer.dropEffect = 'none'; return;
  }
  body.classList.add('drag-over'); body.classList.remove('drag-forbidden');
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
  const cardId = _draggedCardId, fromStage = _draggedFromStage;
  _draggedCardId = null; _draggedFromStage = null;

  if (readonly) { toast('Cột này chỉ-đọc với vai của bạn.', 'error'); return; }
  if (targetStage === fromStage) return;

  const cardEl = document.querySelector(`.kanban-card[data-card-id="${cardId}"]`);
  if (cardEl) body.appendChild(cardEl);

  try {
    await api('kanban.move', { cardId, toStage: targetStage });
    toast('Đã chuyển stage', 'success');
    loadKanbanBoard({ silent: true });
  } catch (e) {
    toast(e.message || 'Không chuyển được', 'error');
    loadKanbanBoard({ silent: true });
  }
}

// ============================================================================
// CARD DRAWER
// ============================================================================

export async function openKanbanCard(cardId) {
  let drawer = document.getElementById('drawer-kanban-card');
  if (!drawer) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="drawer" id="drawer-kanban-card">
        <div class="drawer-header">
          <div><h3 id="kbd-title">Chi tiết thẻ</h3><div class="drawer-sub" id="kbd-sub"></div></div>
          <button class="modal-close" onclick="closeAllDrawers && closeAllDrawers()"><i data-lucide="x" style="width:18px;height:18px"></i></button>
        </div>
        <div class="drawer-body" id="kbd-body"><div class="empty-state"><div class="spinner dark"></div> Đang tải...</div></div>
        <div class="drawer-footer">
          <button type="button" class="btn btn-ghost" onclick="closeAllDrawers && closeAllDrawers()">Đóng</button>
          <button type="button" class="btn btn-primary" id="kbd-save-btn" onclick="saveKanbanCardEdits()">Lưu thay đổi</button>
        </div>
      </div>`);
    if (window.lucide) window.lucide.createIcons();
  }
  window.openDrawer && window.openDrawer('drawer-kanban-card');
  document.getElementById('kbd-body').innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>';

  try {
    const r = await api('kanban.card.get', null, { id: cardId });
    const card = r.card;
    const payments = r.payments || [];
    const me = state.kanban.config?.me || {};
    const cfg = state.kanban.config;
    const stageRow = (cfg?.stages || []).find((s) => s.id === card.currentStage);
    const isTech = card.track === 'technical';

    document.getElementById('kbd-title').textContent = card.title || '(không tiêu đề)';
    document.getElementById('kbd-sub').textContent =
      `${CARD_TYPE_LABEL[card.cardType] || card.cardType} · ${stageRow ? stageRow.name : card.currentStage}` +
      (card.customerName ? ` · ${card.customerName}` : '');
    drawer = document.getElementById('drawer-kanban-card');
    drawer.dataset.cardId = card.id;
    drawer.dataset.track = card.track;

    const modes = (card.financials && card.financials._modes) || {};
    const colReadOnly = state.kanban.data?.columns?.find((c) => c.stage.id === card.currentStage)?.readOnly;
    const lockedAll = !!colReadOnly || me.isReadOnly;
    document.getElementById('kbd-save-btn').style.display = (lockedAll || isTech) ? 'none' : '';

    const fin = card.financials || {};
    const showGroup = (g) => modes[g] === 'write' || modes[g] === 'read';
    const lockField = (g) => modes[g] !== 'write' || lockedAll;
    const ftext = (key, group, label, type = 'text') => {
      if (!showGroup(group)) return '';
      const v = fin[key] != null ? fin[key] : '';
      return `<label class="kbd-field"><span>${label}</span><input type="${type}" data-fin-key="${key}" value="${escapeHtml(String(v))}" ${lockField(group) ? 'disabled' : ''}></label>`;
    };

    // Items
    const itemsHtml = (card.items && card.items.length > 0) ? `
      <div class="kbd-section">
        <h4>${isTech ? 'Máy / Thiết bị' : 'Sản phẩm'} (${card.items.length})</h4>
        <table class="kbd-items"><thead><tr><th>Mã/Tên</th><th>SL</th><th>ĐVT</th>
          ${!isTech && showGroup('selling') ? '<th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th>' : ''}
          ${!isTech && showGroup('cost') ? '<th class="text-right">Giá vốn</th>' : ''}
        </tr></thead><tbody>
          ${card.items.map((it) => `<tr>
            <td>${escapeHtml(it.productCode || '')} ${escapeHtml(it.productName || '')}</td>
            <td class="text-right">${escapeHtml(String(it.quantity ?? ''))}</td>
            <td>${escapeHtml(it.unit || '')}</td>
            ${!isTech && showGroup('selling') ? `<td class="text-right">${it.unitPrice != null ? formatVND(it.unitPrice) : '-'}</td><td class="text-right">${it.lineSubtotal != null ? formatVND(it.lineSubtotal) : '-'}</td>` : ''}
            ${!isTech && showGroup('cost') ? `<td class="text-right">${it.costPrice != null ? formatVND(it.costPrice) : '-'}</td>` : ''}
          </tr>`).join('')}
        </tbody></table>
      </div>` : '';

    // Payments ledger (chỉ thẻ thương mại + vai thấy debt)
    let paymentsHtml = '';
    const canSeePayments = !isTech && (showGroup('debt') || me.isAdmin);
    if (canSeePayments) {
      const balance = fin.debt_amount != null ? fin.debt_amount : (fin.debtAmount != null ? fin.debtAmount : null);
      const canRecord = !me.isReadOnly;        // KD/KT phòng tạo đơn + KTHC + admin (server check lại)
      const canConfirm = me.isAdmin || me.deptCode === 'KTHC';
      paymentsHtml = `
        <div class="kbd-section">
          <h4>Sổ thanh toán${balance != null ? ` · Còn nợ: <strong>${formatVND(balance)}</strong>` : ''}</h4>
          ${canRecord ? `
            <div class="kbd-pay-add">
              <input type="number" id="kbd-pay-amount" placeholder="Số tiền khách trả" min="0">
              <input type="text" id="kbd-pay-note" placeholder="Ghi chú (tuỳ chọn)">
              <button class="btn btn-sm btn-primary" onclick="addKanbanPayment('${card.id}')">Ghi khoản</button>
            </div>
            <div class="kbd-pay-hint">${me.deptCode === 'KTHC' || me.isAdmin ? 'Khoản bạn ghi sẽ được xác nhận ngay.' : 'Khoản bạn ghi ở trạng thái CHỜ KTHC xác nhận.'}</div>
          ` : ''}
          ${payments.length === 0 ? '<div class="kbd-empty-line">Chưa có khoản thanh toán nào.</div>' : `
            <table class="kbd-items"><thead><tr><th>Số tiền</th><th>Phòng</th><th>Trạng thái</th><th>Thời gian</th><th></th></tr></thead><tbody>
              ${payments.map((p) => `<tr>
                <td><strong>${formatVND(p.amount)}</strong></td>
                <td>${escapeHtml(p.recordedDept || '')}</td>
                <td><span class="pay-badge pay-badge--${p.status}">${p.status === 'confirmed' ? 'Đã xác nhận' : 'Chờ xác nhận'}</span></td>
                <td>${timeAgo(p.createdAt)}</td>
                <td>${(p.status === 'pending' && canConfirm) ? `<button class="btn btn-xs btn-outline" onclick="confirmKanbanPayment('${p.id}','${card.id}')">Xác nhận</button>` : ''}</td>
              </tr>`).join('')}
            </tbody></table>`}
        </div>`;
    }

    // Nút "Tạo kỳ thuê" — thẻ KỸ THUẬT thue_may đang TECH_ACTIVE, vai KT/admin
    let rentalBtn = '';
    const allowRental = !me.isReadOnly && (me.isAdmin || me.deptCode === 'KT');
    if (isTech && card.cardType === 'thue_may' && card.currentStage === 'TECH_ACTIVE' && allowRental) {
      rentalBtn = `<button class="btn btn-outline" style="margin-bottom:12px" onclick="openCreateRentalPeriod('${card.id}')"><i data-lucide="calendar-plus" style="width:14px;height:14px"></i> Tạo kỳ thuê mới</button>`;
    }

    // Nút "Đóng tay / Xóa nợ" — admin + KTHC-TP, thẻ thương mại chưa done
    let forceCloseBtn = '';
    const canForce = (me.isAdmin || (me.deptCode === 'KTHC' && me.role === 'truong_phong'));
    if (!isTech && card.status === 'active' && canForce) {
      forceCloseBtn = `<button class="btn btn-outline btn-danger-outline" style="margin-bottom:12px" onclick="forceCloseKanbanCard('${card.id}')"><i data-lucide="alert-octagon" style="width:14px;height:14px"></i> Đóng tay / Xóa nợ</button>`;
    }

    const logsHtml = (r.logs && r.logs.length > 0) ? `
      <div class="kbd-section"><h4>Lịch sử (${r.logs.length})</h4>
        <ul class="kbd-logs">${r.logs.map((l) => `<li><strong>${escapeHtml(l.action)}</strong>${l.fromStage && l.toStage ? ` · ${escapeHtml(l.fromStage)} → ${escapeHtml(l.toStage)}` : ''}<span class="kbd-log-time">${formatDateTimeVN(l.at)}</span></li>`).join('')}</ul>
      </div>` : '';

    document.getElementById('kbd-body').innerHTML = `
      ${rentalBtn}${forceCloseBtn}
      ${lockedAll ? '<div class="kbd-banner-info"><i data-lucide="lock" style="width:14px;height:14px"></i> Thẻ ở chế độ chỉ-đọc với vai của bạn.</div>' : ''}
      ${isTech ? '<div class="kbd-banner-info"><i data-lucide="wrench" style="width:14px;height:14px"></i> Thẻ kỹ thuật — chỉ thông tin lắp/giao máy, không có giá.</div>' : ''}
      <div class="kbd-section"><h4>Thông tin chung</h4>
        <div class="kbd-readrow"><span>Khách hàng</span><div>${escapeHtml(card.customerName || '-')}</div></div>
        <div class="kbd-readrow"><span>Địa chỉ</span><div>${escapeHtml(card.customerAddress || '-')}</div></div>
      </div>
      ${(!isTech && (showGroup('selling') || showGroup('billing') || showGroup('debt') || showGroup('cost'))) ? `
      <div class="kbd-section"><h4>Tài chính</h4>
        ${ftext('total_amount', 'selling', 'Tổng tiền', 'number')}
        ${ftext('cost_price', 'cost', 'Giá vốn (tổng)', 'number')}
        ${ftext('margin', 'cost', 'Lợi nhuận biên', 'number')}
        ${ftext('invoice_no', 'billing', 'Số hóa đơn')}
        ${ftext('invoice_date', 'billing', 'Ngày hóa đơn', 'date')}
        ${ftext('due_date', 'debt', 'Hạn thanh toán', 'date')}
      </div>` : ''}
      ${itemsHtml}
      ${paymentsHtml}
      ${logsHtml}`;
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
  } catch (e) { toast(e.message || 'Không lưu được', 'error'); }
}

function snakeToCamelKey(s) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }

// ============================================================================
// PAYMENTS
// ============================================================================

export async function addKanbanPayment(cardId) {
  const amount = Number(document.getElementById('kbd-pay-amount')?.value);
  const note = document.getElementById('kbd-pay-note')?.value || '';
  if (!(amount > 0)) { toast('Nhập số tiền hợp lệ', 'error'); return; }
  try {
    const r = await api('kanban.payment.add', { cardId, amount, note });
    toast(r.pending ? 'Đã ghi khoản — chờ KTHC xác nhận' : 'Đã ghi nhận thanh toán', 'success');
    openKanbanCard(cardId);
    loadKanbanBoard({ silent: true });
  } catch (e) { toast(e.message || 'Không ghi được', 'error'); }
}

export async function confirmKanbanPayment(paymentId, cardId) {
  if (!(await confirmDialog({ title: 'Xác nhận thanh toán', message: 'Xác nhận khoản này đã thu? Công nợ sẽ được trừ tương ứng.', type: 'info', okText: 'Xác nhận' }))) return;
  try {
    await api('kanban.payment.confirm', { paymentId });
    toast('Đã xác nhận', 'success');
    openKanbanCard(cardId);
    loadKanbanBoard({ silent: true });
  } catch (e) { toast(e.message || 'Không xác nhận được', 'error'); }
}

// ============================================================================
// FORCE CLOSE
// ============================================================================

export async function forceCloseKanbanCard(cardId) {
  const reason = window.prompt('Lý do đóng tay / xóa nợ (bắt buộc):', '');
  if (reason === null) return;
  if (!reason.trim()) { toast('Bắt buộc ghi lý do', 'error'); return; }
  try {
    await api('kanban.card.forceClose', { cardId, reason: reason.trim() });
    toast('Đã đóng thẻ', 'success');
    window.closeAllDrawers && window.closeAllDrawers();
    loadKanbanBoard({ silent: true });
  } catch (e) { toast(e.message || 'Không đóng được', 'error'); }
}

// ============================================================================
// RENTAL PERIOD (từ thẻ kỹ thuật)
// ============================================================================

export async function openCreateRentalPeriod(techCardId) {
  const label = window.prompt('Nhãn kỳ (vd "Kỳ 2026-06"):', '');
  if (label === null) return;
  const amount = window.prompt('Phí thuê kỳ này (VND):', '');
  if (amount === null) return;
  const start = window.prompt('Ngày bắt đầu kỳ (yyyy-mm-dd, tuỳ chọn):', '');
  const end = window.prompt('Ngày kết thúc kỳ (yyyy-mm-dd, tuỳ chọn):', '');
  try {
    await api('kanban.rentalPeriod.create', {
      techCardId, periodLabel: label || null,
      amount: amount ? Number(amount) : null,
      periodStart: start || null, periodEnd: end || null,
    });
    toast('Đã tạo kỳ thuê', 'success');
    loadKanbanBoard({ silent: true });
  } catch (e) { toast(e.message || 'Không tạo được kỳ thuê', 'error'); }
}

// ============================================================================
// FILTER track
// ============================================================================

export function setKanbanTrackFilter(value) {
  state.kanban.filterTrack = value || '';
  loadKanbanBoard();
}

// ============================================================================
// CHUÔNG 🔔
// ============================================================================

async function refreshKanbanNotifBadge() {
  const badge = document.getElementById('kanban-notif-badge');
  if (!badge) return;
  try {
    const r = await api('kanban.notifications.list', null, { limit: 1 }, { silent: true });
    const n = r.unreadCount || 0;
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = 'inline-flex'; }
    else badge.style.display = 'none';
  } catch (e) { /* ignore */ }
}

function startKanbanNotifPolling() {
  if (state.kanban.notifPollTimer) return;
  state.kanban.notifPollTimer = setInterval(refreshKanbanNotifBadge, 60000);
}

export async function openKanbanNotifPanel() {
  let panel = document.getElementById('modal-kanban-notif');
  if (!panel) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop" id="modal-kanban-notif">
        <div class="modal" style="max-width:520px">
          <div class="modal-header"><h3><i data-lucide="bell" style="width:18px;height:18px"></i> Thông báo Kanban</h3>
            <button class="modal-close" onclick="closeModal('modal-kanban-notif')"><i data-lucide="x" style="width:18px;height:18px"></i></button></div>
          <div class="modal-body">
            <div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn btn-ghost btn-sm" onclick="markAllKanbanNotifRead()">Đánh dấu tất cả đã đọc</button></div>
            <div id="kanban-notif-list"><div class="empty-state"><div class="spinner dark"></div> Đang tải...</div></div>
          </div>
        </div>
      </div>`);
    if (window.lucide) window.lucide.createIcons();
  }
  openModal('modal-kanban-notif');
  try {
    const r = await api('kanban.notifications.list', null, { limit: 50 }, { silent: true });
    const items = (r.items || []).filter((n) => ['card_assigned', 'card_handoff', 'card_returned', 'debt_overdue'].includes(n.type));
    const list = document.getElementById('kanban-notif-list');
    list.innerHTML = items.length === 0
      ? '<div class="empty-state"><p>Không có thông báo Kanban.</p></div>'
      : items.map((n) => `<div class="kbd-notif-item ${n.isRead ? 'read' : 'unread'}" onclick="onKanbanNotifClick('${n.id}','${n.cardId || n.entityId || ''}')">
          <div class="kbd-notif-title">${escapeHtml(n.title)}</div>
          <div class="kbd-notif-body">${escapeHtml(n.message || '')}</div>
          <div class="kbd-notif-meta">${timeAgo(n.createdAt)} · ${escapeHtml(n.type)}</div></div>`).join('');
    refreshKanbanNotifBadge();
  } catch (e) {
    document.getElementById('kanban-notif-list').innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

export async function onKanbanNotifClick(notifId, cardId) {
  try { await api('kanban.notifications.read', { ids: [notifId] }, null, { silent: true }); } catch (e) { /* ignore */ }
  closeModal('modal-kanban-notif');
  if (cardId) openKanbanCard(cardId);
  refreshKanbanNotifBadge();
}

export async function markAllKanbanNotifRead() {
  try { await api('kanban.notifications.read', { all: true }, null, { silent: true }); toast('Đã đánh dấu tất cả', 'success'); openKanbanNotifPanel(); }
  catch (e) { toast(e.message, 'error'); }
}

// ============================================================================
// EXPOSE
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
window.addKanbanPayment = addKanbanPayment;
window.confirmKanbanPayment = confirmKanbanPayment;
window.forceCloseKanbanCard = forceCloseKanbanCard;
window.openCreateRentalPeriod = openCreateRentalPeriod;
window.setKanbanTrackFilter = setKanbanTrackFilter;
window.openKanbanNotifPanel = openKanbanNotifPanel;
window.onKanbanNotifClick = onKanbanNotifClick;
window.markAllKanbanNotifRead = markAllKanbanNotifRead;

// Backward-compat: main.js gọi loadWorkflows() khi switch tab "workflow" (tên tab giữ nguyên)
window.loadWorkflows = loadKanbanBoard;
