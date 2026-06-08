import { state, loadSession, clearSession } from './state.js';
import { api } from './api.js';
import {
  toast,
  confirmDialog,
  alertDialog,
  promptDialog,
  showLoading,
  hideLoading,
  openModal,
  closeModal,
  initDateInputs,
  setCustomInputValue,
  getCustomInputValue,
  extractFormData,
  initColumnCustomizer
} from './utils.js';

// Import modules to ensure they register or run
import './modules/dashboard.js';
import './modules/notifications.js';
import { CUSTOMERS_COLUMNS, CONTACTS_COLUMNS, ACTIVITIES_COLUMNS } from './modules/customers.js';
import { OPPS_COLUMNS, QUOTES_COLUMNS, ORDERS_COLUMNS } from './modules/sales.js';
import { TICKETS_COLUMNS } from './modules/tickets.js';
import { CAMPAIGNS_COLUMNS } from './modules/marketing.js';
import './modules/admin.js';
import './modules/kanban.js';
import './modules/export.js';

// ============================================================
// LOGIN
// ============================================================
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit');
  const errorBox = document.getElementById('login-error');
  errorBox.classList.remove('show');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span><span>Đang đăng nhập...</span>';

  try {
    const result = await api('auth.login', { username, password });
    saveSession(result.token, result.user);
    toast('Đăng nhập thành công', 'success', 'Chào mừng ' + result.user.fullName);
    showApp();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.add('show');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Đăng nhập</span>';
  }
});

// ============================================================
// LOGOUT
// ============================================================
document.getElementById('btn-logout').addEventListener('click', async () => {
  try {
    await api('auth.logout');
  } catch (e) {
    // ignore
  }
  if (typeof stopNotificationPolling === 'function') stopNotificationPolling();
  clearSession();
  closeModal('modal-user-menu');
  showLogin();
  toast('Đã đăng xuất', 'info');
});

// ============================================================
// CHANGE PASSWORD
// ============================================================
document.getElementById('form-change-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const oldPassword = fd.get('oldPassword');
  const newPassword = fd.get('newPassword');
  const confirmPassword = fd.get('confirmPassword');

  if (newPassword !== confirmPassword) {
    toast('Mật khẩu xác nhận không khớp', 'error');
    return;
  }

  try {
    await api('auth.changePassword', { oldPassword, newPassword });
    toast('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.', 'success');
    closeModal('modal-change-password');
    setTimeout(() => {
      clearSession();
      showLogin();
    }, 1500);
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ============================================================
// USER MENU
// ============================================================
document.getElementById('btn-user-menu').addEventListener('click', () => {
  if (!state.user) return;
  const u = state.user;
  document.getElementById('menu-avatar').textContent = (u.fullName || 'U').charAt(0).toUpperCase();
  document.getElementById('menu-name').textContent = u.fullName || '-';
  document.getElementById('menu-email').textContent = u.email || '-';
  document.getElementById('menu-position').textContent = u.position || '-';
  openModal('modal-user-menu');
});

// Đóng modal khi click backdrop
document.querySelectorAll('.modal-backdrop').forEach(b => {
  b.addEventListener('click', (e) => {
    if (e.target === b) b.classList.remove('show');
  });
});

// ============================================================
// NAVIGATION (TABS) & AUTO-LOAD
// ============================================================
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === target));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === target));
    state.currentTab = target;

    if (target === 'customers' && state.customers.items.length === 0) window.loadCustomers();
    else if (target === 'contacts' && state.contacts.items.length === 0) window.loadContacts();
    else if (target === 'activities' && state.activities.items.length === 0) window.loadActivities();
    else if (target === 'sales' && state.opps.items.length === 0) window.loadOpps();
    else if (target === 'support' && state.tickets.items.length === 0) window.loadTickets();
    else if (target === 'marketing' && state.campaigns.items.length === 0) window.loadCampaigns();
    else if (target === 'notes' && state.notes.items.length === 0) window.loadNotes();
    else if (target === 'messages' && state.messages.items.length === 0) window.loadMessages();
    else if (target === 'admin' && state.users.items.length === 0) window.loadUsers();
    else if (target === 'workflow') window.loadWorkflows();  // Phase 4B
  });
});

// ============================================================
// QUICK ACTIONS - kết nối vào form
// ============================================================
document.querySelectorAll('.quick-action').forEach(b => {
  // override listener cũ
  b.replaceWith(b.cloneNode(true));
});
document.querySelectorAll('.quick-action').forEach(b => {
  b.addEventListener('click', () => {
    const type = b.dataset.quick;
    switch(type) {
      case 'customer': window.openCustomerForm(); break;
      case 'contact':  window.openContactForm(); break;
      case 'opportunity': window.openOpportunityForm(); break;
      case 'quote': window.openQuoteForm(); break;
      case 'order': window.openOrderForm(); break;
      case 'activity': window.openActivityForm(); break;
    }
  });
});

// ============================================================
// SHOW LOGIN / APP
// ============================================================
function showLogin() {
  document.getElementById('screen-login').style.display = 'grid';
  document.getElementById('screen-app').classList.remove('show');
  document.getElementById('login-username').focus();
}

async function showApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-app').classList.add('show');
  renderUserInfo();
  
  // Phase 4A Fix - Reset UI state mỗi lần login để không thừa hưởng state user trước
  // 1. Luôn về tab Tổng quan
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'dashboard'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === 'dashboard'));
  
  // 2. Sidebar luôn mở ra khi đăng nhập
  const ws = document.querySelector('.workspace');
  ws.classList.remove('sidebar-collapsed');
  localStorage.setItem('hast_sidebar_collapsed', '0');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  if (toggleBtn) {
    toggleBtn.innerHTML = '<i data-lucide="panel-left-close" style="width:18px;height:18px"></i>';
  }
  
  // 3. Đóng tất cả dropdowns/modals nếu còn mở
  closeAllDrawers();
  document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('.notif-dropdown.show, .settings-dropdown.show').forEach(d => d.classList.remove('show'));
  
  // 4. Reset state items của các tab về rỗng để load lại lần đầu tiên
  ['customers','contacts','activities','opps','quotes','orders','tickets','campaigns','notes','messages','users','adminProds'].forEach(k => {
    if (state[k]) {
      state[k].items = [];
      state[k].page = 1;
      state[k].search = '';
      state[k].filters = {};
    }
  });
  state.products = [];
  state.allCustomers = [];
  state.depts = { items: [] };
  state.tags = { items: [] };
  state.settings = {};
  state.appSettings = {};
  
  await loadAppSettings(); // Load logo, VAT, company name từ Settings
  applyRoleVisibility();   // Ẩn nút theo quyền

  // Khởi tạo Custom Columns cho tất cả các tab
  initColumnCustomizer('customers', 'customers-table-wrap', 'col-cust-dropdown', 'col-cust-container', CUSTOMERS_COLUMNS);
  initColumnCustomizer('contacts', 'contacts-table-wrap', 'col-cust-dropdown-contacts', 'col-cust-container-contacts', CONTACTS_COLUMNS);
  initColumnCustomizer('activities', 'activities-table-wrap', 'col-cust-dropdown-activities', 'col-cust-container-activities', ACTIVITIES_COLUMNS);
  initColumnCustomizer('opps', 'opps-table-wrap', 'col-cust-dropdown-opps', 'col-cust-container-opps', OPPS_COLUMNS);
  initColumnCustomizer('quotes', 'quotes-table-wrap', 'col-cust-dropdown-quotes', 'col-cust-container-quotes', QUOTES_COLUMNS);
  initColumnCustomizer('orders', 'orders-table-wrap', 'col-cust-dropdown-orders', 'col-cust-container-orders', ORDERS_COLUMNS);
  initColumnCustomizer('tickets', 'tickets-table-wrap', 'col-cust-dropdown-tickets', 'col-cust-container-tickets', TICKETS_COLUMNS);
  initColumnCustomizer('campaigns', 'campaigns-table-wrap', 'col-cust-dropdown-campaigns', 'col-cust-container-campaigns', CAMPAIGNS_COLUMNS);

  await loadDashboard();
  lucide.createIcons();

  // Phase 4C: Bắt đầu polling notification mỗi 60 giây
  startNotificationPolling();
}

// Bật tắt Custom Column Dropdown cho nhiều bảng
function setupColumnDropdownToggle(btnId, dropdownId) {
  document.getElementById(btnId)?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Đóng tất cả dropdown cột khác trước khi mở
    document.querySelectorAll('.col-customizer-dropdown.show').forEach(d => {
      if (d.id !== dropdownId) d.classList.remove('show');
    });
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) dropdown.classList.toggle('show');
  });
}

setupColumnDropdownToggle('btn-col-cust', 'col-cust-dropdown');
setupColumnDropdownToggle('btn-col-contacts', 'col-cust-dropdown-contacts');
setupColumnDropdownToggle('btn-col-activities', 'col-cust-dropdown-activities');
setupColumnDropdownToggle('btn-col-opps', 'col-cust-dropdown-opps');
setupColumnDropdownToggle('btn-col-quotes', 'col-cust-dropdown-quotes');
setupColumnDropdownToggle('btn-col-orders', 'col-cust-dropdown-orders');
setupColumnDropdownToggle('btn-col-tickets', 'col-cust-dropdown-tickets');
setupColumnDropdownToggle('btn-col-campaigns', 'col-cust-dropdown-campaigns');

// Đóng khi click ngoài (đã có event listener click ngoài ở notifications.js nhưng ta gom thêm vào đây)
document.addEventListener('click', (e) => {
  if (!e.target.closest('.col-customizer-dropdown') && !e.target.closest('[id^="btn-col-"]')) {
    document.querySelectorAll('.col-customizer-dropdown.show').forEach(d => d.classList.remove('show'));
  }
});

// Phase 4C: Polling cho notification badge
let _notifPollInterval = null;
function startNotificationPolling() {
  // Dừng polling cũ nếu có (vd: khi user logout/login lại)
  if (_notifPollInterval) clearInterval(_notifPollInterval);
  // Load lần đầu tiên ngay
  updateNotifBadge();
  // Sau đó cứ 60s 1 lần
  _notifPollInterval = setInterval(() => {
    if (state.user) updateNotifBadge();
  }, 60000);
}
function stopNotificationPolling() {
  if (_notifPollInterval) {
    clearInterval(_notifPollInterval);
    _notifPollInterval = null;
  }
}

/**
 * Load app-wide settings (logo, VAT, company name) từ sheet Settings
 * Áp dụng cho topbar, login screen, default VAT của line items.
 */
async function loadAppSettings() {
  try {
    const settings = await api('setting.list');
    state.appSettings = settings || {};

    // 1. Logo công ty
    const logoUrl = settings['company.logoUrl'];
    if (logoUrl && logoUrl.trim()) {
      const fullUrl = resolveLogoUrl(logoUrl.trim());
      // Topbar
      const topbarLogo = document.getElementById('topbar-logo');
      if (topbarLogo) {
        topbarLogo.innerHTML = `<img src="${escapeHtml(fullUrl)}" alt="Logo" onerror="this.parentElement.innerHTML='H'" />`;
      }
      // Login screen
      document.querySelectorAll('.login-brand-logo').forEach(el => {
        el.innerHTML = `<img src="${escapeHtml(fullUrl)}" alt="Logo" onerror="this.parentElement.innerHTML='H'" />`;
      });
    }

    // 2. Tên công ty
    const companyShortName = settings['company.shortName'] || settings['company.name'];
    if (companyShortName) {
      const el = document.getElementById('topbar-company-name');
      if (el) el.textContent = companyShortName;
    }

    // 3. VAT mặc định
    if (settings['system.defaultVatRate']) {
      state.defaultVat = parseFloat(settings['system.defaultVatRate']);
    } else {
      state.defaultVat = 10;
    }
  } catch (e) {
    console.error('Không tải được settings:', e);
    state.defaultVat = 10;
  }
}

/**
 * Resolve logo URL - hỗ trợ:
 * - URL đầy đủ: https://...
 * - Đường dẫn tương đối: logo.png (cùng folder với index.html trên GitHub Pages)
 * - GitHub raw URL: https://raw.githubusercontent.com/...
 */
function resolveLogoUrl(url) {
  if (!url) return '';
  // URL đầy đủ → giữ nguyên
  if (/^https?:\/\//i.test(url)) return url;
  // Bắt đầu bằng / → absolute path
  if (url.startsWith('/')) return url;
  // Relative path → resolve với current location
  return url;
}

/**
 * Ẩn/hiện các phần UI theo role (#10) - LOGIC ĐẦY ĐỦ
 *
 * Có 2 cơ chế ẩn:
 * 1. data-roles="admin,manager" → element chỉ hiện khi role thuộc list
 * 2. CSS class role-* trên body → ẩn theo bộ rules định sẵn
 */
function applyRoleVisibility() {
  const role = state.user?.role || 'staff';
  const body = document.body;

  // Set role class trên body - CSS sẽ xử lý visibility qua rules ở trên
  body.classList.remove('role-admin', 'role-boss', 'role-manager', 'role-staff');
  body.classList.add('role-' + role);

  // Belt-and-suspenders: cũng set inline style cho data-roles để chắc chắn
  document.querySelectorAll('[data-roles]').forEach(el => {
    const allowed = (el.dataset.roles || '').split(',').map(s => s.trim());
    if (allowed.includes(role)) {
      el.style.removeProperty('display');
    } else {
      el.style.display = 'none';
    }
  });

  // Show admin shortcut trong settings dropdown nếu admin/manager/boss
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = (role === 'admin' || role === 'manager' || role === 'boss') ? '' : 'none';
  });

  // Nếu sub-tab đầu tiên bị ẩn, chuyển active sang sub-tab khác (cho manager)
  setTimeout(() => {
    const activeAdminSub = document.querySelector('.admin-subtab.active');
    if (activeAdminSub) {
      const computed = window.getComputedStyle(activeAdminSub);
      if (computed.display === 'none') {
        const firstVisible = Array.from(document.querySelectorAll('.admin-subtab')).find(t => {
          return window.getComputedStyle(t).display !== 'none';
        });
        if (firstVisible) firstVisible.click();
      }
    }
  }, 50);
}

function renderUserInfo() {
  const u = state.user;
  if (!u) return;
  const initial = (u.fullName || u.username || 'U').charAt(0).toUpperCase();
  const roleLabel = {admin:'Quản trị viên', boss:'Tổng GĐ', manager:'Trưởng phòng', staff:'Nhân viên'}[u.role] || u.role;

  document.getElementById('user-avatar').textContent = initial;
  document.getElementById('user-name').textContent = u.fullName || u.username;
  document.getElementById('user-role').textContent = roleLabel;

  document.getElementById('side-avatar').textContent = initial;
  document.getElementById('side-name').textContent = u.fullName || u.username;
  document.getElementById('side-role').textContent = roleLabel;
  lucide.createIcons();
}

// ============================================================
// EXPORT BÁO GIÁ / ĐƠN HÀNG → WORD/PDF (Phase 3D #4)
// ============================================================

/**
 * Xuất báo giá/đơn hàng ra Word hoặc PDF qua backend Apps Script
 * @param {string} type 'quote' hoặc 'order'
 * @param {string} id ID của báo giá/đơn hàng
 * @param {string} format 'docx' hoặc 'pdf'
 */
async function exportSalesDoc(type, id, format) {
  showLoading(`Đang tạo file ${format.toUpperCase()}...`);
  try {
    const action = type === 'quote' ? 'quote.export' : 'order.export';
    const r = await api(action, { id: id, format: format }, {}, { silent: true });
    hideLoading();
    if (r && r.downloadUrl) {
      showExportResult(r, format);
    } else {
      throw new Error('Backend không trả về URL file');
    }
  } catch (e) {
    hideLoading();
    toast('Lỗi xuất file: ' + e.message, 'error');
  }
}

/**
 * Hiển thị modal kết quả export với link rõ ràng (tránh popup blocker)
 */
function showExportResult(result, format) {
  // Tạo modal nếu chưa có
  let modal = document.getElementById('modal-export-result');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop" id="modal-export-result">
        <div class="modal" style="max-width:560px">
          <div class="modal-header">
            <h3><i data-lucide="file-check" style="width:20px;height:20px;display:inline;vertical-align:middle"></i> File đã được tạo</h3>
            <button class="modal-close" onclick="closeModal('modal-export-result')"><i data-lucide="x" style="width:18px;height:18px"></i></button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom:14px;font-size:13.5px;color:var(--ink-2)">File đã được lưu trên Google Drive. Bấm nút bên dưới để mở/tải về:</p>
            <div id="export-result-info" style="background:var(--paper);padding:14px;border-radius:6px;font-size:13px;margin-bottom:14px"></div>
            <p style="margin-top:14px;padding:10px 12px;background:#FEF3C7;border-radius:6px;font-size:12.5px;color:#92400E">
              <strong>Lưu ý:</strong> Nếu không thấy file mở ra, có thể trình duyệt chặn popup. Hãy bấm trực tiếp nút "Mở file" bên dưới.
            </p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" id="btn-copy-link"><i data-lucide="copy" style="width:14px;height:14px"></i> Sao chép link</button>
            <a id="btn-open-file" target="_blank" rel="noopener" class="btn btn-primary"><i data-lucide="external-link" style="width:14px;height:14px"></i> Mở file</a>
          </div>
        </div>
      </div>
    `);
    lucide.createIcons();
  }
  // Populate info
  document.getElementById('export-result-info').innerHTML = `
    <div style="display:grid;grid-template-columns:90px 1fr;gap:6px">
      <div style="color:var(--ink-3)">Tên file:</div><div><strong>${escapeHtml(result.fileName || 'file')}</strong></div>
      <div style="color:var(--ink-3)">Định dạng:</div><div>${format.toUpperCase()}</div>
      <div style="color:var(--ink-3)">Mã file:</div><div><code style="font-size:11px">${escapeHtml(result.fileId || '')}</code></div>
    </div>
  `;
  document.getElementById('btn-open-file').href = result.downloadUrl;
  document.getElementById('btn-copy-link').onclick = () => {
    navigator.clipboard.writeText(result.downloadUrl).then(() => {
      toast('Đã sao chép link', 'success');
    }).catch(() => {
      // Fallback: prompt user copy thủ công
      promptDialog({ title: 'Sao chép link', message: 'Browser không hỗ trợ clipboard. Hãy bôi đen và Ctrl+C để sao chép link:', defaultValue: result.downloadUrl });
    });
  };
  openModal('modal-export-result');
  // Tự động mở tab mới (browser có thể block)
  try {
    window.open(result.downloadUrl, '_blank');
  } catch (e) { /* ignore */ }
}

// Thêm nút Xuất Word/PDF vào drawer báo giá/đơn hàng
// (sẽ append khi mở drawer ở edit mode)
function addExportButtonsToSalesDoc() {
  if (!state.currentEditing) return; // chỉ có nút này khi đang edit
  const footer = document.querySelector('#drawer-sales-doc .drawer-footer');
  if (!footer) return;
  // Bỏ các nút export cũ nếu có
  footer.querySelectorAll('.export-btn').forEach(b => b.remove());

  const type = state.salesDocMode; // 'quote' hoặc 'order'
  const id = state.currentEditing.id;
  const wordBtn = document.createElement('button');
  wordBtn.type = 'button';
  wordBtn.className = 'btn btn-outline btn-sm export-btn';
  wordBtn.innerHTML = '<i data-lucide="file-text" style="width:14px;height:14px"></i> Xuất Word';
  wordBtn.onclick = () => exportSalesDoc(type, id, 'docx');

  const pdfBtn = document.createElement('button');
  pdfBtn.type = 'button';
  pdfBtn.className = 'btn btn-outline btn-sm export-btn';
  pdfBtn.innerHTML = '<i data-lucide="file-down" style="width:14px;height:14px"></i> Xuất PDF';
  pdfBtn.onclick = () => exportSalesDoc(type, id, 'pdf');

  // Chèn vào đầu footer (trước nút Huỷ)
  footer.insertBefore(pdfBtn, footer.firstChild);
  footer.insertBefore(wordBtn, footer.firstChild);
  lucide.createIcons();
}

// Override openSalesDocForm để thêm export buttons khi edit
const _origOpenSalesDocForm = openSalesDocForm;
window.openSalesDocForm = async function(mode, id) {
  await _origOpenSalesDocForm.call(this, mode, id);
  if (id) setTimeout(addExportButtonsToSalesDoc, 100);
};

// ============================================================
// INIT - kiểm tra session khi tải trang
// ============================================================
(async function init() {
  // Render icons trước
  lucide.createIcons();

  const sess = loadSession();
  if (sess && sess.token) {
    // Verify token còn dùng được không bằng cách gọi auth.me
    try {
      const me = await api('auth.me');
      state.user = me;
      showApp();
      return;
    } catch (e) {
      clearSession();
    }
  }
  showLogin();
})();



// Expose to window for HTML inline event handlers
window.showLogin = showLogin;
window.showApp = showApp;
window.startNotificationPolling = startNotificationPolling;
window.stopNotificationPolling = stopNotificationPolling;
window.loadAppSettings = loadAppSettings;
window.resolveLogoUrl = resolveLogoUrl;
window.applyRoleVisibility = applyRoleVisibility;
window.renderUserInfo = renderUserInfo;
window.exportSalesDoc = exportSalesDoc;
window.showExportResult = showExportResult;
window.addExportButtonsToSalesDoc = addExportButtonsToSalesDoc;
