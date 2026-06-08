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
  timeAgo
} from '../utils.js';

// =============================================================
// TAB 6: TICKETS (Hỗ trợ kỹ thuật)
// =============================================================
export async function loadTickets(page) {
  if (page) state.tickets.page = page;
  const st = state.tickets;
  const tbody = document.getElementById('tickets-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.status) params.status = st.filters.status;
    if (st.filters.priority) params.priority = st.filters.priority;
    if (st.filters.category) params.category = st.filters.category;
    const r = await api('ticket.list', null, params);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    // Load song song KH + Users để có tên hiển thị
    await Promise.all([ensureAllCustomers(), ensureAllUsers()]);
    renderTickets();
  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function ticketStatusBadge(s) {
  const m = { 'Mới':'info', 'Đang xử lý':'warning', 'Chờ KH phản hồi':'warning', 'Đã giải quyết':'success', 'Đã đóng':'muted' };
  return `<span class="badge-pill ${m[s]||'muted'}">${escapeHtml(s||'-')}</span>`;
}
export function renderTickets() {
  const st = state.tickets;
  document.getElementById('tickets-count').textContent = `Tổng ${formatNumber(st.total)} ticket`;
  const tbody = document.getElementById('tickets-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><p>Chưa có ticket nào</p></td></tr>';
    return;
  }
  const custMap = {}; state.allCustomers.forEach(c => { custMap[c.id] = c; });
  const userMap = {}; (state.allUsers || []).forEach(u => { userMap[u.id] = u; });
  
  tbody.innerHTML = st.items.map(t => {
    const assignee = t.assignedTo ? userMap[t.assignedTo] : null;
    const assigneeLabel = assignee ? (assignee.fullName || assignee.username) : 
                          (t.assignedTo ? '<span class="text-muted">(Không rõ)</span>' : 
                                          '<span class="text-muted" style="font-style:italic">Chưa giao</span>');
    return `
      <tr onclick="openTicketForm('${t.id}')">
        <td><span class="code">${escapeHtml(t.code||'')}</span></td>
        <td><strong>${escapeHtml(t.subject||'')}</strong></td>
        <td>${custMap[t.customerId] ? escapeHtml(custMap[t.customerId].name) : '-'}</td>
        <td>${escapeHtml(t.category||'-')}</td>
        <td>${priorityBadge(t.priority)}</td>
        <td>${ticketStatusBadge(t.status)}</td>
        <td>${assigneeLabel}</td>
        <td>${formatDateTimeVN(t.openedAt)}</td>
        <td class="col-actions" onclick="event.stopPropagation()">
          <div class="row-actions">
            <button class="row-action-btn" onclick="openTicketForm('${t.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
            <button class="row-action-btn danger" onclick="deleteTicket('${t.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
  renderPagination('tickets-pagination', st, 'loadTickets');
}
export async function openTicketForm(id) {
  await ensureAllCustomers();
  await ensureProducts();
  await populateCustomerDropdown('ticket-customer-select', false);
  const prodSel = document.getElementById('ticket-product-select');
  prodSel.innerHTML = '<option value="">-- Không chọn --</option>' +
    state.products.map(p => `<option value="${p.id}">${escapeHtml(p.code)} - ${escapeHtml(p.name)}</option>`).join('');
  
  // Phase 4C: populate dropdown KTV
  await populateAssignedToDropdown('ticket-assigned-select', { 
    emptyLabel: 'Chưa giao (KTV nào trong phòng cũng nhận được)' 
  });
  
  const form = document.getElementById('form-ticket');
  form.reset();
  state.currentEditing = null;
  if (id) {
    const t = state.tickets.items.find(x => x.id === id);
    if (t) {
      state.currentEditing = t;
      Object.keys(t).forEach(k => {
        const inp = form.elements[k];
        if (inp && inp.type !== 'submit') setCustomInputValue(inp, t[k]);
      });
      document.getElementById('drawer-ticket-title').textContent = 'Sửa ticket - ' + t.code;

      // Hiển thị người tạo
      const creatorField = document.getElementById('ticket-creator-field');
      const creatorNameInp = document.getElementById('ticket-creator-name');
      if (creatorField && creatorNameInp) {
        if (t.creator) {
          creatorField.style.display = '';
          creatorNameInp.value = t.creator.fullName || '-';
        } else {
          creatorField.style.display = 'none';
        }
      }
    }
  } else {
    document.getElementById('drawer-ticket-title').textContent = 'Tạo ticket hỗ trợ';
    const creatorField = document.getElementById('ticket-creator-field');
    if (creatorField) creatorField.style.display = 'none';
  }
  openDrawer('drawer-ticket');
}
document.getElementById('form-ticket').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  if (data.satisfactionRating) data.satisfactionRating = Number(data.satisfactionRating);
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('ticket.update', data);
      toast('Đã cập nhật ticket', 'success');
    } else {
      await api('ticket.create', data);
      toast('Đã tạo ticket', 'success');
    }
    closeAllDrawers();
    loadTickets();
  } catch (err) { toast(err.message, 'error'); }
});
export async function deleteTicket(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá ticket này?', type: 'danger' }))) return;
  try { await api('ticket.delete', { id }); toast('Đã xoá', 'success'); loadTickets(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('tickets-search').addEventListener('input', debounce(e => {
  state.tickets.search = e.target.value; loadTickets(1);
}, 400));
document.getElementById('tickets-filter-status').addEventListener('change', e => { state.tickets.filters.status = e.target.value; loadTickets(1); });
document.getElementById('tickets-filter-priority').addEventListener('change', e => { state.tickets.filters.priority = e.target.value; loadTickets(1); });
document.getElementById('tickets-filter-category').addEventListener('change', e => { state.tickets.filters.category = e.target.value; loadTickets(1); });


// Expose to window for HTML inline event handlers
window.loadTickets = loadTickets;
window.ticketStatusBadge = ticketStatusBadge;
window.renderTickets = renderTickets;
window.openTicketForm = openTicketForm;
window.deleteTicket = deleteTicket;
