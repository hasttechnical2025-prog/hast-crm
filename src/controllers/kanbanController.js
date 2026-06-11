/**
 * Kanban v3 — Controller (cổng kiểm soát duy nhất). MÔ HÌNH HAI LUỒNG.
 * Tham chiếu: plans/kanban_rebuild_spec.md v3 (§1A ưu tiên cao nhất).
 *
 * Actions (qua mainController dispatch):
 *   - kanban.config.get          — stages(+track) + transitions cho FE
 *   - kanban.board.get           — board đã lọc theo track + phòng + role; mask field
 *   - kanban.card.get            — đọc 1 thẻ cho drawer (kèm payments + logs)
 *   - kanban.card.update         — sửa field theo editableGroupsFor (KTHC hóa đơn/thanh toán)
 *   - kanban.card.forceClose     — đóng tay / xóa nợ (admin + KTHC-TP), ghi lý do
 *   - kanban.move                — cổng kéo-nhả; →COM_DONE auto khi số dư=0 (không kéo tay)
 *   - kanban.rentalPeriod.create — nút "Tạo kỳ thuê" trên thẻ kỹ thuật thue_may TECH_ACTIVE (KT-NV)
 *   - kanban.payment.add         — ghi khoản thu (KD→pending; KTHC→confirmed)
 *   - kanban.payment.confirm     — KTHC xác nhận khoản pending → trừ nợ + sync đơn
 *   - kanban.payment.list        — sổ thanh toán của 1 thẻ
 *   - kanban.notifications.list/read — chuông 🔔
 *   - kanban.debt.scan           — chạy thủ công fn_debt_reminder_scan() — admin only
 *
 * Auto-create hook (gọi từ crudController sau khi tạo crm_orders): createCardsFromOrder().
 * KHÔNG còn kanban.card.create thủ công — thẻ sinh từ đơn (§0.3).
 */
const { supabase } = require('../config');
const { snakeToCamel } = require('../utils/helpers');
const { getKanbanCtx, requireWritable } = require('../utils/kanban-auth');
const {
  FIN_FIELDS_BY_GROUP,
  fieldGroupsFor,
  editableGroupsSet,
  maskFinancials,
  visibleColumnsFor,
  canSeeCard,
} = require('../utils/kanban-visibility');

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
  const { data, error } = await supabase.from('crm_kanban_cards').select('*').eq('id', id).single();
  if (error || !data) {
    const e = new Error('NOT_FOUND: Không tìm thấy thẻ');
    e.code = 'NOT_FOUND';
    throw e;
  }
  return data;
}

async function loadFinancials(cardId) {
  const { data, error } = await supabase
    .from('crm_kanban_financials').select('*').eq('card_id', cardId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadCardItems(cardId) {
  const { data, error } = await supabase
    .from('crm_kanban_card_items').select('*').eq('card_id', cardId).order('position');
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
      card_id: cardId, actor_id: actorId, action,
      from_stage: fromStage || null, to_stage: toStage || null, meta: meta || null,
    });
  } catch (e) { console.error('[kanban] log error', e); }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

async function insertNotification({ userId, type, title, body, cardId, priority }) {
  if (!userId) return;
  try {
    await supabase.from('crm_notifications').insert({
      user_id: userId, type, title, message: body || null,
      entity_type: 'kanban_card', entity_id: cardId || null, card_id: cardId || null,
      is_read: false, priority: priority || 'normal',
    });
  } catch (e) { console.error('[kanban] notify error', e); }
}

async function notifyUsersOfDept(deptCode, payload) {
  if (!deptCode) return 0;
  const { data: dept } = await supabase
    .from('crm_departments').select('id').ilike('code', deptCode).maybeSingle();
  if (!dept) return 0;
  const { data: users } = await supabase
    .from('crm_users').select('id')
    .eq('department_id', dept.id).eq('is_deleted', false).eq('status', 'active');
  if (!users || users.length === 0) return 0;
  for (const u of users) await insertNotification({ ...payload, userId: u.id });
  return users.length;
}

// ============================================================================
// MASK — chuẩn hoá card payload cho FE
// ============================================================================

function maskCardForView(ctx, card, financials, items) {
  const groupModes = fieldGroupsFor(ctx, card);
  const fin = maskFinancials(financials, groupModes);

  const viewCost = groupModes.cost === 'write' || groupModes.cost === 'read';
  const viewSelling = groupModes.selling === 'write' || groupModes.selling === 'read';

  // Thẻ kỹ thuật: chỉ tên/SL máy (KHÔNG giá). Thẻ thương mại: theo nhóm xem được.
  const maskedItems = (items || []).map((it) => {
    const out = {
      id: it.id, productId: it.product_id, productName: it.product_name,
      productCode: it.product_code, unit: it.unit, quantity: it.quantity,
      position: it.position, notes: it.notes,
    };
    if (card.track !== 'technical' && viewSelling) {
      out.unitPrice = it.unit_price;
      out.lineSubtotal = it.line_subtotal;
    }
    if (card.track !== 'technical' && viewCost) {
      out.costPrice = it.cost_price;
    }
    return out;
  });

  return {
    id: card.id,
    cardType: card.card_type,
    track: card.track,
    title: card.title,
    currentStage: card.current_stage,
    ownerDept: card.owner_dept,
    assignedTo: card.assigned_to,
    customerId: card.customer_id,
    customerName: card.customer_name,
    customerAddress: card.customer_address,
    orderId: card.order_id,
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

function ctxOut(ctx) {
  return {
    userId: ctx.userId, role: ctx.role, isAdmin: ctx.isAdmin,
    isReadOnly: ctx.isReadOnly, deptCode: ctx.deptCode,
  };
}

// ============================================================================
// kanban.config.get
// ============================================================================

async function kanbanConfigGet(currentUser) {
  const ctx = await getKanbanCtx(currentUser);
  const { stages, transitions } = await loadConfig();
  return {
    me: ctxOut(ctx),
    stages: stages.map((s) => ({
      id: s.id, name: s.name, ownerDept: s.owner_dept,
      sortOrder: s.sort_order, isTerminal: s.is_terminal, track: s.track,
    })),
    transitions: transitions.map((t) => ({
      id: t.id, cardType: t.card_type, fromStage: t.from_stage, toStage: t.to_stage,
      direction: t.direction, allowedRoles: t.allowed_roles,
      actingDept: t.acting_dept, requireFields: t.require_fields,
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
  if (visibleStageIds.length === 0) return { me: ctxOut(ctx), columns: [] };

  let q = supabase.from('crm_kanban_cards').select('*')
    .eq('status', 'active').in('current_stage', visibleStageIds);
  if (params && params.track) q = q.eq('track', params.track);
  const { data: cards, error } = await q.order('updated_at', { ascending: false });
  if (error) throw error;

  const allowed = (cards || []).filter((c) => canSeeCard(ctx, c, stageVisMap));
  const ids = allowed.map((c) => c.id);

  const finMap = new Map();
  const itemsByCard = new Map();
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

  const cardsByStage = new Map();
  for (const c of allowed) {
    const masked = maskCardForView(ctx, c, finMap.get(c.id) || null, itemsByCard.get(c.id) || []);
    if (!cardsByStage.has(c.current_stage)) cardsByStage.set(c.current_stage, []);
    cardsByStage.get(c.current_stage).push(masked);
  }

  const columns = visibleCols.map(({ stage, readOnly }) => ({
    stage: {
      id: stage.id, name: stage.name, ownerDept: stage.owner_dept,
      sortOrder: stage.sort_order, isTerminal: stage.is_terminal, track: stage.track,
    },
    readOnly,
    cards: cardsByStage.get(stage.id) || [],
  }));

  return { me: ctxOut(ctx), columns };
}

// ============================================================================
// kanban.card.get
// ============================================================================

async function kanbanCardGet(currentUser, params) {
  const ctx = await getKanbanCtx(currentUser);
  const cardId = params?.id || params?.cardId;
  if (!cardId) { const e = new Error('BAD_REQUEST: Thiếu id thẻ'); e.code = 'BAD_REQUEST'; throw e; }
  const card = await loadCard(cardId);

  const { stages, transitions } = await loadConfig();
  const visibleCols = visibleColumnsFor(ctx, stages, transitions);
  const stageVisMap = new Map(visibleCols.map((c) => [c.stage.id, { readOnly: c.readOnly }]));
  if (!canSeeCard(ctx, card, stageVisMap)) {
    const e = new Error('FORBIDDEN: Bạn không có quyền xem thẻ này'); e.code = 'FORBIDDEN'; throw e;
  }
  const [fin, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  const masked = maskCardForView(ctx, card, fin, items);

  // Sổ thanh toán — chỉ với thẻ thương mại + vai thấy được debt/billing
  let payments = [];
  const modes = masked._modes;
  const canSeePayments = card.track === 'commercial' &&
    (modes.debt === 'write' || modes.debt === 'read' || ctx.isAdmin);
  if (canSeePayments) {
    const { data: pays } = await supabase
      .from('crm_kanban_payments').select('*').eq('card_id', cardId)
      .order('created_at', { ascending: false });
    payments = (pays || []).map((p) => ({
      id: p.id, amount: p.amount, recordedBy: p.recorded_by, recordedDept: p.recorded_dept,
      status: p.status, confirmedBy: p.confirmed_by, confirmedAt: p.confirmed_at,
      note: p.note, createdAt: p.created_at,
    }));
  }

  let logs = [];
  if (ctx.role !== 'nhan_vien' || ctx.isAdmin) {
    const { data: logRows } = await supabase
      .from('crm_kanban_logs').select('*').eq('card_id', cardId)
      .order('at', { ascending: false }).limit(20);
    logs = (logRows || []).map((l) => ({
      id: l.id, action: l.action, fromStage: l.from_stage, toStage: l.to_stage,
      actorId: l.actor_id, meta: l.meta, at: l.at,
    }));
  }

  return { card: masked, payments, logs };
}

// ============================================================================
// PAYMENTS — sổ thanh toán có xác nhận (§1A)
// ============================================================================

/**
 * Tính lại số dư từ financials + payments confirmed; nếu = 0 → auto COM_DONE + sync đơn.
 * NGUỒN SỰ THẬT (DK chốt): crm_kanban_payments confirmed → sync về crm_orders.
 */
async function recomputeBalanceAndMaybeClose(cardId, actorId) {
  const card = await loadCard(cardId);
  if (card.track !== 'commercial') return { balance: null };

  const fin = await loadFinancials(cardId);
  const total = Number(fin?.total_amount || 0);

  const { data: pays } = await supabase
    .from('crm_kanban_payments').select('amount, status').eq('card_id', cardId);
  const paidConfirmed = (pays || [])
    .filter((p) => p.status === 'confirmed')
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  const balance = total - paidConfirmed;
  const paymentStatus = balance <= 0 && total > 0 ? 'paid' : (paidConfirmed > 0 ? 'partial' : 'unpaid');

  // Cập nhật financials động (paid_amount/debt_amount/payment_status)
  await supabase.from('crm_kanban_financials').update({
    paid_amount: paidConfirmed,
    debt_amount: balance > 0 ? balance : 0,
    payment_status: paymentStatus,
  }).eq('card_id', cardId);

  // Sync về đơn hàng (nguồn sự thật) nếu thẻ gắn order
  if (card.order_id) {
    const { data: order } = await supabase
      .from('crm_orders').select('total_amount').eq('id', card.order_id).maybeSingle();
    const orderTotal = Number(order?.total_amount || total);
    await supabase.from('crm_orders').update({
      paid_amount: paidConfirmed,
      remaining_amount: Math.max(orderTotal - paidConfirmed, 0),
      payment_status: paymentStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', card.order_id);
  }

  // Auto-complete: số dư = 0 và thẻ đang ở COM_DEBT → tự sang COM_DONE (không ai kéo)
  if (balance <= 0 && total > 0 && card.status === 'active' && card.current_stage === 'COM_DEBT') {
    await supabase.from('crm_kanban_cards')
      .update({ current_stage: 'COM_DONE', status: 'done' }).eq('id', cardId);
    await logKanban(cardId, actorId, 'auto_complete', 'COM_DEBT', 'COM_DONE',
      { reason: 'balance_zero', total, paidConfirmed });
    // Báo phòng tạo đơn + người tạo
    if (card.created_by) {
      await insertNotification({
        userId: card.created_by, type: 'card_returned',
        title: 'Thẻ đã hoàn tất (thu đủ công nợ)',
        body: card.title + ' — đã thu đủ, tự động đóng.', cardId, priority: 'normal',
      });
    }
  }

  return { balance, paidConfirmed, total, paymentStatus };
}

async function kanbanPaymentAdd(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardId = payload?.cardId;
  const amount = Number(payload?.amount);
  if (!cardId || !(amount > 0)) {
    const e = new Error('BAD_REQUEST: Thiếu cardId hoặc amount > 0'); e.code = 'BAD_REQUEST'; throw e;
  }
  const card = await loadCard(cardId);
  if (card.track !== 'commercial') {
    const e = new Error('BAD_REQUEST: Chỉ thẻ thương mại mới ghi thanh toán'); e.code = 'BAD_REQUEST'; throw e;
  }
  // Ai được ghi: KTHC, admin, hoặc phòng tạo đơn (KD máy / KT vật tư). Vai khác → 403.
  const isOriginDept = ctx.deptCode && card.owner_dept === ctx.deptCode;
  const isKTHC = ctx.deptCode === 'KTHC';
  if (!ctx.isAdmin && !isKTHC && !isOriginDept) {
    const e = new Error('FORBIDDEN: Bạn không có quyền ghi thanh toán cho thẻ này'); e.code = 'FORBIDDEN'; throw e;
  }

  // KTHC/admin ghi → confirmed luôn; phòng tạo đơn (KD) ghi → pending.
  const confirmed = ctx.isAdmin || isKTHC;
  const row = {
    card_id: cardId, amount, recorded_by: ctx.userId, recorded_dept: ctx.deptCode || 'NA',
    status: confirmed ? 'confirmed' : 'pending',
    confirmed_by: confirmed ? ctx.userId : null,
    confirmed_at: confirmed ? new Date().toISOString() : null,
    note: payload.note || null,
  };
  const { data: inserted, error } = await supabase
    .from('crm_kanban_payments').insert(row).select().single();
  if (error) throw error;

  await logKanban(cardId, ctx.userId, confirmed ? 'payment_confirmed' : 'payment_pending',
    card.current_stage, card.current_stage, { amount, paymentId: inserted.id });

  let balanceInfo = { balance: null };
  if (confirmed) {
    balanceInfo = await recomputeBalanceAndMaybeClose(cardId, ctx.userId);
  } else {
    // Báo KTHC có khoản chờ xác nhận
    await notifyUsersOfDept('KTHC', {
      type: 'card_handoff', title: 'Có khoản thanh toán chờ xác nhận',
      body: `${card.title} — ${amount.toLocaleString('vi-VN')} (ghi bởi ${ctx.deptCode})`,
      cardId, priority: 'normal',
    });
  }

  return { payment: snakeToCamel(inserted), balance: balanceInfo.balance, pending: !confirmed };
}

async function kanbanPaymentConfirm(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);
  if (!ctx.isAdmin && ctx.deptCode !== 'KTHC') {
    const e = new Error('FORBIDDEN: Chỉ KTHC/admin xác nhận thanh toán'); e.code = 'FORBIDDEN'; throw e;
  }
  const paymentId = payload?.paymentId;
  if (!paymentId) { const e = new Error('BAD_REQUEST: Thiếu paymentId'); e.code = 'BAD_REQUEST'; throw e; }

  const { data: pay, error: pErr } = await supabase
    .from('crm_kanban_payments').select('*').eq('id', paymentId).single();
  if (pErr || !pay) { const e = new Error('NOT_FOUND: Không tìm thấy khoản thanh toán'); e.code = 'NOT_FOUND'; throw e; }
  if (pay.status === 'confirmed') return { ok: true, alreadyConfirmed: true };

  const { error } = await supabase.from('crm_kanban_payments').update({
    status: 'confirmed', confirmed_by: ctx.userId, confirmed_at: new Date().toISOString(),
  }).eq('id', paymentId);
  if (error) throw error;

  await logKanban(pay.card_id, ctx.userId, 'payment_confirmed', null, null,
    { amount: pay.amount, paymentId });
  const balanceInfo = await recomputeBalanceAndMaybeClose(pay.card_id, ctx.userId);
  return { ok: true, balance: balanceInfo.balance };
}

async function kanbanPaymentList(currentUser, params) {
  const ctx = await getKanbanCtx(currentUser);
  const cardId = params?.cardId;
  if (!cardId) { const e = new Error('BAD_REQUEST: Thiếu cardId'); e.code = 'BAD_REQUEST'; throw e; }
  const card = await loadCard(cardId);
  const { stages, transitions } = await loadConfig();
  const visibleCols = visibleColumnsFor(ctx, stages, transitions);
  const stageVisMap = new Map(visibleCols.map((c) => [c.stage.id, { readOnly: c.readOnly }]));
  if (!canSeeCard(ctx, card, stageVisMap)) {
    const e = new Error('FORBIDDEN: Không có quyền xem thẻ'); e.code = 'FORBIDDEN'; throw e;
  }
  const { data: pays } = await supabase
    .from('crm_kanban_payments').select('*').eq('card_id', cardId)
    .order('created_at', { ascending: false });
  return { payments: snakeToCamel(pays || []) };
}

/**
 * Tóm tắt thanh toán cho 1 ĐƠN HÀNG — dùng ở màn Bán hàng (nút "Ghi nhận thanh toán").
 * Hợp nhất sổ về crm_kanban_payments: tìm thẻ thương mại CHÍNH của đơn (parent_card_id null),
 * trả Tổng / Đã trả (confirmed) / Còn lại / Chờ xác nhận + cardId để màn đơn ghi khoản chung sổ.
 */
async function kanbanPaymentSummaryByOrder(currentUser, params) {
  const ctx = await getKanbanCtx(currentUser);
  const orderId = params?.orderId;
  if (!orderId) { const e = new Error('BAD_REQUEST: Thiếu orderId'); e.code = 'BAD_REQUEST'; throw e; }

  const { data: cards } = await supabase
    .from('crm_kanban_cards').select('*')
    .eq('order_id', orderId).eq('track', 'commercial').is('parent_card_id', null);
  const card = (cards || [])[0];
  if (!card) {
    // Đơn thuê máy (không có thẻ thương mại chính) — thanh toán theo kỳ trên Kanban.
    return { hasCard: false, message: 'Đơn này thanh toán theo kỳ thuê trên Kanban (không có công nợ tổng).' };
  }

  const fin = await loadFinancials(card.id);
  const total = Number(fin?.total_amount || 0);
  const { data: pays } = await supabase
    .from('crm_kanban_payments').select('*').eq('card_id', card.id)
    .order('created_at', { ascending: false });
  const confirmed = (pays || []).filter((p) => p.status === 'confirmed').reduce((s, p) => s + Number(p.amount || 0), 0);
  const pending = (pays || []).filter((p) => p.status === 'pending').reduce((s, p) => s + Number(p.amount || 0), 0);

  return {
    hasCard: true,
    cardId: card.id,
    total,
    paidConfirmed: confirmed,
    balance: Math.max(total - confirmed, 0),
    pendingTotal: pending,
    canRecord: !ctx.isReadOnly,
    canConfirm: ctx.isAdmin || ctx.deptCode === 'KTHC',
    payments: (pays || []).map((p) => ({
      id: p.id, amount: p.amount, recordedDept: p.recorded_dept,
      status: p.status, note: p.note, createdAt: p.created_at,
    })),
  };
}

/**
 * Hook khi XÓA đơn hàng (gọi từ crudDelete trước khi soft-delete đơn).
 * Spec §12.1:
 *  - Nếu thẻ liên quan có số hóa đơn HOẶC khoản payment confirmed → CHẶN xóa
 *    (chỉ admin được hủy = cancel, không xóa cứng). Non-admin → 403.
 *  - Ngược lại: set mọi thẻ liên quan status='cancelled' (gỡ board, giữ audit).
 * Trả về số thẻ đã cancel. Throw nếu bị chặn.
 */
async function cancelCardsForOrder(orderId, user) {
  const { data: cards } = await supabase
    .from('crm_kanban_cards').select('id, track, status').eq('order_id', orderId);
  if (!cards || cards.length === 0) return 0;

  const cardIds = cards.map((c) => c.id);

  // Kiểm tra ràng buộc: có số hóa đơn?
  const { data: fins } = await supabase
    .from('crm_kanban_financials').select('card_id, invoice_no').in('card_id', cardIds);
  const hasInvoice = (fins || []).some((f) => f.invoice_no != null && String(f.invoice_no).trim() !== '');

  // Có payment đã xác nhận?
  const { data: pays } = await supabase
    .from('crm_kanban_payments').select('card_id, status').in('card_id', cardIds).eq('status', 'confirmed');
  const hasConfirmedPayment = (pays || []).length > 0;

  if (hasInvoice || hasConfirmedPayment) {
    if (user.role !== 'admin') {
      const e = new Error('FORBIDDEN: Đơn đã có hóa đơn hoặc khoản thanh toán đã xác nhận — không thể xóa. Liên hệ admin để hủy.');
      e.code = 'FORBIDDEN';
      throw e;
    }
    // admin: cho phép hủy (cancel thẻ), không chặn.
  }

  // Cancel mọi thẻ active của đơn (giữ audit, gỡ khỏi board).
  const { error } = await supabase
    .from('crm_kanban_cards').update({ status: 'cancelled' })
    .eq('order_id', orderId).neq('status', 'cancelled');
  if (error) throw error;

  for (const c of cards) {
    await logKanban(c.id, user.id, 'cancel', c.status, 'cancelled',
      { reason: 'order_deleted', orderId, hadInvoice: hasInvoice, hadConfirmedPayment: hasConfirmedPayment });
  }
  return cards.length;
}

// ============================================================================
// kanban.move — cổng kéo-nhả v3
// ============================================================================

async function kanbanMove(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardId = payload?.cardId || payload?.id;
  const toStage = payload?.toStage;
  if (!cardId || !toStage) { const e = new Error('BAD_REQUEST: Thiếu cardId hoặc toStage'); e.code = 'BAD_REQUEST'; throw e; }

  // Cấm kéo tay vào COM_DONE — chỉ auto (số dư=0) hoặc forceClose.
  if (toStage === 'COM_DONE') {
    const e = new Error('VALIDATION: Thẻ thương mại tự hoàn tất khi thu đủ công nợ — không kéo tay. Dùng "Đóng tay/Xóa nợ" nếu cần.');
    e.code = 'VALIDATION'; e.statusCode = 422; throw e;
  }

  const card = await loadCard(cardId);

  const { data: tList, error: tErr } = await supabase
    .from('crm_kanban_transitions').select('*')
    .eq('card_type', card.card_type).eq('from_stage', card.current_stage)
    .eq('to_stage', toStage).limit(1);
  if (tErr) throw tErr;
  const t = tList && tList[0];
  if (!t) { const e = new Error('FORBIDDEN: Không có luồng hợp lệ'); e.code = 'FORBIDDEN'; throw e; }

  const allowedRoles = Array.isArray(t.allowed_roles) ? t.allowed_roles : (t.allowed_roles || []);
  if (!ctx.isAdmin && !allowedRoles.includes(ctx.role)) {
    const e = new Error(`FORBIDDEN: Vai trò ${ctx.role} không được phép chuyển stage này`); e.code = 'FORBIDDEN'; throw e;
  }
  if (!ctx.isAdmin && ctx.role !== 'boss' && ctx.deptCode !== t.acting_dept) {
    const e = new Error(`FORBIDDEN: Chỉ phòng ${t.acting_dept} mới được thực hiện chuyển này`); e.code = 'FORBIDDEN'; throw e;
  }
  if (!ctx.isAdmin && ctx.role === 'nhan_vien' && card.assigned_to !== ctx.userId) {
    const e = new Error('FORBIDDEN: NV chỉ được kéo thẻ được giao cho mình'); e.code = 'FORBIDDEN'; throw e;
  }

  const requireFields = Array.isArray(t.require_fields) ? t.require_fields : (t.require_fields || []);
  if (requireFields.length > 0) {
    const fin = await loadFinancials(cardId);
    for (const f of requireFields) {
      const v = fin ? fin[f] : null;
      if (v == null || v === '') {
        const e = new Error(`VALIDATION: Thiếu điều kiện: ${f}`); e.code = 'VALIDATION'; e.statusCode = 422; throw e;
      }
    }
  }

  const stageMap = await loadStageMap();
  const newStageRow = stageMap.get(toStage);
  const newStatus = newStageRow?.is_terminal ? 'done' : card.status;

  const { data: updated, error: upErr } = await supabase
    .from('crm_kanban_cards').update({ current_stage: toStage, status: newStatus })
    .eq('id', cardId).select().single();
  if (upErr) throw upErr;

  await logKanban(cardId, ctx.userId, 'move', card.current_stage, toStage,
    { direction: t.direction, cardType: card.card_type });

  // Notifications: handoff (vượt phòng) / returned (lùi)
  const oldStage = stageMap.get(card.current_stage);
  const newStage = stageMap.get(toStage);
  if (t.direction === 'forward' && newStage?.owner_dept && newStage.owner_dept !== oldStage?.owner_dept
      && newStage.owner_dept !== 'ORIGIN') {
    await notifyUsersOfDept(newStage.owner_dept, {
      type: 'card_handoff', title: `Có thẻ mới bàn giao cho phòng ${newStage.owner_dept}`,
      body: card.title + (card.customer_name ? ' — ' + card.customer_name : '') + ` (${newStage.name})`,
      cardId, priority: 'normal',
    });
  } else if (t.direction === 'backward' && card.assigned_to && card.assigned_to !== ctx.userId) {
    await insertNotification({
      userId: card.assigned_to, type: 'card_returned', title: 'Thẻ của bạn bị kéo lùi',
      body: card.title + (oldStage ? ` (về ${newStage?.name || toStage})` : ''),
      cardId, priority: 'high',
    });
  }

  const [finFresh, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  return { card: maskCardForView(ctx, updated, finFresh, items) };
}

// ============================================================================
// kanban.card.forceClose — đóng tay / xóa nợ (admin + KTHC-TP)
// ============================================================================

async function kanbanCardForceClose(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardId = payload?.cardId;
  const reason = (payload?.reason || '').trim();
  if (!cardId) { const e = new Error('BAD_REQUEST: Thiếu cardId'); e.code = 'BAD_REQUEST'; throw e; }
  if (!reason) { const e = new Error('BAD_REQUEST: Bắt buộc ghi lý do đóng tay/xóa nợ'); e.code = 'BAD_REQUEST'; throw e; }

  // Chỉ admin + KTHC-TP
  const isKthcTP = ctx.deptCode === 'KTHC' && ctx.role === 'truong_phong';
  if (!ctx.isAdmin && !isKthcTP) {
    const e = new Error('FORBIDDEN: Chỉ admin hoặc Trưởng phòng KTHC được đóng tay/xóa nợ'); e.code = 'FORBIDDEN'; throw e;
  }

  const card = await loadCard(cardId);
  if (card.track !== 'commercial') {
    const e = new Error('BAD_REQUEST: Chỉ áp dụng cho thẻ thương mại'); e.code = 'BAD_REQUEST'; throw e;
  }

  const { data: updated, error } = await supabase
    .from('crm_kanban_cards').update({ current_stage: 'COM_DONE', status: 'done' })
    .eq('id', cardId).select().single();
  if (error) throw error;

  // Đánh dấu write-off trên financials (giữ debt thực để kế toán biết, payment_status='paid' để khỏi nhắc nợ)
  await supabase.from('crm_kanban_financials')
    .update({ payment_status: 'paid' }).eq('card_id', cardId);

  await logKanban(cardId, ctx.userId, 'force_close', card.current_stage, 'COM_DONE',
    { reason, by: ctx.appRole, dept: ctx.deptCode });

  const [fin, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  return { card: maskCardForView(ctx, updated, fin, items) };
}

// ============================================================================
// kanban.card.update — sửa field theo editableGroupsFor
// ============================================================================

function normalizeFinancialsPayload(camelObj) {
  if (!camelObj) return null;
  const out = {};
  const map = {
    currency: 'currency', unitPrice: 'unit_price', quantity: 'quantity',
    subtotal: 'subtotal', totalAmount: 'total_amount', costPrice: 'cost_price', margin: 'margin',
    invoiceNo: 'invoice_no', invoiceDate: 'invoice_date',
    debtAmount: 'debt_amount', dueDate: 'due_date', paidAmount: 'paid_amount', paymentStatus: 'payment_status',
  };
  for (const [c, s] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(camelObj, c)) out[s] = camelObj[c];
  }
  return out;
}

function pickEditableFinancialsPatch(ctx, card, finPatchSnake) {
  const groupModes = fieldGroupsFor(ctx, card);
  const editable = editableGroupsSet(ctx, groupModes);
  const allowed = [];
  const row = {};
  if (!finPatchSnake) return { row, allowed };
  for (const [group, fields] of Object.entries(FIN_FIELDS_BY_GROUP)) {
    if (!editable.has(group)) continue;
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(finPatchSnake, f)) { row[f] = finPatchSnake[f]; allowed.push(f); }
    }
  }
  if (Object.prototype.hasOwnProperty.call(finPatchSnake, 'currency')) row.currency = finPatchSnake.currency;
  return { row, allowed };
}

async function kanbanCardUpdate(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const cardId = payload?.id || payload?.cardId;
  if (!cardId) { const e = new Error('BAD_REQUEST: Thiếu id thẻ'); e.code = 'BAD_REQUEST'; throw e; }
  const card = await loadCard(cardId);

  const { stages, transitions } = await loadConfig();
  const visibleCols = visibleColumnsFor(ctx, stages, transitions);
  const stageVisMap = new Map(visibleCols.map((c) => [c.stage.id, { readOnly: c.readOnly }]));
  if (!canSeeCard(ctx, card, stageVisMap)) {
    const e = new Error('FORBIDDEN: Bạn không có quyền truy cập thẻ này'); e.code = 'FORBIDDEN'; throw e;
  }
  if (ctx.role === 'nhan_vien' && card.assigned_to !== ctx.userId && !ctx.isAdmin) {
    const e = new Error('FORBIDDEN: NV chỉ được sửa thẻ được giao cho mình'); e.code = 'FORBIDDEN'; throw e;
  }

  // Metadata cho phép sửa: title, assigned_to (TP/admin), customer fields
  const cardPatch = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'title')) cardPatch.title = (payload.title || '').trim();
  if (Object.prototype.hasOwnProperty.call(payload, 'assignedTo') && (ctx.role !== 'nhan_vien' || ctx.isAdmin)) {
    cardPatch.assigned_to = payload.assignedTo || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'customerAddress')) cardPatch.customer_address = payload.customerAddress || null;

  let updatedCard = card;
  const prevAssignedTo = card.assigned_to;
  if (Object.keys(cardPatch).length > 0) {
    const { data, error } = await supabase
      .from('crm_kanban_cards').update(cardPatch).eq('id', cardId).select().single();
    if (error) throw error;
    updatedCard = data;
  }

  // Financials theo quyền (KTHC: hóa đơn; phòng tạo đơn: không sửa được gì ngoài note vì cost/billing/debt read)
  const finPatchSnake = normalizeFinancialsPayload(payload.financials);
  if (finPatchSnake) {
    const { row: finPatch, allowed } = pickEditableFinancialsPatch(ctx, updatedCard, finPatchSnake);
    if (allowed.length > 0 || finPatch.currency) {
      const existing = await loadFinancials(cardId);
      if (!existing) await supabase.from('crm_kanban_financials').insert({ card_id: cardId, ...finPatch });
      else await supabase.from('crm_kanban_financials').update(finPatch).eq('card_id', cardId);
    }
  }

  if (cardPatch.assigned_to && cardPatch.assigned_to !== prevAssignedTo && cardPatch.assigned_to !== ctx.userId) {
    await insertNotification({
      userId: cardPatch.assigned_to, type: 'card_assigned', title: 'Thẻ mới được giao cho bạn',
      body: updatedCard.title + (updatedCard.customer_name ? ' — ' + updatedCard.customer_name : ''),
      cardId, priority: 'normal',
    });
  }

  await logKanban(cardId, ctx.userId, 'update', card.current_stage, card.current_stage,
    { patchKeys: Object.keys(cardPatch), financialsTouched: !!finPatchSnake });

  const [fin, items] = await Promise.all([loadFinancials(cardId), loadCardItems(cardId)]);
  return { card: maskCardForView(ctx, updatedCard, fin, items) };
}

// ============================================================================
// kanban.rentalPeriod.create — KT-NV tạo kỳ thuê từ thẻ kỹ thuật TECH_ACTIVE (§1A)
// ============================================================================

async function kanbanRentalPeriodCreate(currentUser, payload) {
  const ctx = await getKanbanCtx(currentUser);
  requireWritable(ctx);

  const techCardId = payload?.techCardId || payload?.contractCardId;
  if (!techCardId) { const e = new Error('BAD_REQUEST: Thiếu techCardId'); e.code = 'BAD_REQUEST'; throw e; }

  // Quyền: KT (NV/TP) hoặc admin (§1A: billing kỳ do KT-NV phụ trách)
  if (!ctx.isAdmin && ctx.deptCode !== 'KT') {
    const e = new Error('FORBIDDEN: Chỉ KT hoặc admin được tạo kỳ thuê'); e.code = 'FORBIDDEN'; throw e;
  }
  const tech = await loadCard(techCardId);
  if (tech.card_type !== 'thue_may' || tech.track !== 'technical') {
    const e = new Error('BAD_REQUEST: Thẻ nguồn phải là thẻ kỹ thuật thue_may'); e.code = 'BAD_REQUEST'; throw e;
  }
  if (tech.current_stage !== 'TECH_ACTIVE') {
    const e = new Error('BAD_REQUEST: Máy phải đang ở "Đang cho thuê" (TECH_ACTIVE)'); e.code = 'BAD_REQUEST'; throw e;
  }

  const periodLabel = payload.periodLabel || null;
  const periodStart = payload.periodStart || null;
  const periodEnd = payload.periodEnd || null;
  const periodAmount = Number(payload.amount) || null; // phí kỳ — KT nhập (như giá vật tư)

  // Thẻ kỳ thuê = thẻ THƯƠNG MẠI ở COM_NEW, owner_dept=KT (KT đẩy sang KTHC).
  const insertPeriod = {
    card_type: 'thue_may_ky', track: 'commercial',
    title: tech.title + (periodLabel ? ' — ' + periodLabel : ' — kỳ thuê'),
    current_stage: 'COM_NEW', owner_dept: 'KT',
    assigned_to: ctx.role === 'nhan_vien' ? ctx.userId : null,
    customer_id: tech.customer_id, customer_name: tech.customer_name,
    customer_address: tech.customer_address,
    parent_card_id: tech.id, order_id: tech.order_id,
    period_label: periodLabel, period_start: periodStart, period_end: periodEnd,
    status: 'active', created_by: ctx.userId,
  };
  const { data: created, error } = await supabase
    .from('crm_kanban_cards').insert(insertPeriod).select().single();
  if (error) throw error;

  // Financials kỳ: phí thuê = selling (KT thấy phí, KHÔNG thấy giá vốn máy)
  await supabase.from('crm_kanban_financials').insert({
    card_id: created.id, currency: 'VND',
    total_amount: periodAmount, subtotal: periodAmount,
    payment_status: 'unpaid',
  });
  if (periodAmount) {
    await supabase.from('crm_kanban_card_items').insert({
      card_id: created.id, product_name: 'Phí thuê ' + (periodLabel || 'kỳ'),
      quantity: 1, unit_price: periodAmount, line_subtotal: periodAmount, position: 0,
    });
  }

  await logKanban(created.id, ctx.userId, 'rental_period_create', null, 'COM_NEW',
    { techCardId, periodLabel, periodStart, periodEnd, amount: periodAmount });

  const [fin, items] = await Promise.all([loadFinancials(created.id), loadCardItems(created.id)]);
  return { card: maskCardForView(ctx, created, fin, items) };
}

// ============================================================================
// AUTO-CREATE HOOK — sinh thẻ từ đơn hàng (§2). Gọi từ crudController.
// ============================================================================

const VALID_ORDER_TYPES = ['ban_may', 'thue_may', 'ban_vat_tu'];

/**
 * Gọi sau khi crm_orders được tạo. order = row vừa insert; orderItems = mảng items đã insert.
 * creator = user tạo đơn (để lấy owner_dept).
 *
 * Kanban v3 (chốt DK 2026-06-11): card_type đọc THẲNG từ order.order_type
 * (radio bắt buộc trên form), KHÔNG đoán từ sản phẩm. owner_dept = phòng tạo đơn.
 */
async function createCardsFromOrder(order, orderItems, creator) {
  try {
    if (!order || !order.id) return;

    // Bỏ qua đơn không có order_type (đơn cũ trước v3) — không sinh thẻ.
    const cardType = order.order_type;
    if (!VALID_ORDER_TYPES.includes(cardType)) {
      console.warn('[kanban] order', order.code || order.id, 'không có order_type hợp lệ → bỏ qua sinh thẻ');
      return;
    }

    // Lấy product info cho từng item (cost_price snapshot)
    const productIds = (orderItems || []).map((it) => it.product_id).filter(Boolean);
    const prodMap = new Map();
    if (productIds.length > 0) {
      const { data: prods } = await supabase
        .from('crm_products')
        .select('id, name, code, unit, cost_price, list_price, price')
        .in('id', productIds);
      (prods || []).forEach((p) => prodMap.set(p.id, p));
    }

    // owner_dept = code phòng người tạo đơn
    let originDept = 'KD';
    if (creator?.department_id) {
      const { data: d } = await supabase
        .from('crm_departments').select('code').eq('id', creator.department_id).maybeSingle();
      if (d?.code) originDept = d.code.toUpperCase();
    }

    // Khách hàng snapshot
    let customerName = null, customerAddress = null;
    if (order.customer_id) {
      const { data: cust } = await supabase
        .from('crm_customers').select('name, address').eq('id', order.customer_id).maybeSingle();
      customerName = cust?.name || null;
      customerAddress = cust?.address || order.delivery_address || order.shipping_address || null;
    }

    // ===== THẺ THƯƠNG MẠI =====
    // Vật tư = thẻ thương mại đơn lẻ; máy bán = thương mại + kỹ thuật; thuê = CHỈ kỹ thuật (§1.3).
    let commercialCard = null;
    if (cardType !== 'thue_may') {
      const { data: comCard, error: comErr } = await supabase.from('crm_kanban_cards').insert({
        card_type: cardType, track: 'commercial',
        title: order.title || ('Đơn ' + (order.code || '')),
        current_stage: 'COM_NEW', owner_dept: originDept,
        assigned_to: order.assigned_to || creator?.id || null,
        customer_id: order.customer_id, customer_name: customerName, customer_address: customerAddress,
        order_id: order.id, status: 'active', created_by: creator?.id || null,
      }).select().single();
      if (comErr) throw comErr;
      commercialCard = comCard;

      // Snapshot items + financials
      let total = 0, totalCost = 0;
      const itemRows = (orderItems || []).map((it, idx) => {
        const p = prodMap.get(it.product_id) || {};
        const qty = Number(it.quantity || 0);
        const up = Number(it.unit_price || 0);
        const cp = Number(p.cost_price || 0);
        total += qty * up;
        totalCost += qty * cp;
        return {
          card_id: comCard.id, product_id: it.product_id || null,
          product_name: p.name || null, product_code: p.code || null, unit: it.unit || p.unit || null,
          quantity: qty, unit_price: up, cost_price: cp, line_subtotal: qty * up, position: idx,
        };
      });
      if (itemRows.length > 0) await supabase.from('crm_kanban_card_items').insert(itemRows);
      await supabase.from('crm_kanban_financials').insert({
        card_id: comCard.id, currency: 'VND',
        total_amount: Number(order.total_amount) || total, subtotal: total,
        cost_price: totalCost, margin: (Number(order.total_amount) || total) - totalCost,
        payment_status: 'unpaid', paid_amount: 0,
      });
      await logKanban(comCard.id, creator?.id || null, 'create', null, 'COM_NEW',
        { cardType, track: 'commercial', orderId: order.id });
      if (comCard.assigned_to && comCard.assigned_to !== creator?.id) {
        await insertNotification({
          userId: comCard.assigned_to, type: 'card_assigned',
          title: 'Thẻ thương mại mới', body: comCard.title, cardId: comCard.id, priority: 'normal',
        });
      }
    }

    // ===== THẺ KỸ THUẬT (máy: bán hoặc thuê) =====
    if (cardType === 'ban_may' || cardType === 'thue_may') {
      const { data: techCard, error: techErr } = await supabase.from('crm_kanban_cards').insert({
        card_type: cardType, track: 'technical',
        title: (order.title || ('Đơn ' + (order.code || ''))) + ' — kỹ thuật',
        current_stage: 'TECH_TODO', owner_dept: 'KT',
        assigned_to: null, // chờ KT-TP phân công
        customer_id: order.customer_id, customer_name: customerName, customer_address: customerAddress,
        order_id: order.id, status: 'active', created_by: creator?.id || null,
      }).select().single();
      if (techErr) throw techErr;

      // Thẻ kỹ thuật chỉ snapshot tên+SL máy, KHÔNG unit_price/cost_price.
      const techItems = (orderItems || []).map((it, idx) => {
        const p = prodMap.get(it.product_id) || {};
        return {
          card_id: techCard.id, product_id: it.product_id || null,
          product_name: p.name || null, product_code: p.code || null, unit: it.unit || p.unit || null,
          quantity: Number(it.quantity || 0), unit_price: null, cost_price: null,
          line_subtotal: null, position: idx,
        };
      });
      if (techItems.length > 0) await supabase.from('crm_kanban_card_items').insert(techItems);
      await logKanban(techCard.id, creator?.id || null, 'create', null, 'TECH_TODO',
        { cardType, track: 'technical', orderId: order.id });
      await notifyUsersOfDept('KT', {
        type: 'card_handoff', title: 'Có máy cần lắp/giao',
        body: (customerName || '') + ' — ' + (techCard.title || ''), cardId: techCard.id, priority: 'normal',
      });
    }
  } catch (e) {
    // Không chặn việc tạo đơn nếu sinh thẻ lỗi — chỉ log.
    console.error('[kanban] createCardsFromOrder error:', e.message);
  }
}

// ============================================================================
// NOTIFICATIONS endpoints
// ============================================================================

async function kanbanNotificationsList(currentUser, params) {
  const limit = parseInt(params?.limit || 30, 10);
  const { data: items, error } = await supabase
    .from('crm_notifications').select('*')
    .eq('user_id', currentUser.id).eq('is_deleted', false)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const { count, error: cErr } = await supabase
    .from('crm_notifications').select('*', { count: 'exact', head: true })
    .eq('user_id', currentUser.id).eq('is_read', false).eq('is_deleted', false);
  if (cErr) throw cErr;
  return { items: snakeToCamel(items || []), unreadCount: count || 0 };
}

async function kanbanNotificationsRead(currentUser, payload) {
  const ids = payload?.ids;
  const all = !!payload?.all;
  if (!all && (!ids || ids.length === 0)) { const e = new Error('BAD_REQUEST: Thiếu ids hoặc cờ all'); e.code = 'BAD_REQUEST'; throw e; }
  let q = supabase.from('crm_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', currentUser.id);
  if (!all) q = q.in('id', ids); else q = q.eq('is_read', false);
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}

async function kanbanDebtScan(currentUser) {
  const ctx = await getKanbanCtx(currentUser);
  if (!ctx.isAdmin) { const e = new Error('FORBIDDEN: Chỉ admin mới chạy được debt.scan thủ công'); e.code = 'FORBIDDEN'; throw e; }
  const { data, error } = await supabase.rpc('fn_debt_reminder_scan');
  if (error) throw error;
  return { result: snakeToCamel(data || {}) };
}

// ============================================================================
module.exports = {
  kanbanConfigGet,
  kanbanBoardGet,
  kanbanCardGet,
  kanbanCardUpdate,
  kanbanCardForceClose,
  kanbanMove,
  kanbanRentalPeriodCreate,
  kanbanPaymentAdd,
  kanbanPaymentConfirm,
  kanbanPaymentList,
  kanbanPaymentSummaryByOrder,
  kanbanNotificationsList,
  kanbanNotificationsRead,
  kanbanDebtScan,
  // hooks
  createCardsFromOrder,
  cancelCardsForOrder,
};
