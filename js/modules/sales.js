import { state } from '../state.js';
import { api } from '../api.js';
import {
  toast,
  confirmDialog,
  alertDialog,
  promptDialog,
  showLoading,
  hideLoading,
  openModal,
  closeModal,
  formatDateVN,
  formatDateTimeVN,
  formatThousands,
  formatVND,
  formatNumber,
  formatPhone,
  stripPhone,
  parseMoney,
  parseDateVN,
  parseDateTimeVN,
  initDateInputs,
  setCustomInputValue,
  getCustomInputValue,
  extractFormData,
  timeAgo,
  syncColumnVisibility
} from '../utils.js';

export const OPPS_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'title', label: 'Tên cơ hội', required: true },
  { key: 'customer', label: 'Khách hàng' },
  { key: 'stage', label: 'Giai đoạn' },
  { key: 'value', label: 'Giá trị' },
  { key: 'probability', label: '% TT' },
  { key: 'closeDate', label: 'Đóng dự kiến' },
  { key: 'actions', label: 'Hành động', required: true }
];

export const QUOTES_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'customer', label: 'Khách hàng' },
  { key: 'date', label: 'Ngày báo giá' },
  { key: 'validDate', label: 'Hiệu lực đến' },
  { key: 'value', label: 'Tổng tiền' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'actions', label: 'Hành động', required: true }
];

export const ORDERS_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'customer', label: 'Khách hàng' },
  { key: 'date', label: 'Ngày đặt' },
  { key: 'total', label: 'Tổng tiền' },
  { key: 'debt', label: 'Công nợ' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'payment', label: 'Thanh toán' },
  { key: 'actions', label: 'Hành động', required: true }
];

// =============================================================
// TAB 5: SALES - sub-tabs (Opportunities / Quotes / Orders)
// =============================================================
// CHỈ áp dụng cho sub-tabs trong panel Sales, KHÔNG áp dụng settings-tab hay admin-subtab
document.querySelectorAll('[data-panel="sales"] .sub-tab').forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.subtab;
    // Scope: chỉ toggle sub-tab và sub-panel trong Sales panel
    document.querySelectorAll('[data-panel="sales"] .sub-tab').forEach(x => x.classList.toggle('active', x.dataset.subtab === target));
    document.querySelectorAll('[data-panel="sales"] .sub-panel').forEach(p => p.classList.toggle('active', p.dataset.subpanel === target));
    if (target === 'opportunities') loadOpps();
    else if (target === 'quotes') loadQuotes();
    else if (target === 'orders') loadOrders();
  });
});

// ====== OPPORTUNITIES ======
export async function loadOpps(page, options = {}) {
  if (page) state.opps.page = page;
  const st = state.opps;
  const tbody = document.getElementById('opps-tbody');
  if (!options.silent) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  }
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.stage) params.stage = st.filters.stage;
    const r = await api('opportunity.list', null, params, options);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    await ensureAllCustomers();
    renderOpps();
  } catch (e) {
    if (!options.silent) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    }
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function renderOpps() {
  const st = state.opps;
  const tbody = document.getElementById('opps-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><p>Chưa có cơ hội nào</p></td></tr>';
    return;
  }
  const custMap = {}; state.allCustomers.forEach(c => { custMap[c.id] = c; });
  tbody.innerHTML = st.items.map(o => `
    <tr onclick="openOpportunityForm('${o.id}')">
      <td data-col="code"><span class="code">${escapeHtml(o.code||'')}</span></td>
      <td data-col="title"><strong>${escapeHtml(o.name||'')}</strong></td>
      <td data-col="customer">${custMap[o.customerId] ? escapeHtml(custMap[o.customerId].name) : '-'}</td>
      <td data-col="stage">${stageBadge(o.stage)}</td>
      <td data-col="value" class="text-right">${formatShortMoney(o.estimatedValue||0)}</td>
      <td data-col="probability" class="text-right">${o.probability||0}%</td>
      <td data-col="closeDate">${formatDateVN(o.expectedCloseDate)}</td>
      <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          <button class="row-action-btn" onclick="openOpportunityForm('${o.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteOpp('${o.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
  syncColumnVisibility('opps', 'opps-table-wrap', OPPS_COLUMNS);
  renderPagination('opps-pagination', st, 'loadOpps');
}
export async function openOpportunityForm(id) {

  try {
    await populateCustomerDropdown('opp-customer-select', false);
    const form = document.getElementById('form-opportunity');
    form.reset();
    state.currentEditing = null;
    if (id) {
      const o = state.opps.items.find(x => x.id === id);
      if (o) {
        state.currentEditing = o;
        Object.keys(o).forEach(k => {
          const inp = form.elements[k];
          if (inp && inp.type !== 'submit') setCustomInputValue(inp, o[k]);
        });
        document.getElementById('drawer-opp-title').textContent = 'Sửa cơ hội - ' + o.code;
      }
    } else {
      document.getElementById('drawer-opp-title').textContent = 'Tạo cơ hội';
    }
    openDrawer('drawer-opportunity');
  } finally {
    hideLoading();
  }
}
document.getElementById('form-opportunity').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  ['probability','estimatedValue'].forEach(k => { if (data[k] !== '') data[k] = Number(data[k]); });
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('opportunity.update', data);
      toast('Đã cập nhật cơ hội', 'success');
    } else {
      await api('opportunity.create', data);
      toast('Đã tạo cơ hội', 'success');
    }
    closeAllDrawers();
    loadOpps();
  } catch (err) { toast(err.message, 'error'); }
});
export async function deleteOpp(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá cơ hội này?', type: 'danger' }))) return;
  try { await api('opportunity.delete', { id }); toast('Đã xoá', 'success'); loadOpps(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('opps-search').addEventListener('input', debounce(e => {
  state.opps.search = e.target.value; loadOpps(1);
}, 400));
document.getElementById('opps-filter-stage').addEventListener('change', e => {
  state.opps.filters.stage = e.target.value; loadOpps(1);
});

// ====== QUOTES ======
export async function loadQuotes(page, options = {}) {
  if (page) state.quotes.page = page;
  const st = state.quotes;
  const tbody = document.getElementById('quotes-tbody');
  if (!options.silent) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  }
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.status) params.status = st.filters.status;
    const r = await api('quote.list', null, params, options);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    await ensureAllCustomers();
    renderQuotes();
  } catch (e) {
    if (!options.silent) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    }
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function renderQuotes() {
  const st = state.quotes;
  const tbody = document.getElementById('quotes-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state"><p>Chưa có báo giá nào</p></td></tr>';
    return;
  }
  const custMap = {}; state.allCustomers.forEach(c => { custMap[c.id] = c; });
  tbody.innerHTML = st.items.map(q => `
    <tr onclick="openQuoteForm('${q.id}')">
      <td data-col="code"><span class="code">${escapeHtml(q.code||'')}</span></td>
      <td data-col="customer">${custMap[q.customerId] ? escapeHtml(custMap[q.customerId].name) : '-'}</td>
      <td data-col="date">${formatDateVN(q.issueDate)}</td>
      <td data-col="validDate">${formatDateVN(q.validUntil)}</td>
      <td data-col="value" class="text-right"><strong>${formatVND(q.totalAmount||0)}</strong></td>
      <td data-col="status">${quoteStatusBadge(q.status)}</td>
      <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          ${q.status !== 'accepted' ? `<button class="row-action-btn" onclick="convertQuoteToOrder('${q.id}')" title="Chuyển thành đơn"><i data-lucide="arrow-right-circle" style="width:14px;height:14px"></i></button>` : ''}
          <button class="row-action-btn" onclick="openQuoteForm('${q.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteQuote('${q.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
  syncColumnVisibility('quotes', 'quotes-table-wrap', QUOTES_COLUMNS);
  renderPagination('quotes-pagination', st, 'loadQuotes');
}
export async function openQuoteForm(id) {
  await openSalesDocForm('quote', id);
}
export async function deleteQuote(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá báo giá này?', type: 'danger' }))) return;
  try { await api('quote.delete', { id }); toast('Đã xoá', 'success'); loadQuotes(); }
  catch (e) { toast(e.message, 'error'); }
}
export async function convertQuoteToOrder(id) {
  if (!(await confirmDialog({ title: 'Xác nhận', message: 'Chuyển báo giá này thành đơn hàng?', type: 'warning' }))) return;
  try {
    await api('quote.convertToOrder', { id });
    toast('Đã chuyển thành đơn hàng', 'success');
    loadQuotes();
  } catch (e) { toast(e.message, 'error'); }
}
document.getElementById('quotes-search').addEventListener('input', debounce(e => {
  state.quotes.search = e.target.value; loadQuotes(1);
}, 400));
document.getElementById('quotes-filter-status').addEventListener('change', e => {
  state.quotes.filters.status = e.target.value; loadQuotes(1);
});

// ====== ORDERS ======
export async function loadOrders(page, options = {}) {
  if (page) state.orders.page = page;
  const st = state.orders;
  const tbody = document.getElementById('orders-tbody');
  if (!options.silent) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  }
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.status) params.status = st.filters.status;
    if (st.filters.paymentStatus) params.paymentStatus = st.filters.paymentStatus;
    const r = await api('order.list', null, params, options);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    await ensureAllCustomers();
    renderOrders();
  } catch (e) {
    if (!options.silent) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    }
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function renderOrders() {
  const st = state.orders;
  const tbody = document.getElementById('orders-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><p>Chưa có đơn hàng nào</p></td></tr>';
    return;
  }
  const custMap = {}; state.allCustomers.forEach(c => { custMap[c.id] = c; });
  tbody.innerHTML = st.items.map(o => {
    // Quick action buttons - hiện thị dựa vào trạng thái hiện tại
    let statusQuick = '';
    if (o.status === 'Chờ xác nhận') {
      statusQuick = `<button class="quick-status-btn success" onclick="event.stopPropagation();quickOrderStatus('${o.id}','Đã xác nhận')" title="Xác nhận đơn">✓ Xác nhận</button>`;
    } else if (o.status === 'Đã xác nhận') {
      statusQuick = `<button class="quick-status-btn" onclick="event.stopPropagation();quickOrderStatus('${o.id}','Đang giao')" title="Đánh dấu đang giao">→ Đang giao</button>`;
    } else if (o.status === 'Đang giao') {
      statusQuick = `<button class="quick-status-btn success" onclick="event.stopPropagation();quickOrderStatus('${o.id}','Đã giao')" title="Đánh dấu đã giao">✓ Đã giao</button>`;
    }

    let paymentQuick = '';
    if (o.paymentStatus !== 'Đã thanh toán' && o.remainingAmount > 0) {
      paymentQuick = `<button class="quick-status-btn warning" onclick="event.stopPropagation();quickOrderPayment('${o.id}',${o.totalAmount||0},${o.paidAmount||0})" title="Ghi nhận thanh toán">💰 Thanh toán</button>`;
    }

    return `
      <tr onclick="openOrderForm('${o.id}')">
        <td data-col="code"><span class="code">${escapeHtml(o.code||'')}</span></td>
        <td data-col="customer">${custMap[o.customerId] ? escapeHtml(custMap[o.customerId].name) : '-'}</td>
        <td data-col="date">${formatDateVN(o.orderDate)}</td>
        <td data-col="total" class="text-right"><strong>${formatVND(o.totalAmount||0)}</strong></td>
        <td data-col="debt" class="text-right" style="color:${o.remainingAmount>0?'var(--danger)':'var(--ink-3)'}">${formatShortMoney(o.remainingAmount||0)}</td>
        <td data-col="status">${orderStatusBadge(o.status)}<div style="margin-top:4px">${statusQuick}</div></td>
        <td data-col="payment">${paymentBadge(o.paymentStatus)}<div style="margin-top:4px">${paymentQuick}</div></td>
        <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
          <div class="row-actions">
            <button class="row-action-btn" onclick="openOrderForm('${o.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
            <button class="row-action-btn danger" onclick="deleteOrder('${o.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
  syncColumnVisibility('orders', 'orders-table-wrap', ORDERS_COLUMNS);
  renderPagination('orders-pagination', st, 'loadOrders');
}

// Phase 4A - Quick actions đơn hàng
export async function quickOrderStatus(id, newStatus) {
  if (!(await confirmDialog({ title: 'Xác nhận', message: `Đổi trạng thái sang "${newStatus}"?`, type: 'warning' }))) return;
  try {
    await api('order.update', { id: id, status: newStatus });
    toast(`Đã cập nhật trạng thái: ${newStatus}`, 'success');
    loadOrders();
  } catch (e) { toast(e.message, 'error'); }
}

export async function quickOrderPayment(id, totalAmount, currentPaid) {
  const remaining = (totalAmount || 0) - (currentPaid || 0);
  const input = await promptDialog({
    title: 'Ghi nhận thanh toán',
    message: `Tổng đơn: <strong>${formatVND(totalAmount)}</strong><br>` +
             `Đã thanh toán: ${formatVND(currentPaid)}<br>` +
             `Còn lại: <strong style="color:var(--danger)">${formatVND(remaining)}</strong><br><br>` +
             `Nhập số tiền thanh toán lần này (VND):`,
    defaultValue: String(remaining),
    placeholder: 'VD: 50000000',
  });
  if (input === null) return;
  const amount = parseMoney(input);
  if (amount <= 0) {
    toast('Số tiền không hợp lệ', 'error');
    return;
  }
  const newPaid = (currentPaid || 0) + amount;
  let newStatus = 'Trả một phần';
  if (newPaid >= totalAmount) newStatus = 'Đã thanh toán';
  else if (newPaid <= 0) newStatus = 'Chưa thanh toán';
  
  try {
    await api('order.update', { id: id, paidAmount: newPaid, paymentStatus: newStatus });
    toast(`Đã ghi nhận thanh toán ${formatVND(amount)}`, 'success');
    loadOrders();
  } catch (e) { toast(e.message, 'error'); }
}
export async function openOrderForm(id) {
  await openSalesDocForm('order', id);
}
export async function deleteOrder(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá đơn hàng này?', type: 'danger' }))) return;
  try { await api('order.delete', { id }); toast('Đã xoá', 'success'); loadOrders(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('orders-search').addEventListener('input', debounce(e => {
  state.orders.search = e.target.value; loadOrders(1);
}, 400));
document.getElementById('orders-filter-status').addEventListener('change', e => {
  state.orders.filters.status = e.target.value; loadOrders(1);
});
document.getElementById('orders-filter-payment').addEventListener('change', e => {
  state.orders.filters.paymentStatus = e.target.value; loadOrders(1);
});

// ====== SALES DOC (Quote/Order chia sẻ form với dynamic line items) ======
export async function openSalesDocForm(mode, id) {

  try {
    state.salesDocMode = mode;
    state.currentEditing = null;
    await ensureAllCustomers();
    await ensureProducts();
    await populateCustomerDropdown('sd-customer-select', false);

    const form = document.getElementById('form-sales-doc');
    form.reset();

    // Show/hide fields theo mode
    const isQuote = mode === 'quote';
    document.getElementById('sd-field-issuedate').style.display = isQuote ? '' : 'none';
    document.getElementById('sd-field-validuntil').style.display = isQuote ? '' : 'none';
    document.getElementById('sd-field-deliveryterms').style.display = isQuote ? '' : 'none';
    document.getElementById('sd-field-orderdate').style.display = isQuote ? 'none' : '';
    document.getElementById('sd-field-deliverydate').style.display = isQuote ? 'none' : '';
    document.getElementById('sd-field-shippingaddress').style.display = isQuote ? 'none' : '';
    document.getElementById('sd-field-shippingfee').style.display = isQuote ? 'none' : '';
    document.getElementById('tot-shipping-row').style.display = isQuote ? 'none' : '';
    document.getElementById('sd-submit-btn').textContent = isQuote ? (id ? 'Cập nhật báo giá' : 'Lưu báo giá') : (id ? 'Cập nhật đơn hàng' : 'Lưu đơn hàng');

    // Clear line items
    document.getElementById('line-items-tbody').innerHTML = '';

    if (id) {
      // Edit mode: load chi tiết
      try {
        const action = isQuote ? 'quote.get' : 'order.get';
        const r = await api(action, null, { id });
        const doc = isQuote ? r.quote : r.order;
        state.currentEditing = doc;
        document.getElementById('sd-title').textContent = (isQuote ? 'Sửa báo giá - ' : 'Sửa đơn hàng - ') + doc.code;
        Object.keys(doc).forEach(k => {
          const inp = form.elements[k];
          if (inp && inp.type !== 'submit') setCustomInputValue(inp, doc[k]);
        });
        (r.items || []).forEach(it => addLineItem(it));
      } catch (e) {
        toast(e.message, 'error');
        return;
      }
    } else {
      document.getElementById('sd-title').textContent = isQuote ? 'Soạn báo giá' : 'Tạo đơn hàng';
      if (isQuote) form.elements.issueDate.value = new Date().toISOString().slice(0, 10);
      else form.elements.orderDate.value = new Date().toISOString().slice(0, 10);
      addLineItem();
    }

    recalcTotals();
    openDrawer('drawer-sales-doc');
  } finally {
    hideLoading();
  }
}

export function addLineItem(item) {
  const tbody = document.getElementById('line-items-tbody');
  const tr = document.createElement('tr');
  const prodOptions = state.products.map(p => {
    const label = p.externalCode ? `${escapeHtml(p.externalCode)} - ${escapeHtml(p.name)}` : `${escapeHtml(p.code)} - ${escapeHtml(p.name)}`;
    return `<option value="${p.id}" data-price="${p.listPrice||0}" data-unit="${escapeHtml(p.unit||'')}" data-vat="${p.vatRate||state.defaultVat||10}">${label}</option>`;
  }).join('');
  tr.innerHTML = `
    <td>
      <select class="li-product"><option value="">-- Chọn sản phẩm --</option>${prodOptions}</select>
    </td>
    <td><input type="number" class="li-qty text-right" min="0" step="any" value="${item?item.quantity||1:1}" /></td>
    <td><input type="text" class="li-unit" value="${item?escapeHtml(item.unit||''):''}" /></td>
    <td><input type="text" data-format="money" inputmode="numeric" class="li-price text-right" value="${item?item.unitPrice||0:0}" /></td>
    <td><input type="number" class="li-disc text-right" min="0" max="100" step="any" value="${item?item.discountPercent||0:0}" /></td>
    <td><input type="number" class="li-vat text-right" min="0" max="100" step="any" value="${item?(item.vatRate||state.defaultVat||10):(state.defaultVat||10)}" /></td>
    <td class="text-right li-total numeric" style="padding-right:8px;font-weight:500">0 ₫</td>
    <td><button type="button" class="row-del" onclick="this.closest('tr').remove(); recalcTotals();"><i data-lucide="x" style="width:14px;height:14px"></i></button></td>
  `;
  tbody.appendChild(tr);

  // Init format money cho .li-price
  initDateInputs(tr);
  // Khi đổi sản phẩm
  const prodSel = tr.querySelector('.li-product');
  prodSel.addEventListener('change', () => {
    const opt = prodSel.selectedOptions[0];
    if (opt && opt.value) {
      const priceInp = tr.querySelector('.li-price');
      priceInp.value = formatThousands(parseInt(opt.dataset.price || 0, 10));
      tr.querySelector('.li-unit').value = opt.dataset.unit || '';
      tr.querySelector('.li-vat').value = opt.dataset.vat || state.defaultVat || 10;
      recalcTotals();
    }
  });
  ['.li-qty', '.li-price', '.li-disc', '.li-vat'].forEach(sel => {
    tr.querySelector(sel).addEventListener('input', recalcTotals);
  });

  if (item && item.productId) prodSel.value = item.productId;
  lucide.createIcons();
  recalcTotals();
}

export function recalcTotals() {
  let subtotal = 0, discount = 0, vat = 0;
  document.querySelectorAll('#line-items-tbody tr').forEach(tr => {
    const qty = parseFloat(tr.querySelector('.li-qty').value) || 0;
    // li-price có data-format="money" → dùng parseMoney
    const price = parseMoney(tr.querySelector('.li-price').value);
    const dp = parseFloat(tr.querySelector('.li-disc').value) || 0;
    const vp = parseFloat(tr.querySelector('.li-vat').value) || 0;
    const gross = qty * price;
    const d = gross * dp / 100;
    const afterD = gross - d;
    const v = afterD * vp / 100;
    const lineTotal = afterD + v;
    subtotal += gross;
    discount += d;
    vat += v;
    tr.querySelector('.li-total').textContent = formatVND(lineTotal);
  });
  const shippingInp = document.querySelector('#form-sales-doc [name="shippingFee"]');
  const shipping = shippingInp ? parseMoney(shippingInp.value) : 0;
  const grand = subtotal - discount + vat + (state.salesDocMode === 'order' ? shipping : 0);
  document.getElementById('tot-subtotal').textContent = formatVND(subtotal);
  document.getElementById('tot-discount').textContent = formatVND(discount);
  document.getElementById('tot-vat').textContent = formatVND(vat);
  document.getElementById('tot-shipping').textContent = formatVND(shipping);
  document.getElementById('tot-grand').textContent = formatVND(grand);
}

// shipping fee → recalc
document.addEventListener('input', e => {
  if (e.target && e.target.name === 'shippingFee') recalcTotals();
});

document.getElementById('form-sales-doc').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  // collect items
  const items = [];
  document.querySelectorAll('#line-items-tbody tr').forEach(tr => {
    const productId = tr.querySelector('.li-product').value;
    const qty = parseFloat(tr.querySelector('.li-qty').value) || 0;
    if (qty <= 0) return;
    const opt = tr.querySelector('.li-product').selectedOptions[0];
    items.push({
      productId: productId,
      productName: opt ? opt.text : '',
      quantity: qty,
      unit: tr.querySelector('.li-unit').value,
      unitPrice: parseMoney(tr.querySelector('.li-price').value),
      discountPercent: parseFloat(tr.querySelector('.li-disc').value) || 0,
      vatRate: parseFloat(tr.querySelector('.li-vat').value) || 0,
    });
  });
  if (items.length === 0) { toast('Vui lòng thêm ít nhất 1 dòng hàng', 'warning'); return; }
  data.items = items;
  if (data.shippingFee) data.shippingFee = Number(data.shippingFee);

  const isQuote = state.salesDocMode === 'quote';
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api(isQuote ? 'quote.update' : 'order.update', data);
      toast('Đã cập nhật', 'success');
    } else {
      await api(isQuote ? 'quote.create' : 'order.create', data);
      toast('Đã tạo ' + (isQuote ? 'báo giá' : 'đơn hàng'), 'success');
    }
    closeAllDrawers();
    if (isQuote) loadQuotes(); else loadOrders();
  } catch (err) { toast(err.message, 'error'); }
});


// Expose to window for HTML inline event handlers
window.loadOpps = loadOpps;
window.renderOpps = renderOpps;
window.openOpportunityForm = openOpportunityForm;
window.deleteOpp = deleteOpp;
window.loadQuotes = loadQuotes;
window.renderQuotes = renderQuotes;
window.openQuoteForm = openQuoteForm;
window.deleteQuote = deleteQuote;
window.convertQuoteToOrder = convertQuoteToOrder;
window.loadOrders = loadOrders;
window.renderOrders = renderOrders;
window.quickOrderStatus = quickOrderStatus;
window.quickOrderPayment = quickOrderPayment;
window.openOrderForm = openOrderForm;
window.deleteOrder = deleteOrder;
window.openSalesDocForm = openSalesDocForm;
window.addLineItem = addLineItem;
window.recalcTotals = recalcTotals;
