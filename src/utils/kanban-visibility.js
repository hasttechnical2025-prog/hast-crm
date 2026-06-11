/**
 * Kanban v3 — Visibility & permission theo MÔ HÌNH HAI LUỒNG.
 * Tham chiếu: plans/kanban_rebuild_spec.md §1A (ưu tiên cao nhất) + §5.
 *
 * Track:
 *   commercial — thẻ thương mại (dòng tiền): phòng tạo đơn + KTHC + admin/boss.
 *   technical  — thẻ kỹ thuật (lắp/giao máy): KT kéo; KD CHỈ XEM; KTHC không thấy.
 *
 * Vai (ánh xạ ở kanban-auth.js):
 *   admin → toàn quyền · boss → chỉ-xem mọi thứ · manager → truong_phong · staff → nhan_vien.
 *
 * Ma trận field thẻ THƯƠNG MẠI (§5.2 v3):
 *   | nhóm    | admin | phòng-tạo-đơn | KTHC | boss |
 *   | selling |   ✓   |       ✓       |  ✓   | đọc  |
 *   | cost    |   ✓   |       ✗       |  ✓   | đọc  |
 *   | billing |   ✓   |      đọc      |  ✓   | đọc  |
 *   | debt    |   ✓   |      đọc      |  ✓   | đọc  |
 * Thẻ KỸ THUẬT: KHÔNG tài chính với mọi vai (server không trả financials).
 */

const FIN_FIELDS_BY_GROUP = {
  selling: ['unit_price', 'quantity', 'subtotal', 'total_amount'],
  cost:    ['cost_price', 'margin'],
  billing: ['invoice_no', 'invoice_date'],
  debt:    ['debt_amount', 'due_date', 'paid_amount', 'payment_status'],
};

const ALL_FIN_FIELDS = Object.values(FIN_FIELDS_BY_GROUP).flat();

/**
 * Trả về group→mode cho user trên 1 thẻ. 'write' | 'read' | null (không gửi).
 */
function fieldGroupsFor(ctx, card) {
  const NONE = { selling: null, cost: null, billing: null, debt: null };

  // Thẻ kỹ thuật: KHÔNG tài chính cho bất kỳ ai (kể cả admin/boss — thẻ này không mang giá).
  if (card.track === 'technical') return { ...NONE };

  if (ctx.isAdmin) return { selling: 'write', cost: 'write', billing: 'write', debt: 'write' };
  if (ctx.role === 'boss') return { selling: 'read', cost: 'read', billing: 'read', debt: 'read' };

  if (ctx.deptCode === 'KTHC') {
    return { selling: 'write', cost: 'write', billing: 'write', debt: 'write' };
  }
  // Phòng tạo đơn (KD với máy/thuê; KT với vật tư/kỳ thuê)
  if (ctx.deptCode && card.owner_dept === ctx.deptCode) {
    return { selling: 'write', cost: null, billing: 'read', debt: 'read' };
  }
  return { ...NONE };
}

function viewableGroupsSet(groupModes) {
  const s = new Set();
  for (const g of ['selling', 'cost', 'billing', 'debt']) {
    if (groupModes[g] === 'write' || groupModes[g] === 'read') s.add(g);
  }
  return s;
}

function editableGroupsSet(ctx, groupModes) {
  if (ctx.isReadOnly) return new Set();
  const s = new Set();
  for (const g of ['selling', 'cost', 'billing', 'debt']) {
    if (groupModes[g] === 'write') s.add(g);
  }
  return s;
}

/**
 * Lọc payload financials theo group được xem. 'currency' luôn giữ.
 * Kèm _modes để FE khóa input nhóm 'read'. Trả null nếu không xem được gì.
 */
function maskFinancials(finRow, groupModes) {
  if (!finRow) return null;
  const view = viewableGroupsSet(groupModes);
  if (view.size === 0) return null;

  const out = { currency: finRow.currency || 'VND', _modes: {} };
  for (const [group, fields] of Object.entries(FIN_FIELDS_BY_GROUP)) {
    if (!view.has(group)) continue;
    for (const f of fields) {
      if (f in finRow) out[f] = finRow[f];
    }
    out._modes[group] = groupModes[group];
  }
  return out;
}

/**
 * Cột hiển thị theo track + phòng (§1A):
 *  - admin/boss: tất cả (boss read-only).
 *  - KD: cột commercial + cột technical (technical LUÔN read-only — KD xem, không kéo).
 *  - KT: cột technical + cột commercial (thẻ lọc riêng ở canSeeCard).
 *  - KTHC: cột commercial TRỪ COM_NEW (không thấy "Đơn mới").
 * readOnly per cột = phòng user KHÔNG có transition nào acting từ cột đó
 * (config-driven — đổi transitions là đổi quyền kéo, không sửa code).
 */
function visibleColumnsFor(ctx, allStages, allTransitions) {
  const sorted = allStages.slice().sort((a, b) => a.sort_order - b.sort_order);

  if (ctx.isAdmin || ctx.role === 'boss') {
    return sorted.map((s) => ({ stage: s, readOnly: ctx.isReadOnly }));
  }

  const myDept = ctx.deptCode;
  if (!myDept) return [];

  // Stage mà phòng user kéo được từ đó (theo transitions)
  const actingFrom = new Set(
    allTransitions.filter((t) => t.acting_dept === myDept).map((t) => t.from_stage)
  );

  let visible;
  if (myDept === 'KD') {
    visible = sorted; // commercial + technical (technical sẽ readOnly vì KD không acting)
  } else if (myDept === 'KT') {
    visible = sorted; // technical + commercial (thẻ thương mại lọc theo owner_dept=KT ở canSeeCard)
  } else if (myDept === 'KTHC') {
    visible = sorted.filter((s) => s.track === 'commercial' && s.id !== 'COM_NEW');
  } else {
    return [];
  }

  return visible.map((s) => ({ stage: s, readOnly: !actingFrom.has(s.id) }));
}

/**
 * Quyền XEM thẻ trong cột (§5.1 + §1A):
 *  - admin/boss: mọi thẻ.
 *  - technical card: KT (TP: hết; NV: assigned mình/chưa giao). KD chỉ-xem
 *    (TP: hết; NV: thẻ sinh từ đơn mình tạo — created_by). KTHC: không.
 *  - commercial card:
 *    - KTHC: mọi thẻ (TP + NV — phòng xử lý tập trung).
 *    - KD/KT: chỉ thẻ owner_dept = phòng mình (TP: hết; NV: assigned mình/chưa giao).
 */
function canSeeCard(ctx, card, stageVisibilityMap) {
  if (ctx.isAdmin || ctx.role === 'boss') return true;
  if (!stageVisibilityMap.has(card.current_stage)) return false;

  const myDept = ctx.deptCode;
  const isTP = ctx.role === 'truong_phong';
  const isOwnAssigned = card.assigned_to && card.assigned_to === ctx.userId;
  const isUnassigned = !card.assigned_to;

  if (card.track === 'technical') {
    if (myDept === 'KT') return isTP || isOwnAssigned || isUnassigned;
    if (myDept === 'KD') return isTP || card.created_by === ctx.userId; // theo dõi máy của đơn mình
    return false; // KTHC không thấy kỹ thuật
  }

  // commercial
  if (myDept === 'KTHC') return true;
  if (card.owner_dept !== myDept) return false; // KT không thấy thẻ thương mại máy, KD không thấy vật tư
  return isTP || isOwnAssigned || isUnassigned;
}

module.exports = {
  FIN_FIELDS_BY_GROUP,
  ALL_FIN_FIELDS,
  fieldGroupsFor,
  viewableGroupsSet,
  editableGroupsSet,
  maskFinancials,
  visibleColumnsFor,
  canSeeCard,
};
