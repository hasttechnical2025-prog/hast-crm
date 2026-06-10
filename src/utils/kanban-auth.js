/**
 * Kanban v2 — auth context resolver.
 *
 * Maps app role → spec role:
 *   admin   → effRole='boss', isAdmin=true   (toàn quyền, được GHI)
 *   boss    → effRole='boss', isReadOnly=true (chỉ XEM)
 *   manager → effRole='truong_phong'
 *   staff   → effRole='nhan_vien'
 *
 * Phòng: resolve department_id (uuid) → crm_departments.code (KD/KT/KTHC...).
 * Cache code trong context để khỏi query lại nhiều lần trong cùng 1 request.
 */
const { supabase } = require('../config');

const ROLE_MAP = {
  admin: 'boss',         // effRole
  boss: 'boss',
  manager: 'truong_phong',
  staff: 'nhan_vien',
};

async function getKanbanCtx(currentUser) {
  if (!currentUser) {
    const e = new Error('UNAUTHORIZED: Thiếu currentUser khi build kanban ctx');
    e.code = 'UNAUTHORIZED';
    throw e;
  }

  const appRole = currentUser.role;
  const effRole = ROLE_MAP[appRole];
  if (!effRole) {
    const e = new Error(`FORBIDDEN: role không hợp lệ cho Kanban: ${appRole}`);
    e.code = 'FORBIDDEN';
    throw e;
  }

  const isAdmin = appRole === 'admin';
  const isReadOnly = appRole === 'boss'; // boss chỉ xem, admin được ghi.

  // Resolve dept code
  let deptCode = null;
  if (currentUser.department_id) {
    const { data: dept } = await supabase
      .from('crm_departments')
      .select('id, code, name')
      .eq('id', currentUser.department_id)
      .single();
    if (dept) deptCode = (dept.code || '').toUpperCase() || null;
  }

  return {
    userId: currentUser.id,
    user: currentUser,
    appRole,
    role: effRole,           // 'boss' | 'truong_phong' | 'nhan_vien'
    isAdmin,                 // bypass write checks ngoài role-based khác
    isReadOnly,              // boss — chặn mọi ghi
    deptId: currentUser.department_id || null,
    deptCode,                // 'KD' | 'KT' | 'KTHC' | null
  };
}

/**
 * Yêu cầu user có quyền GHI (admin hoặc role write-capable).
 * Boss → 403.
 */
function requireWritable(ctx) {
  if (ctx.isReadOnly) {
    const e = new Error('FORBIDDEN: Boss chỉ có quyền xem, không có quyền thao tác.');
    e.code = 'FORBIDDEN';
    throw e;
  }
}

module.exports = {
  ROLE_MAP,
  getKanbanCtx,
  requireWritable,
};
