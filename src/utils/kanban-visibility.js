/**
 * Kanban v2 — Visibility & permission matrix.
 * Tham chiếu: plans/kanban_rebuild_spec.md §5.
 *
 * Vai trò (mapping app role → spec role):
 *   admin   → effRole='boss', isAdmin=true  (toàn quyền — bao gồm GHI)
 *   boss    → effRole='boss', isReadOnly=true (chỉ XEM; mọi ghi -> 403)
 *   manager → effRole='truong_phong'
 *   staff   → effRole='nhan_vien'
 *
 * Tài chính chia 4 nhóm: selling, cost, billing, debt.
 * Mỗi nhóm có 3 mode: 'write' | 'read' | null (server không gửi xuống).
 * 'write_own' = chỉ áp dụng khi card.assigned_to = user.id; ngoài ra → null.
 * 'read_own'  = đọc (không sửa) — chỉ áp dụng khi card.assigned_to = user.id.
 */

const FIN_FIELDS_BY_GROUP = {
  selling: ['unit_price', 'quantity', 'subtotal', 'total_amount'],
  cost:    ['cost_price', 'margin'],
  billing: ['invoice_no', 'invoice_date'],
  debt:    ['debt_amount', 'due_date', 'paid_amount', 'payment_status'],
};

const ALL_FIN_FIELDS = Object.values(FIN_FIELDS_BY_GROUP).flat();

// "Family" của thẻ — nhóm 3 loại thẻ máy chung 1 ma trận, vật tư riêng.
function cardFamily(cardType) {
  return cardType === 'ban_vat_tu' ? 'vat_tu' : 'may';
}

// Ma trận §5.4. Đầu vào: family + effRole + deptCode → object {selling, cost, billing, debt}.
// Mỗi giá trị: 'write' | 'read' | 'write_own' | 'read_own' | null.
const MATRIX = {
  may: {
    // Boss/admin xem mọi thứ; admin còn write được, boss read-only — phân biệt ở chỗ khác.
    boss: { _any: { selling: 'write', cost: 'write', billing: 'write', debt: 'write' } },
    truong_phong: {
      KD:   { selling: 'write', cost: null,    billing: 'read', debt: 'read' },
      KT:   { selling: null,    cost: null,    billing: null,   debt: null   },
      KTHC: { selling: 'write', cost: 'write', billing: 'write',debt: 'write'},
    },
    nhan_vien: {
      KD:   { selling: 'write_own', cost: null, billing: 'read_own', debt: 'read_own' },
      KT:   { selling: null,        cost: null, billing: null,        debt: null       },
      KTHC: { selling: 'write',     cost: 'write', billing: 'write', debt: 'write' },
    },
  },
  vat_tu: {
    boss: { _any: { selling: 'write', cost: 'write', billing: 'write', debt: 'write' } },
    truong_phong: {
      KT:   { selling: 'write', cost: 'write', billing: 'read', debt: null  },
      KTHC: { selling: 'write', cost: 'write', billing: 'write',debt: 'write' },
    },
    nhan_vien: {
      KT:   { selling: 'write_own', cost: null, billing: null, debt: null },
      KTHC: { selling: 'write', cost: 'write', billing: 'write', debt: 'write' },
    },
  },
};

/**
 * Trả về group→mode cho user trên 1 thẻ cụ thể.
 * @param {object} ctx — kanban auth context (xem kanban-auth.js)
 * @param {object} card — { card_type, assigned_to }
 * @returns {{selling, cost, billing, debt}} mỗi giá trị 'write'|'read'|null
 */
function fieldGroupsFor(ctx, card) {
  const family = cardFamily(card.card_type);
  const effRole = ctx.role;
  const cell = MATRIX[family]?.[effRole];
  let groups;
  if (!cell) {
    groups = { selling: null, cost: null, billing: null, debt: null };
  } else if (cell._any) {
    groups = { ...cell._any };
  } else {
    groups = cell[ctx.deptCode] || { selling: null, cost: null, billing: null, debt: null };
  }

  const isOwn = card.assigned_to && ctx.userId && card.assigned_to === ctx.userId;
  // Resolve *_own modes
  const out = {};
  for (const g of ['selling', 'cost', 'billing', 'debt']) {
    const m = groups[g];
    if (m === 'write_own') out[g] = isOwn ? 'write' : null;
    else if (m === 'read_own') out[g] = isOwn ? 'read' : null;
    else out[g] = m;
  }
  return out;
}

/**
 * Tập group được xem (read hoặc write).
 */
function viewableGroupsSet(groupModes) {
  const s = new Set();
  for (const g of ['selling', 'cost', 'billing', 'debt']) {
    if (groupModes[g] === 'write' || groupModes[g] === 'read') s.add(g);
  }
  return s;
}

/**
 * Tập group được SỬA.
 * Lưu ý: boss read-only -> tất cả group về null khi sửa (kiểm tra ở ctx.isReadOnly).
 */
function editableGroupsSet(ctx, groupModes) {
  if (ctx.isReadOnly) return new Set();
  const s = new Set();
  for (const g of ['selling', 'cost', 'billing', 'debt']) {
    if (groupModes[g] === 'write') s.add(g);
  }
  return s;
}

/**
 * Lọc payload financials xuống chỉ những field thuộc group user được xem.
 * Field 'currency' luôn giữ.
 * Mỗi field còn giữ tag mode='write'|'read' để frontend khóa input nếu 'read'.
 *
 * Trả null nếu user không xem được nhóm nào.
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
    out._modes[group] = groupModes[group]; // 'write' | 'read'
  }
  return out;
}

/**
 * Chuyển danh sách stages + transitions thành visibleColumnsFor(ctx).
 * Trả về [{ stage, readOnly }] theo sort_order.
 */
function visibleColumnsFor(ctx, allStages, allTransitions) {
  // Boss/admin: tất cả cột, đều editable theo permission của transitions.
  if (ctx.role === 'boss') {
    return allStages
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ stage: s, readOnly: false }));
  }

  const myDept = ctx.deptCode;
  if (!myDept) {
    // No dept (uncommon) → no columns.
    return [];
  }

  // Stage thuộc phòng mình → editable
  const myStages = new Set(allStages.filter((s) => s.owner_dept === myDept).map((s) => s.id));

  // Neighbor stages: bất kỳ stage X mà có transition (forward) giữa X và 1 stage trong myStages.
  const neighbors = new Set();
  for (const t of allTransitions) {
    if (t.direction !== 'forward') continue;
    if (myStages.has(t.from_stage) && !myStages.has(t.to_stage)) neighbors.add(t.to_stage);
    if (myStages.has(t.to_stage) && !myStages.has(t.from_stage)) neighbors.add(t.from_stage);
  }

  return allStages
    .filter((s) => myStages.has(s.id) || neighbors.has(s.id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({ stage: s, readOnly: !myStages.has(s.id) }));
}

/**
 * Quyền XEM thẻ trong cột:
 *   - Boss/admin: thấy mọi thẻ.
 *   - TP: thẻ ở stage editable (phòng mình): tất cả; ở stage read-only: chỉ thẻ owner_dept=phòng mình HOẶC assigned_to=mình.
 *   - NV: thẻ ở stage editable: assigned_to=mình HOẶC unassigned (assigned_to IS NULL) ; ở stage read-only: assigned_to=mình.
 *
 * @param {object} ctx
 * @param {object} card
 * @param {Map<string, {readOnly:boolean}>} stageVisibilityMap — key = stage id
 * @returns {boolean}
 */
function canSeeCard(ctx, card, stageVisibilityMap) {
  if (ctx.role === 'boss') return true;
  const visEntry = stageVisibilityMap.get(card.current_stage);
  if (!visEntry) return false;
  const isReadOnlyStage = visEntry.readOnly;
  const myDept = ctx.deptCode;
  const isOwn = card.assigned_to && card.assigned_to === ctx.userId;

  if (!isReadOnlyStage) {
    // editable stage thuộc phòng mình
    if (ctx.role === 'truong_phong') return true;
    if (ctx.role === 'nhan_vien') return isOwn || !card.assigned_to;
  } else {
    // read-only neighbor stage
    if (ctx.role === 'truong_phong') return card.owner_dept === myDept || isOwn;
    if (ctx.role === 'nhan_vien') return isOwn;
  }
  return false;
}

module.exports = {
  FIN_FIELDS_BY_GROUP,
  ALL_FIN_FIELDS,
  cardFamily,
  fieldGroupsFor,
  viewableGroupsSet,
  editableGroupsSet,
  maskFinancials,
  visibleColumnsFor,
  canSeeCard,
};
