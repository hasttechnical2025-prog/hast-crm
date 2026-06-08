import { state } from './state.js';
import { api } from './api.js';

// TOAST
// ============================================================
export function toast(message, type = 'info', title = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
  const icon = icons[type] || 'info';
  el.innerHTML = `
    <div class="toast-icon"><i data-lucide="${icon}" style="width:18px;height:18px"></i></div>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
  `;
  container.appendChild(el);
  lucide.createIcons();
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// LOADING OVERLAY
// ============================================================
export function showLoading(text = 'Đang tải...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('show');
}
export function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('show');
}

// ============================================================
// CUSTOM CONFIRM / ALERT / PROMPT (thay thế native browser dialogs)
// ============================================================
export function _ensureDialogModal() {
  if (document.getElementById('app-dialog')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="app-dialog">
      <div class="modal app-dialog-modal" style="max-width:440px">
        <div class="modal-header">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="app-dialog-icon" id="app-dialog-icon"></div>
            <h3 id="app-dialog-title" style="margin:0">Xác nhận</h3>
          </div>
        </div>
        <div class="modal-body">
          <div id="app-dialog-message" style="font-size:13.5px;color:var(--ink-2);line-height:1.55"></div>
          <div id="app-dialog-input-wrap" style="margin-top:14px;display:none">
            <input type="text" id="app-dialog-input" style="width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:var(--radius);font-size:13px" />
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" id="app-dialog-cancel">Huỷ</button>
          <button type="button" class="btn btn-primary" id="app-dialog-ok">Đồng ý</button>
        </div>
      </div>
    </div>
  `);
}

export function confirmDialog(opts) {
  _ensureDialogModal();
  opts = opts || {};
  return new Promise(resolve => {
    const modal = document.getElementById('app-dialog');
    const title = document.getElementById('app-dialog-title');
    const message = document.getElementById('app-dialog-message');
    const icon = document.getElementById('app-dialog-icon');
    const okBtn = document.getElementById('app-dialog-ok');
    const cancelBtn = document.getElementById('app-dialog-cancel');
    const inputWrap = document.getElementById('app-dialog-input-wrap');
    
    title.textContent = opts.title || 'Xác nhận';
    message.innerHTML = (opts.message || '').replace(/\n/g, '<br>');
    inputWrap.style.display = 'none';
    
    const type = opts.type || 'info';
    const iconMap = {
      info: '<i data-lucide="help-circle" style="width:24px;height:24px;color:var(--navy-700)"></i>',
      warning: '<i data-lucide="alert-triangle" style="width:24px;height:24px;color:#D97706"></i>',
      danger: '<i data-lucide="alert-octagon" style="width:24px;height:24px;color:var(--danger)"></i>',
      success: '<i data-lucide="check-circle-2" style="width:24px;height:24px;color:var(--success)"></i>',
    };
    icon.innerHTML = iconMap[type] || iconMap.info;
    
    okBtn.textContent = opts.okText || 'Đồng ý';
    okBtn.className = 'btn ' + (type === 'danger' ? 'btn-danger allow-boss' : 'btn-primary');
    cancelBtn.textContent = opts.cancelText || 'Huỷ';
    cancelBtn.style.display = opts.hideCancel ? 'none' : '';
    
    let escHandler;
    const cleanup = (result) => {
      modal.classList.remove('show');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      if (escHandler) document.removeEventListener('keydown', escHandler);
      resolve(result);
    };
    
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    
    modal.classList.add('show');
    lucide.createIcons();
    setTimeout(() => okBtn.focus(), 50);
    
    escHandler = (e) => {
      if (e.key === 'Escape') { cleanup(false); }
      else if (e.key === 'Enter' && document.activeElement !== document.getElementById('app-dialog-input')) { cleanup(true); }
    };
    document.addEventListener('keydown', escHandler);
  });
}

export function alertDialog(opts) {
  if (typeof opts === 'string') opts = { message: opts };
  return confirmDialog(Object.assign({
    title: 'Thông báo',
    okText: 'Đã hiểu',
    hideCancel: true,
  }, opts));
}

export function promptDialog(opts) {
  _ensureDialogModal();
  opts = opts || {};
  return new Promise(resolve => {
    const modal = document.getElementById('app-dialog');
    const title = document.getElementById('app-dialog-title');
    const message = document.getElementById('app-dialog-message');
    const icon = document.getElementById('app-dialog-icon');
    const okBtn = document.getElementById('app-dialog-ok');
    const cancelBtn = document.getElementById('app-dialog-cancel');
    const inputWrap = document.getElementById('app-dialog-input-wrap');
    const input = document.getElementById('app-dialog-input');
    
    title.textContent = opts.title || 'Nhập thông tin';
    message.innerHTML = (opts.message || '').replace(/\n/g, '<br>');
    icon.innerHTML = '<i data-lucide="edit-3" style="width:24px;height:24px;color:var(--navy-700)"></i>';
    
    inputWrap.style.display = '';
    input.type = opts.inputType || 'text';
    input.value = opts.defaultValue || '';
    input.placeholder = opts.placeholder || '';
    
    okBtn.textContent = opts.okText || 'OK';
    okBtn.className = 'btn btn-primary';
    cancelBtn.textContent = opts.cancelText || 'Huỷ';
    cancelBtn.style.display = '';
    
    const cleanup = (result) => {
      modal.classList.remove('show');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
      input.onkeydown = null;
      resolve(result);
    };
    
    okBtn.onclick = () => cleanup(input.value);
    cancelBtn.onclick = () => cleanup(null);
    modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
    
    modal.classList.add('show');
    lucide.createIcons();
    setTimeout(() => { input.focus(); input.select(); }, 50);
    
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cleanup(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    };
  });
}

// ============================================================
// MODAL helpers
// ============================================================
export function openModal(id) {
  document.getElementById(id).classList.add('show');
  lucide.createIcons();
  // Init custom inputs trong modal
  initDateInputs(document.getElementById(id));
}
export function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}
export function openChangePasswordModal() {
  closeModal('modal-user-menu');
  setTimeout(() => openModal('modal-change-password'), 150);
}

// FORMATTING HELPERS
// ============================================================
// ============================================================
// FORMAT HELPERS - dấu chấm phân cách hàng nghìn (VN style)
// ============================================================

/** Thêm dấu chấm phân cách hàng nghìn, ép buộc dùng dấu chấm */
export function formatThousands(n) {
  if (n == null || isNaN(n)) return '0';
  // Tách phần nguyên và phần thập phân
  const num = Number(n);
  const isNeg = num < 0;
  const abs = Math.abs(num);
  const parts = String(abs).split('.');
  // Thêm dấu chấm vào phần nguyên
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // Phần thập phân (nếu có) dùng dấu phẩy
  const result = parts.length > 1 ? parts[0] + ',' + parts[1] : parts[0];
  return (isNeg ? '-' : '') + result;
}

export function formatVND(n) {
  if (n == null || isNaN(n)) return '0 ₫';
  return formatThousands(Math.round(Number(n))) + ' ₫';
}

export function formatNumber(n) {
  if (n == null || isNaN(n)) return '0';
  // Nếu là số nguyên thì không hiện thập phân
  const num = Number(n);
  if (Number.isInteger(num)) return formatThousands(num);
  return formatThousands(num);
}

export function formatShortMoney(n) {
  if (n == null || isNaN(n)) return '0 ₫';
  const v = Math.abs(n);
  if (v >= 1e9) return formatThousands((n / 1e9).toFixed(1).replace(/\.0$/,'').replace('.', ',')) + ' tỷ';
  if (v >= 1e6) return formatThousands((n / 1e6).toFixed(1).replace(/\.0$/,'').replace('.', ',')) + ' tr';
  if (v >= 1e3) return formatThousands(Math.round(n / 1e3)) + 'k';
  return formatThousands(Math.round(n)) + ' ₫';
}

/** Format ngày dd/mm/yyyy */
export function formatDateVN(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Format ngày + giờ dd/mm/yyyy hh:mm */
export function formatDateTimeVN(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/**
 * Format số điện thoại VN
 * - Di động (10 số bắt đầu bằng 0[3-9]): 0xxx-xxx-xxx (4-3-3)
 * - Cố định Hà Nội (024xxxxxxxx, 11 số): (024) xxxx xxxx
 * - Cố định khác (10 số 02xxxxxxxx): (02x) xxx xxxx
 * - Không xác định: format kiểu di động (4-3-3)
 */
export function formatPhone(p) {
  if (!p) return '';
  // Bỏ tất cả ký tự không phải số (giữ dấu + nếu có ở đầu)
  let s = String(p).trim();
  const hasPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return String(p);

  // Quốc tế: +84xxx → đổi về 0
  if (hasPlus && s.startsWith('84')) {
    s = '0' + s.substring(2);
  }

  const len = s.length;

  // Di động: 10 số, bắt đầu 03/05/07/08/09
  if (len === 10 && /^0[35789]/.test(s)) {
    return `${s.substring(0,4)}-${s.substring(4,7)}-${s.substring(7,10)}`;
  }

  // Cố định Hà Nội (024): 11 số tổng (024 + 8 số)
  if (len === 11 && s.startsWith('024')) {
    return `(024) ${s.substring(3,7)} ${s.substring(7,11)}`;
  }
  // Cố định TP.HCM (028): 11 số
  if (len === 11 && s.startsWith('028')) {
    return `(028) ${s.substring(3,7)} ${s.substring(7,11)}`;
  }
  // Cố định khác (10 số): 02x xxx xxxx
  if (len === 10 && /^02/.test(s)) {
    return `(${s.substring(0,3)}) ${s.substring(3,6)} ${s.substring(6,10)}`;
  }
  // 11 số bắt đầu 02 nhưng không phải HN/HCM
  if (len === 11 && /^02/.test(s)) {
    return `(${s.substring(0,3)}) ${s.substring(3,7)} ${s.substring(7,11)}`;
  }

  // Không xác định: format kiểu di động nếu đủ 9-10 số
  if (len === 10) return `${s.substring(0,4)}-${s.substring(4,7)}-${s.substring(7,10)}`;
  if (len === 9)  return `${s.substring(0,3)}-${s.substring(3,6)}-${s.substring(6,9)}`;
  if (len === 11) return `${s.substring(0,4)}-${s.substring(4,8)}-${s.substring(8,11)}`;
  // Quá ngắn / lạ: trả về như cũ
  return String(p);
}

/**
 * Strip non-digits từ số điện thoại đã format → trả về digits-only để lưu DB
 */
export function stripPhone(p) {
  if (!p) return '';
  return String(p).replace(/[^\d]/g, '');
}

/**
 * Parse số tiền có dấu chấm về số nguyên
 * VD: "1.234.567" → 1234567
 */
export function parseMoney(s) {
  if (!s) return 0;
  if (typeof s === 'number') return s;
  // Bỏ tất cả ký tự không phải số, giữ dấu trừ ở đầu
  let str = String(s).trim();
  const isNeg = str.startsWith('-');
  str = str.replace(/[^\d]/g, '');
  if (!str) return 0;
  const n = parseInt(str, 10);
  return isNeg ? -n : n;
}

/**
 * Parse date dd/mm/yyyy thành Date object hoặc ISO string
 */
export function parseDateVN(s) {
  if (!s) return null;
  s = String(s).trim();
  // Đã là ISO format yyyy-mm-dd
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return s.substring(0, 10);
  // dd/mm/yyyy
  const vnMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vnMatch) {
    const dd = vnMatch[1].padStart(2, '0');
    const mm = vnMatch[2].padStart(2, '0');
    const yyyy = vnMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return s; // không match, trả về nguyên trạng
}

/**
 * Parse datetime dd/mm/yyyy hh:mm thành ISO yyyy-mm-ddThh:mm
 */
export function parseDateTimeVN(s) {
  if (!s) return null;
  s = String(s).trim();
  // Tách phần ngày và giờ (nếu có)
  const parts = s.split(/\s+/);
  const datePart = parts[0];
  const timePart = parts[1] || '00:00';
  const datIso = parseDateVN(datePart);
  if (!datIso) return s;
  // Validate giờ
  const tm = timePart.match(/^(\d{1,2}):(\d{1,2})/);
  if (tm) {
    const hh = tm[1].padStart(2, '0');
    const mi = tm[2].padStart(2, '0');
    return `${datIso}T${hh}:${mi}`;
  }
  return `${datIso}T00:00`;
}

/**
 * Init custom date pickers - chuyển tất cả input[data-format="date"] thành ô gõ dd/mm/yyyy
 * - Auto thêm dấu / khi gõ
 * - Validate khi blur
 */
export function initDateInputs(container) {
  const root = container || document;
  root.querySelectorAll('input[data-format="date"]:not([data-init])').forEach(inp => {
    inp.setAttribute('data-init', '1');
    inp.setAttribute('placeholder', 'dd/mm/yyyy');
    inp.setAttribute('maxlength', '10');

    // Format value sẵn có (ISO yyyy-mm-dd → dd/mm/yyyy)
    if (inp.value) {
      const m = String(inp.value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) inp.value = `${m[3]}/${m[2]}/${m[1]}`;
    }

    inp.addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^\d]/g, '');
      let formatted = '';
      if (v.length > 0) formatted = v.substring(0, 2);
      if (v.length >= 3) formatted = v.substring(0, 2) + '/' + v.substring(2, 4);
      if (v.length >= 5) formatted = v.substring(0, 2) + '/' + v.substring(2, 4) + '/' + v.substring(4, 8);
      e.target.value = formatted;
    });

    inp.addEventListener('blur', (e) => {
      const v = e.target.value.trim();
      if (!v) return;
      // Validate
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) {
        e.target.classList.add('input-error');
        return;
      }
      const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yyyy = parseInt(m[3], 10);
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 1900 || yyyy > 2100) {
        e.target.classList.add('input-error');
        return;
      }
      e.target.classList.remove('input-error');
      // Format lại với leading zero
      e.target.value = String(dd).padStart(2,'0') + '/' + String(mm).padStart(2,'0') + '/' + yyyy;
    });
  });

  root.querySelectorAll('input[data-format="datetime"]:not([data-init])').forEach(inp => {
    inp.setAttribute('data-init', '1');
    inp.setAttribute('placeholder', 'dd/mm/yyyy hh:mm');
    inp.setAttribute('maxlength', '16');

    // Format value sẵn có (ISO yyyy-mm-ddThh:mm → dd/mm/yyyy hh:mm)
    if (inp.value) {
      const m = String(inp.value).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      if (m) inp.value = `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
    }

    inp.addEventListener('input', (e) => {
      let v = e.target.value.replace(/[^\d]/g, '');
      let formatted = '';
      if (v.length > 0) formatted = v.substring(0, 2);
      if (v.length >= 3) formatted = v.substring(0, 2) + '/' + v.substring(2, 4);
      if (v.length >= 5) formatted = v.substring(0, 2) + '/' + v.substring(2, 4) + '/' + v.substring(4, 8);
      if (v.length >= 9) formatted += ' ' + v.substring(8, 10);
      if (v.length >= 11) formatted += ':' + v.substring(10, 12);
      e.target.value = formatted;
    });
  });

  // Phone inputs - format khi gõ
  root.querySelectorAll('input[data-format="phone"]:not([data-init])').forEach(inp => {
    inp.setAttribute('data-init', '1');
    // Format value sẵn có
    if (inp.value) {
      const raw = stripPhone(inp.value);
      if (raw) inp.value = formatPhone(raw);
    }
    inp.addEventListener('blur', (e) => {
      const raw = stripPhone(e.target.value);
      if (raw) e.target.value = formatPhone(raw);
    });
    // Khi focus, hiển thị raw digits để dễ sửa
    inp.addEventListener('focus', (e) => {
      e.target.value = stripPhone(e.target.value) || e.target.value;
    });
  });

  // Money inputs - format khi gõ với dấu chấm
  root.querySelectorAll('input[data-format="money"]:not([data-init])').forEach(inp => {
    inp.setAttribute('data-init', '1');
    // Set inputmode để mobile hiện numeric keyboard
    inp.setAttribute('inputmode', 'numeric');
    // Format value sẵn có (nếu là số raw thì format)
    if (inp.value && !inp.value.includes('.') && !inp.value.includes(',')) {
      const n = parseInt(inp.value, 10);
      if (!isNaN(n) && n !== 0) inp.value = formatThousands(n);
      else if (n === 0) inp.value = ''; // 0 → để trống để user dễ nhập
    }
    inp.addEventListener('input', (e) => {
      const cursorPos = e.target.selectionStart;
      const oldLen = e.target.value.length;
      const num = parseMoney(e.target.value);
      e.target.value = num === 0 ? '' : formatThousands(num);
      // Restore cursor position (gần đúng)
      const newLen = e.target.value.length;
      const newCursor = Math.max(0, cursorPos + (newLen - oldLen));
      try { e.target.setSelectionRange(newCursor, newCursor); } catch (err) {}
    });
  });
}

/**
 * Đặt giá trị cho input custom (gọi khi mở form edit)
 */
export function setCustomInputValue(input, value) {
  if (!input || value == null || value === '') {
    if (input) input.value = '';
    return;
  }
  const fmt = input.dataset.format;
  if (fmt === 'date') {
    // Convert ISO yyyy-mm-dd → dd/mm/yyyy
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      input.value = `${m[3]}/${m[2]}/${m[1]}`;
    } else {
      input.value = formatDateVN(value);
    }
  } else if (fmt === 'datetime') {
    input.value = formatDateTimeVN(value);
  } else if (fmt === 'phone') {
    input.value = formatPhone(value);
  } else if (fmt === 'money') {
    input.value = value ? formatThousands(value) : '';
  } else {
    input.value = value;
  }
}

/**
 * Lấy giá trị từ input custom đã được parse về định dạng chuẩn
 */
export function getCustomInputValue(input) {
  if (!input) return '';
  const fmt = input.dataset.format;
  const v = input.value;
  if (fmt === 'date') return parseDateVN(v);
  if (fmt === 'datetime') return parseDateTimeVN(v);
  if (fmt === 'phone') return stripPhone(v);
  if (fmt === 'money') return parseMoney(v);
  return v;
}

/**
 * Wrap form submit: convert custom inputs về định dạng chuẩn trước khi submit
 */
export function extractFormData(form) {
  const data = {};
  Array.from(form.elements).forEach(el => {
    if (!el.name || el.type === 'submit' || el.type === 'button') return;
    if (el.type === 'checkbox') {
      data[el.name] = el.checked ? 'TRUE' : 'FALSE';
    } else if (el.dataset && el.dataset.format) {
      data[el.name] = getCustomInputValue(el);
    } else if (el.tagName === 'SELECT' && el.multiple) {
      data[el.name] = Array.from(el.selectedOptions).map(o => o.value).join(',');
    } else {
      data[el.name] = el.value;
    }
  });
  return data;
}
export function timeAgo(s) {
  if (!s) return '';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (isNaN(diff)) return s;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return Math.floor(diff/60) + ' phút trước';
  if (diff < 86400) return Math.floor(diff/3600) + ' giờ trước';
  if (diff < 86400*7) return Math.floor(diff/86400) + ' ngày trước';
  return formatDateVN(s);
}

// ============================================================
// COLUMN CUSTOMIZER (Tùy chỉnh cột)
// ============================================================
export function initColumnCustomizer(tabName, tableWrapId, dropdownId, containerId, columnsDef) {
  const container = document.getElementById(containerId);
  const dropdown = document.getElementById(dropdownId);
  const tableWrap = document.getElementById(tableWrapId);
  if (!container || !dropdown || !tableWrap) return;

  const storageKey = `hast_crm_cols_${tabName}`;
  let saved = localStorage.getItem(storageKey);
  let visibleCols = saved ? JSON.parse(saved) : columnsDef.map(c => c.key);

  // Áp dụng lớp CSS khởi tạo
  applyColumnClasses(tableWrap, columnsDef, visibleCols);

  // Render các checkbox
  container.innerHTML = columnsDef.map(col => {
    const isChecked = visibleCols.includes(col.key);
    const isRequired = col.required;
    return `
      <label class="col-customizer-item ${isRequired ? 'required' : ''}">
        <input type="checkbox" data-key="${col.key}" ${isChecked ? 'checked' : ''} ${isRequired ? 'disabled' : ''} />
        <span>${escapeHtml(col.label)}</span>
      </label>
    `;
  }).join('');

  // Xử lý sự kiện khi thay đổi checkbox
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      const col = columnsDef.find(c => c.key === key);
      if (col && col.required) {
        cb.checked = true; // Không cho phép tắt cột bắt buộc
        return;
      }

      if (cb.checked) {
        if (!visibleCols.includes(key)) visibleCols.push(key);
      } else {
        visibleCols = visibleCols.filter(k => k !== key);
      }

      localStorage.setItem(storageKey, JSON.stringify(visibleCols));
      applyColumnClasses(tableWrap, columnsDef, visibleCols);
    });
  });
}

function applyColumnClasses(tableWrap, columnsDef, visibleCols) {
  columnsDef.forEach(col => {
    if (col.required) return;
    const hideClass = `hide-col-${col.key}`;
    const isVisible = visibleCols.includes(col.key);
    tableWrap.classList.toggle(hideClass, !isVisible);
  });
}

export function syncColumnVisibility(tabName, tableWrapId, columnsDef) {
  const tableWrap = document.getElementById(tableWrapId);
  if (!tableWrap) return;
  const storageKey = `hast_crm_cols_${tabName}`;
  const saved = localStorage.getItem(storageKey);
  const visibleCols = saved ? JSON.parse(saved) : columnsDef.map(c => c.key);
  applyColumnClasses(tableWrap, columnsDef, visibleCols);
}

// Expose to window for HTML inline event handlers
window.toast = toast;
window.escapeHtml = escapeHtml;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window._ensureDialogModal = _ensureDialogModal;
window.confirmDialog = confirmDialog;
window.alertDialog = alertDialog;
window.promptDialog = promptDialog;
window.openModal = openModal;
window.closeModal = closeModal;
window.openChangePasswordModal = openChangePasswordModal;
window.formatThousands = formatThousands;
window.formatVND = formatVND;
window.formatNumber = formatNumber;
window.formatShortMoney = formatShortMoney;
window.formatDateVN = formatDateVN;
window.formatDateTimeVN = formatDateTimeVN;
window.formatPhone = formatPhone;
window.stripPhone = stripPhone;
window.parseMoney = parseMoney;
window.parseDateVN = parseDateVN;
window.parseDateTimeVN = parseDateTimeVN;
window.initDateInputs = initDateInputs;
window.setCustomInputValue = setCustomInputValue;
window.getCustomInputValue = getCustomInputValue;
window.extractFormData = extractFormData;
window.timeAgo = timeAgo;
window.initColumnCustomizer = initColumnCustomizer;
window.syncColumnVisibility = syncColumnVisibility;
