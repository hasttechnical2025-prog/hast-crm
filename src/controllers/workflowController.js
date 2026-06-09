const { supabase } = require('../config');
const { snakeToCamel } = require('../utils/helpers');

const WORKFLOW_STAGES = {
  sales: [
    { key: 'kd_processing',    label: 'KD: Đang xử lý',        dept: 'KD',   order: 1 },
    { key: 'kthc_invoice',     label: 'KTHC: Lên hoá đơn',     dept: 'KTHC', order: 2 },
    { key: 'kthc_collecting',  label: 'KTHC: Thu nợ',           dept: 'KTHC', order: 3 },
    { key: 'completed',        label: 'Hoàn thành',             dept: '',     order: 4 },
  ],
  installation: [
    { key: 'kd_signed',        label: 'KD: Đã ký HĐ',           dept: 'KD',   order: 1 },
    { key: 'kt_installing',    label: 'KT: Lắp đặt',            dept: 'KT',   order: 2 },
    { key: 'kthc_acceptance',  label: 'KTHC: Nghiệm thu',       dept: 'KTHC', order: 3 },
    { key: 'completed',        label: 'Hoàn thành',             dept: '',     order: 4 },
  ],
  maintenance: [
    { key: 'received',         label: 'KD: Tiếp nhận',          dept: 'KD',   order: 1 },
    { key: 'kt_processing',    label: 'KT: Xử lý',              dept: 'KT',   order: 2 },
    { key: 'kthc_billing',     label: 'KTHC: Thu phí (nếu có)', dept: 'KTHC', order: 3 },
    { key: 'completed',        label: 'Hoàn thành',             dept: '',     order: 4 },
  ],
};

// =====================================
// HELPERS
// =====================================

async function generateWorkflowCode() {
  const year = new Date().getFullYear();
  const prefix = 'WF' + year + '-';
  const { data } = await supabase
    .from('crm_workflows')
    .select('code')
    .ilike('code', `${prefix}%`)
    .order('code', { ascending: false })
    .limit(1);

  if (data && data.length > 0) {
    const lastCode = data[0].code;
    const num = parseInt(lastCode.substring(lastCode.indexOf('-') + 1), 10) + 1;
    return prefix + String(num).padStart(4, '0');
  }
  return prefix + '0001';
}

async function autoCreateWorkflowsForEntity(tableName, entityRecord, currentUser) {
  try {
    const todayStr = new Date().toISOString();

    if (tableName === 'crm_orders') {
      // 1. Tạo Workflow Bán hàng & Thanh toán (sales)
      const salesCode = await generateWorkflowCode();
      const salesWf = {
        id: require('crypto').randomUUID(),
        code: salesCode,
        workflow_type: 'sales',
        entity_type: 'order',
        entity_id: entityRecord.id,
        current_stage: 'kd_processing',
        current_dept: 'KD',
        assigned_to: entityRecord.assigned_to || currentUser.id,
        priority: 'Trung bình',
        due_date: entityRecord.due_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        history: [{ stage: 'kd_processing', movedAt: todayStr, movedBy: currentUser.id }],
        status: 'active',
        created_by: currentUser.id,
        updated_by: currentUser.id,
        created_at: todayStr,
        updated_at: todayStr,
        is_deleted: false
      };
      const { error: salesErr } = await supabase.from('crm_workflows').insert(salesWf);
      if (salesErr) throw salesErr;

      // 2. Kiểm tra xem có máy photocopy trong danh sách sản phẩm của đơn hàng không
      const { data: items } = await supabase
        .from('crm_order_items')
        .select('*, product:crm_products(*)')
        .eq('parent_id', entityRecord.id)
        .eq('is_deleted', false);

      const hasPhotocopy = (items || []).some(item =>
        item.product && String(item.product.category).toLowerCase().includes('máy photocopy')
      );

      if (hasPhotocopy) {
        // Tạo thêm Workflow Lắp đặt máy (installation)
        const instCode = await generateWorkflowCode();
        const instWf = {
          id: require('crypto').randomUUID(),
          code: instCode,
          workflow_type: 'installation',
          entity_type: 'order',
          entity_id: entityRecord.id,
          current_stage: 'kd_signed',
          current_dept: 'KD',
          assigned_to: entityRecord.assigned_to || currentUser.id,
          priority: 'Trung bình',
          due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10), // Hạn 5 ngày
          history: [{ stage: 'kd_signed', movedAt: todayStr, movedBy: currentUser.id }],
          status: 'active',
          created_by: currentUser.id,
          updated_by: currentUser.id,
          created_at: todayStr,
          updated_at: todayStr,
          is_deleted: false
        };
        const { error: instErr } = await supabase.from('crm_workflows').insert(instWf);
        if (instErr) throw instErr;
      }
    } else if (tableName === 'crm_support_tickets') {
      // 3. Tạo Workflow Bảo trì kỹ thuật (maintenance)
      const maintCode = await generateWorkflowCode();
      const maintWf = {
        id: require('crypto').randomUUID(),
        code: maintCode,
        workflow_type: 'maintenance',
        entity_type: 'ticket',
        entity_id: entityRecord.id,
        current_stage: 'received',
        current_dept: 'KD',
        assigned_to: entityRecord.assigned_to || currentUser.id,
        priority: entityRecord.priority || 'Trung bình',
        due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), // Hạn 3 ngày
        history: [{ stage: 'received', movedAt: todayStr, movedBy: currentUser.id }],
        status: 'active',
        created_by: currentUser.id,
        updated_by: currentUser.id,
        created_at: todayStr,
        updated_at: todayStr,
        is_deleted: false
      };
      const { error: maintErr } = await supabase.from('crm_workflows').insert(maintWf);
      if (maintErr) throw maintErr;
    }
  } catch (err) {
    console.error('Error auto-creating workflows:', err);
  }
}

async function getUserDeptCode(user) {
  if (!user || !user.department_id) return '';
  try {
    const { data: dept } = await supabase
      .from('crm_departments')
      .select('*')
      .eq('id', user.department_id)
      .single();

    if (!dept) return '';
    if (dept.code) return String(dept.code).toUpperCase();

    const name = String(dept.name || '').toLowerCase();
    if (name.includes('kinh doanh')) return 'KD';
    if (name.includes('kế toán') || name.includes('hành chính')) return 'KTHC';
    if (name.includes('kỹ thuật')) return 'KT';
    return '';
  } catch (e) {
    return '';
  }
}

function workflowInvolvesDept(wf, deptCode) {
  if (!deptCode) return false;
  const stages = WORKFLOW_STAGES[wf.workflow_type] || [];
  return stages.some(stage => stage.dept === deptCode);
}

function canMoveWorkflow(user, wf, stages, userDept) {
  if (!user) return false;
  const role = user.role;
  if (role === 'admin') return true;
  if (role === 'boss') return false; // Read-only

  if (!userDept) return false;

  if (role === 'manager') {
    return workflowInvolvesDept(wf, userDept);
  }

  // Staff
  if (wf.assigned_to === user.id) return true;

  // Check current stage belongs to user's dept
  const currentStage = stages.find(s => s.key === wf.current_stage);
  if (currentStage && currentStage.dept === userDept) return true;
  return false;
}

// =====================================
// NOTIFICATION ENGINE
// =====================================

async function createNotification(userId, data, createdById) {
  if (!userId) return null;
  try {
    const notifCode = 'NT' + Date.now().toString().slice(-6);
    const notif = {
      code: notifCode,
      user_id: userId,
      type: data.type || 'info',
      title: data.title || '',
      message: data.message || '',
      entity_type: data.entityType || '',
      entity_id: data.entityId || null,
      is_read: false,
      priority: data.priority || 'normal',
      created_by: createdById,
      updated_by: createdById
    };

    await supabase.from('crm_notifications').insert(notif);
  } catch (e) {
    console.error('Error creating notification:', e);
  }
}

async function createNotificationForDept(deptCode, data, createdById) {
  if (!deptCode) return 0;
  try {
    const { data: dept } = await supabase
      .from('crm_departments')
      .select('*')
      .ilike('code', deptCode)
      .single();
    if (!dept) return 0;

    const { data: users } = await supabase
      .from('crm_users')
      .select('id')
      .eq('department_id', dept.id)
      .eq('is_deleted', false)
      .eq('status', 'active');

    if (!users || users.length === 0) return 0;

    for (const u of users) {
      await createNotification(u.id, data, createdById);
    }
    return users.length;
  } catch (e) {
    console.error('Error creating dept notification:', e);
    return 0;
  }
}

async function notifyWorkflowMoved(currentUser, wf, newStage, oldStage) {
  if (wf.assigned_to && wf.assigned_to !== currentUser.id) {
    await createNotification(wf.assigned_to, {
      type: 'workflow_moved',
      title: 'Thẻ quy trình đã chuyển',
      message: `Thẻ ${wf.code} đã chuyển sang giai đoạn "${newStage.label}" (${newStage.dept})`,
      entityType: 'workflow',
      entityId: wf.id,
      priority: 'normal'
    }, currentUser.id);
  }

  if (newStage.dept && newStage.dept !== oldStage.dept) {
    let entityCode = '';
    if (wf.entity_type === 'order') {
      const { data: order } = await supabase.from('crm_orders').select('code').eq('id', wf.entity_id).single();
      if (order) entityCode = order.code;
    } else if (wf.entity_type === 'ticket') {
      const { data: ticket } = await supabase.from('crm_support_tickets').select('code').eq('id', wf.entity_id).single();
      if (ticket) entityCode = ticket.code;
    }

    await createNotificationForDept(newStage.dept, {
      type: 'workflow_assigned',
      title: `Có công việc mới cho phòng ${newStage.dept}`,
      message: `${currentUser.full_name || currentUser.username} chuyển thẻ ${wf.code}${entityCode ? ` (${entityCode})` : ''} sang "${newStage.label}"`,
      entityType: 'workflow',
      entityId: wf.id,
      priority: 'normal'
    }, currentUser.id);
  }
}

// =====================================
// MAIN API WORKFLOW CONTROLLERS
// =====================================

async function workflowList(currentUser, params) {
  const type = params.workflowType || 'sales';
  const stages = WORKFLOW_STAGES[type];
  if (!stages) {
    const error = new Error(`workflowType không hợp lệ: ${type}`);
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data: rows, error } = await supabase
    .from('crm_workflows')
    .select('*')
    .eq('workflow_type', type)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const userDept = await getUserDeptCode(currentUser);
  const role = currentUser.role;

  const filteredRows = rows.filter(wf => {
    if (role === 'admin' || role === 'boss') return true;
    if (role === 'manager') {
      return workflowInvolvesDept(wf, userDept);
    }
    if (role === 'staff') {
      if (wf.assigned_to === currentUser.id) return true;
      if (wf.created_by === currentUser.id) return true;
      const stageObj = stages.find(s => s.key === wf.current_stage);
      if (stageObj && stageObj.dept === userDept) return true;
      return false;
    }
    return false;
  });

  const grouped = {};
  stages.forEach(s => {
    grouped[s.key] = { stage: s, items: [] };
  });

  for (const wf of filteredRows) {
    let entity = null;
    let customer = null;
    let productNames = [];

    if (wf.entity_type === 'order') {
      const { data: ord } = await supabase.from('crm_orders').select('*').eq('id', wf.entity_id).single();
      entity = ord;
      if (entity) {
        const { data: cust } = await supabase.from('crm_customers').select('*').eq('id', entity.customer_id).single();
        customer = cust;

        const { data: orderItems } = await supabase
          .from('crm_order_items')
          .select('*, product:crm_products(name)')
          .eq('parent_type', 'order')
          .eq('parent_id', entity.id)
          .eq('is_deleted', false);

        if (orderItems) {
          productNames = orderItems.map(item => item.product?.name || item.notes).filter(Boolean);
        }
      }
    } else if (wf.entity_type === 'ticket') {
      const { data: ticket } = await supabase.from('crm_support_tickets').select('*').eq('id', wf.entity_id).single();
      entity = ticket;
      if (entity) {
        const { data: cust } = await supabase.from('crm_customers').select('*').eq('id', entity.customer_id).single();
        customer = cust;
      }
    }

    const isKtStaff = role === 'staff' && userDept === 'KT';

    const enriched = {
      id: wf.id,
      code: wf.code,
      workflowType: wf.workflow_type,
      entityType: wf.entity_type,
      entityId: wf.entity_id,
      entityCode: entity ? entity.code : '',
      entitySubject: entity ? (entity.subject || entity.name || entity.title || '') : '',
      customerId: customer ? customer.id : '',
      customerName: customer ? customer.name : '(Khách hàng đã xoá)',
      customerCode: customer ? customer.code : '',
      customerClassification: customer ? customer.classification : '',
      customerAddress: customer ? customer.address : '',
      customerPhone: isKtStaff ? '' : (customer ? customer.phone : ''),
      customerEmail: isKtStaff ? '' : (customer ? customer.email : ''),
      customerTaxCode: isKtStaff ? '' : (customer ? customer.tax_code : ''),
      totalAmount: isKtStaff ? null : (entity && entity.total_amount ? entity.total_amount : 0),
      remainingAmount: isKtStaff ? null : (entity && entity.total_amount && entity.paid_amount ? (entity.total_amount - entity.paid_amount) : 0),
      productNames: productNames,
      priority: wf.priority || (entity && entity.priority) || 'Trung bình',
      currentStage: wf.current_stage,
      currentDept: wf.current_dept,
      assignedTo: wf.assigned_to,
      dueDate: wf.due_date,
      status: wf.status,
      canMove: canMoveWorkflow(currentUser, wf, stages, userDept),
      createdAt: wf.created_at,
      updatedAt: wf.updated_at,
    };

    if (grouped[wf.current_stage]) {
      grouped[wf.current_stage].items.push(enriched);
    }
  }

  return grouped;
}

async function workflowGet(currentUser, id) {
  if (!id) {
    const error = new Error('Thiếu id workflow');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data: wf, error } = await supabase
    .from('crm_workflows')
    .select('*')
    .eq('id', id)
    .eq('is_deleted', false)
    .single();

  if (error || !wf) {
    const err = new Error('Không tìm thấy workflow');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const stages = WORKFLOW_STAGES[wf.workflow_type] || [];
  const userDept = await getUserDeptCode(currentUser);
  const role = currentUser.role;
  let hasPermission = false;

  if (role === 'admin' || role === 'boss') {
    hasPermission = true;
  } else if (role === 'manager') {
    hasPermission = workflowInvolvesDept(wf, userDept);
  } else if (role === 'staff') {
    if (wf.assigned_to === currentUser.id || wf.created_by === currentUser.id) {
      hasPermission = true;
    } else {
      const stageObj = stages.find(s => s.key === wf.current_stage);
      if (stageObj && stageObj.dept === userDept) {
        hasPermission = true;
      }
    }
  }

  if (!hasPermission) {
    const err = new Error('Bạn không có quyền truy cập thẻ quy trình này');
    err.code = 'FORBIDDEN';
    throw err;
  }

  let history = wf.history;
  if (typeof history === 'string') {
    try { history = JSON.parse(history); } catch (e) { history = []; }
  }

  return {
    ...snakeToCamel(wf),
    history: history || [],
    canMove: canMoveWorkflow(currentUser, wf, stages, userDept)
  };
}

async function workflowMoveStage(currentUser, payload) {
  if (!payload.id || !payload.newStage) {
    const error = new Error('Thiếu id hoặc newStage');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data: wf, error: getErr } = await supabase
    .from('crm_workflows')
    .select('*')
    .eq('id', payload.id)
    .eq('is_deleted', false)
    .single();

  if (getErr || !wf) {
    const err = new Error('Không tìm thấy workflow');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const stages = WORKFLOW_STAGES[wf.workflow_type];
  const newStage = stages.find(s => s.key === payload.newStage);
  if (!newStage) {
    const err = new Error(`Stage không hợp lệ: ${payload.newStage}`);
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const userDept = await getUserDeptCode(currentUser);

  if (!canMoveWorkflow(currentUser, wf, stages, userDept)) {
    const currentStageObj = stages.find(s => s.key === wf.current_stage);
    const requiredDept = currentStageObj ? currentStageObj.dept : '';
    const err = new Error(`Bạn không có quyền chuyển thẻ này. Chỉ người phòng ${requiredDept} hoặc admin/manager mới chuyển được.`);
    err.code = 'FORBIDDEN';
    throw err;
  }

  let history = wf.history || [];
  if (typeof history === 'string') {
    try { history = JSON.parse(history); } catch (e) { history = []; }
  }

  history.push({
    fromStage: wf.current_stage,
    toStage: newStage.key,
    fromDept: wf.current_dept,
    toDept: newStage.dept,
    userId: currentUser.id,
    userName: currentUser.full_name || currentUser.username,
    timestamp: new Date().toISOString(),
    note: payload.note || ''
  });

  const updates = {
    current_stage: newStage.key,
    current_dept: newStage.dept,
    history: history,
    status: newStage.key === 'completed' ? 'completed' : 'active',
    updated_at: new Date().toISOString(),
    updated_by: currentUser.id
  };

  const { data: updatedWf, error: updateErr } = await supabase
    .from('crm_workflows')
    .update(updates)
    .eq('id', wf.id)
    .select()
    .single();

  if (updateErr) throw updateErr;

  try {
    await supabase.from('crm_audit_log').insert({
      user_id: currentUser.id,
      action: 'workflow.moveStage',
      entity_type: 'workflows',
      entity_id: wf.id,
      changes: JSON.stringify({
        workflowCode: wf.code,
        fromStage: wf.current_stage,
        toStage: newStage.key
      })
    });
  } catch (auditErr) {
    console.error('Audit Log Error in moveStage:', auditErr);
  }

  try {
    const currentStageObj = stages.find(s => s.key === wf.current_stage);
    await notifyWorkflowMoved(currentUser, wf, newStage, currentStageObj || { dept: wf.current_dept });
  } catch (notifErr) {
    console.error('Notification Error in moveStage:', notifErr);
  }

  return {
    id: wf.id,
    newStage: newStage.key,
    newDept: newStage.dept
  };
}

async function workflowUpdate(currentUser, payload) {
  if (!payload.id) {
    const error = new Error('Thiếu id workflow để cập nhật');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data: wf, error: getErr } = await supabase
    .from('crm_workflows')
    .select('*')
    .eq('id', payload.id)
    .eq('is_deleted', false)
    .single();

  if (getErr || !wf) {
    const err = new Error('Không tìm thấy workflow');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const role = currentUser.role;
  let hasPermission = false;
  if (role === 'admin' || role === 'boss') {
    hasPermission = true;
  } else {
    const userDept = await getUserDeptCode(currentUser);
    if (role === 'manager' && workflowInvolvesDept(wf, userDept)) {
      hasPermission = true;
    } else if (role === 'staff' && wf.assigned_to === currentUser.id) {
      hasPermission = true;
    }
  }

  if (!hasPermission) {
    const err = new Error('Bạn không có quyền cập nhật thẻ quy trình này');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const updates = {};
  if (payload.assignedTo !== undefined) updates.assigned_to = payload.assignedTo;
  if (payload.dueDate !== undefined) updates.due_date = payload.dueDate;
  if (payload.priority !== undefined) updates.priority = payload.priority;

  updates.updated_at = new Date().toISOString();
  updates.updated_by = currentUser.id;

  const { data: updatedWf, error: updateErr } = await supabase
    .from('crm_workflows')
    .update(updates)
    .eq('id', wf.id)
    .select()
    .single();

  if (updateErr) throw updateErr;

  return snakeToCamel(updatedWf);
}

module.exports = {
  workflowList,
  workflowGet,
  workflowMoveStage,
  workflowUpdate,
  autoCreateWorkflowsForEntity
};