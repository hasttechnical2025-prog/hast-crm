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

// ============================================================
// =========== PHASE 3B - 4 TABS CHÍNH =========================
// ============================================================

// ====== STATE phase 3B ======
// Centralized in js/state.js

// ====== DRAWER UTILS ======
export function openDrawer(id) {
  document.getElementById('drawer-backdrop').classList.add('show');
  const drawer = document.getElementById(id);
  drawer.classList.add('show');
  lucide.createIcons();
  // Init custom inputs (date, datetime, phone, money)
  initDateInputs(drawer);
  // Apply ENUMs (#PhaseEnumEditor)
  const form = drawer.querySelector('form');
  if (form) applyEnumsToForm(form);
}
export function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => d.classList.remove('show'));
  document.getElementById('drawer-backdrop').classList.remove('show');
}

// ====== BADGE HELPERS ======
export function classBadge(cls) {
  const m = { 'VIP':'vip', 'Tiềm năng':'potential', 'Thường':'normal', 'Không hoạt động':'inactive' };
  return `<span class="badge-pill ${m[cls]||'normal'}">${escapeHtml(cls||'-')}</span>`;
}
export function approvalBadge(st) {
  const m = { approved: ['success','Đã duyệt'], pending: ['warning','Chờ duyệt'], rejected: ['danger','Từ chối'] };
  const [cls, lbl] = m[st] || ['muted', st || '-'];
  return `<span class="badge-pill ${cls}">${lbl}</span>`;
}

export function visibilityBadge(v) {
  if (!v || v === 'department') {
    return '<span class="visibility-badge department"><i data-lucide="users" style="width:11px;height:11px"></i>Phòng</span>';
  } else if (v === 'private') {
    return '<span class="visibility-badge private"><i data-lucide="lock" style="width:11px;height:11px"></i>Riêng</span>';
  } else if (v === 'public') {
    return '<span class="visibility-badge public"><i data-lucide="globe" style="width:11px;height:11px"></i>Cty</span>';
  }
  return '';
}
export function stageBadge(stage) {
  const m = { 'Tiếp cận':'info', 'Khảo sát':'info', 'Báo giá':'warning', 'Đàm phán':'warning', 'Thắng':'success', 'Thua':'danger' };
  return `<span class="badge-pill ${m[stage]||'muted'}">${escapeHtml(stage||'-')}</span>`;
}
export function quoteStatusBadge(s) {
  const m = { draft:['draft','Nháp'], sent:['info','Đã gửi'], accepted:['success','Chấp nhận'], rejected:['danger','Từ chối'], expired:['muted','Hết hạn'] };
  const [c, l] = m[s] || ['muted', s||'-'];
  return `<span class="badge-pill ${c}">${l}</span>`;
}
export function orderStatusBadge(s) {
  const m = { 'Chờ xác nhận':'warning', 'Đã xác nhận':'info', 'Đang giao':'info', 'Đã giao':'success', 'Đã huỷ':'danger' };
  return `<span class="badge-pill ${m[s]||'muted'}">${escapeHtml(s||'-')}</span>`;
}
export function paymentBadge(s) {
  const m = { 'Chưa thanh toán':'danger', 'Trả một phần':'warning', 'Đã thanh toán':'success' };
  return `<span class="badge-pill ${m[s]||'muted'}">${escapeHtml(s||'-')}</span>`;
}
export function activityStatusBadge(s) {
  const m = { 'Chờ xử lý':'warning', 'Đang làm':'info', 'Hoàn thành':'success', 'Bỏ qua':'muted' };
  return `<span class="badge-pill ${m[s]||'muted'}">${escapeHtml(s||'-')}</span>`;
}
export function priorityBadge(p) {
  const m = { 'Thấp':'muted', 'Trung bình':'info', 'Cao':'warning', 'Khẩn cấp':'danger' };
  return `<span class="badge-pill ${m[p]||'muted'}">${escapeHtml(p||'-')}</span>`;
}

// ====== PAGINATION RENDER ======
export function renderPagination(elId, st, onPageChange) {
  const el = document.getElementById(elId);
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(st.total / st.pageSize));
  const buttons = [];
  buttons.push(`<button class="page-btn" ${st.page<=1?'disabled':''} onclick="${onPageChange}(${st.page-1})"><i data-lucide="chevron-left" style="width:14px;height:14px"></i></button>`);
  const start = Math.max(1, st.page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) {
    buttons.push(`<button class="page-btn ${i===st.page?'active':''}" onclick="${onPageChange}(${i})">${i}</button>`);
  }
  buttons.push(`<button class="page-btn" ${st.page>=totalPages?'disabled':''} onclick="${onPageChange}(${st.page+1})"><i data-lucide="chevron-right" style="width:14px;height:14px"></i></button>`);
  el.innerHTML = `
    <div>Tổng <strong>${formatNumber(st.total)}</strong> bản ghi · Trang ${st.page}/${totalPages}</div>
    <div class="pagination-controls">${buttons.join('')}</div>
  `;
  lucide.createIcons();
}

// ====== CACHE products & customers cho dropdown ======
export async function ensureProducts() {
  if (state.products.length > 0) return state.products;
  try {
    const r = await api('product.list', null, { pageSize: 500, isActive: 'true' });
    state.products = r.items || [];
  } catch (e) { state.products = []; }
  return state.products;
}
export async function ensureAllCustomers() {
  if (state.allCustomers.length > 0) return state.allCustomers;
  try {
    const r = await api('customer.list', null, { pageSize: 500, approvalStatus: 'approved' });
    state.allCustomers = r.items || [];
  } catch (e) { state.allCustomers = []; }
  return state.allCustomers;
}

// =============================================================
// PHASE 4B2 - Cache user list dùng chung cho các dropdown assignedTo
// =============================================================
state.allUsers = [];
export async function ensureAllUsers() {
  if (state.allUsers.length > 0) return state.allUsers;
  try {
    // Dùng API user.listForAssign - mọi role gọi được, trả về user cùng phòng (staff/manager) hoặc all (admin/boss)
    const r = await api('user.listForAssign', null, { pageSize: 200 });
    state.allUsers = (r.items || []).filter(u => u.isActive !== 'FALSE' && u.isActive !== false);
  } catch (e) {
    // Fallback: thử user.list (admin/manager/boss được)
    try {
      const r = await api('user.list', null, { pageSize: 200 });
      state.allUsers = (r.items || []).filter(u => u.isActive !== 'FALSE' && u.isActive !== false);
    } catch (e2) { state.allUsers = []; }
  }
  return state.allUsers;
}

/**
 * Populate dropdown assignedTo trong form (cho customer, ticket, opportunity...)
 * - Hiển thị tên + chức danh (role) + phòng ban
 * - Mặc định "Chỉ mình tôi" (giá trị rỗng)
 * - Tự loại trừ user hiện tại (vì mặc định là họ)
 */
export async function populateAssignedToDropdown(selectId, options) {
  options = options || {};
  const sel = document.getElementById(selectId);
  if (!sel) return;
  // Loading state
  const currentValue = sel.value;
  sel.innerHTML = `<option value="">-- ${options.emptyLabel || 'Chỉ mình tôi'} --</option><option disabled>Đang tải...</option>`;
  
  // Load song song users + departments
  await Promise.all([ensureAllUsers(), ensureDepartments()]);
  const users = state.allUsers;
  const me = state.user?.id;
  
  // Build dept name map
  const deptMap = {};
  (state.depts?.items || []).forEach(d => { deptMap[d.id] = d.name || d.code || ''; });
  
  const roleLabel = { admin: 'Quản trị', boss: 'Tổng GĐ', manager: 'Trưởng phòng', staff: 'Nhân viên' };
  
  // Filter & sort: ưu tiên cùng phòng ban với user hiện tại
  const myDeptId = state.user?.departmentId;
  const filtered = users.filter(u => u.id !== me);
  filtered.sort((a, b) => {
    const sameA = a.departmentId === myDeptId ? 0 : 1;
    const sameB = b.departmentId === myDeptId ? 0 : 1;
    if (sameA !== sameB) return sameA - sameB;
    return String(a.fullName || a.username || '').localeCompare(String(b.fullName || b.username || ''));
  });
  
  if (filtered.length === 0) {
    sel.innerHTML = `<option value="">-- ${options.emptyLabel || 'Chỉ mình tôi'} --</option><option disabled>(Không có nhân viên nào để gán)</option>`;
    return;
  }
  
  const optsHtml = filtered.map(u => {
    const dept = u.departmentId ? deptMap[u.departmentId] : '';
    const rl = roleLabel[u.role] || u.role;
    const sub = [rl, dept].filter(Boolean).join(' · ');
    return `<option value="${escapeHtml(u.id)}">${escapeHtml(u.fullName || u.username)}${sub ? ' (' + escapeHtml(sub) + ')' : ''}</option>`;
  }).join('');
  
  sel.innerHTML = `<option value="">-- ${options.emptyLabel || 'Chỉ mình tôi'} --</option>` + optsHtml;
  
  // Restore selected value (khi edit)
  if (currentValue) sel.value = currentValue;
}

/**
 * Đảm bảo state.depts.items có data (dùng để show tên phòng ban trong dropdown user)
 */
export async function ensureDepartments() {
  if (state.depts && state.depts.items && state.depts.items.length > 0) return;
  try {
    const r = await api('department.list');
    if (!state.depts) state.depts = { items: [] };
    state.depts.items = r.items || [];
  } catch (e) { /* ignore */ }
}

// =============================================================
// TAB 2: CUSTOMERS
// =============================================================
export async function checkGlobalDuplicates() {
  try {
    const alertBox = document.getElementById('duplicate-alert');
    if (!alertBox) return;

    const r = await api('customer.list', null, { pageSize: 500 });
    const customers = r.items || [];

    const map = new Map();
    const duplicates = new Set();
    const dupDetails = {};

    customers.forEach(c => {
      if (c.phone) {
        const key = 'phone:' + c.phone;
        if (map.has(key)) {
          const other = map.get(key);
          duplicates.add(c); duplicates.add(other);
          dupDetails[c.id] = (dupDetails[c.id] ? dupDetails[c.id] + ', ' : '') + 'Trùng SĐT';
          dupDetails[other.id] = (dupDetails[other.id] ? dupDetails[other.id] + ', ' : '') + 'Trùng SĐT';
        } else map.set(key, c);
      }
      if (c.taxCode) {
        const key = 'tax:' + c.taxCode;
        if (map.has(key)) {
          const other = map.get(key);
          duplicates.add(c); duplicates.add(other);
          dupDetails[c.id] = (dupDetails[c.id] ? dupDetails[c.id] + ', ' : '') + 'Trùng MST';
          dupDetails[other.id] = (dupDetails[other.id] ? dupDetails[other.id] + ', ' : '') + 'Trùng MST';
        } else map.set(key, c);
      }
      if (c.email) {
        const key = 'email:' + c.email;
        if (map.has(key)) {
          const other = map.get(key);
          duplicates.add(c); duplicates.add(other);
          dupDetails[c.id] = (dupDetails[c.id] ? dupDetails[c.id] + ', ' : '') + 'Trùng Email';
          dupDetails[other.id] = (dupDetails[other.id] ? dupDetails[other.id] + ', ' : '') + 'Trùng Email';
        } else map.set(key, c);
      }
    });

    if (duplicates.size === 0) {
      alertBox.innerHTML = `
        <div class="alert-card empty">
          <div class="alert-title"><i data-lucide="shield-check"></i> Chưa có cảnh báo</div>
          <div class="alert-body">Hệ thống sẽ tự động báo khi phát hiện khách hàng trùng số ĐT, email hoặc MST.</div>
        </div>
      `;
    } else {
      const dupArray = Array.from(duplicates);
      alertBox.innerHTML = `
        <div class="alert-card warning">
          <div class="alert-title"><i data-lucide="alert-triangle"></i> Phát hiện ${dupArray.length} khách hàng có thể trùng lặp</div>
          <div class="alert-body" style="max-height: 250px; overflow-y: auto;">
            <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 13px;">
              ${dupArray.map(c => `
                <li style="margin-bottom: 6px;">
                  <a href="#" onclick="openCustomerDetail('${c.id}'); return false;" style="font-weight: 500;">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</a>
                  <span style="font-size: 11px; color: var(--danger); display: block;">(${dupDetails[c.id]})</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>
      `;
    }
    lucide.createIcons();
  } catch (e) {
    console.error('Lỗi kiểm tra trùng lặp:', e);
  }
}

export async function loadCustomers(page, options = {}) {
  if (page) state.customers.page = page;
  const st = state.customers;
  const tbody = document.getElementById('customers-tbody');
  if (!options.silent) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  }
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.classification) params.classification = st.filters.classification;
    if (st.filters.approvalStatus) params.approvalStatus = st.filters.approvalStatus;
    const r = await api('customer.list', null, params, options); // pass options to avoid fullscreen loader on error/etc
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    renderCustomers();
    state.allCustomers = []; // reset cache khi list thay đổi
    checkGlobalDuplicates();
  } catch (e) {
    if (!options.silent) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    }
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export const CUSTOMERS_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'name', label: 'Tên khách hàng', required: true },
  { key: 'phone', label: 'Điện thoại' },
  { key: 'email', label: 'Email' },
  { key: 'classification', label: 'Phân loại' },
  { key: 'revenue', label: 'Doanh thu' },
  { key: 'debt', label: 'Công nợ' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'actions', label: 'Hành động', required: true }
];

export function renderCustomers() {
  const st = state.customers;
  document.getElementById('customers-count').textContent = `Tổng ${formatNumber(st.total)} khách hàng`;
  const tbody = document.getElementById('customers-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="9" class="empty-state"><i data-lucide="users"></i><p>Chưa có khách hàng nào</p></td></tr>';
    lucide.createIcons();
    return;
  }
  tbody.innerHTML = st.items.map(c => `
    <tr onclick="openCustomerDetail('${c.id}')">
      <td data-col="code">
        ${c.externalCode ? `<strong>${escapeHtml(c.externalCode)}</strong><br>` : ''}
        <span class="code" style="font-size:11px;color:var(--ink-3)">${escapeHtml(c.code||'')}</span>
      </td>
      <td data-col="name">
        <strong>${escapeHtml(c.name||'')}</strong>
        ${visibilityBadge(c.visibility)}
      </td>
      <td data-col="phone">${formatPhone(c.phone)}</td>
      <td data-col="email">${escapeHtml(c.email||'')}</td>
      <td data-col="classification">${classBadge(c.classification)}</td>
      <td data-col="revenue" class="text-right">${formatShortMoney(c.totalRevenue||0)}</td>
      <td data-col="debt" class="text-right" style="color:${c.currentDebt>0?'var(--danger)':'var(--ink-3)'}">${formatShortMoney(c.currentDebt||0)}</td>
      <td data-col="status">${approvalBadge(c.approvalStatus)}</td>
      <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          <button class="row-action-btn" onclick="openCustomerForm('${c.id}')" title="Sửa"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteCustomer('${c.id}')" title="Xoá"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
  syncColumnVisibility('customers', 'customers-table-wrap', CUSTOMERS_COLUMNS);
  renderPagination('customers-pagination', st, 'loadCustomers');
}

let provincesCache = [];

export async function setupProvinceWardDropdowns(selectedProvince, selectedWard) {
  const provinceInput = document.getElementById('customer-province');
  const provinceList = document.getElementById('province-list');
  const wardInput = document.getElementById('customer-ward');
  const wardList = document.getElementById('ward-list');

  if (!provinceInput || !provinceList || !wardInput || !wardList) return;

  // Load provinces cache
  if (provincesCache.length === 0) {
    try {
      const res = await fetch('https://provinces.open-api.vn/api/');
      provincesCache = await res.json();
    } catch (e) {
      console.error('Lỗi tải danh mục Tỉnh/TP:', e);
      provincesCache = [{ code: 1, name: 'Thành phố Hà Nội' }, { code: 79, name: 'Thành phố Hồ Chí Minh' }];
    }
  }

  // Populate datalist Tỉnh/TP
  provinceList.innerHTML = provincesCache.map(p => `<option value="${escapeHtml(p.name)}" data-code="${p.code}"></option>`).join('');

  // Hàm load Xã/Phường
  const loadWards = async (provinceCode, targetWardValue) => {
    wardInput.placeholder = 'Đang tải Xã/Phường...';
    try {
      const res = await fetch(`https://provinces.open-api.vn/api/p/${provinceCode}?depth=3`);
      const data = await res.json();

      const wards = [];
      if (data.districts) {
        data.districts.forEach(d => {
          if (d.wards) {
            d.wards.forEach(w => {
              wards.push(w.name);
            });
          }
        });
      }
      wards.sort((a, b) => a.localeCompare(b));

      wardList.innerHTML = wards.map(w => `<option value="${escapeHtml(w)}"></option>`).join('');
      wardInput.placeholder = 'Chọn hoặc gõ tìm Xã/Phường...';

      if (targetWardValue) {
        wardInput.value = targetWardValue;
      }
    } catch (e) {
      console.error('Lỗi tải danh mục Xã/Phường:', e);
      wardInput.placeholder = 'Lỗi tải dữ liệu';
    }
  };

  // Lắng nghe sự kiện input khi người dùng chọn/nhập Tỉnh/TP
  provinceInput.oninput = async function() {
    const val = provinceInput.value;
    const matched = provincesCache.find(p => p.name === val);

    if (!matched) {
      wardList.innerHTML = '';
      return;
    }

    wardInput.value = ''; // Reset xã phường
    await loadWards(matched.code);
  };

  // Thiết lập giá trị mặc định (khi sửa khách hàng)
  if (selectedProvince) {
    provinceInput.value = selectedProvince;
    const matched = provincesCache.find(p => p.name === selectedProvince);
    if (matched) {
      await loadWards(matched.code, selectedWard);
    }
  } else {
    provinceInput.value = '';
    wardInput.value = '';
    wardList.innerHTML = '';
  }
}

export async function openCustomerForm(id) {

  try {
    const form = document.getElementById('form-customer');
    form.reset();
    state.currentEditing = null;

    await ensureDepartments();

    const visSel = document.getElementById('customer-visibility-select');
    if (visSel) {
      const role = state.user?.role || 'staff';
      const allOptions = [
        { value: 'private', label: 'Riêng tôi (chỉ tôi và người tôi gán)', roles: ['admin','manager','staff','boss'] },
        { value: 'department', label: 'Phòng ban tôi (mọi người trong phòng KD/KT/KTHC đều thấy)', roles: ['admin','manager'] },
        { value: 'public', label: 'Toàn công ty (tất cả nhân viên đều thấy)', roles: ['admin'] },
      ];
      visSel.innerHTML = allOptions
        .filter(o => o.roles.includes(role))
        .map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
        .join('');
      if (role === 'staff') visSel.value = 'private';
      else visSel.value = 'department';
    }

    await populateAssignedToDropdown('customer-assigned-select');

    let defaultProvince = 'Thành phố Hà Nội';
    let defaultWard = '';

    if (id) {
      const c = state.customers.items.find(x => x.id === id);
      if (c) {
        state.currentEditing = c;
        defaultProvince = c.province || '';
        defaultWard = c.district || '';
        Object.keys(c).forEach(k => {
          const inp = form.elements[k];
          if (inp && inp.type !== 'submit') setCustomInputValue(inp, c[k]);
        });
        document.getElementById('drawer-customer-title').textContent = 'Sửa khách hàng';
        document.getElementById('drawer-customer-sub').textContent = c.code || '';
      }
    } else {
      document.getElementById('drawer-customer-title').textContent = 'Thêm khách hàng';
      document.getElementById('drawer-customer-sub').textContent = '';
    }

    await setupProvinceWardDropdowns(defaultProvince, defaultWard);
    openDrawer('drawer-customer');
  } finally {
    hideLoading();
  }
}

document.getElementById('form-customer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  // Convert number fields
  ['ratingStars','creditLimit','purchaseCycle'].forEach(k => { if (data[k] !== '') data[k] = Number(data[k]); });

  try {
    // 💡 NEW FEATURE: Kiểm tra trùng lặp trước khi lưu
    showLoading('Đang kiểm tra dữ liệu...');
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
    }
    const duplicates = await api('customer.findDuplicates', { customerData: data }, {}, { silent: true });
    hideLoading();

    if (duplicates && duplicates.length > 0) {
      let msg = `<p style="margin-bottom:10px;">Phát hiện <strong>${duplicates.length} khách hàng</strong> trên hệ thống có thông tin trùng lặp:</p><ul style="padding-left:20px;margin-bottom:15px;color:var(--danger)">`;
      duplicates.forEach(d => {
         msg += `<li style="margin-bottom:4px;"><b>${escapeHtml(d.code)}</b> - ${escapeHtml(d.name)} <br><small><i>(Lý do: ${escapeHtml(d.duplicateReason)})</i></small></li>`;
      });
      msg += `</ul><p>Bạn có chắc chắn vẫn muốn tiếp tục lưu hồ sơ này không?</p>`;

      const confirm = await confirmDialog({
        title: 'Cảnh báo trùng lặp',
        message: msg,
        type: 'warning',
        okText: 'Vẫn lưu',
        cancelText: 'Hủy, để tôi kiểm tra lại'
      });
      if (!confirm) return; // User cancelled
    }

    if (state.currentEditing) {
      await api('customer.update', data);
      toast('Đã cập nhật khách hàng', 'success');
    } else {
      await api('customer.create', data);
      toast('Đã thêm khách hàng', 'success');
    }
    closeAllDrawers();
    loadCustomers();
  } catch (err) {
    hideLoading();
    toast(err.message, 'error');
  }
});

export async function deleteCustomer(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá khách hàng này? (Có thể khôi phục bởi admin)', type: 'danger' }))) return;
  try {
    await api('customer.delete', { id });
    toast('Đã xoá', 'success');
    loadCustomers();
  } catch (e) { toast(e.message, 'error'); }
}

export async function openCustomerDetail(id) {
  openDrawer('drawer-customer-detail');
  document.getElementById('cd-body').innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>';
  try {
    const r = await api('customer.get', null, { id });
    const c = r.customer;
    document.getElementById('cd-name').textContent = c.name;
    document.getElementById('cd-code').textContent = c.code + ' · ' + (c.industry || 'Chưa phân loại ngành');
    document.getElementById('cd-edit').onclick = () => { closeAllDrawers(); setTimeout(() => openCustomerForm(c.id), 200); };
    document.getElementById('cd-find-duplicates').onclick = () => findDuplicates(c.id);

    // Phase 4A - Nút Duyệt/Từ chối: chỉ hiện khi pending + user là admin/manager
    const approveBtn = document.getElementById('cd-approve');
    const rejectBtn = document.getElementById('cd-reject');
    const canApprove = (state.user?.role === 'admin' || state.user?.role === 'manager') && c.approvalStatus === 'pending';
    if (canApprove) {
      approveBtn.style.display = '';
      rejectBtn.style.display = '';
      approveBtn.onclick = () => approveCustomer(c.id);
      rejectBtn.onclick = () => rejectCustomer(c.id);
    } else {
      approveBtn.style.display = 'none';
      rejectBtn.style.display = 'none';
    }

    const s = r.summary;
    const contactsHtml = r.contacts.length === 0 ? '<p class="text-muted text-sm">Chưa có liên hệ nào</p>' :
      r.contacts.map(ct => `
        <div class="detail-row">
          <div class="label">${escapeHtml(ct.position||'-')}</div>
          <div class="value">${escapeHtml(ct.fullName)} · ${formatPhone(ct.mobile||ct.phone)} ${(ct.isPrimary==='TRUE'||ct.isPrimary===true)?'<span class="badge-pill info" style="margin-left:6px">Chính</span>':''}</div>
        </div>
      `).join('');

    document.getElementById('cd-body').innerHTML = `
      <div class="detail-grid">
        <div>
          <div class="detail-card">
            <h4>Thông tin chính</h4>
            <div class="detail-row"><div class="label">Mã</div><div class="value code">${escapeHtml(c.code)}</div></div>
            <div class="detail-row"><div class="label">Loại</div><div class="value">${c.customerType==='individual'?'Cá nhân':'Doanh nghiệp'}</div></div>
            <div class="detail-row"><div class="label">MST</div><div class="value">${escapeHtml(c.taxCode||'-')}</div></div>
            <div class="detail-row"><div class="label">Điện thoại</div><div class="value">${formatPhone(c.phone)||'-'}</div></div>
            <div class="detail-row"><div class="label">Email</div><div class="value">${escapeHtml(c.email||'-')}</div></div>
            <div class="detail-row"><div class="label">Địa chỉ</div><div class="value">${escapeHtml([c.address,c.district,c.province].filter(Boolean).join(', ')||'-')}</div></div>
            <div class="detail-row"><div class="label">Phân loại</div><div class="value">${classBadge(c.classification)}</div></div>
            <div class="detail-row"><div class="label">Xếp hạng</div><div class="value" style="color:var(--accent)">${'★'.repeat(c.ratingStars||0)}${'☆'.repeat(5-(c.ratingStars||0))}</div></div>
            <div class="detail-row"><div class="label">Trạng thái</div><div class="value">${approvalBadge(c.approvalStatus)}</div></div>
            <div class="detail-row"><div class="label">Nguồn</div><div class="value">${escapeHtml(c.source||'-')}</div></div>
            <div class="detail-row"><div class="label">Người tạo</div><div class="value">${c.creator ? escapeHtml(c.creator.fullName) : '-'}</div></div>
          </div>
        </div>
        <div>
          <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="stat-card"><div class="stat-card-label">Tổng đơn</div><div class="stat-card-value" style="font-size:22px">${formatNumber(s.totalOrders)}</div></div>
            <div class="stat-card accent"><div class="stat-card-label">Doanh thu</div><div class="stat-card-value" style="font-size:20px">${formatShortMoney(s.totalRevenue)}</div></div>
            <div class="stat-card ${s.totalDebt>0?'danger':''}"><div class="stat-card-label">Công nợ</div><div class="stat-card-value" style="font-size:20px">${formatShortMoney(s.totalDebt)}</div></div>
            <div class="stat-card"><div class="stat-card-label">Cơ hội mở</div><div class="stat-card-value" style="font-size:22px">${formatNumber(s.openOpportunities)}</div></div>
          </div>
          <div class="detail-card" style="margin-bottom:16px">
            <h4>Liên hệ (${r.contacts.length})</h4>
            ${contactsHtml}
          </div>
          <div class="detail-card">
            <h4>Ghi chú</h4>
            <div style="font-size:13px;white-space:pre-wrap">${escapeHtml(c.notes||'(Chưa có ghi chú)')}</div>
          </div>
        </div>
      </div>
    `;
    lucide.createIcons();
  } catch (e) {
    document.getElementById('cd-body').innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

export async function findDuplicates(customerId) {
  try {
    const list = await api('customer.findDuplicates', null, { id: customerId });
    if (!list || list.length === 0) { toast('Không phát hiện khách hàng trùng', 'info'); return; }
    const msg = `Phát hiện ${list.length} khách hàng có thể trùng:\n` +
      list.slice(0,5).map(c => `- ${c.code} ${c.name} (${c.duplicateReason || 'Trùng lặp'})`).join('\n');
    await alertDialog({ message: msg });
  } catch (e) { toast(e.message, 'error'); }
}

// Phase 4A - Duyệt/Từ chối khách hàng
export async function approveCustomer(customerId) {
  if (!(await confirmDialog({ title: 'Xác nhận', message: 'Xác nhận DUYỆT khách hàng này?\n\nSau khi duyệt, KH sẽ chính thức vào hệ thống.', type: 'warning' }))) return;
  try {
    await api('customer.update', { id: customerId, approvalStatus: 'approved' });
    toast('Đã duyệt khách hàng', 'success');
    closeAllDrawers();
    loadCustomers();
  } catch (e) { toast(e.message, 'error'); }
}

export async function rejectCustomer(customerId) {
  const reason = await promptDialog({ message: 'Lý do từ chối (tuỳ chọn):' });
  if (reason === null) return; // user cancelled
  if (!(await confirmDialog({ title: 'Xác nhận', message: 'Xác nhận TỪ CHỐI khách hàng này?', type: 'warning' }))) return;
  try {
    const updates = { id: customerId, approvalStatus: 'rejected' };
    if (reason) updates.notes = '[Từ chối] ' + reason;
    await api('customer.update', updates);
    toast('Đã từ chối khách hàng', 'success');
    closeAllDrawers();
    loadCustomers();
  } catch (e) { toast(e.message, 'error'); }
}

// Filter listeners
document.getElementById('customers-search').addEventListener('input', debounce(e => {
  state.customers.search = e.target.value;
  state.customers.page = 1;
  loadCustomers();
}, 400));
document.getElementById('customers-filter-class').addEventListener('change', e => {
  state.customers.filters.classification = e.target.value;
  loadCustomers(1);
});
document.getElementById('customers-filter-approval').addEventListener('change', e => {
  state.customers.filters.approvalStatus = e.target.value;
  loadCustomers(1);
});

export function debounce(fn, ms) {
  let t;
  return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

// =============================================================
// TAB 3: CONTACTS
// =============================================================
export async function loadContacts(page, options = {}) {
  if (page) state.contacts.page = page;
  const st = state.contacts;
  const tbody = document.getElementById('contacts-tbody');
  if (!options.silent) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  }
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.customerId) params.customerId = st.filters.customerId;
    const r = await api('contact.list', null, params, options);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    renderContacts();
    await populateCustomerDropdown('contacts-filter-customer', true);
  } catch (e) {
    if (!options.silent) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    }
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export const CONTACTS_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'name', label: 'Họ tên', required: true },
  { key: 'customer', label: 'Khách hàng' },
  { key: 'position', label: 'Chức vụ' },
  { key: 'phone', label: 'Điện thoại' },
  { key: 'email', label: 'Email' },
  { key: 'isPrimary', label: 'Chính' },
  { key: 'actions', label: 'Hành động', required: true }
];

export function renderContacts() {
  const st = state.contacts;
  document.getElementById('contacts-count').textContent = `Tổng ${formatNumber(st.total)} liên hệ`;
  const tbody = document.getElementById('contacts-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8" class="empty-state"><p>Chưa có liên hệ nào</p></td></tr>';
    return;
  }
  const custMap = {};
  state.allCustomers.forEach(c => { custMap[c.id] = c; });
  tbody.innerHTML = st.items.map(c => {
    const cust = custMap[c.customerId];
    return `
      <tr onclick="openContactForm('${c.id}')">
        <td data-col="code"><span class="code">${escapeHtml(c.code||'')}</span></td>
        <td data-col="name"><strong>${escapeHtml(c.fullName||'')}</strong></td>
        <td data-col="customer">${cust ? escapeHtml(cust.name) : '<span class="text-muted">-</span>'}</td>
        <td data-col="position">${escapeHtml(c.position||'-')}</td>
        <td data-col="phone">${formatPhone(c.mobile||c.phone)||'-'}</td>
        <td data-col="email">${escapeHtml(c.email||'-')}</td>
        <td data-col="isPrimary">${(c.isPrimary==='TRUE'||c.isPrimary===true)?'<span class="badge-pill info">Chính</span>':''}</td>
        <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
          <div class="row-actions">
            <button class="row-action-btn" onclick="openContactForm('${c.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
            <button class="row-action-btn danger" onclick="deleteContact('${c.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('');
  lucide.createIcons();
  syncColumnVisibility('contacts', 'contacts-table-wrap', CONTACTS_COLUMNS);
  renderPagination('contacts-pagination', st, 'loadContacts');
}

export async function populateCustomerDropdown(selectId, includeEmpty) {
  state.allCustomers = []; // Ép tải lại danh sách mới nhất từ server mỗi khi mở form
  await ensureAllCustomers();
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = (includeEmpty ? '<option value="">Tất cả khách hàng</option>' : '<option value="">-- Chọn khách hàng --</option>') +
    state.allCustomers.map(c => `<option value="${c.id}">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</option>`).join('');
  if (current) sel.value = current;
}

export async function openContactForm(id) {

  try {
    await populateCustomerDropdown('contact-customer-select', false);
    const form = document.getElementById('form-contact');
    form.reset();
    state.currentEditing = null;
    if (id) {
      const c = state.contacts.items.find(x => x.id === id);
      if (c) {
        state.currentEditing = c;
        Object.keys(c).forEach(k => {
          const inp = form.elements[k];
          if (inp && inp.type !== 'submit' && inp.type !== 'checkbox') setCustomInputValue(inp, c[k]);
        });
        form.elements.isPrimary.checked = (c.isPrimary === 'TRUE' || c.isPrimary === true);
        document.getElementById('drawer-contact-title').textContent = 'Sửa liên hệ - ' + c.code;
      }
    } else {
      document.getElementById('drawer-contact-title').textContent = 'Thêm liên hệ';
    }
    openDrawer('drawer-contact');
  } finally {
    hideLoading();
  }
}

document.getElementById('form-contact').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  data.isPrimary = e.target.elements.isPrimary.checked ? 'TRUE' : 'FALSE';
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('contact.update', data);
      toast('Đã cập nhật liên hệ', 'success');
    } else {
      await api('contact.create', data);
      toast('Đã thêm liên hệ', 'success');
    }
    closeAllDrawers();
    loadContacts();
  } catch (err) { toast(err.message, 'error'); }
});

export async function deleteContact(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá liên hệ này?', type: 'danger' }))) return;
  try { await api('contact.delete', { id }); toast('Đã xoá', 'success'); loadContacts(); }
  catch (e) { toast(e.message, 'error'); }
}

document.getElementById('contacts-search').addEventListener('input', debounce(e => {
  state.contacts.search = e.target.value; loadContacts(1);
}, 400));
document.getElementById('contacts-filter-customer').addEventListener('change', e => {
  state.contacts.filters.customerId = e.target.value; loadContacts(1);
});

// =============================================================
// TAB 4: ACTIVITIES
// =============================================================
export async function loadActivities(page, options = {}) {
  if (page) state.activities.page = page;
  const st = state.activities;
  const tbody = document.getElementById('activities-tbody');
  if (!options.silent) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state"><div class="spinner dark"></div> Đang tải...</td></tr>';
  }
  try {
    const params = { page: st.page, pageSize: st.pageSize };
    if (st.search) params.search = st.search;
    if (st.filters.type) params.type = st.filters.type;
    if (st.filters.status) params.status = st.filters.status;
    const r = await api('activity.list', null, params, options);
    st.items = r.items || [];
    st.total = r.pagination?.total || 0;
    renderActivities();
  } catch (e) {
    if (!options.silent) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7" class="empty-state">Lỗi: ${escapeHtml(e.message)}</td></tr>`;
    }
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}
export const ACTIVITIES_COLUMNS = [
  { key: 'code', label: 'Mã', required: true },
  { key: 'type', label: 'Loại' },
  { key: 'title', label: 'Tiêu đề', required: true },
  { key: 'time', label: 'Thời gian' },
  { key: 'priority', label: 'Ưu tiên' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'actions', label: 'Hành động', required: true }
];

export function renderActivities() {
  const st = state.activities;
  document.getElementById('activities-count').textContent = `Tổng ${formatNumber(st.total)} hoạt động`;
  const tbody = document.getElementById('activities-tbody');
  if (st.items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7" class="empty-state"><p>Chưa có hoạt động nào</p></td></tr>';
    return;
  }
  const typeLabel = { call:'Cuộc gọi', meeting:'Họp/Demo', task:'Nhiệm vụ', email:'Email', visit:'Thăm khách', sms:'SMS' };
  tbody.innerHTML = st.items.map(a => `
    <tr onclick="openActivityForm('${a.id}')">
      <td data-col="code"><span class="code">${escapeHtml(a.code||'')}</span></td>
      <td data-col="type">${escapeHtml(typeLabel[a.type]||a.type)}</td>
      <td data-col="title"><strong>${escapeHtml(a.title||'')}</strong></td>
      <td data-col="time">${formatDateTimeVN(a.startTime)}</td>
      <td data-col="priority">${priorityBadge(a.priority)}</td>
      <td data-col="status">${activityStatusBadge(a.status)}</td>
      <td data-col="actions" class="col-actions" onclick="event.stopPropagation()">
        <div class="row-actions">
          ${a.status !== 'Hoàn thành' ? `<button class="row-action-btn" onclick="completeActivity('${a.id}')" title="Hoàn thành"><i data-lucide="check" style="width:14px;height:14px"></i></button>` : ''}
          <button class="row-action-btn" onclick="openActivityForm('${a.id}')"><i data-lucide="edit" style="width:14px;height:14px"></i></button>
          <button class="row-action-btn danger" onclick="deleteActivity('${a.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  lucide.createIcons();
  syncColumnVisibility('activities', 'activities-table-wrap', ACTIVITIES_COLUMNS);
  renderPagination('activities-pagination', st, 'loadActivities');
}

export function calculateActivityDuration() {
  const form = document.getElementById('form-activity');
  if (!form) return;
  const startInp = form.elements['startTime'];
  const endInp = form.elements['endTime'];
  const durationInp = form.elements['duration'];

  if (startInp && endInp && durationInp) {
    const sVal = startInp.value;
    const eVal = endInp.value;
    if (sVal && eVal) {
      const sIso = parseDateTimeVN(sVal);
      const eIso = parseDateTimeVN(eVal);
      if (sIso && eIso) {
        const sTime = new Date(sIso).getTime();
        const eTime = new Date(eIso).getTime();
        if (!isNaN(sTime) && !isNaN(eTime)) {
          const diffMins = Math.round((eTime - sTime) / 60000);
          durationInp.value = diffMins >= 0 ? diffMins : 0;
          return;
        }
      }
    }
    durationInp.value = '';
  }
}

export async function openActivityForm(id) {

  try {
    const form = document.getElementById('form-activity');
    form.reset();
    state.currentEditing = null;
    let defaultRelatedType = '';
    let defaultRelatedId = '';

    if (id) {
      const a = state.activities.items.find(x => x.id === id);
      if (a) {
        state.currentEditing = a;
        defaultRelatedType = a.relatedType || '';
        defaultRelatedId = a.relatedId || '';
        Object.keys(a).forEach(k => {
          const inp = form.elements[k];
          if (inp && inp.type !== 'submit') setCustomInputValue(inp, a[k]);
        });
        document.getElementById('drawer-activity-title').textContent = 'Sửa hoạt động - ' + a.code;
      }
    } else {
      document.getElementById('drawer-activity-title').textContent = 'Tạo hoạt động';
    }

    await populateRelatedIdDropdown('activity-related-type', 'activity-related-id', defaultRelatedType, defaultRelatedId);
    calculateActivityDuration();
    openDrawer('drawer-activity');
  } finally {
    hideLoading();
  }
}

// Bắt sự kiện thay đổi ngày giờ để tự động tính thời lượng
(() => {
  const form = document.getElementById('form-activity');
  if (!form) return;
  const startInp = form.elements['startTime'];
  const endInp = form.elements['endTime'];
  if (startInp && endInp) {
    ['input', 'change', 'blur'].forEach(evtName => {
      startInp.addEventListener(evtName, calculateActivityDuration);
      endInp.addEventListener(evtName, calculateActivityDuration);
    });
  }
})();

document.getElementById('form-activity').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = extractFormData(e.target);
  if (data.duration) data.duration = Number(data.duration);
  try {
    if (state.currentEditing) {
      data.id = state.currentEditing.id;
      await api('activity.update', data);
      toast('Đã cập nhật hoạt động', 'success');
    } else {
      await api('activity.create', data);
      toast('Đã tạo hoạt động', 'success');
    }
    closeAllDrawers();
    loadActivities();
  } catch (err) { toast(err.message, 'error'); }
});

export async function completeActivity(id) {
  const result = await promptDialog({ message: 'Kết quả thực hiện (tuỳ chọn):' });
  if (result === null) return;
  try {
    await api('activity.complete', { id, result });
    toast('Đã đánh dấu hoàn thành', 'success');
    loadActivities();
  } catch (e) { toast(e.message, 'error'); }
}
export async function deleteActivity(id) {
  if (!(await confirmDialog({ title: 'Xoá', message: 'Xoá hoạt động này?', type: 'danger' }))) return;
  try { await api('activity.delete', { id }); toast('Đã xoá', 'success'); loadActivities(); }
  catch (e) { toast(e.message, 'error'); }
}

document.getElementById('activities-search').addEventListener('input', debounce(e => {
  state.activities.search = e.target.value; loadActivities(1);
}, 400));
document.getElementById('activities-filter-type').addEventListener('change', e => {
  state.activities.filters.type = e.target.value; loadActivities(1);
});
document.getElementById('activities-filter-status').addEventListener('change', e => {
  state.activities.filters.status = e.target.value; loadActivities(1);
});


// Expose to window for HTML inline event handlers
window.openDrawer = openDrawer;
window.closeAllDrawers = closeAllDrawers;
window.classBadge = classBadge;
window.approvalBadge = approvalBadge;
window.visibilityBadge = visibilityBadge;
window.stageBadge = stageBadge;
window.quoteStatusBadge = quoteStatusBadge;
window.orderStatusBadge = orderStatusBadge;
window.paymentBadge = paymentBadge;
window.activityStatusBadge = activityStatusBadge;
window.priorityBadge = priorityBadge;
window.renderPagination = renderPagination;
window.ensureProducts = ensureProducts;
window.ensureAllCustomers = ensureAllCustomers;
window.ensureAllUsers = ensureAllUsers;
window.populateAssignedToDropdown = populateAssignedToDropdown;
window.ensureDepartments = ensureDepartments;
window.checkGlobalDuplicates = checkGlobalDuplicates;
window.loadCustomers = loadCustomers;
window.renderCustomers = renderCustomers;
window.setupProvinceWardDropdowns = setupProvinceWardDropdowns;
window.openCustomerForm = openCustomerForm;
window.deleteCustomer = deleteCustomer;
window.openCustomerDetail = openCustomerDetail;
window.findDuplicates = findDuplicates;
window.approveCustomer = approveCustomer;
window.rejectCustomer = rejectCustomer;
window.debounce = debounce;
window.loadContacts = loadContacts;
window.renderContacts = renderContacts;
window.populateCustomerDropdown = populateCustomerDropdown;
window.openContactForm = openContactForm;
window.deleteContact = deleteContact;
window.loadActivities = loadActivities;
window.renderActivities = renderActivities;
window.calculateActivityDuration = calculateActivityDuration;
window.openActivityForm = openActivityForm;
window.completeActivity = completeActivity;
window.deleteActivity = deleteActivity;
