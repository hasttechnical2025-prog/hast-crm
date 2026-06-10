const { supabase, CONSTANTS } = require('../config');
const { snakeToCamel, camelToSnake } = require('../utils/helpers');
const { generateSalt, hashPassword } = require('../utils/crypto');

// =====================================
// PERMISSION FILTER BUILDER FOR SQL
// =====================================
async function applyPermissionFilter(query, user, hasDeptField = true, hasAssignedField = true, tableName = null) {
  // Notifications filter by user_id
  if (tableName === 'crm_notifications') {
    if (user.role === 'admin' || user.role === 'boss') return { q: query };
    return { q: query.eq('user_id', user.id) };
  }

  // Khách hàng filter theo visibility
  if (tableName === 'crm_customers') {
    if (user.role === 'admin' || user.role === 'boss') return { q: query };

    let parts = [`created_by.eq.${user.id}`];

    if (hasAssignedField) {
      parts.push(`assigned_to.eq.${user.id}`);
    }

    // Công ty
    parts.push(`visibility.eq.public`);

    // Phòng ban
    if (user.department_id) {
      // Tìm các user cùng phòng ban
      const { data: deptUsers } = await supabase
        .from('crm_users')
        .select('id')
        .eq('department_id', user.department_id)
        .eq('is_deleted', false);

      if (deptUsers && deptUsers.length > 0) {
        const userIds = deptUsers.map(u => u.id);

        if (user.role === 'manager') {
          // Trưởng phòng nhìn thấy TOÀN BỘ KH của phòng (tạo bởi hoặc gán cho người trong phòng)
          parts.push(`created_by.in.(${userIds.join(',')})`);
          if (hasAssignedField) {
            parts.push(`assigned_to.in.(${userIds.join(',')})`);
          }
        } else if (user.role === 'staff') {
          // Nhân viên chỉ nhìn thấy KH của phòng nếu visibility = department
          parts.push(`and(visibility.eq.department,created_by.in.(${userIds.join(',')}))`);
        }
      }
    }

    return { q: query.or(parts.join(',')) };
  }

  // Khóa chặn liên hệ (Contact) - Phải theo tệp khách hàng được phép xem
  if (tableName === 'crm_contacts') {
    if (user.role === 'admin' || user.role === 'boss') return { q: query };

    // Đệ quy lấy truy vấn cho danh sách KH được phép xem
    const customerQuery = supabase.from('crm_customers').select('id').eq('is_deleted', false);
    const filterResult = await applyPermissionFilter(customerQuery, user, true, true, 'crm_customers');
    const { data: allowedCustomers } = await filterResult.q;
    const allowedCustomerIds = (allowedCustomers || []).map(c => c.id);

    if (allowedCustomerIds.length === 0) {
      // Nếu không xem được khách nào, cũng không xem được liên hệ nào
      return { q: query.eq('id', '00000000-0000-0000-0000-000000000000') };
    }

    // Nhân viên chỉ được xem Liên hệ mà (thuộc khách hàng được xem) HOẶC (do chính họ tạo)
    return { q: query.or(`customer_id.in.(${allowedCustomerIds.join(',')}),created_by.eq.${user.id}`) };
  }

  // Nếu bảng không có cả 2 trường này (VD: products, tags), ai cũng được xem tất cả
  if (!hasDeptField && !hasAssignedField) {
    return { q: query };
  }

  if (user.role === 'admin' || user.role === 'boss') {
    return { q: query }; // Không lọc, xem toàn bộ
  }

  if (user.role === 'manager') {
    let filterString = '';
    if (hasDeptField && user.department_id) {
      filterString += `department_id.eq.${user.department_id}`;
    }
    if (hasAssignedField) {
      if (filterString) filterString += ',';
      filterString += `assigned_to.eq.${user.id}`;
    }
    if (filterString) {
      return { q: query.or(filterString) };
    }
    return { q: query };
  }

  // staff: Chỉ xem bản ghi được giao cho mình HOẶC do mình tạo
  let filterParts = [`created_by.eq.${user.id}`];
  if (hasAssignedField) {
    filterParts.push(`assigned_to.eq.${user.id}`);
  }
  return { q: query.or(filterParts.join(',')) };
}

// =====================================
// GENERIC CRUD CONTROLLERS
// =====================================

async function crudList(tableName, user, params) {
  const page = parseInt(params.page, 10) || 1;
  const pageSize = parseInt(params.pageSize, 10) || 20;
  const sortBy = params.sortBy ? params.sortBy.replace(/([A-Z])/g, "_$1").toLowerCase() : 'created_at';
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';
  const search = params.search ? String(params.search).trim() : '';

  let selectQuery = '*';
  const hasAssignedCol = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities', 'crm_customers'].includes(tableName);
  const hasCreatedByCol = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities', 'crm_customers', 'crm_contacts', 'crm_notes', 'crm_messages'].includes(tableName);

  if (hasAssignedCol && hasCreatedByCol) {
    selectQuery = '*, creator:crm_users!created_by(id, full_name), assignee:crm_users!assigned_to(id, full_name)';
  } else if (hasCreatedByCol) {
    selectQuery = '*, creator:crm_users!created_by(id, full_name)';
  }

  let query = supabase
    .from(tableName)
    .select(selectQuery, { count: 'exact' })
    .eq('is_deleted', false);

  const hasDeptField = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities'].includes(tableName);
  const hasAssignedField = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities', 'crm_customers'].includes(tableName);

  const filterResult = await applyPermissionFilter(query, user, hasDeptField, hasAssignedField, tableName);
  query = filterResult.q;

  // Áp dụng tìm kiếm
  if (search) {
    let searchFields = ['code', 'name'];
    if (tableName === 'crm_users') searchFields = ['username', 'full_name', 'email', 'phone'];
    else if (tableName === 'crm_customers') searchFields = ['code', 'name', 'phone', 'email'];
    else if (tableName === 'crm_opportunities' || tableName === 'crm_quotes' || tableName === 'crm_orders') searchFields = ['code', 'title'];

    const orCondition = searchFields.map(field => `${field}.ilike.%${search}%`).join(',');
    query = query.or(orCondition);
  }

  // Áp dụng các bộ lọc bổ sung
  for (const [key, val] of Object.entries(params || {})) {
    if (val === undefined || val === null || val === '') continue;
    if (['page', 'pageSize', 'sortBy', 'sortOrder', 'search'].includes(key)) continue;

    const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();

    if (snakeKey === 'tag_id') {
      query = query.like('tags', `%${val}%`);
    } else {
      query = query.eq(snakeKey, val);
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  query = query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return {
    items: snakeToCamel(data),
    pagination: {
      page: page,
      pageSize: pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize)
    }
  };
}

async function crudGet(tableName, user, id) {
  if (!id) {
    const error = new Error('BAD_REQUEST: Thiếu id bản ghi');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  let selectQuery = '*';
  const hasAssignedCol = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities', 'crm_customers'].includes(tableName);
  const hasCreatedByCol = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities', 'crm_customers', 'crm_contacts', 'crm_notes', 'crm_messages'].includes(tableName);

  if (hasAssignedCol && hasCreatedByCol) {
    selectQuery = '*, creator:crm_users!created_by(id, full_name), assignee:crm_users!assigned_to(id, full_name)';
  } else if (hasCreatedByCol) {
    selectQuery = '*, creator:crm_users!created_by(id, full_name)';
  }

  const { data, error } = await supabase
    .from(tableName)
    .select(selectQuery)
    .eq('id', id)
    .eq('is_deleted', false)
    .single();

  if (error || !data) {
    const err = new Error('NOT_FOUND: Không tìm thấy bản ghi');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Phân quyền chi tiết cho bản ghi đơn lẻ
  if (user.role !== 'admin' && user.role !== 'boss') {
    if (tableName === 'crm_notifications') {
      if (data.user_id !== user.id) {
        const err = new Error('FORBIDDEN: Bạn không có quyền truy cập thông báo này');
        err.code = 'FORBIDDEN';
        throw err;
      }
    } else if (tableName === 'crm_customers') {
      const isCreator = data.created_by === user.id;
      const isAssigned = data.assigned_to === user.id;
      const isPublic = data.visibility === 'public';

      // Lấy thông tin phòng ban của người tạo từ crm_users
      let creatorDeptId = null;
      if (data.created_by) {
        const { data: creator } = await supabase
          .from('crm_users')
          .select('department_id')
          .eq('id', data.created_by)
          .single();
        if (creator) {
          creatorDeptId = creator.department_id;
        }
      }

      const isSameDept = creatorDeptId === user.department_id;
      const isDeptVisible = data.visibility === 'department' && isSameDept;

      let hasImplicitAccess = false;
      if (!isCreator && !isAssigned && !isPublic) {
        let implicitAssignedFilter = `assigned_to.eq.${user.id}`;

        // Nếu là manager, kiểm tra xem có ai trong phòng ban được gán không
        if (user.role === 'manager' && user.department_id) {
          const { data: deptUsers } = await supabase.from('crm_users').select('id').eq('department_id', user.department_id).eq('is_deleted', false);
          if (deptUsers && deptUsers.length > 0) {
            const userIds = deptUsers.map(u => u.id);
            implicitAssignedFilter = `assigned_to.in.(${userIds.join(',')})`;
          }
        }

        // Cấp quyền đọc ẩn (Implicit Access) nếu có Ticket hoặc Activity thuộc KH này được gán (theo filter trên)
        const { count: tCount } = await supabase.from('crm_support_tickets').select('id', { count: 'exact', head: true }).eq('customer_id', data.id).or(implicitAssignedFilter).eq('is_deleted', false);
        if (tCount && tCount > 0) hasImplicitAccess = true;
        else {
          const { count: aCount } = await supabase.from('crm_activities').select('id', { count: 'exact', head: true }).eq('customer_id', data.id).or(implicitAssignedFilter).eq('is_deleted', false);
          if (aCount && aCount > 0) hasImplicitAccess = true;
        }
      }

      if (user.role === 'manager') {
        if (!isCreator && !isAssigned && !isPublic && !isSameDept && !hasImplicitAccess) {
          const err = new Error('FORBIDDEN: Bạn không có quyền truy cập khách hàng này');
          err.code = 'FORBIDDEN';
          throw err;
        }
      } else if (user.role === 'staff') {
        if (!isCreator && !isAssigned && !isPublic && !isDeptVisible && !hasImplicitAccess) {
          const err = new Error('FORBIDDEN: Bạn không có quyền truy cập khách hàng này');
          err.code = 'FORBIDDEN';
          throw err;
        }
      }
    } else {
      const hasDeptField = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities'].includes(tableName);
      const hasAssignedField = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_support_tickets', 'crm_activities', 'crm_customers'].includes(tableName);

      if (!hasDeptField && !hasAssignedField) {
        // Không lọc
      } else {
        if (user.role === 'manager') {
          const matchDept = !hasDeptField || data.department_id === user.department_id;
          const matchAssigned = !hasAssignedField || data.assigned_to === user.id;
          if (!matchDept && !matchAssigned) {
            const err = new Error('FORBIDDEN: Bạn không có quyền truy cập bản ghi này');
            err.code = 'FORBIDDEN';
            throw err;
          }
        } else { // staff
          const matchCreated = data.created_by === user.id;
          const matchAssigned = hasAssignedField && data.assigned_to === user.id;
          if (!matchCreated && !matchAssigned) {
            const err = new Error('FORBIDDEN: Bạn không có quyền truy cập bản ghi này');
            err.code = 'FORBIDDEN';
            throw err;
          }
        }
      }
    }
  }

  return snakeToCamel(data);
}

async function generateCode(tableName) {
  const prefix = CONSTANTS.CODE_PREFIXES[tableName];
  if (!prefix) return null;

  const year = new Date().getFullYear();
  const codePattern = `${prefix}${year}-`;

  const { data, error } = await supabase
    .from(tableName)
    .select('code')
    .like('code', `${codePattern}%`)
    .order('code', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Error generating code for ${tableName}:`, error);
    return null;
  }

  let maxSeq = 0;
  if (data && data.code) {
    const seqStr = data.code.substring(codePattern.length);
    const seq = parseInt(seqStr, 10);
    if (!isNaN(seq)) {
      maxSeq = seq;
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `${codePattern}${nextSeq}`;
}

function sanitizePayload(snakePayload) {
  if (!snakePayload || typeof snakePayload !== 'object') return snakePayload;
  const sanitized = {};
  for (const key of Object.keys(snakePayload)) {
    if (snakePayload[key] === '') {
      sanitized[key] = null;
    } else {
      sanitized[key] = snakePayload[key];
    }
  }
  return sanitized;
}

async function crudCreate(tableName, user, payload) {
  let snakePayload = camelToSnake(payload);
  snakePayload = sanitizePayload(snakePayload);

  // Extract items to prevent Supabase 'column does not exist' error
  const items = snakePayload.items;
  delete snakePayload.items;

  // Tự động tính toán tổng tiền trên backend cho báo giá và đơn hàng
  if (['crm_quotes', 'crm_orders'].includes(tableName) && items && items.length > 0) {
    let subtotal = 0;
    let discountAmount = 0;
    let vatAmount = 0;

    items.forEach(item => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      const dp = Number(item.discount_percent) || 0;
      const vp = Number(item.vat_rate) || 0;

      const gross = qty * price;
      const d = gross * dp / 100;
      const afterD = gross - d;
      const v = afterD * vp / 100;

      subtotal += gross;
      discountAmount += d;
      vatAmount += v;
    });

    const shippingFee = Number(snakePayload.shipping_fee) || 0;
    const totalAmount = subtotal - discountAmount + vatAmount + (tableName === 'crm_orders' ? shippingFee : 0);

    snakePayload.subtotal = subtotal;
    snakePayload.discount_amount = discountAmount;
    snakePayload.vat_amount = vatAmount;
    snakePayload.total_amount = totalAmount;

    if (tableName === 'crm_quotes') {
      snakePayload.value = totalAmount;
    } else if (tableName === 'crm_orders') {
      const paidAmount = Number(snakePayload.paid_amount) || 0;
      snakePayload.remaining_amount = totalAmount - paidAmount;
    }
  }

  if (!snakePayload.id) {
    snakePayload.id = require('crypto').randomUUID();
  }

  if (!snakePayload.code && CONSTANTS.CODE_PREFIXES[tableName]) {
    snakePayload.code = await generateCode(tableName);
  }

  // Tự sinh title cho báo giá / đơn hàng nếu thiếu
  if (['crm_quotes', 'crm_orders'].includes(tableName) && !snakePayload.title) {
    let customerName = 'Khách hàng';
    if (snakePayload.customer_id) {
      try {
        const { data: c } = await supabase.from('crm_customers').select('name').eq('id', snakePayload.customer_id).single();
        if (c && c.name) customerName = c.name;
      } catch (e) {}
    }
    const tLabel = tableName === 'crm_quotes' ? 'Báo giá' : 'Đơn hàng';
    snakePayload.title = `${tLabel} cho ${customerName}`;
  }

  // Tự gán các giá trị mặc định cho những bảng thích hợp (chỉ trừ support tickets, workflows, notifications để trống)
  const hasAssignedCol = ['crm_opportunities', 'crm_quotes', 'crm_orders', 'crm_activities'].includes(tableName);
  const hasDeptCol = ['crm_opportunities', 'crm_quotes', 'crm_orders'].includes(tableName);

  if (hasAssignedCol && !snakePayload.assigned_to) {
    snakePayload.assigned_to = user.id;
  }
  if (hasDeptCol && !snakePayload.department_id) {
    snakePayload.department_id = user.department_id;
  }

  snakePayload.created_at = new Date().toISOString();
  snakePayload.created_by = user.id;
  snakePayload.updated_at = new Date().toISOString();
  snakePayload.updated_by = user.id;
  snakePayload.is_deleted = false;

  const { data, error } = await supabase
    .from(tableName)
    .insert(snakePayload)
    .select()
    .single();

  if (error) throw error;

  // Insert line items for quotes and orders
  if (['crm_quotes', 'crm_orders'].includes(tableName) && items && items.length > 0) {
    const formattedItems = items.map(item => ({
      id: require('crypto').randomUUID(),
      parent_type: tableName === 'crm_quotes' ? 'quote' : 'order',
      parent_id: data.id,
      product_id: item.product_id,
      quantity: Number(item.quantity) || 1,
      unit: item.unit || '',
      unit_price: Number(item.unit_price) || 0,
      discount_percent: Number(item.discount_percent) || 0,
      vat_rate: Number(item.vat_rate) || 10,
      amount: Number(item.quantity * item.unit_price * (1 - (item.discount_percent || 0)/100) * (1 + (item.vat_rate || 10)/100)) || 0,
      notes: item.notes || '',
      created_by: user.id,
      updated_by: user.id
    }));
    const { error: itemErr } = await supabase.from('crm_order_items').insert(formattedItems);
    if (itemErr) throw itemErr;
  }

  // Kanban v2: KHÔNG auto-sinh thẻ kanban từ Order/Ticket. Thẻ Kanban là entity độc lập.

  return snakeToCamel(data);
}

async function crudUpdate(tableName, user, id, payload) {
  if (!id) {
    const error = new Error('BAD_REQUEST: Thiếu id bản ghi để cập nhật');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  // Kiểm tra quyền và lấy dữ liệu hiện tại
  const existingData = await crudGet(tableName, user, id);

  let snakePayload = camelToSnake(payload);
  snakePayload = sanitizePayload(snakePayload);

  // Smart Re-approval: Tự động bắt duyệt lại nếu thay đổi thông tin pháp lý quan trọng của Khách hàng
  if (tableName === 'crm_customers') {
    if (existingData.approvalStatus === 'approved') {
      const nameChanged = snakePayload.name && snakePayload.name !== existingData.name;
      const taxCodeChanged = snakePayload.tax_code !== undefined && snakePayload.tax_code !== existingData.taxCode;

      if (nameChanged || taxCodeChanged) {
        snakePayload.approval_status = 'pending';
        snakePayload.approval_reason = '[Hệ thống] Tự động yêu cầu duyệt lại do sửa đổi thông tin quan trọng (Tên / MST).';
      }
    }
  }

  // Extract items to prevent Supabase 'column does not exist' error
  const items = snakePayload.items;
  delete snakePayload.items;

  // Tự động tính toán tổng tiền trên backend cho báo giá và đơn hàng khi sửa
  if (['crm_quotes', 'crm_orders'].includes(tableName) && items && items.length > 0) {
    let subtotal = 0;
    let discountAmount = 0;
    let vatAmount = 0;

    items.forEach(item => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unit_price) || 0;
      const dp = Number(item.discount_percent) || 0;
      const vp = Number(item.vat_rate) || 0;

      const gross = qty * price;
      const d = gross * dp / 100;
      const afterD = gross - d;
      const v = afterD * vp / 100;

      subtotal += gross;
      discountAmount += d;
      vatAmount += v;
    });

    // Cần lấy phí vận chuyển hiện tại hoặc mới
    const shippingFee = snakePayload.shipping_fee !== undefined ? Number(snakePayload.shipping_fee) : Number(existingData.shippingFee || 0);
    const totalAmount = subtotal - discountAmount + vatAmount + (tableName === 'crm_orders' ? shippingFee : 0);

    snakePayload.subtotal = subtotal;
    snakePayload.discount_amount = discountAmount;
    snakePayload.vat_amount = vatAmount;
    snakePayload.total_amount = totalAmount;

    if (tableName === 'crm_quotes') {
      snakePayload.value = totalAmount;
    } else if (tableName === 'crm_orders') {
      const paidAmount = snakePayload.paid_amount !== undefined ? Number(snakePayload.paid_amount) : Number(existingData.paidAmount || 0);
      snakePayload.remaining_amount = totalAmount - paidAmount;
    }
  }

  delete snakePayload.id;
  delete snakePayload.created_by;
  delete snakePayload.created_at;

  snakePayload.updated_at = new Date().toISOString();
  snakePayload.updated_by = user.id;

  const { data, error } = await supabase
    .from(tableName)
    .update(snakePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Update line items for quotes and orders
  if (['crm_quotes', 'crm_orders'].includes(tableName) && items !== undefined) {
    // Xoá mềm (soft delete) các mặt hàng cũ
    await supabase.from('crm_order_items').update({ is_deleted: true, updated_by: user.id }).eq('parent_id', id);

    // Thêm các mặt hàng mới
    if (items && items.length > 0) {
      const formattedItems = items.map(item => ({
        id: require('crypto').randomUUID(),
        parent_type: tableName === 'crm_quotes' ? 'quote' : 'order',
        parent_id: id,
        product_id: item.product_id,
        quantity: Number(item.quantity) || 1,
        unit: item.unit || '',
        unit_price: Number(item.unit_price) || 0,
        discount_percent: Number(item.discount_percent) || 0,
        vat_rate: Number(item.vat_rate) || 10,
        amount: Number(item.quantity * item.unit_price * (1 - (item.discount_percent || 0)/100) * (1 + (item.vat_rate || 10)/100)) || 0,
        notes: item.notes || '',
        created_by: user.id,
        updated_by: user.id
      }));
      const { error: itemErr } = await supabase.from('crm_order_items').insert(formattedItems);
      if (itemErr) throw itemErr;
    }
  }

  // Kanban v2: KHÔNG auto-sinh thẻ kanban từ Order/Ticket khi update.

  return snakeToCamel(data);
}

async function crudDelete(tableName, user, id) {
  if (!id) {
    const error = new Error('BAD_REQUEST: Thiếu id bản ghi để xóa');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  await crudGet(tableName, user, id);

  const { data, error } = await supabase
    .from(tableName)
    .update({
      is_deleted: true,
      updated_at: new Date().toISOString(),
      updated_by: user.id
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return true;
}

async function settingList(user) {
  const { data, error } = await supabase.from('crm_settings').select('*');
  if (error) throw error;

  const obj = {};
  if (data) {
    data.forEach(r => {
      obj[r.key] = r.value;
    });
  }
  return obj;
}

async function settingUpdate(user, key, value) {
  if (!key) {
    const error = new Error('BAD_REQUEST: Thiếu key cấu hình');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (user.role !== 'admin') {
    const error = new Error('FORBIDDEN: Chỉ admin mới được sửa cấu hình');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const { data, error } = await supabase
    .from('crm_settings')
    .upsert({ key, value })
    .select()
    .single();

  if (error) throw error;
  return true;
}

async function userCreate(currentUser, payload) {
  if (currentUser.role !== 'admin') {
    const error = new Error('FORBIDDEN: Chỉ admin mới có quyền tạo người dùng');
    error.code = 'FORBIDDEN';
    throw error;
  }

  let snakePayload = camelToSnake(payload);
  snakePayload = sanitizePayload(snakePayload);

  if (!snakePayload.username || !payload.password) {
    throw new Error('BAD_REQUEST: Thiếu username hoặc password');
  }

  const salt = generateSalt();
  const hash = hashPassword(payload.password, salt);

  delete snakePayload.password;

  snakePayload.id = require('crypto').randomUUID();
  snakePayload.salt = salt;
  snakePayload.password_hash = hash;
  snakePayload.status = payload.status || 'active';
  snakePayload.created_at = new Date().toISOString();
  snakePayload.created_by = currentUser.id;
  snakePayload.updated_at = new Date().toISOString();
  snakePayload.updated_by = currentUser.id;
  snakePayload.is_deleted = false;

  const { data, error } = await supabase
    .from('crm_users')
    .insert(snakePayload)
    .select()
    .single();

  if (error) throw error;

  const camelData = snakeToCamel(data);
  delete camelData.passwordHash;
  delete camelData.salt;
  return camelData;
}

async function userUpdate(currentUser, id, payload) {
  if (currentUser.role !== 'admin') {
    const error = new Error('FORBIDDEN: Chỉ admin mới có quyền cập nhật người dùng');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const safePayload = { ...payload };
  delete safePayload.password;
  delete safePayload.passwordHash;
  delete safePayload.salt;
  delete safePayload.username;

  const result = await crudUpdate('crm_users', currentUser, id, safePayload);
  delete result.passwordHash;
  delete result.salt;
  return result;
}

async function customerGet(currentUser, id) {
  const customer = await crudGet('crm_customers', currentUser, id);

  const { data: contacts } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('customer_id', id)
    .eq('is_deleted', false);

  const [orders, opportunities, tickets] = await Promise.all([
    supabase.from('crm_orders').select('*').eq('customer_id', id).eq('is_deleted', false),
    supabase.from('crm_opportunities').select('*').eq('customer_id', id).eq('is_deleted', false),
    supabase.from('crm_support_tickets').select('*').eq('customer_id', id).eq('is_deleted', false)
  ]);

  const ordersData = orders.data || [];
  const oppsData = opportunities.data || [];
  const ticketsData = tickets.data || [];

  const totalRevenue = ordersData.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const totalDebt = ordersData.reduce((sum, o) => sum + (parseFloat(o.remaining_amount) || 0), 0);

  return {
    customer: customer,
    contacts: snakeToCamel(contacts || []),
    summary: {
      totalContacts: (contacts || []).length,
      totalOrders: ordersData.length,
      totalOpportunities: oppsData.length,
      totalTickets: ticketsData.length,
      totalRevenue: totalRevenue,
      totalDebt: totalDebt
    }
  };
}

module.exports = {
  crudList,
  crudGet,
  crudCreate,
  crudUpdate,
  crudDelete,
  settingList,
  settingUpdate,
  userCreate,
  userUpdate,
  customerGet
};