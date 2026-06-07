const fs = require('fs');
const path = require('path');
const PizzaZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { supabase } = require('../config');
const { authenticateRequest } = require('../middlewares/auth');

// Format tiền tệ VND
function formatVND(num) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num || 0).replace('₫', 'đ');
}

// Format ngày dd/mm/yyyy
function formatDateVN(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

async function handleExport(req, res) {
  try {
    const { type, id, format, token } = req.query;

    if (!type || !id || !format || !token) {
      return res.status(400).send('<h1>Thiếu tham số xuất file (type, id, format, token)</h1>');
    }

    // 1. Xác thực người dùng qua token truyền ở query string
    let currentUser;
    try {
      currentUser = await authenticateRequest(token);
    } catch (authErr) {
      return res.status(401).send(`<h1>Xác thực thất bại: ${authErr.message}</h1>`);
    }

    if (format === 'pdf') {
      return res.status(400).send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
          <h2 style="color: #c2410c;">⚠️ Định dạng PDF chưa được hỗ trợ trực tiếp</h2>
          <p style="color: #4b5563;">Trên môi trường Serverless, xuất PDF trực tiếp từ Word bị giới hạn dung lượng cài đặt LibreOffice.</p>
          <p style="font-weight: bold; color: #1e3a8a;">Vui lòng quay lại và chọn nút "Xuất Word" để tải file .docx về máy.</p>
          <button onclick="window.close()" style="padding: 8px 16px; background: #1e3a8a; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 15px;">Đóng tab</button>
        </div>
      `);
    }

    let fileBuffer;
    let outFileName = 'tailieu.docx';

    if (type === 'quote') {
      // 2. Lấy dữ liệu Báo giá
      const { data: quote, error: qErr } = await supabase
        .from('crm_quotes')
        .select('*, customer:crm_customers(*), creator:crm_users!created_by(full_name, phone)')
        .eq('id', id)
        .single();

      if (qErr || !quote) return res.status(404).send('<h1>Không tìm thấy báo giá</h1>');

      // Lấy chi tiết sản phẩm
      const { data: items } = await supabase
        .from('crm_order_items')
        .select('*, product:crm_products(*)')
        .eq('parent_id', id)
        .eq('is_deleted', false);

      // 3. Chọn file template dựa trên quoteType (Bán máy / Thuê máy)
      const isRental = quote.quote_type === 'rental';
      const templateName = isRental ? 'quote_rental_template.docx' : 'quote_sale_template.docx';
      const templatePath = path.resolve(__dirname, '../templates', templateName);

      if (!fs.existsSync(templatePath)) {
        return res.status(400).send(`
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f59e0b; background: #fef3c7; border-radius: 8px; max-width: 600px; margin: 50px auto;">
            <h3 style="color: #b45309; margin-top:0;">⚠️ Chưa cấu hình file mẫu (Template)</h3>
            <p>Không tìm thấy file mẫu Word tại thư mục backend: <code>src/templates/${templateName}</code></p>
            <p><strong>Hướng dẫn cho Admin:</strong> Hãy thiết kế file mẫu Word có chứa các thẻ <code>{...}</code>, lưu tên là <code>${templateName}</code> và bỏ vào thư mục <code>src/templates/</code> trên máy tính, sau đó push code lên GitHub.</p>
          </div>
        `);
      }

      // 4. Đọc template mẫu
      const templateContent = fs.readFileSync(templatePath, 'binary');
      const zip = new PizzaZip(templateContent);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

      // Định dạng ngày tháng
      const today = new Date();
      const dateData = {
        day: String(today.getDate()).padStart(2, '0'),
        month: String(today.getMonth() + 1).padStart(2, '0'),
        year: today.getFullYear(),
        valid_date: formatDateVN(quote.validity_date)
      };

      // Định dạng danh sách hàng hóa
      let stt = 1;
      const formattedItems = (items || []).map(item => ({
        stt: stt++,
        product_code: item.product?.code || '',
        brand_name: item.product?.category || '',
        model_name: item.product?.name || item.notes || '',
        quantities: item.quantity,
        unit_price: formatVND(item.unit_price),
        amount: formatVND(item.amount),
        notes: item.notes || ''
      }));

      // Tổng lượng
      const tong_so_luong = (items || []).reduce((sum, item) => sum + (item.quantity || 0), 0);

      // Điền data vào file template
      doc.render({
        ...dateData,
        code: quote.code,
        customer_name: quote.customer?.name || '',
        customer_address: quote.customer?.address || '',
        customer_phone: quote.customer?.phone || '',
        customer_email: quote.customer?.email || '',
        mst: quote.customer?.tax_code || '',
        total: formatVND(quote.value),
        tong_so_luong: tong_so_luong,
        payment_terms: quote.payment_terms || 'Thanh toán trực tiếp',
        delivery_terms: quote.delivery_terms || 'Giao hàng tận nơi',
        creator_name: quote.creator?.full_name || '',
        creator_phone: quote.creator?.phone || '',
        items: formattedItems
      });

      fileBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
      outFileName = `BaoGia_${quote.code}.docx`;

    } else if (type === 'order') {
      // Lấy dữ liệu Đơn hàng
      const { data: order, error: oErr } = await supabase
        .from('crm_orders')
        .select('*, customer:crm_customers(*)')
        .eq('id', id)
        .single();

      if (oErr || !order) return res.status(404).send('<h1>Không tìm thấy đơn hàng</h1>');

      const { data: items } = await supabase
        .from('crm_order_items')
        .select('*, product:crm_products(*)')
        .eq('parent_id', id)
        .eq('is_deleted', false);

      const templatePath = path.resolve(__dirname, '../templates/order_template.docx');

      if (!fs.existsSync(templatePath)) {
        return res.status(400).send(`
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f59e0b; background: #fef3c7; border-radius: 8px; max-width: 600px; margin: 50px auto;">
            <h3 style="color: #b45309; margin-top:0;">⚠️ Chưa cấu hình file mẫu (Template)</h3>
            <p>Không tìm thấy file mẫu Word tại thư mục backend: <code>src/templates/order_template.docx</code></p>
            <p><strong>Hướng dẫn cho Admin:</strong> Hãy thiết kế file mẫu Word, lưu tên là <code>order_template.docx</code> và bỏ vào thư mục <code>src/templates/</code> trên máy tính, sau đó push code lên GitHub.</p>
          </div>
        `);
      }

      const templateContent = fs.readFileSync(templatePath, 'binary');
      const zip = new PizzaZip(templateContent);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

      const today = new Date();
      const formattedItems = (items || []).map((item, idx) => ({
        stt: idx + 1,
        product_code: item.product?.code || '',
        model_name: item.product?.name || item.notes || '',
        quantities: item.quantity,
        unit_price: formatVND(item.unit_price),
        amount: formatVND(item.amount),
        notes: item.notes || ''
      }));

      doc.render({
        day: String(today.getDate()).padStart(2, '0'),
        month: String(today.getMonth() + 1).padStart(2, '0'),
        year: today.getFullYear(),
        code: order.code,
        customer_name: order.customer?.name || '',
        customer_address: order.customer?.address || '',
        delivery_address: order.delivery_address || order.customer?.address || '',
        total: formatVND(order.total_amount),
        paid_amount: formatVND(order.paid_amount),
        remaining_amount: formatVND(order.total_amount - order.paid_amount),
        due_date: formatDateVN(order.due_date),
        items: formattedItems
      });

      fileBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
      outFileName = `DonHang_${order.code}.docx`;
    } else {
      return res.status(400).send('<h1>Loại xuất file không hợp lệ</h1>');
    }

    // 5. Gửi file trả về trình duyệt tải xuống
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outFileName)}"`);
    res.send(fileBuffer);

  } catch (err) {
    console.error('Lỗi xuất file Word:', err);
    res.status(500).send(`<h1>Lỗi xuất file Word: ${err.message}</h1>`);
  }
}

module.exports = {
  handleExport
};