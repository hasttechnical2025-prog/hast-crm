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

// ============================================================
// =========== PHASE 3D - IMPORT/EXPORT EXCEL & PDF ============
// ============================================================

/**
 * Export danh sách khách hàng ra Excel
 */
export async function exportCustomersExcel() {
  showLoading('Đang xuất Excel...');
  try {
    // Lấy toàn bộ KH (max 500 rows)
    const r = await api('customer.list', null, { pageSize: 500 });
    const items = r.items || [];

    if (items.length === 0) {
      toast('Không có khách hàng để xuất', 'warning');
      return;
    }

    // Convert sang format Excel
    const data = items.map(c => ({
      'Mã KH': c.code || '',
      'Tên khách hàng': c.name || '',
      'Loại': c.customerType === 'individual' ? 'Cá nhân' : 'Doanh nghiệp',
      'MST': c.taxCode || '',
      'Điện thoại': c.phone || '',
      'Email': c.email || '',
      'Website': c.website || '',
      'Địa chỉ': c.address || '',
      'Tỉnh/TP': c.province || '',
      'Quận/Huyện': c.district || '',
      'Ngành nghề': c.industry || '',
      'Phân loại': c.classification || '',
      'Xếp hạng': c.ratingStars || 0,
      'Hạn mức TD': Number(c.creditLimit) || 0,
      'Công nợ': Number(c.currentDebt) || 0,
      'Tổng đơn': Number(c.totalOrders) || 0,
      'Doanh thu': Number(c.totalRevenue) || 0,
      'Nguồn': c.source || '',
      'Trạng thái duyệt': c.approvalStatus === 'approved' ? 'Đã duyệt' : (c.approvalStatus === 'pending' ? 'Chờ duyệt' : 'Từ chối'),
      'Ghi chú': c.notes || '',
      'Ngày tạo': formatDateVN(c.createdAt),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    // Set column widths
    ws['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 24 },
      { wch: 20 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 12 },
      { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 30 }, { wch: 12 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Khách hàng');
    const filename = `KhachHang_HAST_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast(`Đã xuất ${items.length} khách hàng → ${filename}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

/**
 * Import khách hàng từ file Excel.
 * Cho phép preview trước khi nhập.
 */
export async function importCustomersExcel(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  showLoading('Đang đọc file Excel...');
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      toast('File Excel không có dữ liệu', 'warning');
      return;
    }

    // Map các tên cột linh hoạt (cả tiếng Việt và English)
    const colMap = {
      name: ['Tên khách hàng', 'Tên KH', 'Tên', 'name', 'customer_name', 'Tên công ty'],
      customerType: ['Loại', 'customerType', 'type'],
      taxCode: ['MST', 'Mã số thuế', 'taxCode', 'tax_code'],
      phone: ['Điện thoại', 'SĐT', 'phone', 'mobile', 'Số điện thoại'],
      email: ['Email', 'email'],
      website: ['Website', 'website', 'web'],
      address: ['Địa chỉ', 'address'],
      province: ['Tỉnh/TP', 'Tỉnh', 'province'],
      district: ['Quận/Huyện', 'Quận', 'district'],
      industry: ['Ngành nghề', 'Ngành', 'industry'],
      classification: ['Phân loại', 'classification', 'category'],
      source: ['Nguồn', 'source'],
      notes: ['Ghi chú', 'notes', 'note'],
      creditLimit: ['Hạn mức TD', 'Hạn mức tín dụng', 'creditLimit'],
      ratingStars: ['Xếp hạng', 'ratingStars'],
    };

    function findValue(row, fieldKey) {
      const aliases = colMap[fieldKey] || [];
      for (const alias of aliases) {
        if (row[alias] !== undefined && row[alias] !== '') return row[alias];
      }
      return '';
    }

    // Parse rows
    const parsed = rows.map((row, idx) => {
      const customer = {};
      Object.keys(colMap).forEach(field => {
        const v = findValue(row, field);
        if (v !== '') customer[field] = String(v).trim();
      });
      // Chuẩn hóa customerType
      if (customer.customerType) {
        const t = String(customer.customerType).toLowerCase();
        customer.customerType = (t.includes('cá nhân') || t === 'individual') ? 'individual' : 'organization';
      }
      // Normalize classification
      if (customer.classification) {
        const cls = String(customer.classification).toLowerCase();
        if (cls.includes('vip')) customer.classification = 'VIP';
        else if (cls.includes('tiềm')) customer.classification = 'Tiềm năng';
        else if (cls.includes('không')) customer.classification = 'Không hoạt động';
        else customer.classification = 'Thường';
      }
      return { rowIdx: idx + 2, data: customer, valid: !!customer.name };
    });

    const validCount = parsed.filter(p => p.valid).length;
    const invalidCount = parsed.length - validCount;

    hideLoading();

    // Hiện modal preview
    showImportPreview(parsed, validCount, invalidCount);
  } catch (e) {
    hideLoading();
    toast('Lỗi đọc file: ' + e.message, 'error');
  } finally {
    inputEl.value = ''; // reset để có thể chọn lại file
  }
}

export function showImportPreview(parsed, validCount, invalidCount) {
  const modalEl = document.getElementById('modal-import-preview');
  if (!modalEl) {
    // Tạo modal nếu chưa có
    const html = `
      <div class="modal-backdrop" id="modal-import-preview">
        <div class="modal" style="max-width:880px">
          <div class="modal-header">
            <h3 id="import-preview-title">Xem trước Import</h3>
            <button class="modal-close" onclick="closeModal('modal-import-preview')"><i data-lucide="x" style="width:18px;height:18px"></i></button>
          </div>
          <div class="modal-body" style="max-height:60vh;overflow:auto">
            <div id="import-preview-body"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" onclick="closeModal('modal-import-preview')">Huỷ</button>
            <button type="button" class="btn btn-primary" id="btn-import-confirm"><i data-lucide="upload" style="width:14px;height:14px"></i> Xác nhận nhập</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  document.getElementById('import-preview-title').textContent = `Xem trước: ${validCount} hợp lệ, ${invalidCount} bỏ qua`;
  const body = document.getElementById('import-preview-body');

  // Hiển thị bảng preview 10 dòng đầu
  const preview = parsed.slice(0, 10);
  body.innerHTML = `
    <p style="margin-bottom:12px;font-size:13px;color:var(--ink-2)">
      Tìm thấy <strong>${parsed.length}</strong> dòng trong file Excel. Sau khi nhập, <strong>${validCount}</strong> khách hàng sẽ được tạo.
    </p>
    <div style="overflow-x:auto;border:1px solid var(--line);border-radius:6px">
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>#</th><th>Tên</th><th>SĐT</th><th>Email</th><th>Phân loại</th><th>Hợp lệ</th>
          </tr>
        </thead>
        <tbody>
          ${preview.map(p => `
            <tr>
              <td>${p.rowIdx}</td>
              <td>${escapeHtml(p.data.name||'(thiếu)')}</td>
              <td>${formatPhone(p.data.phone)||'-'}</td>
              <td>${escapeHtml(p.data.email||'-')}</td>
              <td>${escapeHtml(p.data.classification||'-')}</td>
              <td>${p.valid?'<span class="badge-pill success">OK</span>':'<span class="badge-pill danger">Thiếu tên</span>'}</td>
            </tr>
          `).join('')}
          ${parsed.length > 10 ? `<tr><td colspan="6" style="text-align:center;color:var(--ink-3)">... và ${parsed.length-10} dòng nữa</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('btn-import-confirm').onclick = () => doImportCustomers(parsed.filter(p => p.valid));
  openModal('modal-import-preview');
}

export async function doImportCustomers(validItems) {
  if (validItems.length === 0) {
    toast('Không có dòng hợp lệ để nhập', 'warning');
    return;
  }
  closeModal('modal-import-preview');
  showLoading(`Đang nhập ${validItems.length} khách hàng...`);

  let success = 0, failed = 0;
  for (let i = 0; i < validItems.length; i++) {
    try {
      document.getElementById('loading-text').textContent = `Đang nhập ${i+1}/${validItems.length}...`;
      await api('customer.create', validItems[i].data, {}, { silent: true });
      success++;
    } catch (e) {
      failed++;
      console.error(`Row ${validItems[i].rowIdx}: ${e.message}`);
    }
  }
  hideLoading();
  toast(`Đã nhập ${success} khách hàng (${failed} lỗi)`, success > 0 ? 'success' : 'error');
  loadCustomers();
}

/**
 * Export danh sách sản phẩm ra Excel
 */
export async function exportProductsExcel() {
  showLoading('Đang xuất Excel...');
  try {
    const r = await api('product.list', null, { pageSize: 1000 });
    const items = r.items || [];

    if (items.length === 0) {
      toast('Không có sản phẩm để xuất', 'warning');
      return;
    }

    const data = items.map(p => ({
      'Mã SP': p.code || '',
      'Tên sản phẩm': p.name || '',
      'Hãng/Thương hiệu': p.brand || '',
      'Danh mục/Loại': p.category || '',
      'ĐVT': p.unit || '',
      'Giá niêm yết (VND)': Number(p.listPrice) || 0,
      'Giá vốn (VND)': Number(p.costPrice) || 0,
      'Tồn kho': Number(p.stockQty) || 0,
      'Đang bán': p.isActive === 'TRUE' || p.isActive === true ? 'Có' : 'Không',
      'Cho thuê': p.isForRent === 'TRUE' || p.isForRent === true ? 'Có' : 'Không',
      'Giá thuê/Tháng': Number(p.rentPricePerMonth) || 0,
      'Dịch vụ CPC': p.isForCPC === 'TRUE' || p.isForCPC === true ? 'Có' : 'Không',
      'CPC Trắng Đen': Number(p.cpcBlackWhite) || 0,
      'CPC Màu': Number(p.cpcColor) || 0,
      'Mô tả': p.description || '',
      'Mã ngoài': p.externalCode || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 16 },
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 12 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sản phẩm');
    const filename = `SanPham_HAST_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast(`Đã xuất ${items.length} sản phẩm → ${filename}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

/**
 * Import sản phẩm từ file Excel
 */
export async function importProductsExcel(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  showLoading('Đang đọc file Excel...');
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      toast('File Excel không có dữ liệu', 'warning');
      return;
    }

    const colMap = {
      name: ['Tên sản phẩm', 'Tên SP', 'Tên', 'name', 'product_name'],
      brand: ['Hãng/Thương hiệu', 'Hãng', 'Thương hiệu', 'brand'],
      category: ['Danh mục/Loại', 'Danh mục', 'Loại', 'category', 'category_name'],
      unit: ['ĐVT', 'Đơn vị tính', 'Đơn vị', 'unit'],
      listPrice: ['Giá niêm yết (VND)', 'Giá niêm yết', 'Giá bán', 'listPrice', 'price'],
      costPrice: ['Giá vốn (VND)', 'Giá vốn', 'costPrice'],
      stockQty: ['Tồn kho', 'Số lượng', 'stockQty', 'qty'],
      isActive: ['Đang bán', 'isActive', 'active'],
      isForRent: ['Cho thuê', 'isForRent'],
      rentPricePerMonth: ['Giá thuê/Tháng', 'Giá thuê', 'rentPrice'],
      isForCPC: ['Dịch vụ CPC', 'isForCPC', 'cpc'],
      cpcBlackWhite: ['CPC Trắng Đen', 'cpcBlackWhite'],
      cpcColor: ['CPC Màu', 'cpcColor'],
      description: ['Mô tả', 'description'],
      externalCode: ['Mã ngoài', 'externalCode', 'external_code']
    };

    function findValue(row, fieldKey) {
      const aliases = colMap[fieldKey] || [];
      for (const alias of aliases) {
        if (row[alias] !== undefined && row[alias] !== '') return row[alias];
      }
      return '';
    }

    const parsed = rows.map((row, idx) => {
      const product = {};
      Object.keys(colMap).forEach(field => {
        const v = findValue(row, field);
        if (v !== '') product[field] = String(v).trim();
      });

      // Map Yes/No thành TRUE/FALSE
      ['isActive', 'isForRent', 'isForCPC'].forEach(k => {
        if (product[k]) {
          const val = String(product[k]).toLowerCase();
          if (val === 'có' || val === 'yes' || val === 'true' || val === '1') product[k] = 'TRUE';
          else product[k] = 'FALSE';
        } else {
          product[k] = 'FALSE';
        }
      });

      // Parse numbers
      ['listPrice', 'costPrice', 'stockQty', 'rentPricePerMonth', 'cpcBlackWhite', 'cpcColor'].forEach(k => {
        product[k] = Number(product[k]) || 0;
      });

      const hasName = !!product.name;
      return {
        rowIdx: idx + 2,
        valid: hasName,
        error: hasName ? '' : 'Thiếu Tên sản phẩm',
        data: product
      };
    });

    showProductsImportPreview(parsed);
  } catch (e) {
    toast('Lỗi đọc file Excel: ' + e.message, 'error');
  } finally {
    hideLoading();
    inputEl.value = ''; // Reset input file
  }
}

function showProductsImportPreview(parsed) {
  const container = document.getElementById('import-preview-container');
  if (!container) return;

  const validCount = parsed.filter(p => p.valid).length;
  const invalidCount = parsed.length - validCount;

  container.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px">
      Phát hiện <strong>${parsed.length}</strong> dòng:
      <span style="color:var(--success)">${validCount} hợp lệ</span>,
      <span style="color:var(--danger)">${invalidCount} lỗi</span>.
    </div>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:4px">
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Dòng</th>
            <th>Tên sản phẩm</th>
            <th>Loại</th>
            <th>Đơn giá</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${parsed.slice(0, 10).map(p => `
            <tr style="${p.valid ? '' : 'background:#FEE2E2'}">
              <td>${p.rowIdx}</td>
              <td><strong>${escapeHtml(p.data.name || '-')}</strong></td>
              <td>${escapeHtml(p.data.category || '-')}</td>
              <td>${formatVND(p.data.listPrice)}</td>
              <td>${p.valid ? '<span style="color:var(--success)">✓ OK</span>' : `<span style="color:var(--danger)">${p.error}</span>`}</td>
            </tr>
          `).join('')}
          ${parsed.length > 10 ? `<tr><td colspan="5" style="text-align:center;color:var(--ink-3)">... và ${parsed.length-10} dòng nữa</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-import-confirm').onclick = () => doImportProducts(parsed.filter(p => p.valid));
  openModal('modal-import-preview');
}

export async function doImportProducts(validItems) {
  if (validItems.length === 0) {
    toast('Không có dòng hợp lệ để nhập', 'warning');
    return;
  }
  closeModal('modal-import-preview');
  showLoading(`Đang nhập ${validItems.length} sản phẩm...`);

  let success = 0, failed = 0;
  for (let i = 0; i < validItems.length; i++) {
    try {
      document.getElementById('loading-text').textContent = `Đang nhập ${i+1}/${validItems.length}...`;
      await api('product.create', validItems[i].data, {}, { silent: true });
      success++;
    } catch (e) {
      failed++;
      console.error(`Row ${validItems[i].rowIdx}: ${e.message}`);
    }
  }
  hideLoading();
  toast(`Đã nhập ${success} sản phẩm (${failed} lỗi)`, success > 0 ? 'success' : 'error');
  state.products = []; // clear cache global

  // Reload danh sách sản phẩm trong trang quản trị nếu tab đang hiển thị
  const activeTab = document.querySelector('.admin-subtab.active')?.dataset.subtab;
  if (activeTab === 'products') {
    const { loadAdminProducts } = await import('./admin.js');
    loadAdminProducts();
  }
}

/**
 * Export danh sách người dùng ra Excel
 */
export async function exportUsersExcel() {
  showLoading('Đang xuất Excel...');
  try {
    const r = await api('user.list', null, { pageSize: 500 });
    const items = r.items || [];

    if (items.length === 0) {
      toast('Không có người dùng để xuất', 'warning');
      return;
    }

    // Load phòng ban để map ID sang Tên phòng ban
    const { ensureDepartments } = await import('./customers.js');
    await ensureDepartments();
    const deptMap = {};
    (state.depts?.items || []).forEach(d => { deptMap[d.id] = d.name; });

    const data = items.map(u => ({
      'Username': u.username || '',
      'Họ và tên': u.fullName || '',
      'Email': u.email || '',
      'Điện thoại': u.phone || '',
      'Vai trò': u.role === 'admin' ? 'Quản trị viên' : (u.role === 'boss' ? 'Tổng GĐ' : (u.role === 'manager' ? 'Trưởng phòng' : 'Nhân viên')),
      'Phòng ban': deptMap[u.departmentId] || '',
      'Chức vụ': u.position || '',
      'Trạng thái': u.status === 'active' ? 'Hoạt động' : 'Vô hiệu'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 16 }, { wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 20 },
      { wch: 16 }, { wch: 12 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Người dùng');
    const filename = `NguoiDung_HAST_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast(`Đã xuất ${items.length} người dùng → ${filename}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

/**
 * Import người dùng từ file Excel
 */
export async function importUsersExcel(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  showLoading('Đang đọc file Excel...');
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      toast('File Excel không có dữ liệu', 'warning');
      return;
    }

    // Load depts để map tên phòng ban sang ID
    const { ensureDepartments } = await import('./customers.js');
    await ensureDepartments();
    const deptMap = {};
    (state.depts?.items || []).forEach(d => {
      deptMap[String(d.name).toLowerCase().trim()] = d.id;
      deptMap[String(d.code).toLowerCase().trim()] = d.id;
    });

    const colMap = {
      username: ['Username', 'Tên đăng nhập', 'Tên tài khoản', 'username', 'user'],
      fullName: ['Họ và tên', 'Họ tên', 'Tên', 'fullName', 'full_name'],
      email: ['Email', 'email'],
      phone: ['Điện thoại', 'SĐT', 'phone', 'mobile'],
      role: ['Vai trò', 'role', 'Chức vụ/Vai trò'],
      departmentName: ['Phòng ban', 'Phòng', 'Bộ phận', 'department'],
      position: ['Chức vụ', 'position', 'Vị trí'],
      status: ['Trạng thái', 'status', 'Tình trạng'],
      password: ['Mật khẩu', 'Password', 'password']
    };

    function findValue(row, fieldKey) {
      const aliases = colMap[fieldKey] || [];
      for (const alias of aliases) {
        if (row[alias] !== undefined && row[alias] !== '') return row[alias];
      }
      return '';
    }

    const parsed = rows.map((row, idx) => {
      const user = {};
      Object.keys(colMap).forEach(field => {
        const v = findValue(row, field);
        if (v !== '') user[field] = String(v).trim();
      });

      // Map vai trò sang value
      if (user.role) {
        const r = String(user.role).toLowerCase();
        if (r.includes('quản') || r.includes('admin')) user.role = 'admin';
        else if (r.includes('tổng') || r.includes('giám') || r.includes('boss')) user.role = 'boss';
        else if (r.includes('trưởng') || r.includes('manager')) user.role = 'manager';
        else user.role = 'staff';
      } else {
        user.role = 'staff';
      }

      // Map phòng ban sang ID
      if (user.departmentName) {
        const deptKey = String(user.departmentName).toLowerCase().trim();
        user.departmentId = deptMap[deptKey] || null;
      }
      delete user.departmentName;

      // Map trạng thái
      if (user.status) {
        const s = String(user.status).toLowerCase();
        if (s.includes('hoạt') || s.includes('active') || s.includes('đang')) user.status = 'active';
        else user.status = 'inactive';
      } else {
        user.status = 'active';
      }

      // Mật khẩu mặc định nếu thiếu
      if (!user.password) {
        user.password = 'User@2026';
      }

      const hasUsername = !!user.username;
      const hasFullName = !!user.fullName;
      const isValid = hasUsername && hasFullName;
      return {
        rowIdx: idx + 2,
        valid: isValid,
        error: !hasUsername ? 'Thiếu Username' : (!hasFullName ? 'Thiếu Họ tên' : ''),
        data: user
      };
    });

    showUsersImportPreview(parsed);
  } catch (e) {
    toast('Lỗi đọc file Excel: ' + e.message, 'error');
  } finally {
    hideLoading();
    inputEl.value = '';
  }
}

function showUsersImportPreview(parsed) {
  const container = document.getElementById('import-preview-container');
  if (!container) return;

  const validCount = parsed.filter(u => u.valid).length;
  const invalidCount = parsed.length - validCount;

  container.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px">
      Phát hiện <strong>${parsed.length}</strong> dòng người dùng:
      <span style="color:var(--success)">${validCount} hợp lệ</span>,
      <span style="color:var(--danger)">${invalidCount} lỗi</span>.
    </div>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:4px">
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Dòng</th>
            <th>Username</th>
            <th>Họ và tên</th>
            <th>Vai trò</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${parsed.slice(0, 10).map(u => `
            <tr style="${u.valid ? '' : 'background:#FEE2E2'}">
              <td>${u.rowIdx}</td>
              <td><strong>${escapeHtml(u.data.username || '-')}</strong></td>
              <td>${escapeHtml(u.data.fullName || '-')}</td>
              <td>${escapeHtml(u.data.role || '-')}</td>
              <td>${u.valid ? '<span style="color:var(--success)">✓ OK</span>' : `<span style="color:var(--danger)">${u.error}</span>`}</td>
            </tr>
          `).join('')}
          ${parsed.length > 10 ? `<tr><td colspan="5" style="text-align:center;color:var(--ink-3)">... và ${parsed.length-10} dòng nữa</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-import-confirm').onclick = () => doImportUsers(parsed.filter(u => u.valid));
  openModal('modal-import-preview');
}

export async function doImportUsers(validItems) {
  if (validItems.length === 0) {
    toast('Không có dòng hợp lệ để nhập', 'warning');
    return;
  }
  closeModal('modal-import-preview');
  showLoading(`Đang nhập ${validItems.length} người dùng...`);

  let success = 0, failed = 0;
  for (let i = 0; i < validItems.length; i++) {
    try {
      document.getElementById('loading-text').textContent = `Đang nhập ${i+1}/${validItems.length}...`;
      await api('user.create', validItems[i].data, {}, { silent: true });
      success++;
    } catch (e) {
      failed++;
      console.error(`Row ${validItems[i].rowIdx}: ${e.message}`);
    }
  }
  hideLoading();
  toast(`Đã nhập ${success} người dùng (${failed} lỗi)`, success > 0 ? 'success' : 'error');

  const activeTab = document.querySelector('.admin-subtab.active')?.dataset.subtab;
  if (activeTab === 'users') {
    const { loadUsers } = await import('./admin.js');
    loadUsers();
  }
}

/**
 * Export danh sách phòng ban ra Excel
 */
export async function exportDepartmentsExcel() {
  showLoading('Đang xuất Excel...');
  try {
    const r = await api('department.list', null, { pageSize: 100 });
    const items = r.items || [];

    if (items.length === 0) {
      toast('Không có phòng ban để xuất', 'warning');
      return;
    }

    const data = items.map(d => ({
      'Mã phòng ban': d.code || '',
      'Tên phòng ban': d.name || '',
      'Mô tả': d.description || '',
      'Trạng thái': d.isActive === 'TRUE' || d.isActive === true ? 'Hoạt động' : 'Vô hiệu'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 16 }, { wch: 24 }, { wch: 36 }, { wch: 14 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Phòng ban');
    const filename = `PhongBan_HAST_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast(`Đã xuất ${items.length} phòng ban → ${filename}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    hideLoading();
  }
}

/**
 * Import phòng ban từ file Excel
 */
export async function importDepartmentsExcel(inputEl) {
  const file = inputEl.files[0];
  if (!file) return;

  showLoading('Đang đọc file Excel...');
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      toast('File Excel không có dữ liệu', 'warning');
      return;
    }

    const colMap = {
      code: ['Mã phòng ban', 'Mã', 'Mã PB', 'code'],
      name: ['Tên phòng ban', 'Tên phòng', 'Tên PB', 'name'],
      description: ['Mô tả', 'description', 'Mô tả chi tiết'],
      isActive: ['Trạng thái', 'isActive', 'active']
    };

    function findValue(row, fieldKey) {
      const aliases = colMap[fieldKey] || [];
      for (const alias of aliases) {
        if (row[alias] !== undefined && row[alias] !== '') return row[alias];
      }
      return '';
    }

    const parsed = rows.map((row, idx) => {
      const dept = {};
      Object.keys(colMap).forEach(field => {
        const v = findValue(row, field);
        if (v !== '') dept[field] = String(v).trim();
      });

      // Map isActive
      if (dept.isActive) {
        const s = String(dept.isActive).toLowerCase();
        if (s.includes('hoạt') || s.includes('active') || s.includes('đang') || s === 'có' || s === 'yes' || s === 'true') dept.isActive = 'TRUE';
        else dept.isActive = 'FALSE';
      } else {
        dept.isActive = 'TRUE';
      }

      const hasCode = !!dept.code;
      const hasName = !!dept.name;
      const isValid = hasCode && hasName;
      return {
        rowIdx: idx + 2,
        valid: isValid,
        error: !hasCode ? 'Thiếu Mã phòng ban' : (!hasName ? 'Thiếu Tên phòng ban' : ''),
        data: dept
      };
    });

    showDepartmentsImportPreview(parsed);
  } catch (e) {
    toast('Lỗi đọc file Excel: ' + e.message, 'error');
  } finally {
    hideLoading();
    inputEl.value = '';
  }
}

function showDepartmentsImportPreview(parsed) {
  const container = document.getElementById('import-preview-container');
  if (!container) return;

  const validCount = parsed.filter(d => d.valid).length;
  const invalidCount = parsed.length - validCount;

  container.innerHTML = `
    <div style="margin-bottom:12px;font-size:13px">
      Phát hiện <strong>${parsed.length}</strong> dòng phòng ban:
      <span style="color:var(--success)">${validCount} hợp lệ</span>,
      <span style="color:var(--danger)">${invalidCount} lỗi</span>.
    </div>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--line);border-radius:4px">
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Dòng</th>
            <th>Mã</th>
            <th>Tên phòng ban</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${parsed.slice(0, 10).map(d => `
            <tr style="${d.valid ? '' : 'background:#FEE2E2'}">
              <td>${d.rowIdx}</td>
              <td><strong>${escapeHtml(d.data.code || '-')}</strong></td>
              <td>${escapeHtml(d.data.name || '-')}</td>
              <td>${d.valid ? '<span style="color:var(--success)">✓ OK</span>' : `<span style="color:var(--danger)">${d.error}</span>`}</td>
            </tr>
          `).join('')}
          ${parsed.length > 10 ? `<tr><td colspan="4" style="text-align:center;color:var(--ink-3)">... và ${parsed.length-10} dòng nữa</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-import-confirm').onclick = () => doImportDepartments(parsed.filter(d => d.valid));
  openModal('modal-import-preview');
}

export async function doImportDepartments(validItems) {
  if (validItems.length === 0) {
    toast('Không có dòng hợp lệ để nhập', 'warning');
    return;
  }
  closeModal('modal-import-preview');
  showLoading(`Đang nhập ${validItems.length} phòng ban...`);

  let success = 0, failed = 0;
  for (let i = 0; i < validItems.length; i++) {
    try {
      document.getElementById('loading-text').textContent = `Đang nhập ${i+1}/${validItems.length}...`;
      await api('department.create', validItems[i].data, {}, { silent: true });
      success++;
    } catch (e) {
      failed++;
      console.error(`Row ${validItems[i].rowIdx}: ${e.message}`);
    }
  }
  hideLoading();
  toast(`Đã nhập ${success} phòng ban (${failed} lỗi)`, success > 0 ? 'success' : 'error');

  const activeTab = document.querySelector('.admin-subtab.active')?.dataset.subtab;
  if (activeTab === 'departments') {
    const { loadDepartments } = await import('./admin.js');
    loadDepartments();
  }
}


// Expose to window for HTML inline event handlers
window.exportCustomersExcel = exportCustomersExcel;
window.importCustomersExcel = importCustomersExcel;
window.showImportPreview = showImportPreview;
window.doImportCustomers = doImportCustomers;
window.exportProductsExcel = exportProductsExcel;
window.importProductsExcel = importProductsExcel;
window.showProductsImportPreview = showProductsImportPreview;
window.doImportProducts = doImportProducts;
window.exportUsersExcel = exportUsersExcel;
window.importUsersExcel = importUsersExcel;
window.exportDepartmentsExcel = exportDepartmentsExcel;
window.importDepartmentsExcel = importDepartmentsExcel;
