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
// ADMIN TAB - sub-tabs
// =============================================================
document.querySelectorAll('.admin-subtab').forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.subtab;
    document.querySelectorAll('.admin-subtab').forEach(x => x.classList.toggle('active', x.dataset.subtab === target));
    document.querySelectorAll('.admin-subpanel').forEach(p => p.classList.toggle('active', p.dataset.subpanel === target));
    // Lazy load
    if (target === 'users' && state.users.items.length === 0) loadUsers();
    else if (target === 'departments' && state.depts.items.length === 0) loadDepartments();
    else if (target === 'products' && state.adminProds.items.length === 0) loadAdminProducts();
    else if (target === 'tags' && state.tags.items.length === 0) loadTags();
    else if (target === 'settings' && Object.keys(state.settings).length === 0) loadSettings();
    else if (target === 'permissions') loadPermissionsMatrix(); // Phase 4D: load mỗi lần để có data mới nhất
  });
});

// ====== ADMIN: USERS ======
export async function loadUsers(page) {
  if (page) state.users.page = page;
  const st = state.users;
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.role) params.role = st.filters.role;
    const r = await api('user.list', null, params);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    if (state.depts.items.length === 0) await loadDepartments(true);
    renderUsers();
  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
  }
}
export function renderUsers() {
  const st = state.users;
  const tbody = document.getElementById('users-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><p>Chưa có người dùng nào</p></td></tr>';
    return;
  }
  const deptMap = {}; state.depts.items.forEach(d => { deptMap[d.id] = d.name; });
  const roleLabel = { admin:'Quản trị viên', boss:'Tổng GĐ', manager:'Trưởng phòng', staff:'Nhân viên' };
  tbody.innerHTML = st.items.map(u => {
    const initial = (u.fullName || u.username || 'U').charAt(0).toUpperCase();
    return `
      <tr onclick="openUserForm('${u.id}')">
        <td><span class="code">${escapeHtml(u.username||'')}</span></td>
        <td><div class="user-cell"><div class="mini-avatar">${initial}</div><strong>${escapeHtml(u.fullName||'')}</strong></div></td>
        <td>${escapeHtml(u.email||'-')}</td>
        <td><span class="role-badge ${u.role}">${roleLabel[u.role]||u.role}</span></td>
        <td>${escapeHtml(deptMap[u.departmentId]||'-')}</td>
        <td>${u.status === 'active' ? '<span class="badge-pill success">Hoạt động</span>' : (u.status === 'locked' ? '<span class="badge-pill danger">Khoá</span>' : '<span class="badge-pill muted">Vô hiệu</span>')}</td>
        <td>${u.lastLoginAt ? timeAgo(u.lastLoginAt) : '-'}</td>
        <td class="col-actions" onclick="event.stopPropagation()">
          <div class="row-actions">
            <button class="row-action-btn" onclick="openUserForm('${u.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
            ${u.id !== state.user.id ? `<button class="row-action-btn danger" onclick="deleteUser('${u.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
  renderPagination('users-pagination', st, 'loadUsers');
}
export async function openUserForm(id) {
  openDrawer('drawer-user');
  if (state.depts.items.length === 0) await loadDepartments(true);
  const deptSel = document.getElementById('user-dept-select');
  deptSel.innerHTML = '<option value="">-- Không chọn --</option>' +
    state.depts.items.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');

  const form = document.getElementById('form-user');
  form.reset();
  state.currentEditing = null;
  const passwordField = document.getElementById('user-password-field');
  const resetBtn = document.getElementById('btn-reset-password');

  if (id) {
    const u = state.users.items.find(x => x.id === id);
    if (u) {
      state.currentEditing = u;
      Object.keys(u).forEach(k => {
        const inp = form.elements[k];
        if (inp && inp.type !== 'submit' && k !== 'password') setCustomInputValue(inp, u[k]);
      });
      // Khi edit: ẩn password field, hiện reset button
      passwordField.style.display = 'none';
      form.elements.password.required = false;
      form.elements.username.disabled = true; // không cho đổi username
      resetBtn.style.display = '';
      resetBtn.onclick = () => resetUserPassword(u.id, u.username);
      document.getElementById('drawer-user-title').textContent = 'Sửa: ' + u.username;
    }
  } else {
    passwordField.style.display = '';
    form.elements.password.required = true;
    form.elements.username.disabled = false;
    resetBtn.style.display = 'none';
    document.getElementById('drawer-user-title').textContent = 'Thêm người dùng';
  }
}
document.getElementById('form-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  try {
    if (state.currentEditing) {
      delete data.password;
      delete data.username;
      data.id = state.currentEditing.id;
      await api('user.update', data);
      toast('Đã cập nhật người dùng', 'success');
    } else {
      await api('user.create', data);
      toast('Đã tạo người dùng', 'success');
    }
    closeAllDrawers();
    loadUsers();
  } catch (err) { toast(err.message, 'error'); }
});
export async function resetUserPassword(userId, username) {
  const newPassword = await promptDialog({ message: `Nhập mật khẩu MỚI cho ${username} (≥6 ký tự):` });
  if (!newPassword) return;
  if (newPassword.length < 6) { toast('Mật khẩu phải ≥ 6 ký tự', 'error'); return; }
  try {
    await api('auth.resetPassword', { userId, newPassword });
    toast('Đã đặt lại mật khẩu', 'success');
    closeAllDrawers();
  } catch (e) { toast(e.message, 'error'); }
}
export async function deleteUser(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá người dùng này? (Soft delete, có thể khôi phục)', type: 'danger' }))) return;
  try { await api('user.delete', { id }); toast('Đã xoá', 'success'); loadUsers(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('users-search').addEventListener('input', debounce(e => {
  state.users.search = e.target.value; loadUsers(1);
}, 400));
document.getElementById('users-filter-role').addEventListener('change', e => { state.users.filters.role = e.target.value; loadUsers(1); });

// ====== ADMIN: DEPARTMENTS ======
export async function loadDepartments(silent) {
  try {
    const r = await api('department.list');
    state.depts.items = r.items || [];
    renderDepartments();
  } catch (e) {
    if (!silent) document.getElementById('depts-tbody').innerHTML = `<tr><td colspan="5" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
  }
}
export function renderDepartments() {
  const items = state.depts.items;
  const tbody = document.getElementById('depts-tbody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Chưa có phòng ban nào</p></td></tr>';
    return;
  }
  tbody.innerHTML = items.map(d => `
    <tr onclick="openDepartmentForm('${d.id}')">
      <td><span class="code">${escapeHtml(d.code||'')}</span></td>
      <td><strong>${escapeHtml(d.name||'')}</strong></td>
      <td>${escapeHtml(d.description||'-')}</td>
      <td>${d.isActive === 'TRUE' || d.isActive === true ? '<span class="badge-pill success">Hoạt động</span>' : '<span class="badge-pill muted">Vô hiệu</span>'}</td>
      <td class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          <button class="row-action-btn" onclick="openDepartmentForm('${d.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteDepartment('${d.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
}
export function openDepartmentForm(id) {
  openDrawer('drawer-department');
  const form = document.getElementById('form-department');
  form.reset();
  state.currentEditing = null;
  if (id) {
    const d = state.depts.items.find(x => x.id === id);
    if (d) {
      state.currentEditing = d;
      ['code','name','description'].forEach(k => { if (form.elements[k]) form.elements[k].value = d[k] || ''; });
      document.getElementById('drawer-dept-title').textContent = 'Sửa: ' + d.name;
    }
  } else {
    document.getElementById('drawer-dept-title').textContent = 'Thêm phòng ban';
  }
}
document.getElementById('form-department').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('department.update', data);
      toast('Đã cập nhật phòng ban', 'success');
    } else {
      await api('department.create', data);
      toast('Đã tạo phòng ban', 'success');
    }
    closeAllDrawers();
    state.depts.items = [];
    loadDepartments();
  } catch (err) { toast(err.message, 'error'); }
});
export async function deleteDepartment(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá phòng ban này?', type: 'danger' }))) return;
  try { await api('department.delete', { id }); toast('Đã xoá', 'success'); state.depts.items=[]; loadDepartments(); }
  catch (e) { toast(e.message, 'error'); }
}

// ====== ADMIN: PRODUCTS ======
export async function loadAdminProducts(page) {
  if (page) state.adminProds.page = page;
  const st = state.adminProds;
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.brand) params.brand = st.filters.brand;
    if (st.filters.category) params.category = st.filters.category;
    const r = await api('product.list', null, params);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    renderAdminProducts();
  } catch (e) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
  }
}
export function renderAdminProducts() {
  const st = state.adminProds;
  const tbody = document.getElementById('products-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><p>Chưa có sản phẩm nào</p></td></tr>';
    return;
  }
  tbody.innerHTML = st.items.map(p => `
    <tr onclick="openProductForm('${p.id}')">
      <td>
        ${p.externalCode ? `<strong>${escapeHtml(p.externalCode)}</strong><br>` : ''}
        <span class="code" style="font-size:11px;color:var(--ink-3)">${escapeHtml(p.code||'')}</span>
      </td>
      <td><strong>${escapeHtml(p.name||'')}</strong>${p.model?'<br><span class="text-sm text-muted">'+escapeHtml(p.model)+'</span>':''}</td>
      <td>${escapeHtml(p.brand||'-')}</td>
      <td>${escapeHtml(p.category||'-')}</td>
      <td>${escapeHtml(p.unit||'-')}</td>
      <td class="text-right">${formatVND(p.listPrice||0)}</td>
      <td class="text-right">${formatNumber(p.stockQty||0)}</td>
      <td>${(p.isActive === 'TRUE' || p.isActive === true) ? '<span class="badge-pill success">Đang bán</span>' : '<span class="badge-pill muted">Ngừng</span>'}</td>
      <td class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          <button class="row-action-btn" onclick="openProductForm('${p.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteProduct('${p.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
  renderPagination('products-pagination', st, 'loadAdminProducts');
}
export function openProductForm(id) {
  openDrawer('drawer-product');
  const form = document.getElementById('form-product');
  form.reset();
  state.currentEditing = null;
  if (id) {
    const p = state.adminProds.items.find(x => x.id === id);
    if (p) {
      state.currentEditing = p;
      Object.keys(p).forEach(k => {
        const inp = form.elements[k];
        if (inp && inp.type !== 'submit' && inp.type !== 'checkbox') setCustomInputValue(inp, p[k]);
      });
      ['isActive','isForRent','isForCPC'].forEach(k => {
        if (form.elements[k]) form.elements[k].checked = (p[k] === 'TRUE' || p[k] === true);
      });
      document.getElementById('drawer-product-title').textContent = 'Sửa: ' + p.code;
    }
  } else {
    document.getElementById('drawer-product-title').textContent = 'Thêm sản phẩm';
  }
}
document.getElementById('form-product').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  ['isActive','isForRent','isForCPC'].forEach(k => {
    data[k] = e.target.elements[k].checked ? 'TRUE' : 'FALSE';
  });
  ['listPrice','costPrice','vatRate','stockQty','rentPricePerMonth','cpcBlackWhite','cpcColor'].forEach(k => {
    if (data[k] !== '') data[k] = Number(data[k]);
  });
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('product.update', data);
      toast('Đã cập nhật sản phẩm', 'success');
    } else {
      await api('product.create', data);
      toast('Đã tạo sản phẩm', 'success');
    }
    closeAllDrawers();
    state.products = []; // reset cache global
    loadAdminProducts();
  } catch (err) { toast(err.message, 'error'); }
});
export async function deleteProduct(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá sản phẩm này?', type: 'danger' }))) return;
  try { await api('product.delete', { id }); toast('Đã xoá', 'success'); state.products=[]; loadAdminProducts(); }
  catch (e) { toast(e.message, 'error'); }
}
document.getElementById('products-search').addEventListener('input', debounce(e => {
  state.adminProds.search = e.target.value; loadAdminProducts(1);
}, 400));
document.getElementById('products-filter-brand').addEventListener('change', e => { state.adminProds.filters.brand = e.target.value; loadAdminProducts(1); });
document.getElementById('products-filter-category').addEventListener('change', e => { state.adminProds.filters.category = e.target.value; loadAdminProducts(1); });

// ====== ADMIN: TAGS ======
export async function loadTags() {
  const grid = document.getElementById('tags-grid');
  grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="spinner dark"></div> Đang tải...</div>';
  try {
    const r = await api('tag.list');
    state.tags.items = r.items || [];
    renderTags();
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}
export function renderTags() {
  const items = state.tags.items;
  const grid = document.getElementById('tags-grid');
  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i data-lucide="tag"></i><p>Chưa có thẻ nào</p></div>';
    lucide.createIcons();
    return;
  }
  const catLabel = { customer:'Khách hàng', contact:'Liên hệ', opportunity:'Cơ hội', general:'Chung' };
  grid.innerHTML = items.map(t => `
    <div class="tag-card">
      <div class="tag-card-info">
        <div class="chip" style="background:${escapeHtml(t.color||'#1976d2')}"><span class="chip-dot"></span>${escapeHtml(t.name||'')}</div>
        <div class="tag-desc">${escapeHtml(t.description||'(Không có mô tả)')}</div>
        <div class="tag-cat">${catLabel[t.category]||t.category||''}</div>
      </div>
      <div class="tag-card-actions">
        <button class="row-action-btn" onclick="openTagForm('${t.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
        <button class="row-action-btn danger" onclick="deleteTag('${t.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}
export function openTagForm(id) {
  openDrawer('drawer-tag');
  const form = document.getElementById('form-tag');
  form.reset();
  form.elements.color.value = '#1976d2';
  state.currentEditing = null;
  if (id) {
    const t = state.tags.items.find(x => x.id === id);
    if (t) {
      state.currentEditing = t;
      ['name','color','category','description'].forEach(k => { if (form.elements[k]) form.elements[k].value = t[k] || ''; });
      if (t.color) form.elements.color.value = t.color;
      document.getElementById('drawer-tag-title').textContent = 'Sửa thẻ: ' + t.name;
    }
  } else {
    document.getElementById('drawer-tag-title').textContent = 'Thêm thẻ';
  }
}
document.getElementById('form-tag').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('tag.update', data);
      toast('Đã cập nhật thẻ', 'success');
    } else {
      await api('tag.create', data);
      toast('Đã tạo thẻ', 'success');
    }
    closeAllDrawers();
    loadTags();
  } catch (err) { toast(err.message, 'error'); }
});
export async function deleteTag(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá thẻ này?', type: 'danger' }))) return;
  try { await api('tag.delete', { id }); toast('Đã xoá', 'success'); loadTags(); }
  catch (e) { toast(e.message, 'error'); }
}

// ============================================================
// PHASE 4D - PERMISSIONS MATRIX UI
// ============================================================

// Định nghĩa các nhóm action + label tiếng Việt
const PERMISSION_GROUPS = [
  {
    title: 'Khách hàng & Liên hệ',
    actions: [
      ['customer.create',  'Tạo khách hàng'],
      ['customer.update',  'Sửa khách hàng'],
      ['customer.delete',  'Xoá khách hàng'],
      ['customer.approve', 'Duyệt khách hàng'],
      ['customer.merge',   'Gộp khách hàng trùng'],
      ['customer.import',  'Nhập khách hàng từ file'],
      ['contact.create',   'Tạo liên hệ'],
      ['contact.update',   'Sửa liên hệ'],
      ['contact.delete',   'Xoá liên hệ'],
    ],
  },
  {
    title: 'Bán hàng',
    actions: [
      ['opportunity.create', 'Tạo cơ hội'],
      ['opportunity.update', 'Sửa cơ hội'],
      ['opportunity.delete', 'Xoá cơ hội'],
      ['quote.create',       'Tạo báo giá'],
      ['quote.update',       'Sửa báo giá'],
      ['quote.delete',       'Xoá báo giá'],
      ['quote.export',       'Xuất báo giá Word/PDF'],
      ['order.create',       'Tạo đơn hàng'],
      ['order.update',       'Sửa đơn hàng'],
      ['order.delete',       'Xoá đơn hàng'],
      ['order.export',       'Xuất đơn hàng Word/PDF'],
    ],
  },
  {
    title: 'Hoạt động & Hỗ trợ',
    actions: [
      ['activity.create', 'Tạo hoạt động'],
      ['activity.update', 'Sửa hoạt động'],
      ['activity.delete', 'Xoá hoạt động'],
      ['ticket.create',   'Tạo ticket hỗ trợ'],
      ['ticket.update',   'Sửa ticket'],
      ['ticket.delete',   'Xoá ticket'],
    ],
  },
  {
    title: 'Marketing',
    actions: [
      ['campaign.create', 'Tạo chiến dịch'],
      ['campaign.update', 'Sửa chiến dịch'],
      ['campaign.delete', 'Xoá chiến dịch'],
      ['campaign.send',   'Gửi chiến dịch'],
    ],
  },
  {
    title: 'Ghi chú & Trao đổi',
    actions: [
      ['note.create',    'Tạo ghi chú'],
      ['note.delete',    'Xoá ghi chú'],
      ['message.create', 'Tạo tin nhắn nội bộ'],
    ],
  },
  {
    title: 'Quản trị hệ thống',
    actions: [
      ['user.list',          'Xem danh sách người dùng'],
      ['user.create',        'Tạo người dùng', { lockedRoles: ['admin'] }],
      ['user.update',        'Sửa người dùng', { lockedRoles: ['admin'] }],
      ['user.delete',        'Xoá người dùng', { lockedRoles: ['admin'] }],
      ['department.create',  'Tạo phòng ban', { lockedRoles: ['admin'] }],
      ['department.update',  'Sửa phòng ban', { lockedRoles: ['admin'] }],
      ['department.delete',  'Xoá phòng ban', { lockedRoles: ['admin'] }],
      ['product.create',     'Tạo sản phẩm'],
      ['product.update',     'Sửa sản phẩm'],
      ['product.delete',     'Xoá sản phẩm'],
      ['tag.create',         'Tạo thẻ'],
      ['tag.update',         'Sửa thẻ'],
      ['tag.delete',         'Xoá thẻ'],
      ['setting.update',     'Sửa cấu hình hệ thống', { lockedRoles: ['admin'] }],
      ['permissions.update', 'Sửa ma trận phân quyền', { lockedRoles: ['admin'] }],
    ],
  },
];

const PERMISSION_ROLES = [
  { key: 'admin',   label: 'Admin',     color: '#7C2D12' },
  { key: 'boss',    label: 'Tổng GĐ',   color: '#1E3A8A' },
  { key: 'manager', label: 'Quản lý',   color: '#065F46' },
  { key: 'staff',   label: 'Nhân viên', color: '#78350F' },
];

state.permissionsMatrix = {};
state.permissionsMatrixOriginal = {};

/**
 * Load ma trận phân quyền từ backend
 */
export async function loadPermissionsMatrix() {
  const tableDiv = document.getElementById('permissions-table');
  if (!tableDiv) return;
  tableDiv.innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải ma trận quyền...</div>';
  try {
    const r = await api('permissions.get');
    state.permissionsMatrix = r.matrix || {};
    state.permissionsMatrixOriginal = JSON.parse(JSON.stringify(state.permissionsMatrix));
    renderPermissionsMatrix();
    document.getElementById('btn-save-permissions').disabled = true;
  } catch (e) {
    tableDiv.innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

/**
 * Render bảng ma trận
 */
export function renderPermissionsMatrix() {
  const tableDiv = document.getElementById('permissions-table');
  let html = `
    <table class="permissions-table">
      <thead>
        <tr>
          <th style="min-width:280px">Hành động</th>
          ${PERMISSION_ROLES.map(r => `<th class="role-col"><span class="role-tag">${escapeHtml(r.label)}</span></th>`).join('')}
        </tr>
      </thead>
      <tbody>
  `;
  
  PERMISSION_GROUPS.forEach(group => {
    html += `<tr class="group-header"><td colspan="${1 + PERMISSION_ROLES.length}">${escapeHtml(group.title)}</td></tr>`;
    group.actions.forEach(([action, label, opts]) => {
      const allowedRoles = state.permissionsMatrix[action] || [];
      const lockedRoles = (opts && opts.lockedRoles) || [];
      
      html += `<tr>
        <td class="action-col">
          <code>${escapeHtml(action)}</code>
          <span class="action-label">${escapeHtml(label)}</span>
        </td>
        ${PERMISSION_ROLES.map(role => {
          const isOn = role.key === 'admin' || allowedRoles.indexOf(role.key) >= 0;
          // Admin luôn locked-on
          const isLocked = role.key === 'admin' || lockedRoles.indexOf(role.key) >= 0;
          const cls = isLocked ? 'is-on is-locked' : (isOn ? 'is-on' : '');
          const handler = isLocked ? '' : `onclick="togglePermission('${action}','${role.key}')"`;
          const title = isLocked ? `${role.label}: bắt buộc có quyền (không thể tắt)` : 
                       (isOn ? `Click để TẮT quyền của ${role.label}` : `Click để BẬT quyền cho ${role.label}`);
          return `<td class="perm-cell">
            <div class="perm-toggle ${cls}" ${handler} title="${title}">
              ${isOn ? '<i data-lucide="check" style="width:14px;height:14px"></i>' : ''}
            </div>
          </td>`;
        }).join('')}
      </tr>`;
    });
  });
  
  html += '</tbody></table>';
  tableDiv.innerHTML = html;
  lucide.createIcons();
}

/**
 * Toggle 1 ô quyền (off ↔ on)
 */
export function togglePermission(action, role) {
  if (role === 'admin') return; // admin luôn có quyền
  
  if (!state.permissionsMatrix[action]) state.permissionsMatrix[action] = [];
  const arr = state.permissionsMatrix[action];
  const idx = arr.indexOf(role);
  if (idx >= 0) {
    arr.splice(idx, 1);
  } else {
    arr.push(role);
  }
  renderPermissionsMatrix();
  // Compare với bản gốc để bật/tắt nút Lưu
  const changed = JSON.stringify(state.permissionsMatrix) !== JSON.stringify(state.permissionsMatrixOriginal);
  document.getElementById('btn-save-permissions').disabled = !changed;
}

/**
 * Lưu ma trận quyền
 */
export async function savePermissionsMatrix() {
  const ok = await confirmDialog({
    title: 'Lưu ma trận phân quyền',
    message: 'Áp dụng các thay đổi vừa rồi cho hệ thống?<br><br>Các thay đổi sẽ có hiệu lực ngay với <strong>tất cả người dùng</strong> trong lần thao tác tiếp theo của họ.',
    type: 'warning',
    okText: 'Áp dụng',
  });
  if (!ok) return;
  
  try {
    await api('permissions.update', { matrix: state.permissionsMatrix });
    toast('Đã lưu ma trận phân quyền', 'success');
    state.permissionsMatrixOriginal = JSON.parse(JSON.stringify(state.permissionsMatrix));
    document.getElementById('btn-save-permissions').disabled = true;
  } catch (e) {
    toast(e.message, 'error');
  }
}

/**
 * Khôi phục ma trận quyền về mặc định
 */
export async function resetPermissionsToDefault() {
  const ok = await confirmDialog({
    title: 'Khôi phục ma trận quyền mặc định',
    message: 'Reset TẤT CẢ ô về giá trị mặc định ban đầu?<br><br>Tất cả tuỳ chỉnh hiện tại sẽ bị mất.',
    type: 'danger',
    okText: 'Khôi phục',
  });
  if (!ok) return;
  
  try {
    // Backend không có API reset → gửi matrix rỗng = backend dùng default
    await api('permissions.update', { matrix: {} });
    toast('Đã khôi phục mặc định', 'success');
    loadPermissionsMatrix();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ====== ADMIN: SETTINGS ======
export async function loadSettings() {
  const div = document.getElementById('settings-list');
  div.innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>';
  try {
    const r = await api('setting.list');
    state.settings = r || {};
    renderSettings();
    renderEnums();  // Render thêm phần ENUMs
  } catch (e) {
    div.innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

// =============================================================
// PHASE 4A - ENUM EDITOR
// =============================================================

// Định nghĩa các ENUMs có thể chỉnh sửa
const ENUM_DEFINITIONS = [
  {
    key: 'enum.customerClassifications',
    title: 'Phân loại khách hàng',
    desc: 'Áp dụng cho dropdown "Phân loại" khi thêm/sửa KH',
    default: ['VIP', 'Tiềm năng', 'Thường', 'Không hoạt động'],
  },
  {
    key: 'enum.opportunityStages',
    title: 'Giai đoạn cơ hội',
    desc: 'Pipeline bán hàng từ Tiếp cận đến Thắng/Thua',
    default: ['Tiếp cận', 'Khảo sát', 'Báo giá', 'Đàm phán', 'Thắng', 'Thua'],
  },
  {
    key: 'enum.priorities',
    title: 'Mức độ ưu tiên',
    desc: 'Dùng cho Hoạt động, Ticket',
    default: ['Thấp', 'Trung bình', 'Cao', 'Khẩn cấp'],
  },
  {
    key: 'enum.productBrands',
    title: 'Hãng sản phẩm',
    desc: 'Dropdown hãng khi tạo sản phẩm',
    default: ['Konica Minolta', 'Fuji Xerox', 'Fujifilm', 'Kyocera', 'Epson'],
  },
  {
    key: 'enum.productCategories',
    title: 'Loại sản phẩm',
    desc: 'Dropdown loại khi tạo sản phẩm',
    default: ['Máy photocopy', 'Linh kiện', 'Vật tư tiêu hao', 'Dịch vụ CPC'],
  },
  {
    key: 'enum.ticketCategories',
    title: 'Danh mục Ticket',
    desc: 'Dropdown phân loại ticket hỗ trợ',
    default: ['Kỹ thuật', 'Bảo hành', 'Tư vấn', 'Khiếu nại', 'Khác'],
  },
  {
    key: 'enum.activityTypes',
    title: 'Loại hoạt động',
    desc: 'Dropdown loại khi tạo hoạt động (format: code:Tên hiển thị)',
    default: ['call:Cuộc gọi', 'meeting:Họp/Demo', 'task:Nhiệm vụ', 'email:Email', 'visit:Thăm khách', 'sms:SMS'],
  },
  {
    key: 'enum.campaignTypes',
    title: 'Loại chiến dịch',
    desc: 'Dropdown loại khi tạo chiến dịch marketing',
    default: ['Email', 'SMS', 'Telesale', 'Sự kiện', 'Khuyến mãi', 'Trả thưởng'],
  },
];

/**
 * Parse 1 ENUM string thành array. Hỗ trợ:
 * - "a,b,c" → ["a","b","c"]
 * - "code1:Label 1,code2:Label 2" → [{code:"code1", label:"Label 1"}, ...]
 */
export function parseEnum(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Lấy giá trị ENUM (ưu tiên từ settings, fallback default)
 */
export function getEnum(key) {
  const defn = ENUM_DEFINITIONS.find(e => e.key === key);
  const fallback = defn ? defn.default : [];
  const val = state.settings && state.settings[key];
  if (!val) return fallback;
  return parseEnum(val);
}

/**
 * Render UI ENUMs editor
 */
export function renderEnums() {
  const div = document.getElementById('enums-list');
  if (!div) return;
  div.innerHTML = ENUM_DEFINITIONS.map((defn, idx) => {
    const items = getEnum(defn.key);
    return `
      <div class="enum-group" data-enum-key="${escapeHtml(defn.key)}">
        <div class="enum-group-title">${escapeHtml(defn.title)}</div>
        <div class="enum-group-desc">${escapeHtml(defn.desc)} · Key: <code style="font-size:11px">${escapeHtml(defn.key)}</code></div>
        <div class="enum-items-list" id="enum-items-${idx}">
          ${items.map((it, i) => `
            <span class="enum-chip">
              ${escapeHtml(it)}
              <span class="chip-remove" onclick="removeEnumItem(${idx}, ${i})">×</span>
            </span>
          `).join('')}
          ${items.length === 0 ? '<span style="font-size:12px;color:var(--ink-3)">Chưa có mục nào</span>' : ''}
        </div>
        <div class="enum-add-row">
          <input type="text" id="enum-input-${idx}" placeholder="Nhập mục mới rồi Enter..." onkeydown="if(event.key==='Enter'){event.preventDefault();addEnumItem(${idx});}" />
          <button class="btn btn-outline btn-sm" onclick="addEnumItem(${idx})"><i data-lucide="plus" style="width:13px;height:13px"></i> Thêm</button>
          <button class="btn btn-outline btn-sm" onclick="resetEnumDefault(${idx})" title="Đặt về mặc định"><i data-lucide="rotate-ccw" style="width:13px;height:13px"></i></button>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

export async function addEnumItem(idx) {
  const defn = ENUM_DEFINITIONS[idx];
  const input = document.getElementById('enum-input-' + idx);
  const newItem = input.value.trim();
  if (!newItem) return;
  // Check duplicate
  const items = getEnum(defn.key);
  if (items.includes(newItem)) {
    toast('Mục này đã tồn tại', 'warning');
    return;
  }
  items.push(newItem);
  await saveEnum(defn.key, items);
  input.value = '';
}

export async function removeEnumItem(idx, itemIdx) {
  const defn = ENUM_DEFINITIONS[idx];
  const items = getEnum(defn.key);
  if (!(await confirmDialog({ title: 'Xoá', message: `Xoá mục "${items[itemIdx]}"?`, type: 'danger' }))) return;
  items.splice(itemIdx, 1);
  await saveEnum(defn.key, items);
}

export async function resetEnumDefault(idx) {
  const defn = ENUM_DEFINITIONS[idx];
  if (!(await confirmDialog({ title: 'Xác nhận', message: `Đặt lại danh sách "${defn.title}" về mặc định?`, type: 'warning' }))) return;
  await saveEnum(defn.key, defn.default);
}

export async function saveEnum(key, items) {
  try {
    const value = items.join(',');
    await api('setting.update', { key: key, value: value });
    state.settings[key] = value;
    renderEnums();
    toast('Đã lưu. F5 để áp dụng', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Sub-tabs trong Settings
document.addEventListener('click', e => {
  const btn = e.target.closest('.settings-tab');
  if (!btn) return;
  const target = btn.dataset.stab;
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.stab === target));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.dataset.stabPanel === target));
});

/**
 * Áp dụng ENUMs vào các dropdown trong 1 form.
 * Mỗi form khai báo qua dataset:
 *   <select name="classification" data-enum="enum.customerClassifications">
 * Hàm này sẽ thay options theo state.settings.
 */
export function applyEnumsToForm(formEl) {
  if (!formEl) return;
  formEl.querySelectorAll('select[data-enum]').forEach(sel => {
    const enumKey = sel.dataset.enum;
    const items = getEnum(enumKey);
    if (items.length === 0) return; // Không có data → giữ options sẵn
    const currentValue = sel.value;
    const hasEmptyOption = sel.options.length > 0 && !sel.options[0].value;
    const emptyOpt = hasEmptyOption ? `<option value="">${escapeHtml(sel.options[0].text)}</option>` : '';
    
    // Items có dạng "code:Label" hoặc "value"
    sel.innerHTML = emptyOpt + items.map(it => {
      if (it.includes(':')) {
        const [code, label] = it.split(':', 2);
        return `<option value="${escapeHtml(code.trim())}">${escapeHtml(label.trim())}</option>`;
      }
      return `<option value="${escapeHtml(it)}">${escapeHtml(it)}</option>`;
    }).join('');
    // Restore selected value
    if (currentValue) sel.value = currentValue;
  });
}
export function renderSettings() {
  const div = document.getElementById('settings-list');
  // Mô tả cho từng key (DEFAULT - các key cần có)
  const descMap = {
    'company.name': 'Tên công ty hiển thị toàn ứng dụng',
    'company.shortName': 'Tên rút gọn',
    'company.address': 'Địa chỉ trụ sở',
    'company.phone': 'Điện thoại công ty',
    'company.email': 'Email công ty',
    'company.taxCode': 'Mã số thuế công ty',
    'company.website': 'Website công ty',
    'company.logoUrl': 'Link logo (tên file logo.png nếu cùng folder index.html, hoặc URL đầy đủ)',
    'company.loginHeadline': 'Câu khẩu hiệu lớn màn hình đăng nhập (dòng 1 & 2, hỗ trợ thẻ HTML <em>)',
    'company.loginTagline': 'Đoạn mô tả chi tiết hệ thống màn hình đăng nhập (dòng 3)',
    'company.loginFooter': 'Chữ bản quyền chân trang màn hình đăng nhập (footer)',
    'system.appName': 'Tên ứng dụng',
    'system.version': 'Phiên bản',
    'system.sessionTimeoutHours': 'Số giờ JWT hết hạn',
    'system.maxFailedLogin': 'Số lần đăng nhập sai tối đa',
    'system.codePrefixYear': 'Năm dùng cho prefix mã (KH2026-...)',
    'system.currency': 'Đơn vị tiền tệ',
    'system.currencySymbol': 'Ký hiệu tiền tệ',
    'system.dateFormat': 'Định dạng ngày',
    'system.defaultVatRate': '% VAT mặc định',
    'system.timezone': 'Múi giờ',
    'feature.email.enabled': 'Bật gửi email thật (TRUE/FALSE)',
    'feature.sms.enabled': 'Bật gửi SMS thật (TRUE/FALSE)',
    // === Phase 3D - Export Word/PDF ===
    'export.quoteTemplateId': '⭐ ID Google Doc template báo giá (lấy từ URL Doc, đoạn giữa /d/ và /edit). Để trống = tự sinh',
    'export.orderTemplateId': '⭐ ID Google Doc template đơn hàng. Để trống = tự sinh',
    'export.outputFolderId': '⭐ ID folder Google Drive để lưu file xuất (optional)',
  };

  // Lấy danh sách keys: ưu tiên thứ tự descMap, sau đó các keys khác
  const allKeys = new Set([...Object.keys(descMap), ...Object.keys(state.settings)]);
  const keys = Array.from(allKeys).sort((a, b) => {
    // Sắp xếp theo prefix: company.* -> system.* -> feature.* -> export.* -> others
    const order = ['company.', 'system.', 'feature.', 'export.', 'permissions.'];
    const aOrder = order.findIndex(p => a.startsWith(p));
    const bOrder = order.findIndex(p => b.startsWith(p));
    if (aOrder !== bOrder) return (aOrder === -1 ? 99 : aOrder) - (bOrder === -1 ? 99 : bOrder);
    return a.localeCompare(b);
  });

  if (keys.length === 0) {
    div.innerHTML = '<div class="empty-state"><p>Chưa có cấu hình</p></div>';
    return;
  }

  div.innerHTML = keys.map(k => {
    const val = state.settings[k];
    const hasValue = val !== undefined && val !== null && val !== '';
    const isStar = (descMap[k] || '').startsWith('⭐');
    return `
      <div class="setting-item" data-key="${escapeHtml(k)}">
        <div>
          <div class="setting-key">${escapeHtml(k)}</div>
          <div class="setting-desc">${escapeHtml(descMap[k]||'')}</div>
        </div>
        <div class="setting-value" id="sv-${k.replace(/\./g,'-')}" style="${!hasValue?'color:var(--ink-3);font-style:italic':''}">
          ${hasValue ? escapeHtml(val) : '(Chưa khai báo)'}
        </div>
        <div><button class="btn btn-outline btn-sm" onclick="editSetting('${escapeHtml(k)}')"><i data-lucide="edit-2" style="width:13px;height:13px"></i></button></div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}
export async function editSetting(key) {
  const newVal = await promptDialog({ title: 'Sửa cấu hình', message: `Nhập giá trị mới cho <code>${key}</code>:`, defaultValue: String(state.settings[key] || '') });
  if (newVal === null) return;
  try {
    await api('setting.update', { key: key, value: newVal });
    toast('Đã cập nhật cấu hình', 'success');
    loadSettings();
  } catch (e) { toast(e.message, 'error'); }
}


// Expose to window for HTML inline event handlers
window.loadUsers = loadUsers;
window.renderUsers = renderUsers;
window.openUserForm = openUserForm;
window.resetUserPassword = resetUserPassword;
window.deleteUser = deleteUser;
window.loadDepartments = loadDepartments;
window.renderDepartments = renderDepartments;
window.openDepartmentForm = openDepartmentForm;
window.deleteDepartment = deleteDepartment;
window.loadAdminProducts = loadAdminProducts;
window.renderAdminProducts = renderAdminProducts;
window.openProductForm = openProductForm;
window.deleteProduct = deleteProduct;
window.loadTags = loadTags;
window.renderTags = renderTags;
window.openTagForm = openTagForm;
window.deleteTag = deleteTag;
window.loadPermissionsMatrix = loadPermissionsMatrix;
window.renderPermissionsMatrix = renderPermissionsMatrix;
window.togglePermission = togglePermission;
window.savePermissionsMatrix = savePermissionsMatrix;
window.resetPermissionsToDefault = resetPermissionsToDefault;
window.loadSettings = loadSettings;
window.parseEnum = parseEnum;
window.getEnum = getEnum;
window.renderEnums = renderEnums;
window.addEnumItem = addEnumItem;
window.removeEnumItem = removeEnumItem;
window.resetEnumDefault = resetEnumDefault;
window.saveEnum = saveEnum;
window.applyEnumsToForm = applyEnumsToForm;
window.renderSettings = renderSettings;
window.editSetting = editSetting;
