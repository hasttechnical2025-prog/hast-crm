const { supabase } = require('../config');
const { verifyPassword, createJWT, hashPassword, generateSalt } = require('../utils/crypto');

// Utility để log audit
async function logAudit(userId, action, entityType, entityId, changes, ipAddress) {
  try {
    const { error } = await supabase.from('crm_audit_log').insert({
      user_id: userId,
      action: action,
      entity_type: entityType,
      entity_id: entityId || null,
      changes: changes ? JSON.stringify(changes) : null,
      ip_address: ipAddress || ''
    });
    if (error) console.error('Audit Log Error:', error);
  } catch (e) {
    console.error('Audit Log Error:', e);
  }
}

async function authLogin(payload, ipAddress) {
  if (!payload.username || !payload.password) {
    const error = new Error('BAD_REQUEST: Thiếu username hoặc password');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const username = String(payload.username).trim().toLowerCase();
  const password = String(payload.password);

  const { data: user, error: userErr } = await supabase
    .from('crm_users')
    .select('*')
    .ilike('username', username)
    .eq('is_deleted', false)
    .single();

  if (userErr || !user) {
    await logAudit(null, 'login_failed', 'user', null, { reason: 'user_not_found', username }, ipAddress);
    const err = new Error('Sai tên đăng nhập hoặc mật khẩu');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  if (user.status === 'locked') {
    const err = new Error('Tài khoản đã bị khoá. Liên hệ quản trị viên.');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (user.status === 'inactive') {
    const err = new Error('Tài khoản đã bị vô hiệu hoá');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const isPasswordValid = verifyPassword(password, user.salt, user.password_hash);

  if (!isPasswordValid) {
    const newFailedCount = (parseInt(user.failed_login_count, 10) || 0) + 1;
    const updates = {
      failed_login_count: newFailedCount,
      updated_at: new Date().toISOString()
    };
    if (newFailedCount >= 5) {
      updates.status = 'locked';
    }
    await supabase.from('crm_users').update(updates).eq('id', user.id);

    await logAudit(user.id, 'login_failed', 'user', user.id, { failedCount: newFailedCount }, ipAddress);
    const err = new Error('Sai tên đăng nhập hoặc mật khẩu');
    err.code = 'UNAUTHORIZED';
    throw err;
  }

  const expSeconds = Math.floor(Date.now() / 1000) + (12 * 3600);
  const tokenPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    departmentId: user.department_id,
    exp: expSeconds,
    iat: Math.floor(Date.now() / 1000),
  };
  const token = createJWT(tokenPayload);
  const expiresAt = new Date(expSeconds * 1000).toISOString();

  await supabase.from('crm_sessions').insert({
    user_id: user.id,
    token: token,
    expired_at: expiresAt
  });

  await supabase.from('crm_users').update({
    failed_login_count: 0,
    last_login_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq('id', user.id);

  await logAudit(user.id, 'login', 'user', user.id, null, ipAddress);

  return {
    token: token,
    expiresAt: expiresAt,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      departmentId: user.department_id,
      position: user.position,
    }
  };
}

async function authLogout(token) {
  await supabase.from('crm_sessions').update({
    is_deleted: true,
    updated_at: new Date().toISOString()
  }).eq('token', token);
  return true;
}

async function authMe(currentUser) {
  let departmentName = '';
  if (currentUser.department_id) {
    const { data: dept } = await supabase
      .from('crm_departments')
      .select('name')
      .eq('id', currentUser.department_id)
      .maybeSingle();
    if (dept) {
      departmentName = dept.name;
    }
  }

  return {
    id: currentUser.id,
    username: currentUser.username,
    fullName: currentUser.full_name,
    email: currentUser.email,
    phone: currentUser.phone,
    avatar: currentUser.avatar,
    role: currentUser.role,
    departmentId: currentUser.department_id,
    departmentName: departmentName,
    position: currentUser.position,
    lastLoginAt: currentUser.last_login_at
  };
}

async function authChangePassword(currentUser, payload) {
  if (!payload.oldPassword || !payload.newPassword) {
    const error = new Error('BAD_REQUEST: Thiếu mật khẩu cũ hoặc mới');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  if (payload.newPassword.length < 6) {
    const error = new Error('BAD_REQUEST: Mật khẩu mới phải có ít nhất 6 ký tự');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const { data: user } = await supabase.from('crm_users').select('*').eq('id', currentUser.id).single();

  if (!verifyPassword(payload.oldPassword, user.salt, user.password_hash)) {
    const error = new Error('BAD_REQUEST: Mật khẩu cũ không đúng');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const newSalt = generateSalt();
  const newHash = hashPassword(payload.newPassword, newSalt);

  await supabase.from('crm_users').update({ salt: newSalt, password_hash: newHash, updated_at: new Date().toISOString(), updated_by: currentUser.id }).eq('id', user.id);
  await supabase.from('crm_sessions').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('user_id', user.id);

  await logAudit(currentUser.id, 'change_password', 'users', user.id, null, '');
  return { changed: true };
}

async function authAdminResetPassword(currentUser, payload) {
  if (currentUser.role !== 'admin') {
    const error = new Error('FORBIDDEN: Bạn không có quyền thực hiện hành động này');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const { data: user } = await supabase.from('crm_users').select('*').eq('id', payload.userId).single();
  if (!user) throw new Error('Không tìm thấy người dùng');

  const newSalt = generateSalt();
  const newHash = hashPassword(payload.newPassword, newSalt);

  await supabase.from('crm_users').update({ salt: newSalt, password_hash: newHash, updated_at: new Date().toISOString(), updated_by: currentUser.id }).eq('id', user.id);
  await supabase.from('crm_sessions').update({ is_deleted: true, updated_at: new Date().toISOString() }).eq('user_id', user.id);

  await logAudit(currentUser.id, 'reset_password', 'users', user.id, null, '');
  return { changed: true };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function authUpdateProfile(currentUser, payload) {
  const { data: user } = await supabase.from('crm_users').select('*').eq('id', currentUser.id).single();
  if (!user) throw new Error('Không tìm thấy người dùng');

  const allowedFields = ['full_name', 'email', 'phone', 'avatar'];
  const updates = { updated_at: new Date().toISOString(), updated_by: currentUser.id };

  if (payload.fullName !== undefined) updates.full_name = payload.fullName;
  if (payload.email !== undefined) {
    if (!isValidEmail(payload.email)) throw new Error('Email không hợp lệ');
    updates.email = payload.email;
  }
  if (payload.phone !== undefined) updates.phone = payload.phone;
  if (payload.avatar !== undefined) updates.avatar = payload.avatar;

  await supabase.from('crm_users').update(updates).eq('id', user.id);
  await logAudit(currentUser.id, 'update_profile', 'users', user.id, updates, '');

  return authMe(currentUser);
}

module.exports = {
  authLogin,
  authLogout,
  authMe,
  authChangePassword,
  authAdminResetPassword,
  authUpdateProfile,
  logAudit
};