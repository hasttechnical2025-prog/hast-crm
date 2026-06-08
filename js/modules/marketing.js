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

export const CAMPAIGNS_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'name', label: 'Tên chiến dịch', required: true },
  { key: 'type', label: 'Loại' },
  { key: 'time', label: 'Thời gian' },
  { key: 'sent', label: 'Đã gửi' },
  { key: 'conversion', label: 'Chuyển đổi' },
  { key: 'revenue', label: 'Doanh thu' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'actions', label: 'Hành động', required: true }
];

// =============================================================
// TAB 7: CAMPAIGNS (Marketing)
// =============================================================
export async function loadCampaigns(page) {
  if (page) state.campaigns.page = page;
  const st = state.campaigns;
  const tbody = document.getElementById('campaigns-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.type) params.type = st.filters.type;
    if (st.filters.status) params.status = st.filters.status;
    const r = await api('campaign.list', null, params);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    renderCampaigns();
  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function campaignStatusBadge(s) {
  const m = { 'Lên kế hoạch':'muted', 'Đang chạy':'info', 'Tạm dừng':'warning', 'Hoàn thành':'success', 'Huỷ':'danger' };
  return `<span class="badge-pill ${m[s]||'muted'}">${escapeHtml(s||'-')}</span>`;
}
export function renderCampaigns() {
  const st = state.campaigns;
  document.getElementById('campaigns-count').textContent = `Tổng ${formatNumber(st.total)} chiến dịch`;
  const tbody = document.getElementById('campaigns-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><p>Chưa có chiến dịch nào</p></td></tr>';
    return;
  }
  tbody.innerHTML = st.items.map(c => `
    <tr onclick="openCampaignForm('${c.id}')">
      <td data-col="code"><span class="code">${escapeHtml(c.code||'')}</span></td>
      <td data-col="name"><strong>${escapeHtml(c.name||'')}</strong></td>
      <td data-col="type">${escapeHtml(c.type||'-')}</td>
      <td data-col="time" class="text-sm">${formatDateVN(c.startDate)} → ${formatDateVN(c.endDate)}</td>
      <td data-col="sent" class="text-right">${formatNumber(c.sentCount||0)}</td>
      <td data-col="conversion" class="text-right">${formatNumber(c.convertedCount||0)}</td>
      <td data-col="revenue" class="text-right">${formatShortMoney(c.revenue||0)}</td>
      <td data-col="status">${campaignStatusBadge(c.status)}</td>
      <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          ${c.status !== 'Hoàn thành' && c.status !== 'Huỷ' ? `<button class="row-action-btn" onclick="sendCampaign('${c.id}')" title="Gửi chiến dịch"><i data-lucide="send" style="width:14px;height:14px"></i></button>` : ''}
          <button class="row-action-btn" onclick="openCampaignForm('${c.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteCampaign('${c.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
  syncColumnVisibility('campaigns', 'campaigns-table-wrap', CAMPAIGNS_COLUMNS);
  renderPagination('campaigns-pagination', st, 'loadCampaigns');
}
export async function openCampaignForm(id) {
  await ensureAllCustomers();
  // Populate multi-select khách hàng
  const sel = document.getElementById('campaign-customers-select');
  sel.innerHTML = state.allCustomers.map(c => `<option value="${c.id}">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</option>`).join('');
  sel.onchange = () => {
    document.getElementById('campaign-customers-count').textContent = sel.selectedOptions.length;
  };
  const form = document.getElementById('form-campaign');
  form.reset();
  state.currentEditing = null;
  const sendBtn = document.getElementById('btn-campaign-send');
  sendBtn.style.display = 'none';

  if (id) {
    const c = state.campaigns.items.find(x => x.id === id);
    if (c) {
      state.currentEditing = c;
      Object.keys(c).forEach(k => {
        const inp = form.elements[k];
        if (inp && inp.type !== 'submit' && k !== 'customerIds') setCustomInputValue(inp, c[k]);
      });
      // Set selected customerIds
      const selectedIds = (c.customerIds || '').split(',').filter(Boolean);
      Array.from(sel.options).forEach(opt => { opt.selected = selectedIds.includes(opt.value); });
      document.getElementById('campaign-customers-count').textContent = selectedIds.length;
      document.getElementById('drawer-campaign-title').textContent = 'Sửa chiến dịch - ' + c.code;
      // Show send button nếu campaign chưa hoàn thành
      if (c.status !== 'Hoàn thành' && c.status !== 'Huỷ') {
        sendBtn.style.display = '';
        sendBtn.onclick = () => sendCampaign(c.id);
      }
    }
  } else {
    document.getElementById('drawer-campaign-title').textContent = 'Tạo chiến dịch';
    document.getElementById('campaign-customers-count').textContent = '0';
  }
  openDrawer('drawer-campaign');
}
document.getElementById('form-campaign').addEventListener('submit', async (e) => {
  e.preventDefault();
  // extractFormData tự xử lý multi-select (join bằng comma)
  const data = extractFormData(e.target);
  // budget, actualCost đã được parse từ data-format="money"
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('campaign.update', data);
      toast('Đã cập nhật chiến dịch', 'success');
    } else {
      await api('campaign.create', data);
      toast('Đã tạo chiến dịch', 'success');
    }
    closeAllDrawers();
    loadCampaigns();
  } catch (err) { toast(err.message, 'error'); }
});
export async function sendCampaign(id) {
  if (!(await confirmDialog({ title: 'Xác nhận', message: 'Gửi chiến dịch này tới toàn bộ khách hàng đã chọn? Hành động này sẽ ghi log vào sheet Messages.', type: 'warning' }))) return;
  try {
    const r = await api('campaign.send', { id });
    toast(`Đã gửi tới ${r.sent} khách hàng`, 'success');
    closeAllDrawers();
    loadCampaigns();
  } catch (e) { toast(e.message, 'error'); }
}
export async function deleteCampaign(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá chiến dịch này?', type: 'danger' }))) return;
  try { await api('campaign.delete', { id }); toast('Đã xoá', 'success'); loadCampaigns(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('campaigns-search').addEventListener('input', debounce(e => {
  state.campaigns.search = e.target.value; loadCampaigns(1);
}, 400));
document.getElementById('campaigns-filter-type').addEventListener('change', e => { state.campaigns.filters.type = e.target.value; loadCampaigns(1); });
document.getElementById('campaigns-filter-status').addEventListener('change', e => { state.campaigns.filters.status = e.target.value; loadCampaigns(1); });

// =============================================================
// TAB 8: NOTES (Ghi chú & Đính kèm)
// =============================================================
export async function loadNotes(page) {
  if (page) state.notes.page = page;
  const st = state.notes;
  const grid = document.getElementById('notes-grid');
  grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="spinner dark"></div> Đang tải...</div>';
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.relatedType) params.relatedType = st.filters.relatedType;
    const r = await api('note.list', null, params);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    renderNotes();
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function renderNotes() {
  const st = state.notes;
  document.getElementById('notes-count').textContent = `Tổng ${formatNumber(st.total)} ghi chú`;
  const grid = document.getElementById('notes-grid');
  if (st.items.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i data-lucide="sticky-note"></i><p>Chưa có ghi chú nào</p></div>';
    lucide.createIcons();
    return;
  }
  const typeLabel = { customer:'KH', opportunity:'Cơ hội', order:'Đơn', ticket:'Ticket', contact:'LH' };
  grid.innerHTML = st.items.map(n => {
    const isPinned = (n.isPinned === 'TRUE' || n.isPinned === true);
    return `
      <div class="note-card ${isPinned?'pinned':''}" onclick="openNoteForm('${n.id}')">
        <div class="note-card-header">
          <div class="note-card-title">${escapeHtml(n.title || '(Không tiêu đề)')}</div>
          <button class="note-card-pin" onclick="event.stopPropagation();togglePinNote('${n.id}', ${!isPinned})" title="${isPinned?'Bỏ ghim':'Ghim'}">
            <i data-lucide="${isPinned?'pin':'pin-off'}" style="width:14px;height:14px"></i>
          </button>
        </div>
        <div class="note-card-content">${escapeHtml((n.content||'').slice(0, 200))}${(n.content||'').length>200?'...':''}</div>
        ${n.attachmentUrl ? `
          <a href="${escapeHtml(n.attachmentUrl)}" target="_blank" class="note-card-attachment" onclick="event.stopPropagation()">
            <i data-lucide="paperclip"></i> ${escapeHtml(n.attachmentName || 'File đính kèm')}
          </a>` : ''}
        <div class="note-card-meta">
          <span>${n.relatedType ? `<span class="badge-pill muted">${typeLabel[n.relatedType]||n.relatedType}</span>` : ''}</span>
          <span>${timeAgo(n.createdAt)}</span>
        </div>
        <div class="note-card-actions">
          <button class="row-action-btn" onclick="event.stopPropagation();openNoteForm('${n.id}')"><i data-lucide="edit" style="width:13px;height:13px"></i></button>
          <button class="row-action-btn danger" onclick="event.stopPropagation();deleteNote('${n.id}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
        </div>
      </div>`;
  }).join('');
  lucide.createIcons();
  renderPagination('notes-pagination', st, 'loadNotes');
}
export async function openNoteForm(id) {
  const form = document.getElementById('form-note');
  form.reset();
  state.currentEditing = null;
  // Reset related-id dropdown
  document.getElementById('note-related-id').innerHTML = '<option value="">-</option>';
  if (id) {
    const n = state.notes.items.find(x => x.id === id);
    if (n) {
      state.currentEditing = n;
      Object.keys(n).forEach(k => {
        const inp = form.elements[k];
        if (inp && inp.type !== 'submit' && inp.type !== 'checkbox') setCustomInputValue(inp, n[k]);
      });
      form.elements.isPinned.checked = (n.isPinned === 'TRUE' || n.isPinned === true);
      // Populate related id options
      await populateRelatedIdDropdown('note-related-type', 'note-related-id', n.relatedType, n.relatedId);
      document.getElementById('drawer-note-title').textContent = 'Sửa ghi chú';
    }
  } else {
    document.getElementById('drawer-note-title').textContent = 'Thêm ghi chú';
  }
  openDrawer('drawer-note');
}
export async function populateRelatedIdDropdown(typeSelectId, idSelectId, currentType, currentId) {
  const typeSel = document.getElementById(typeSelectId);
  const idSel = document.getElementById(idSelectId);
  const type = currentType || typeSel.value;
  idSel.innerHTML = '<option value="">-</option>';
  if (!type) return;
  try {
    let action, items;
    if (type === 'customer') {
      await ensureAllCustomers();
      items = state.allCustomers.map(c => ({ id: c.id, label: `${c.code} - ${c.name}` }));
    } else if (type === 'opportunity') {
      const r = await api('opportunity.list', null, { pageSize: 500 });
      items = (r.items || []).map(o => ({ id: o.id, label: `${o.code} - ${o.name}` }));
    } else if (type === 'order') {
      const r = await api('order.list', null, { pageSize: 500 });
      items = (r.items || []).map(o => ({ id: o.id, label: o.code }));
    } else if (type === 'ticket') {
      const r = await api('ticket.list', null, { pageSize: 500 });
      items = (r.items || []).map(t => ({ id: t.id, label: `${t.code} - ${t.subject}` }));
    } else if (type === 'contact') {
      const r = await api('contact.list', null, { pageSize: 500 });
      items = (r.items || []).map(c => ({ id: c.id, label: `${c.code} - ${c.fullName}` }));
    } else return;
    idSel.innerHTML = '<option value="">-</option>' + items.map(i => `<option value="${i.id}">${escapeHtml(i.label)}</option>`).join('');
    if (currentId) idSel.value = currentId;
  } catch (e) { /* ignore */ }
}
// Khi đổi loại đối tượng, load lại dropdown
document.getElementById('note-related-type').addEventListener('change', () => {
  populateRelatedIdDropdown('note-related-type', 'note-related-id');
});
document.getElementById('activity-related-type').addEventListener('change', () => {
  populateRelatedIdDropdown('activity-related-type', 'activity-related-id');
});
document.getElementById('form-note').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  data.isPinned = e.target.elements.isPinned.checked ? 'TRUE' : 'FALSE';
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('note.update', data);
      toast('Đã cập nhật ghi chú', 'success');
    } else {
      await api('note.create', data);
      toast('Đã lưu ghi chú', 'success');
    }
    closeAllDrawers();
    loadNotes();
  } catch (err) { toast(err.message, 'error'); }
});
export async function togglePinNote(id, pin) {
  try {
    await api('note.update', { id, isPinned: pin ? 'TRUE' : 'FALSE' });
    toast(pin ? 'Đã ghim' : 'Đã bỏ ghim', 'success');
    loadNotes();
  } catch (e) { toast(e.message, 'error'); }
}
export async function deleteNote(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá ghi chú này?', type: 'danger' }))) return;
  try { await api('note.delete', { id }); toast('Đã xoá', 'success'); loadNotes(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('notes-search').addEventListener('input', debounce(e => {
  state.notes.search = e.target.value; loadNotes(1);
}, 400));
document.getElementById('notes-filter-type').addEventListener('change', e => {
  state.notes.filters.relatedType = e.target.value; loadNotes(1);
});

// =============================================================
// TAB 9: MESSAGES (Trao đổi)
// =============================================================
export async function loadMessages(page) {
  if (page) state.messages.page = page;
  const st = state.messages;
  const tl = document.getElementById('messages-timeline');
  tl.innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>';
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.channel) params.channel = st.filters.channel;
    if (st.filters.direction) params.direction = st.filters.direction;
    const r = await api('message.list', null, params);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    await ensureAllCustomers();
    renderMessages();
  } catch (e) {
    tl.innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export function renderMessages() {
  const st = state.messages;
  document.getElementById('messages-count').textContent = `Tổng ${formatNumber(st.total)} trao đổi`;
  const tl = document.getElementById('messages-timeline');
  if (st.items.length === 0) {
    tl.innerHTML = '<div class="empty-state"><i data-lucide="messages-square"></i><p>Chưa có trao đổi nào</p></div>';
    lucide.createIcons();
    return;
  }
  const custMap = {}; state.allCustomers.forEach(c => { custMap[c.id] = c; });
  const channelIcon = { email:'mail', sms:'message-square', call:'phone', zalo:'message-circle', facebook:'facebook', internal:'building' };

  // Group by day
  const groups = {};
  st.items.forEach(m => {
    const d = (m.sentAt || m.createdAt || '').slice(0, 10);
    if (!groups[d]) groups[d] = [];
    groups[d].push(m);
  });
  const sortedDays = Object.keys(groups).sort().reverse();

  let html = '';
  sortedDays.forEach(day => {
    html += `<div class="msg-day">${formatDateVN(day) || 'Không xác định'}</div>`;
    groups[day].forEach(m => {
      const isOut = m.direction === 'outbound';
      const cust = custMap[m.customerId];
      html += `
        <div class="msg-row ${isOut?'outbound':'inbound'}" onclick="deleteMessageConfirm('${m.id}')">
          <div class="msg-channel-icon ${m.channel}"><i data-lucide="${channelIcon[m.channel]||'message-square'}"></i></div>
          <div class="msg-body">
            <div class="msg-header">
              <span class="msg-direction ${isOut?'out':'in'}">${isOut?'Đi':'Đến'}</span>
              <span style="color:var(--ink-2);font-weight:500">${cust ? escapeHtml(cust.name) : 'Khách hàng'}</span>
              <span style="color:var(--ink-3)">· ${escapeHtml(m.channel||'')}</span>
              <span class="msg-time" style="margin-left:auto">${formatDateTimeVN(m.sentAt)}</span>
            </div>
            ${m.subject ? `<div class="msg-subject">${escapeHtml(m.subject)}</div>` : ''}
            <div class="msg-content">${escapeHtml(m.content||'').slice(0, 300)}${(m.content||'').length>300?'...':''}</div>
          </div>
        </div>
      `;
    });
  });
  tl.innerHTML = html;
  lucide.createIcons();
  renderPagination('messages-pagination', st, 'loadMessages');
}
export async function openMessageForm(id) {
  await ensureAllCustomers();
  await populateCustomerDropdown('message-customer-select', false);
  const form = document.getElementById('form-message');
  form.reset();
  // Default sentAt = bây giờ
  form.elements.sentAt.value = new Date().toISOString().slice(0, 16);
  openDrawer('drawer-message');
}
document.getElementById('form-message').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  try {
    await api('message.create', data);
    toast('Đã lưu trao đổi', 'success');
    closeAllDrawers();
    loadMessages();
  } catch (err) { toast(err.message, 'error'); }
});
export async function deleteMessageConfirm(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá trao đổi này?', type: 'danger' }))) return;
  try { await api('message.delete', { id }); toast('Đã xoá', 'success'); loadMessages(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('messages-search').addEventListener('input', debounce(e => {
  state.messages.search = e.target.value; loadMessages(1);
}, 400));
document.getElementById('messages-filter-channel').addEventListener('change', e => { state.messages.filters.channel = e.target.value; loadMessages(1); });
document.getElementById('messages-filter-direction').addEventListener('change', e => { state.messages.filters.direction = e.target.value; loadMessages(1); });


// Expose to window for HTML inline event handlers
window.loadCampaigns = loadCampaigns;
window.campaignStatusBadge = campaignStatusBadge;
window.renderCampaigns = renderCampaigns;
window.openCampaignForm = openCampaignForm;
window.sendCampaign = sendCampaign;
window.deleteCampaign = deleteCampaign;
window.loadNotes = loadNotes;
window.renderNotes = renderNotes;
window.openNoteForm = openNoteForm;
window.populateRelatedIdDropdown = populateRelatedIdDropdown;
window.togglePinNote = togglePinNote;
window.deleteNote = deleteNote;
window.loadMessages = loadMessages;
window.renderMessages = renderMessages;
window.openMessageForm = openMessageForm;
window.deleteMessageConfirm = deleteMessageConfirm;
