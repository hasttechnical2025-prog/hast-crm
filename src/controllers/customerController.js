const { supabase } = require('../config');
const { crudUpdate, crudGet } = require('./crudController');
const { snakeToCamel } = require('../utils/helpers');

async function customerApprove(currentUser, id) {
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
    const error = new Error('FORBIDDEN: Bạn không có quyền thực hiện hành động này');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const updates = {
    approvalStatus: 'approved',
    approvedBy: currentUser.id,
    approvedAt: new Date().toISOString()
  };

  return crudUpdate('crm_customers', currentUser, id, updates);
}

async function customerReject(currentUser, id, reason) {
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
    const error = new Error('FORBIDDEN: Bạn không có quyền thực hiện hành động này');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const customer = await crudGet('crm_customers', currentUser, id);
  const existingNotes = customer.notes || '';
  const newNotes = existingNotes + '\n[Từ chối: ' + (reason || '') + ']';

  const updates = {
    approvalStatus: 'rejected',
    approvedBy: currentUser.id,
    approvedAt: new Date().toISOString(),
    notes: newNotes
  };

  return crudUpdate('crm_customers', currentUser, id, updates);
}

async function customerFindDuplicates(currentUser, dataToCheck) {
  let customer;
  let ignoreId = null;

  if (typeof dataToCheck === 'string') {
    customer = await crudGet('crm_customers', currentUser, dataToCheck);
    ignoreId = dataToCheck;
  } else if (dataToCheck && typeof dataToCheck === 'object') {
    if (dataToCheck.id) {
      customer = await crudGet('crm_customers', currentUser, dataToCheck.id);
      ignoreId = dataToCheck.id;
    } else {
      customer = dataToCheck;
    }
  } else {
    const error = new Error('BAD_REQUEST: Thiếu thông tin khách hàng để kiểm tra trùng lặp');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data: allCustomers, error } = await supabase
    .from('crm_customers')
    .select('id, code, name, phone, email, tax_code')
    .eq('is_deleted', false);

  if (error) throw error;

  const duplicates = [];
  allCustomers.forEach(other => {
    if (ignoreId && other.id === ignoreId) return;

    const reasons = [];
    const checkPhone = customer.phone;
    const checkEmail = customer.email;
    const checkTaxCode = customer.taxCode || customer.tax_code;
    const checkName = customer.name;

    if (checkPhone && other.phone === checkPhone) reasons.push('Trùng SĐT');
    if (checkEmail && other.email === checkEmail) reasons.push('Trùng Email');
    if (checkTaxCode && other.tax_code === checkTaxCode) reasons.push('Trùng MST');
    if (checkName && other.name &&
        String(other.name).toLowerCase().trim() === String(checkName).toLowerCase().trim()) reasons.push('Trùng tên');

    if (reasons.length > 0) {
      duplicates.push({
        ...snakeToCamel(other),
        duplicateReason: reasons.join(', ')
      });
    }
  });

  return duplicates;
}

async function customerMerge(currentUser, primaryId, secondaryIds) {
  if (currentUser.role !== 'admin' && currentUser.role !== 'manager') {
    const error = new Error('FORBIDDEN: Bạn không có quyền thực hiện hành động này');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const primary = await crudGet('crm_customers', currentUser, primaryId);

  const relatedTables = [
    { name: 'crm_contacts', col: 'customer_id' },
    { name: 'crm_opportunities', col: 'customer_id' },
    { name: 'crm_quotes', col: 'customer_id' },
    { name: 'crm_orders', col: 'customer_id' },
    { name: 'crm_support_tickets', col: 'customer_id' },
    { name: 'crm_activities', col: 'customer_id' },
    { name: 'crm_messages', col: 'customer_id' }
  ];

  // Chuyển toàn bộ dữ liệu từ secondaryIds sang primaryId
  for (const table of relatedTables) {
    await supabase
      .from(table.name)
      .update({
        [table.col]: primaryId,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.id
      })
      .in(table.col, secondaryIds);
  }

  // Đối với notes (dùng related_id và related_type)
  await supabase
    .from('crm_notes')
    .update({
      related_id: primaryId,
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id
    })
    .eq('related_type', 'customer')
    .in('related_id', secondaryIds);

  // Xoá (soft delete) các khách hàng phụ
  for (const secId of secondaryIds) {
    await supabase
      .from('crm_customers')
      .update({
        is_deleted: true,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.id,
        notes: `Đã gộp vào khách hàng ${primary.code} (${primaryId})`
      })
      .eq('id', secId);
  }

  return primary;
}

module.exports = {
  customerApprove,
  customerReject,
  customerFindDuplicates,
  customerMerge
};