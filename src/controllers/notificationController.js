const { supabase } = require('../config');
const { snakeToCamel } = require('../utils/helpers');

async function notificationList(currentUser, params) {
  const limit = parseInt(params.limit || params.pageSize || 15, 10);

  // 1. Lấy danh sách thông báo
  const { data: items, error } = await supabase
    .from('crm_notifications')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // 2. Đếm số thông báo chưa đọc
  const { count, error: countErr } = await supabase
    .from('crm_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .eq('is_read', false)
    .eq('is_deleted', false);

  if (countErr) throw countErr;

  return {
    items: snakeToCamel(items || []),
    unreadCount: count || 0
  };
}

async function notificationMarkRead(currentUser, notifId) {
  if (!notifId) {
    const error = new Error('BAD_REQUEST: Thiếu id thông báo');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data, error } = await supabase
    .from('crm_notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id
    })
    .eq('id', notifId)
    .eq('user_id', currentUser.id)
    .select();

  if (error) throw error;
  return true;
}

async function notificationMarkAllRead(currentUser) {
  const { data, error } = await supabase
    .from('crm_notifications')
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: currentUser.id
    })
    .eq('user_id', currentUser.id)
    .eq('is_read', false)
    .select();

  if (error) throw error;
  return true;
}

module.exports = {
  notificationList,
  notificationMarkRead,
  notificationMarkAllRead
};