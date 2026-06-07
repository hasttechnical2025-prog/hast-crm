// supabaseClient.js
// Khởi tạo Supabase client cho backend Vercel.
// Sau khi di trú, các bảng nằm ở public.crm_<tên>. Để KHỎI phải sửa tên bảng
// rải rác trong mọi controller, ta bọc client bằng Proxy: code vẫn gọi
// .from('customers') như cũ, nhưng thực tế chạy vào public.crm_customers.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong môi trường Vercel.');
}

// Client gốc dùng schema public (mặc định) - KHONG con db.schema = 'hast_crm'.
const rawClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------
// Tien to bang + danh sach ten bang "logic" cua CRM.
// Chi nhung ten trong danh sach nay moi duoc them tien to, nen goi
// .from('crm_xxx')... deu khong bi dung toi.
// ---------------------------------------------------------------------
const TABLE_PREFIX = 'crm_';
const CRM_TABLES = new Set([
  'departments', 'users', 'sessions', 'settings', 'audit_log',
  'customers', 'contacts', 'tags', 'products', 'opportunities',
  'quotes', 'orders', 'order_items', 'support_tickets', 'activities',
  'campaigns', 'notes', 'messages', 'workflows', 'notifications',
]);

function physicalName(name) {
  return CRM_TABLES.has(name) ? TABLE_PREFIX + name : name;
}

// Proxy: chi can thiep .from(); moi thu khac (rpc, auth, storage...) giu nguyen.
const supabase = new Proxy(rawClient, {
  get(target, prop) {
    if (prop === 'from') {
      return (name) => target.from(physicalName(name));
    }
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

module.exports = { supabase, TABLE_PREFIX, CRM_TABLES };
