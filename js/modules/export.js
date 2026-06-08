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


// Expose to window for HTML inline event handlers
window.exportCustomersExcel = exportCustomersExcel;
window.importCustomersExcel = importCustomersExcel;
window.showImportPreview = showImportPreview;
window.doImportCustomers = doImportCustomers;
