/**
 * Kanban v2 — Controller chính (cổng kiểm soát duy nhất).
 * Tham chiếu: plans/kanban_rebuild_spec.md §6.
 *
 * Actions (qua mainController dispatch):
 *   - kanban.config.get         — stages + transitions cho FE render UI
 *   - kanban.board.get          — đọc board đã lọc theo quyền (§6.3)
 *   - kanban.card.get           — đọc 1 thẻ cho drawer chi tiết
 *   - kanban.card.create        — tạo thẻ + financials + items (§6.5)
 *   - kanban.card.update        — sửa thẻ + financials + items (§6.5)
 *   - kanban.move               — cổng kéo-nhả (§6.4) — DUY NHẤT đổi current_stage
 *   - kanban.rentalPeriod.create — sinh thẻ kỳ thuê từ hợp đồng (§6.6)
 *   - kanban.notifications.list — chuông 🔔 (§6.9)
 *   - kanban.notifications.read — đánh dấu đã đọc
 *   - kanban.debt.scan          — chạy thủ công fn_debt_reminder_scan() — admin only
 */
const { supabase } = require('../config');
const { snakeToCamel } = require('../utils/helpers');
const {
  getKanbanCtx,
  requireWritable,
} = require('../utils/kanban-auth');
const {
  FIN_FIELDS_BY_GROUP,
  ALL_FIN_FIELDS,
  fieldGroupsFor,
  editableGroupsSet,
  maskFinancials,
  visibleColumnsFor,
  canSeeCard,
} = require('../utils/kanban-visibility');

// Phòng khởi tạo mặc định theo card_type
const INITIAL_STAGE_BY_CARD_TYPE = {
  ban_may: 'KD_OPEN',
  thue_may: 'KD_OPEN',
  ban_vat_tu: 'KT_PROCESS',
  thue_may_ky: 'KTHC_INVOICE',
};
const INITIAL_DEPT_BY_CARD_TYPE = {
  ban_may: 'KD',
  thue_may: 'KD',
  ban_vat_tu: 'KT',
  thue_may_ky: 'KTHC',
};

// ============================================================================
// HELPERS — DB
// ============================================================================

async function loadConfig() {
  const [stagesRes, transRes] = await Promise.all([
    supabase.from('crm_kanban_stages').select('*').order('sort_order'),
    supabase.from('crm_kanban_transitions').select('*'),
  ]);
  if (stagesRes.error) throw stagesRes.error;
  if (transRes.error) throw transRes.error;
  return { stages: stagesRes.data || [], transitions: transRes.data || [] };
}

async function loadCard(id) {
  const { data, error } = await supabase
    .from('crm_kanban_cards')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) {
    const e = new Error('NOT_FOUND: Không tìm thấy thẻ');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return data;
}

async function loadFinancials(cardId) {
  const { data, error } = await supabase
    .from('crm_kanban_financials')
    .select('*')
    .eq('card_id', cardId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadCardItems(cardId) {
  const { data, error } = await supabase
    .from('crm_kanban_card_items')
    .select('*')
    .eq('card_id', cardId)
    .order('position');
  if (error) throw error;
  return data || [];
}

async function loadStageMap() {
  const { stages } = await loadConfig();
  const m = new Map();
  stages.forEach((s) => m.set(s.id, s));
  return m;
}

async function logKanban(cardId, actorId, action, fromStage, toStage, meta) {
  try {
    await supabase.from('crm_kanban_logs').insert({
      card_id: cardId,
      actor_id: actorId,
      action,
      from_stage: fromStage || null,
      to_stage: toStage || null,
      meta: meta || null,
    });
  } catch (e) {
    console.error('[kanban] log error', e);
  }
}

// ============================================================================
// NOTIFICATIONS — emit helpers
// ============================================================================

async function insertNotification({ userId, type, title, body, cardId, priority }) {
  if (!userId) return;
  try {
    await supabase.from('crm_notifications').insert({
      user_id: userId,
      type,
      title,
      message: body || null,
      entity_type: 'kanban_card',
      entity_id: cardId || null,
      card_id: cardId || null,
      is_read: false,
      priority: priority || 'normal',
    });
  } catch (e) {
    console.error('[kanban] notify error', e);
  }
}

async function notifyUsersOfDept(deptCode, payload) {
  if (!deptCode) return 0;
  const { data: dept } = await supabase
    .from('crm_departments')
    .select('id')
    .ilike('code', deptCode)
    .maybeSingle();
  if (!dept) return 0;
  const { data: users } = await supabase
    .from('crm_users')
    .select('id')
    .eq('department_id', dept.id)
    .eq('is_deleted', false)
    .eq('status', 'active');
  if (!users || users.length === 0) return 0;
  for (const u of users) {
    await insertNotification({ ...payload, userId: u.id });
  }
  return users.length;
}

// ============================================================================
// MASK helper — chuẩn hoá card payload trả về FE
// ============================================================================

function maskCardForView(ctx, card, financials, items) {
  const groupModes = fieldGroupsFor(ctx, card);
  const fin = maskFinancials(financials, groupModes);

  // Mask items: snapshot cost_price là nhạy cảm → ẩn nếu group 'cost' không view được.
  // unit_price thuộc selling. line_subtotal cũng thuộc selling.
  const viewCost = groupModes.cost === 'write' || groupModes.cost === 'read';
  const viewSelling = groupModes.selling === 'write' || groupModes.selling === 'read';

  const maskedItems = (items || []).map((it) => {
    const out = {
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      productCode: it.product_code,
      unit: it.unit,
      quantity: it.quantity,
      position: it.position,
      notes: it.notes,
    };
    if (viewSelling) {
      out.unitPrice = it.unit_price;
      out.lineSubtotal = it.line_subtotal;
    }
    if (viewCost) {
      out.costPrice = it.cost_price;
    }
    return out;
  });

  return {
    id: card.id,
    cardType: card.card_type,
    title: card.title,
    currentStage: card.current_stage,
    ownerDept: card.owner_dept,
    assignedTo: card.assigned_to,
    customerId: card.customer_id,
    customerName: card.customer_name,
    parentCardId: card.parent_card_id,
    periodLabel: card.period_label,
    periodStart: card.period_start,
    periodEnd: card.period_end,
    status: card.status,
    createdBy: card.created_by,
    createdAt: card.created_at,
    updatedAt: card.updated_at,
    financials: fin,
    items: maskedItems,
    _modes: groupModes,
  };
}

// ============================================================================
// kanban.config.get
// ============================================================================

async function kanbanConfigGet(currentUser) {
  const ctx = await getKanbanCtx(currentUser);
  const { stages, transitions } = await loadConfig();
  return {
    me: {
      userId: ctx.userId,
      role: ctx.role,
      isAdmin: ctx.isAdmin,
      isReadOnly: ctx.isReadOnly,
      deptCode: ctx.deptCode,
    },
    stages: stages.map((s) => ({
      id: s.id, name: s.name, ownerDept: s.owner_dept,
      sortOrder: s.sort_order, isTerminal: s.is_terminal,
    })),
    transitions: transitions.map((t) => ({
      id: t.id,
      cardType: t.card_type,
      fromStage: t.from_stage,
      toStage: t.to_stage,
      direction: t.direction,
      allowedRoles: t.allowed_roles,
      actingDept: t.acting_dept,
      requireFields: t.require_fields,
    })),
  };
}

// ============================================================================
// kanban.board.get
// ============================================================================

async function kanbanBoardGet(currentUser, params) {
  const ctx = await getKanbanCtx(currentUser);
  const { stages, transitions } = await loadConfig();

  const visibleCols = visibleColumnsFor(ctx, stages, transitions);
  const stageVisMap = new Map(visibleCols.map((c) => [c.stage.id, { readOnly: c.readOnly }]));
  const visibleStageIds = visibleCols.map((c) => c.stage.id);

  if (visibleStageIds.length === 0) {
    return { me: ctxOut(ctx), columns: [] };
  }

  // Lấy cards active trong các stage hiển thị
  let q = supabase
    .from('crm_kanban_cards')
    .select('*')
    .eq('status', 'active')
    .in('current_stage', visibleStageIds);
  if (params && params.cardType) q = q.eq('card_type', params.cardType);
  const { data: cards, error: cardsErr } = await q.order('updated_at', { ascending: false });
  if (cardsErr) throw cardsErr;

  // Filter theo §5.2
  const allowed = (cards || []).filter((c) => canSeeCard(ctx, c, stageVisMap));
  const ids = allowed.map((c) => c.id);

  // Bulk-load financials + items
  let finMap = new Map();
  let itemsByCard = new Map();
  if (ids.length > 0) {
    const [finRes, itRes] = await Promise.all([
      supabase.from('crm_kanban_financials').select('*').in('card_id', ids),
      supabase.from('crm_kanban_card_items').select('*').in('card_id', ids).order('position'),
    ]);
    if (finRes.error) throw finRes.error;
    if (itRes.error) throw itRes.error;
    (finRes.data || []).forEach((f) => finMap.set(f.card_id, f));
    (itRes.data || []).forEach((it) => {
      if (!itemsByCard.has(it.card_id)) itemsByCard.set(it.card_id, []);
      itemsByCard.get(it.card_id).push(it);
    });
  }

  // Group cards by stage
  const cardsByStage = new Map();
  for (const c of allowed) {
    const masked = maskCardForView(ctx, c, finMap.get(c.id) || null, itemsByCard.get(c.id) || []);
    if (!cardsByStage.has(c.current_stage)) cardsByStage.set(c.current_stage, []);
    cardsByStage.get(c.current_stage).push(masked);
  }

  const columns = visibleCols.map(({ stage, readOnly }) => ({
    stage: {
      id: stage.id, name: stage.name, ownerDept: stage.owner_dept,
      sortOrder: stage.sort_order, isTerminal: stage.is_terminal,
    },
    readOnly,
    cards: cardsByStage.get(stage.id) || [],
  }));

  return { me: ctxOut(ctx), columns };
}

function ctxOut(ctx) {
  return {
    userId: ctx.userId,
    role: ctx.role,
    isAdmin: ctx.isAdmin,
    isReadOnly: ctx.isReadOnly,
    deptCode: ctx.deptCode,
  };
}

// ============================================================================
// kanban.card.get
// ============================================================================

async function kanbanCardGet(currentUser, params) {
  const ctx = await getKanbanCtx(currentUser);
  const cardId = params?.id || params?.cardId;
  if (!cardId) {
    const e = new Error('BAD_REQUEST: Thiếu id thẻ');
    e.code = 'BAD_REQUEST'; throw e;
  }
  const card = await loadCard(cardId);
  const { stages, transitions } = await loadConfig();
  const visibleCols = visibleColumnsFor(ctx, stages, transitions);
  const stageVisMap = new Map(visibleCols.map((c) => [c.stage.id, { readOnly: c.readOnly }]));
  if (!canSeeCard(ctx, card, stageVisMap)) {
    const e = new Error('FORBIDDEN: Bạn không có quyền xem thẻ này');
    e.code = 'FORBIDDEN'; throw e;
  }
  const [fin, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  const masked = maskCardForView(ctx, card, fin, items);

  // Kèm logs (20 dòng gần nhất) — chỉ cho TP/Boss/admin
  let logs = [];
  if (ctx.role !== 'nhan_vien' || ctx.isAdmin) {
    const { data: logRows } = await supabase
      .from('crm_kanban_logs')
      .select('*')
      .eq('card_id', cardId)
      .order('at', { ascending: false })
      .limit(20);
    logs = (logRows || []).map((l) => ({
      id: l.id, action: l.action,
      fromStage: l.from_stage, toStage: l.to_stage,
      actorId: l.actor_id, meta: l.meta, at: l.at,
    }));
  }

  return { card: masked, logs };
}

// ============================================================================
// kanban.card.create + kanban.card.update (chung helper saveCard)
// ============================================================================

async function fetchProductSnapshot(productId) {
  if (!productId) return null;
  const { data } = await supabase
    .from('crm_products')
    .select('id, code, name, unit, list_price, price, cost_price, category, is_for_rent')
    .eq('id', productId)
    .single();
  return data || null;
}

/**
 * Sửa financials với ma trận editableGroupsSet → chỉ ghi field thuộc group được phép.
 * Returns { row, allowedFields[] }.
 */
function pickEditableFinancialsPatch(ctx, card, finPatchSnake) {
  const groupModes = fieldGroupsFor(ctx, card);
  const editable = editableGroupsSet(ctx, groupModes);
  const allowed = [];
  const row = {};
  if (!finPatchSnake) return { row, allowed };
  for (const [group, fields] of Object.entries(FIN_FIELDS_BY_GROUP)) {
    if (!editable.has(group)) continue;
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(finPatchSnake, f)) {
        row[f] = finPatchSnake[f];
        allowed.push(f);
      }
    }
  }
  // currency luôn cho sửa nếu có
  if (Object.prototype.hasOwnProperty.call(finPatchSnake, 'currency')) {
    row.currency = finPatchSnake.currency;
  }
  return { row, allowed };
}

/**
 * Tính tổng từ items → trả về { subtotal, totalAmount, costPriceTotal } để cập nhật financials.
 */
function rollupItems(items) {
  let subtotal = 0;
  let costTotal = 0;
  for (const it of items) {
    const qty = Number(it.quantity || 0);
    const up = Number(it.unit_price || 0);
    const cp = Number(it.cost_price || 0);
    const line = qty * up;
    subtotal += line;
    costTotal += qty * cp;
  }
  return { subtotal, totalAmount: subtotal, costPriceTotal: costTotal };
}

/**
 * Camel→snake cho payload financials (chỉ giữ field hợp lệ).
 */
function normalizeFinancialsPayload(camelObj) {
  if (!camelObj) return null;
  const out = {};
  const map = {
    currency: 'currency',
    unitPrice: 'unit_price',
    quantity: 'quantity',
    subtotal: 'subtotal',
    totalAmount: 'total_amount',
    costPrice: 'cost_price',
    margin: 'margin',
    invoiceNo: 'invoice_no',
    invoiceDate: 'invoice_date',
    debtAmount: 'debt_amount',
    dueDate: 'due_date',
    paidAmount: 'paid_amount',
    paymentStatus: 'payment_status',
  };
  for (const [c, s] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(camelObj, c)) out[s] = camelObj[c];
  }
  return out;
}

/**
 * Items: chấp nhận mảng items camelCase từ FE, đồng bộ với DB.
 * - Server tự copy cost_price từ crm_products nếu FE không gửi và costPrice rỗng.
 * - server tự tính line_subtotal = qty * unit_price.
 *
 * Bảo mật:
 *   - cost_price chỉ ghi nếu ctx có group 'cost' editable. Nếu không → ép = null cho item mới
 *     để KHÔNG bị lộ vô tình (nhưng nếu là cập nhật, KHÔNG đè giá cũ đã có).
 *   - unit_price chỉ ghi nếu group 'selling' editable.
 */
async function normalizeItemsForWrite(ctx, card, itemsCamel) {
  if (!Array.isArray(itemsCamel)) return null;
  const groupModes = fieldGroupsFor(ctx, card);
  const editable = editableGroupsSet(ctx, groupModes);
  const canWriteSelling = editable.has('selling');
  const canWriteCost = editable.has('cost');

  const out = [];
  let pos = 0;
  for (const raw of itemsCamel) {
    const productId = raw.productId || raw.product_id || null;
    let unitPrice = raw.unitPrice ?? raw.unit_price ?? null;
    let costPrice = raw.costPrice ?? raw.cost_price ?? null;
    let productName = raw.productName || raw.product_name || null;
    let productCode = raw.productCode || raw.product_code || null;
    let unit = raw.unit || null;

    // Snapshot từ crm_products nếu có productId và FE chưa gửi hết
    if (productId) {
      const prod = await fetchProductSnapshot(productId);
      if (prod) {
        if (!productName) productName = prod.name;
        if (!productCode) productCode = prod.code;
        if (!unit) unit = prod.unit;
        if (unitPrice == null) unitPrice = prod.list_price || prod.price || null;
        if (costPrice == null) costPrice = prod.cost_price || null;
      }
    }

    if (!canWriteSelling) unitPrice = null;
    if (!canWriteCost) costPrice = null;

    const quantity = Number(raw.quantity ?? 1) || 1;
    const lineSubtotal = unitPrice != null ? Number(quantity) * Number(unitPrice) : null;

    out.push({
      id: raw.id || null,
      product_id: productId,
      product_name: productName,
      product_code: productCode,
      unit,
      quantity,
      unit_price: unitPrice,
      cost_price: costPrice,
      line_subtotal: lineSubtotal,
      position: raw.position != null ? raw.position : pos,
      notes: raw.notes || null,
    });
    pos++;
  }
  return out;
}

async function emitAssignedNotification(card, prevAssignedTo, actorUserId) {
  if (!card.assigned_to) return;
  if (card.assigned_to === prevAssignedTo) return;
  if (card.assigned_to === actorUserId) return; // tự giao cho mình thì khỏi báo
  await insertNotification({
    userId: card.assigned_to,
    type: 'card_assigned',
    title: 'Thẻ mới được giao cho bạn',
    body: card.title + (card.customer_name ? ' — ' + card.customer_name : ''),
    cardId: card.id,
    priority: 'normal',
  });
}

async function kanbanCardCreate(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardType = payload?.cardType || payload?.card_type;
  if (!cardType || !INITIAL_STAGE_BY_CARD_TYPE[cardType]) {
    const e = new Error('BAD_REQUEST: cardType không hợp lệ');
    e.code = 'BAD_REQUEST'; throw e;
  }
  // thue_may_ky không cho phép tạo qua đây — phải qua rentalPeriodCreate
  if (cardType === 'thue_may_ky') {
    const e = new Error('FORBIDDEN: Thẻ kỳ thuê chỉ được tạo qua rentalPeriod.create');
    e.code = 'FORBIDDEN'; throw e;
  }
  const initialStage = INITIAL_STAGE_BY_CARD_TYPE[cardType];
  const initialDept = INITIAL_DEPT_BY_CARD_TYPE[cardType];

  // Admin được tạo cho mọi phòng; còn lại phải khớp phòng khởi tạo
  if (!ctx.isAdmin && ctx.deptCode !== initialDept) {
    const e = new Error(`FORBIDDEN: Chỉ user phòng ${initialDept} mới được tạo thẻ ${cardType}`);
    e.code = 'FORBIDDEN'; throw e;
  }

  const title = (payload.title || '').trim();
  if (!title) {
    const e = new Error('BAD_REQUEST: Thiếu tiêu đề thẻ');
    e.code = 'BAD_REQUEST'; throw e;
  }

  // NV tạo thẻ không chỉ định người phụ trách → tự gán cho chính mình,
  // nếu không thẻ unassigned sẽ không kéo được bởi chính người tạo (§5.3).
  let assignedTo = payload.assignedTo || null;
  if (!assignedTo && ctx.role === 'nhan_vien') assignedTo = ctx.userId;

  // Insert card trước (cần id để insert financials + items)
  const insertCard = {
    card_type: cardType,
    title,
    current_stage: initialStage,
    owner_dept: initialDept,
    assigned_to: assignedTo,
    customer_id: payload.customerId || null,
    customer_name: payload.customerName || null,
    status: 'active',
    created_by: ctx.userId,
  };
  const { data: created, error: cardErr } = await supabase
    .from('crm_kanban_cards')
    .insert(insertCard)
    .select()
    .single();
  if (cardErr) throw cardErr;

  // Items
  let items = [];
  if (Array.isArray(payload.items) && payload.items.length > 0) {
    const normalized = await normalizeItemsForWrite(ctx, created, payload.items);
    if (normalized && normalized.length > 0) {
      const rows = normalized.map((it) => ({ ...it, id: undefined, card_id: created.id }));
      const { data: insertedItems, error: itErr } = await supabase
        .from('crm_kanban_card_items')
        .insert(rows)
        .select();
      if (itErr) throw itErr;
      items = insertedItems || [];
    }
  }

  // Rollup → financials
  const finPatchSnake = normalizeFinancialsPayload(payload.financials);
  const { row: finPatch } = pickEditableFinancialsPatch(ctx, created, finPatchSnake);
  const rollup = rollupItems(items);
  const finInsert = {
    card_id: created.id,
    currency: finPatch.currency || 'VND',
    ...finPatch,
  };
  if (items.length > 0) {
    if (finInsert.subtotal == null) finInsert.subtotal = rollup.subtotal;
    if (finInsert.total_amount == null) finInsert.total_amount = rollup.totalAmount;
    // cost_price tổng: chỉ ghi nếu admin/KTHC/KT-TP (group 'cost' editable)
    const groupModes = fieldGroupsFor(ctx, created);
    if (editableGroupsSet(ctx, groupModes).has('cost') && finInsert.cost_price == null) {
      finInsert.cost_price = rollup.costPriceTotal;
    }
  }
  const { error: finErr } = await supabase
    .from('crm_kanban_financials')
    .insert(finInsert);
  if (finErr) throw finErr;

  // Notify assigned + log
  await emitAssignedNotification(created, null, ctx.userId);
  await logKanban(created.id, ctx.userId, 'create', null, created.current_stage, {
    cardType, itemCount: items.length,
  });

  const [finFresh, itemsFresh] = await Promise.all([loadFinancials(created.id), loadCardItems(created.id)]);
  return { card: maskCardForView(ctx, created, finFresh, itemsFresh) };
}

async function kanbanCardUpdate(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardId = payload?.id;
  if (!cardId) {
    const e = new Error('BAD_REQUEST: Thiếu id thẻ');
    e.code = 'BAD_REQUEST'; throw e;
  }
  const card = await loadCard(cardId);

  // Permission xem (nếu không xem được thì không sửa được)
  const { stages, transitions } = await loadConfig();
  const visibleCols = visibleColumnsFor(ctx, stages, transitions);
  const stageVisMap = new Map(visibleCols.map((c) => [c.stage.id, { readOnly: c.readOnly }]));
  if (!canSeeCard(ctx, card, stageVisMap)) {
    const e = new Error('FORBIDDEN: Bạn không có quyền truy cập thẻ này');
    e.code = 'FORBIDDEN'; throw e;
  }
  // NV chỉ được sửa thẻ của chính mình
  if (ctx.role === 'nhan_vien' && card.assigned_to !== ctx.userId) {
    const e = new Error('FORBIDDEN: NV chỉ được sửa thẻ được giao cho mình');
    e.code = 'FORBIDDEN'; throw e;
  }
  // Stage read-only → không cho sửa
  if (stageVisMap.get(card.current_stage)?.readOnly && !ctx.isAdmin) {
    const e = new Error('FORBIDDEN: Thẻ đang ở cột không thuộc phòng bạn (read-only)');
    e.code = 'FORBIDDEN'; throw e;
  }

  // Update card metadata (title/assigned_to/customer)
  const cardPatch = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'title')) cardPatch.title = (payload.title || '').trim();
  if (Object.prototype.hasOwnProperty.call(payload, 'assignedTo')) cardPatch.assigned_to = payload.assignedTo || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'customerId')) cardPatch.customer_id = payload.customerId || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'customerName')) cardPatch.customer_name = payload.customerName || null;

  let updatedCard = card;
  const prevAssignedTo = card.assigned_to;
  if (Object.keys(cardPatch).length > 0) {
    const { data, error } = await supabase
      .from('crm_kanban_cards')
      .update(cardPatch)
      .eq('id', cardId)
      .select()
      .single();
    if (error) throw error;
    updatedCard = data;
  }

  // Update items: replace strategy nếu payload.items được gửi
  if (Array.isArray(payload.items)) {
    const normalized = await normalizeItemsForWrite(ctx, updatedCard, payload.items);
    // Xoá items cũ → insert mới (đơn giản, tránh phức tạp diff)
    const { error: delErr } = await supabase
      .from('crm_kanban_card_items')
      .delete()
      .eq('card_id', cardId);
    if (delErr) throw delErr;
    if (normalized && normalized.length > 0) {
      const rows = normalized.map((it) => ({ ...it, id: undefined, card_id: cardId }));
      const { error: insErr } = await supabase.from('crm_kanban_card_items').insert(rows);
      if (insErr) throw insErr;
    }
  }

  // Update financials
  const finPatchSnake = normalizeFinancialsPayload(payload.financials);
  if (finPatchSnake) {
    const { row: finPatch, allowed } = pickEditableFinancialsPatch(ctx, updatedCard, finPatchSnake);
    if (allowed.length > 0 || finPatch.currency) {
      // Đảm bảo có row financials
      const existing = await loadFinancials(cardId);
      if (!existing) {
        await supabase.from('crm_kanban_financials').insert({ card_id: cardId, ...finPatch });
      } else {
        await supabase.from('crm_kanban_financials').update(finPatch).eq('card_id', cardId);
      }
    }
  }

  // Recompute rollup nếu items thay đổi
  if (Array.isArray(payload.items)) {
    const freshItems = await loadCardItems(cardId);
    const rollup = rollupItems(freshItems);
    const groupModes = fieldGroupsFor(ctx, updatedCard);
    const editable = editableGroupsSet(ctx, groupModes);
    const finExist = await loadFinancials(cardId);
    const recompute = {};
    if (editable.has('selling')) {
      // chỉ tự ghi tổng nếu FE không gửi tay
      const finSent = normalizeFinancialsPayload(payload.financials) || {};
      if (!('subtotal' in finSent)) recompute.subtotal = rollup.subtotal;
      if (!('total_amount' in finSent)) recompute.total_amount = rollup.totalAmount;
    }
    if (editable.has('cost')) {
      const finSent = normalizeFinancialsPayload(payload.financials) || {};
      if (!('cost_price' in finSent)) recompute.cost_price = rollup.costPriceTotal;
    }
    if (Object.keys(recompute).length > 0) {
      if (!finExist) {
        await supabase.from('crm_kanban_financials').insert({ card_id: cardId, ...recompute });
      } else {
        await supabase.from('crm_kanban_financials').update(recompute).eq('card_id', cardId);
      }
    }
  }

  // Notify nếu reassign
  await emitAssignedNotification(updatedCard, prevAssignedTo, ctx.userId);

  await logKanban(cardId, ctx.userId, 'update', card.current_stage, card.current_stage, {
    patchKeys: Object.keys(cardPatch),
    itemsTouched: Array.isArray(payload.items),
    financialsTouched: !!finPatchSnake,
  });

  const [fin, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  return { card: maskCardForView(ctx, updatedCard, fin, items) };
}

// ============================================================================
// kanban.move — CỔNG KIỂM SOÁT kéo-nhả (§6.4)
// ============================================================================

async function kanbanMove(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardId = payload?.cardId || payload?.id;
  const toStage = payload?.toStage;
  if (!cardId || !toStage) {
    const e = new Error('BAD_REQUEST: Thiếu cardId hoặc toStage');
    e.code = 'BAD_REQUEST'; throw e;
  }

  const card = await loadCard(cardId);

  // 3) tìm transition
  const { data: tList, error: tErr } = await supabase
    .from('crm_kanban_transitions')
    .select('*')
    .eq('card_type', card.card_type)
    .eq('from_stage', card.current_stage)
    .eq('to_stage', toStage)
    .limit(1);
  if (tErr) throw tErr;
  const t = tList && tList[0];
  if (!t) {
    const e = new Error('FORBIDDEN: Không có luồng hợp lệ');
    e.code = 'FORBIDDEN'; throw e;
  }

  // 4) role check
  const allowedRoles = Array.isArray(t.allowed_roles) ? t.allowed_roles : (t.allowed_roles || []);
  if (!ctx.isAdmin && !allowedRoles.includes(ctx.role)) {
    const e = new Error(`FORBIDDEN: Vai trò ${ctx.role} không được phép chuyển stage này`);
    e.code = 'FORBIDDEN'; throw e;
  }
  // 5) dept check (boss/admin bỏ qua)
  if (!ctx.isAdmin && ctx.role !== 'boss' && ctx.deptCode !== t.acting_dept) {
    const e = new Error(`FORBIDDEN: Chỉ phòng ${t.acting_dept} mới được thực hiện chuyển này`);
    e.code = 'FORBIDDEN'; throw e;
  }
  // 6) NV chỉ kéo thẻ của mình
  if (!ctx.isAdmin && ctx.role === 'nhan_vien' && card.assigned_to !== ctx.userId) {
    const e = new Error('FORBIDDEN: NV chỉ được kéo thẻ được giao cho mình');
    e.code = 'FORBIDDEN'; throw e;
  }

  // 7) require_fields
  const requireFields = Array.isArray(t.require_fields) ? t.require_fields : (t.require_fields || []);
  let fin = null;
  if (requireFields.length > 0 || toStage === 'DONE') {
    fin = await loadFinancials(cardId);
  }
  for (const f of requireFields) {
    const v = fin ? fin[f] : null;
    if (v == null || v === '' ) {
      const e = new Error(`VALIDATION: Thiếu điều kiện: ${f}`);
      e.code = 'VALIDATION';
      e.statusCode = 422;
      throw e;
    }
  }
  // 7b) đóng thẻ
  if (toStage === 'DONE' && ['ban_may', 'ban_vat_tu', 'thue_may_ky'].includes(card.card_type)) {
    if (!fin || fin.payment_status !== 'paid') {
      const e = new Error('VALIDATION: Chưa thu đủ công nợ, không được đóng thẻ');
      e.code = 'VALIDATION';
      e.statusCode = 422;
      throw e;
    }
  }

  // 8) update
  const stageMap = await loadStageMap();
  const newStageRow = stageMap.get(toStage);
  const newStatus = newStageRow?.is_terminal ? 'done' : card.status;

  const { data: updated, error: upErr } = await supabase
    .from('crm_kanban_cards')
    .update({ current_stage: toStage, status: newStatus })
    .eq('id', cardId)
    .select()
    .single();
  if (upErr) throw upErr;

  // 9) Log + notifications
  await logKanban(cardId, ctx.userId, 'move', card.current_stage, toStage, {
    direction: t.direction,
    cardType: card.card_type,
  });

  // Notification: handoff / returned
  const oldStage = stageMap.get(card.current_stage);
  const newStage = stageMap.get(toStage);
  const oldDept = oldStage?.owner_dept;
  const newDept = newStage?.owner_dept;

  if (t.direction === 'forward' && newDept && newDept !== oldDept) {
    // bàn giao sang phòng khác
    await notifyUsersOfDept(newDept, {
      type: 'card_handoff',
      title: `Có thẻ mới bàn giao cho phòng ${newDept}`,
      body: card.title + (card.customer_name ? ' — ' + card.customer_name : '') + ` (${newStage.name})`,
      cardId: cardId,
      priority: 'normal',
    });
  } else if (t.direction === 'backward') {
    // kéo lùi — báo phòng cũ + người được giao
    if (oldDept) {
      await notifyUsersOfDept(oldDept, {
        type: 'card_returned',
        title: `Thẻ bị kéo lùi về ${oldDept}`,
        body: card.title + (card.customer_name ? ' — ' + card.customer_name : '') + ` (về ${oldStage.name})`,
        cardId: cardId,
        priority: 'high',
      });
    }
    if (card.assigned_to && card.assigned_to !== ctx.userId) {
      await insertNotification({
        userId: card.assigned_to,
        type: 'card_returned',
        title: 'Thẻ của bạn bị kéo lùi',
        body: card.title + (oldStage ? ` (về ${oldStage.name})` : ''),
        cardId: cardId,
        priority: 'high',
      });
    }
  }

  const [finFresh, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  return { card: maskCardForView(ctx, updated, finFresh, items) };
}

// ============================================================================
// kanban.rentalPeriod.create — sinh kỳ thuê từ hợp đồng (§6.6)
// ============================================================================

async function kanbanRentalPeriodCreate(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const contractId = payload?.contractCardId;
  if (!contractId) {
    const e = new Error('BAD_REQUEST: Thiếu contractCardId');
    e.code = 'BAD_REQUEST'; throw e;
  }
  // Quyền: KTHC + Boss/admin
  if (!ctx.isAdmin && ctx.deptCode !== 'KTHC') {
    const e = new Error('FORBIDDEN: Chỉ KTHC hoặc admin mới được tạo kỳ thuê');
    e.code = 'FORBIDDEN'; throw e;
  }
  const contract = await loadCard(contractId);
  if (contract.card_type !== 'thue_may') {
    const e = new Error('BAD_REQUEST: Thẻ nguồn phải là thue_may');
    e.code = 'BAD_REQUEST'; throw e;
  }
  if (contract.current_stage !== 'RENTAL_ACTIVE') {
    const e = new Error('BAD_REQUEST: Hợp đồng phải đang ở RENTAL_ACTIVE');
    e.code = 'BAD_REQUEST'; throw e;
  }

  const periodLabel = payload.periodLabel || null;
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || null;

  const insertPeriod = {
    card_type: 'thue_may_ky',
    title: contract.title + (periodLabel ? ' — ' + periodLabel : ''),
    current_stage: 'KTHC_INVOICE',
    owner_dept: 'KTHC',
    assigned_to: null,
    customer_id: contract.customer_id,
    customer_name: contract.customer_name,
    parent_card_id: contract.id,
    period_label: periodLabel,
    period_start: periodStart,
    period_end: periodEnd,
    status: 'active',
    created_by: ctx.userId,
  };
  const { data: created, error } = await supabase
    .from('crm_kanban_cards')
    .insert(insertPeriod)
    .select()
    .single();
  if (error) throw error;

  // Tạo financials rỗng để chuông + kéo-nhả có nơi check
  await supabase.from('crm_kanban_financials').insert({ card_id: created.id, currency: 'VND' });

  await logKanban(created.id, ctx.userId, 'rental_period_create', null, 'KTHC_INVOICE', {
    contractCardId: contractId,
    periodLabel, periodStart, periodEnd,
  });

  const [fin, items] = await Promise.all([loadFinancials(created.id), loadCardItems(created.id)]);
  return { card: maskCardForView(ctx, created, fin, items) };
}

// ============================================================================
// kanban.notifications.list / read (§6.9)
// ============================================================================

async function kanbanNotificationsList(currentUser, params) {
  const limit = parseInt(params?.limit || 30, 10);
  const { data: items, error } = await supabase
    .from('crm_notifications')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const { count, error: cErr } = await supabase
    .from('crm_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .eq('is_read', false)
    .eq('is_deleted', false);
  if (cErr) throw cErr;
  return {
    items: snakeToCamel(items || []),
    unreadCount: count || 0,
  };
}

async function kanbanNotificationsRead(currentUser, payload) {
  const ids = payload?.ids;
  const all = !!payload?.all;
  if (!all && (!ids || ids.length === 0)) {
    const e = new Error('BAD_REQUEST: Thiếu ids hoặc cờ all');
    e.code = 'BAD_REQUEST'; throw e;
  }
  let q = supabase
    .from('crm_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', currentUser.id);
  if (!all) q = q.in('id', ids);
  else q = q.eq('is_read', false);
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}

// ============================================================================
// kanban.debt.scan — chạy thủ công (admin only)
// ============================================================================

async function kanbanDebtScan(currentUser) {
  const ctx = await getKanbanCtx(currentUser);
  if (!ctx.isAdmin) {
    const e = new Error('FORBIDDEN: Chỉ admin mới chạy được debt.scan thủ công');
    e.code = 'FORBIDDEN'; throw e;
  }
  const { data, error } = await supabase.rpc('fn_debt_reminder_scan');
  if (error) throw error;
  return { result: snakeToCamel(data || {}) };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  kanbanConfigGet,
  kanbanBoardGet,
  kanbanCardGet,
  kanbanCardCreate,
  kanbanCardUpdate,
  kanbanMove,
  kanbanRentalPeriodCreate,
  kanbanNotificationsList,
  kanbanNotificationsRead,
  kanbanDebtScan,
};
