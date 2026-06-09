import { state } from '../state.js';
import { api } from '../api.js';
import {
  toast,
  confirmDialog,
  alertDialog,
  promptDialog,
  showLoading,
  hideLoading,
  openModal,
  closeModal,
  formatDateVN,
  formatDateTimeVN,
  formatThousands,
  formatVND,
  formatNumber,
  formatPhone,
  stripPhone,
  parseMoney,
  parseDateVN,
  parseDateTimeVN,
  initDateInputs,
  setCustomInputValue,
  getCustomInputValue,
  extractFormData,
  timeAgo,
  escapeHtml
} from '../utils.js';

// =============================================================
// (Function updateAdminTabVisibility cũ đã được thay thế bởi applyRoleVisibility)
// =============================================================

// ============================================================
// =========== PHASE 4B - WORKFLOW KANBAN ======================
// ============================================================

state.workflow = {
  currentType: 'sales',  // 'sales' | 'installation' | 'maintenance'
  data: null,
  filters: {  // Phase 4B2
    search: '',
    priority: '',
    assignee: '',  // '' | userId | '__me__' | '__none__'
    dueDate: '',   // '' | 'overdue' | 'today' | 'week' | 'nodue'
  },
};

// Định nghĩa stages frontend (đồng bộ backend)
const WORKFLOW_STAGES_FE = {
  sales: [
    { key: 'kd_processing',    label: 'Đang xử lý',          dept: 'KD',   deptClass: 'kd' },
    { key: 'kthc_invoice',     label: 'Lên hoá đơn',         dept: 'KTHC', deptClass: 'kthc' },
    { key: 'kthc_collecting',  label: 'Thu nợ',              dept: 'KTHC', deptClass: 'kthc' },
    { key: 'completed',        label: 'Hoàn thành',          dept: '',     deptClass: 'done' },
  ],
  installation: [
    { key: 'kd_signed',        label: 'Đã ký HĐ',            dept: 'KD',   deptClass: 'kd' },
    { key: 'kt_installing',    label: 'Lắp đặt',             dept: 'KT',   deptClass: 'kt' },
    { key: 'kthc_acceptance',  label: 'Nghiệm thu',          dept: 'KTHC', deptClass: 'kthc' },
    { key: 'completed',        label: 'Hoàn thành',          dept: '',     deptClass: 'done' },
  ],
  maintenance: [
    { key: 'received',         label: 'Tiếp nhận',           dept: 'KD',   deptClass: 'kd' },
    { key: 'kt_processing',    label: 'Xử lý',               dept: 'KT',   deptClass: 'kt' },
    { key: 'kthc_billing',     label: 'Thu phí (nếu có)',    dept: 'KTHC', deptClass: 'kthc' },
    { key: 'completed',        label: 'Hoàn thành',          dept: '',     deptClass: 'done' },
  ],
};

/**
 * Load workflows theo type hiện tại và render Kanban
 */
export async function loadWorkflows() {
  const board = document.getElementById('kanban-board');
  board.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="spinner dark"></div> Đang tải quy trình...</div>';
  try {
    // Phase 4B2: load users để hiển thị mini avatar + populate filter dropdown
    await ensureAllUsers();
    
    const type = state.workflow.currentType;
    const r = await api('workflow.list', null, { workflowType: type });
    state.workflow.data = r;
    
    // Cập nhật count badge cho type hiện tại
    document.getElementById('wf-count-' + type).textContent = r.total || 0;
    // Lazy load count cho 2 type còn lại
    ['sales', 'installation', 'maintenance'].forEach(otherType => {
      if (otherType !== type) {
        api('workflow.list', null, { workflowType: otherType })
          .then(r2 => {
            const el = document.getElementById('wf-count-' + otherType);
            if (el) el.textContent = r2.total || 0;
          })
          .catch(() => {});
      }
    });
    
    renderKanbanBoard();
    
    // Phase 4B2: bind filter events + refresh assignee options
    bindWorkflowFilterEvents();
    refreshAssigneeFilterOptions();
  } catch (e) {
    board.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
    if (e.code === 'UNAUTHORIZED') { clearSession(); showLogin(); }
  }
}

/**
 * Render Kanban board từ state.workflow.data
 */
// Phase 4B2 - Filter thời gian cho cột "Hoàn thành"
// Lưu lựa chọn vào state để giữ giữa các lần render
if (!state.workflow.completedFilter) state.workflow.completedFilter = 30; // mặc định 30 ngày

/**
 * Filter cards của stage 'completed' theo updatedAt trong N ngày gần đây
 * @returns {{visible: array, totalAll: number, filterDays: number|null}}
 */
export function filterCompletedCards(allCards) {
  const days = state.workflow.completedFilter;
  if (!days || days === 'all') return { visible: allCards, totalAll: allCards.length, filterDays: null };
  
  const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
  const visible = allCards.filter(c => {
    if (!c.updatedAt) return false;
    const t = new Date(c.updatedAt).getTime();
    return !isNaN(t) && t >= cutoffMs;
  });
  return { visible, totalAll: allCards.length, filterDays: days };
}

export function renderKanbanBoard() {
  const data = state.workflow.data;
  if (!data) return;
  
  const board = document.getElementById('kanban-board');
  const stages = data.stages;
  const grouped = data.grouped;
  
  // Empty state với hướng dẫn
  if ((data.total || 0) === 0) {
    const role = state.user?.role;
    let hint = '';
    if (role === 'staff') {
      hint = 'Bạn chỉ thấy các thẻ trong stage của phòng ban bạn HOẶC do bạn tạo / được gán. Nếu không có thẻ nào, có thể chưa có công việc liên quan đến bạn.';
    } else if (role === 'manager') {
      hint = 'Bạn thấy tất cả thẻ có liên quan đến phòng ban bạn quản lý ở bất kỳ giai đoạn nào.';
    }
    board.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;padding:40px">
        <i data-lucide="inbox" style="width:48px;height:48px;color:var(--ink-3)"></i>
        <p style="margin-top:12px"><strong>Không có thẻ nào trong tầm nhìn của bạn</strong></p>
        ${hint ? `<p style="font-size:12.5px;color:var(--ink-3);max-width:500px;margin:8px auto 0">${hint}</p>` : ''}
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  // Phase 4B2: Đếm tổng số card đã filter để hiển thị
  let totalFiltered = 0;
  let totalRaw = 0;
  
  board.innerHTML = stages.map(stage => {
    const allCards = (grouped[stage.key] && grouped[stage.key].items) || [];
    totalRaw += allCards.length;
    const deptClass = stage.dept === 'KD' ? 'kd' : stage.dept === 'KT' ? 'kt' : stage.dept === 'KTHC' ? 'kthc' : 'done';
    const isCompletedColumn = stage.key === 'completed';
    
    // Filter cards & build header phụ với filter
    let cards = allCards;
    let filterControls = '';
    let countBadge = `<div class="kanban-column-count">${allCards.length}</div>`;
    if (isCompletedColumn) {
      const filterResult = filterCompletedCards(allCards);
      cards = filterResult.visible;
      if (filterResult.filterDays) {
        countBadge = `<div class="kanban-column-count" title="Đang hiển thị ${cards.length} trong tổng ${allCards.length}">${cards.length} / ${allCards.length}</div>`;
      }
      const days = state.workflow.completedFilter;
      filterControls = `
        <div class="kanban-completed-filter">
          <select onchange="setCompletedFilter(this.value)" title="Lọc theo thời gian hoàn thành">
            <option value="7" ${days==7?'selected':''}>7 ngày gần đây</option>
            <option value="30" ${days==30?'selected':''}>30 ngày gần đây</option>
            <option value="90" ${days==90?'selected':''}>90 ngày gần đây</option>
            <option value="all" ${days==='all'?'selected':''}>Tất cả</option>
          </select>
          ${allCards.length > cards.length ? `<button class="link-btn" onclick="openCompletedHistory()" title="Xem toàn bộ lịch sử"><i data-lucide="archive" style="width:12px;height:12px"></i> Xem tất cả</button>` : ''}
        </div>
      `;
    }
    
    // Phase 4B2: Apply Kanban-wide filters (search, priority, assignee, dueDate)
    const filteredCards = applyWorkflowFilters(cards);
    totalFiltered += filteredCards.length;
    const hasFilter = hasActiveFilters();
    
    // Cập nhật count badge khi có filter
    if (hasFilter && !isCompletedColumn) {
      countBadge = `<div class="kanban-column-count" title="${filteredCards.length} hiển thị / ${allCards.length} tổng">${filteredCards.length} / ${allCards.length}</div>`;
    }
    
    return `
      <div class="kanban-column">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            ${stage.dept ? `<span class="dept-tag ${deptClass}">${stage.dept}</span>` : `<span class="dept-tag done">✓</span>`}
            ${escapeHtml(stage.label)}
          </div>
          ${countBadge}
        </div>
        ${filterControls}
        <div class="kanban-column-body" data-stage-key="${stage.key}" ondragover="kanbanDragOver(event)" ondragleave="kanbanDragLeave(event)" ondrop="kanbanDrop(event)">
          ${filteredCards.length === 0 ? `<div class="kanban-empty">${hasFilter ? 'Không có thẻ phù hợp với bộ lọc' : (isCompletedColumn && allCards.length > 0 ? 'Không có thẻ trong khoảng thời gian này' : 'Không có thẻ nào')}</div>` : 
            filteredCards.map(card => renderKanbanCard(card, stage)).join('')}
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
  
  // Phase 4B2: hiển thị message nếu filter ẩn hết
  if (hasActiveFilters() && totalFiltered === 0 && totalRaw > 0) {
    // Đã có UI empty trong từng cột rồi, không cần làm gì thêm
  }
}

// ============================================================
// PHASE 4B2 - WORKFLOW FILTERS
// ============================================================

/**
 * Check có filter nào đang active không
 */
export function hasActiveFilters() {
  const f = state.workflow.filters;
  return !!(f.search || f.priority || f.assignee || f.dueDate);
}

/**
 * Apply tất cả filter lên 1 mảng cards
 */
export function applyWorkflowFilters(cards) {
  const f = state.workflow.filters;
  if (!hasActiveFilters()) return cards;
  
  const me = state.user?.id;
  const now = new Date();
  const todayStr = now.toISOString().substring(0, 10);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  // Search lowercase 1 lần
  const searchLower = f.search ? f.search.toLowerCase().trim() : '';
  
  return cards.filter(card => {
    // Search trong: entityCode, customerName, customerCode, entitySubject
    if (searchLower) {
      const haystack = [
        card.entityCode || '',
        card.customerName || '',
        card.customerCode || '',
        card.entitySubject || '',
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }
    
    // Priority
    if (f.priority && card.priority !== f.priority) return false;
    
    // Assignee
    if (f.assignee) {
      if (f.assignee === '__me__') {
        if (card.assignedTo !== me) return false;
      } else if (f.assignee === '__none__') {
        if (card.assignedTo) return false;
      } else {
        if (card.assignedTo !== f.assignee) return false;
      }
    }
    
    // Due date
    if (f.dueDate) {
      const due = card.dueDate;
      if (f.dueDate === 'nodue') {
        if (due) return false;
      } else if (!due) {
        return false; // các filter khác cần có dueDate
      } else {
        const dueStr = String(due).substring(0, 10);
        if (f.dueDate === 'overdue') {
          if (dueStr >= todayStr) return false;
        } else if (f.dueDate === 'today') {
          if (dueStr !== todayStr) return false;
        } else if (f.dueDate === 'week') {
          const dueDate = new Date(dueStr);
          if (dueDate < now || dueDate > weekAhead) return false;
        }
      }
    }
    
    return true;
  });
}

/**
 * Xoá tất cả filter
 */
export function clearWorkflowFilters() {
  state.workflow.filters = { search: '', priority: '', assignee: '', dueDate: '' };
  document.getElementById('wf-filter-search').value = '';
  document.getElementById('wf-filter-priority').value = '';
  document.getElementById('wf-filter-assignee').value = '';
  document.getElementById('wf-filter-overdue').value = '';
  renderKanbanBoard();
}

/**
 * Cập nhật assignee dropdown với danh sách user thực tế từ data
 */
export function refreshAssigneeFilterOptions() {
  const sel = document.getElementById('wf-filter-assignee');
  if (!sel) return;
  const data = state.workflow.data;
  if (!data) return;
  
  // Collect tất cả assignedTo unique từ data
  const assigneeIds = new Set();
  Object.values(data.grouped || {}).forEach(g => {
    (g.items || []).forEach(card => {
      if (card.assignedTo) assigneeIds.add(card.assignedTo);
    });
  });
  
  const userMap = {};
  (state.allUsers || []).forEach(u => { userMap[u.id] = u; });
  
  const currentVal = sel.value;
  let optionsHtml = `
    <option value="">Tất cả người phụ trách</option>
    <option value="__me__">👤 Của tôi</option>
    <option value="__none__">⊘ Chưa giao</option>
  `;
  Array.from(assigneeIds).forEach(uid => {
    const u = userMap[uid];
    if (u) optionsHtml += `<option value="${escapeHtml(uid)}">${escapeHtml(u.fullName || u.username)}</option>`;
  });
  sel.innerHTML = optionsHtml;
  if (currentVal) sel.value = currentVal;
}

// Bind events cho filter inputs (one-time)
let _workflowFiltersBound = false;
export function bindWorkflowFilterEvents() {
  if (_workflowFiltersBound) return;
  _workflowFiltersBound = true;
  
  const searchInput = document.getElementById('wf-filter-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => {
      state.workflow.filters.search = e.target.value;
      renderKanbanBoard();
    }, 250));
  }
  document.getElementById('wf-filter-priority')?.addEventListener('change', e => {
    state.workflow.filters.priority = e.target.value;
    renderKanbanBoard();
  });
  document.getElementById('wf-filter-assignee')?.addEventListener('change', e => {
    state.workflow.filters.assignee = e.target.value;
    renderKanbanBoard();
  });
  document.getElementById('wf-filter-overdue')?.addEventListener('change', e => {
    state.workflow.filters.dueDate = e.target.value;
    renderKanbanBoard();
  });
}

// ============================================================
// PHASE 4B2 - DRAG & DROP KANBAN
// ============================================================

let _draggedCard = null;  // {id, currentStage, canMove}

export function kanbanDragStart(event, cardData) {
  _draggedCard = cardData;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', cardData.id);
  event.target.classList.add('dragging');
}

export function kanbanDragEnd(event) {
  event.target.classList.remove('dragging');
  // Clear all drop-over states
  document.querySelectorAll('.kanban-column-body.drag-over, .kanban-column-body.drag-forbidden').forEach(el => {
    el.classList.remove('drag-over', 'drag-forbidden');
  });
  _draggedCard = null;
}

export function kanbanDragOver(event) {
  if (!_draggedCard) return;
  event.preventDefault();
  
  const targetStage = event.currentTarget.dataset.stageKey;
  const sourceStage = _draggedCard.currentStage;
  
  // Clear other columns' drag-over
  document.querySelectorAll('.kanban-column-body').forEach(el => {
    if (el !== event.currentTarget) el.classList.remove('drag-over', 'drag-forbidden');
  });
  
  // Same column → no effect
  if (targetStage === sourceStage) {
    event.currentTarget.classList.remove('drag-over', 'drag-forbidden');
    event.dataTransfer.dropEffect = 'none';
    return;
  }
  
  // Check permission
  if (!_draggedCard.canMove) {
    event.currentTarget.classList.add('drag-forbidden');
    event.dataTransfer.dropEffect = 'none';
    return;
  }
  
  event.currentTarget.classList.add('drag-over');
  event.dataTransfer.dropEffect = 'move';
}

export function kanbanDragLeave(event) {
  // Chỉ clear khi rời hẳn element, không phải khi vào element con
  if (event.currentTarget.contains(event.relatedTarget)) return;
  event.currentTarget.classList.remove('drag-over', 'drag-forbidden');
}

export async function kanbanDrop(event) {
  event.preventDefault();
  if (!_draggedCard) return;
  
  const targetStage = event.currentTarget.dataset.stageKey;
  const sourceStage = _draggedCard.currentStage;
  const cardId = _draggedCard.id;
  const canMove = _draggedCard.canMove;
  
  event.currentTarget.classList.remove('drag-over', 'drag-forbidden');
  
  if (targetStage === sourceStage) { _draggedCard = null; return; }
  if (!canMove) { 
    _draggedCard = null;
    toast('Bạn không có quyền chuyển thẻ này', 'error'); 
    return; 
  }
  
  // Tìm stage object để biết label
  const stages = WORKFLOW_STAGES_FE[state.workflow.currentType] || [];
  const targetStageObj = stages.find(s => s.key === targetStage);
  const stageLabel = targetStageObj ? targetStageObj.label : targetStage;
  
  _draggedCard = null;
  
  // Confirm
  const ok = await confirmDialog({
    title: 'Chuyển sang giai đoạn',
    message: `Chuyển thẻ sang "<strong>${escapeHtml(stageLabel)}</strong>"?<br><br>Hành động này sẽ ghi lại lịch sử và thông báo cho phòng ban liên quan.`,
    type: 'info',
    okText: 'Chuyển',
  });
  if (!ok) return;
  
  // Optimistic UI: move card ngay trong DOM
  const cardEl = document.querySelector(`.kanban-card[data-card-id="${cardId}"]`);
  const targetBody = event.currentTarget;
  if (cardEl && targetBody) {
    targetBody.appendChild(cardEl);
    // Xoá "empty" placeholder nếu có
    targetBody.querySelectorAll('.kanban-empty').forEach(e => e.remove());
  }
  
  try {
    await api('workflow.moveStage', { id: cardId, newStage: targetStage });
    toast(`Đã chuyển sang "${stageLabel}"`, 'success');
    // Reload để cập nhật count + history
    loadWorkflows();
  } catch (e) {
    toast(e.message, 'error');
    // Rollback: reload để restore state
    loadWorkflows();
  }
}


/**
 * Đổi filter thời gian cho cột Hoàn thành
 */
export function setCompletedFilter(value) {
  state.workflow.completedFilter = value === 'all' ? 'all' : parseInt(value, 10);
  renderKanbanBoard();
}

/**
 * Mở modal hiển thị toàn bộ lịch sử Hoàn thành (kèm search)
 */
export function openCompletedHistory() {
  const data = state.workflow.data;
  if (!data) return;
  const allCompleted = (data.grouped['completed']?.items) || [];
  
  // Tạo modal nếu chưa có
  let modal = document.getElementById('modal-completed-history');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-backdrop" id="modal-completed-history">
        <div class="modal" style="max-width:760px">
          <div class="modal-header">
            <h3><i data-lucide="archive" style="width:20px;height:20px;display:inline;vertical-align:middle"></i> Lịch sử quy trình đã hoàn thành</h3>
            <button class="modal-close" onclick="closeModal('modal-completed-history')"><i data-lucide="x" style="width:18px;height:18px"></i></button>
          </div>
          <div class="modal-body">
            <input type="text" id="completed-history-search" placeholder="🔍 Tìm theo mã, tên KH..." style="width:100%;padding:8px 12px;border:1px solid var(--line);border-radius:6px;margin-bottom:12px;font-size:13px" />
            <div id="completed-history-list" style="max-height:60vh;overflow-y:auto"></div>
          </div>
        </div>
      </div>
    `);
    lucide.createIcons();
  }
  
  const renderList = (searchTerm) => {
    const term = (searchTerm || '').toLowerCase().trim();
    const filtered = !term ? allCompleted : allCompleted.filter(c => {
      const hay = `${c.entityCode||''} ${c.customerName||''} ${c.customerCode||''} ${c.code||''}`.toLowerCase();
      return hay.includes(term);
    });
    const listEl = document.getElementById('completed-history-list');
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>Không tìm thấy</p></div>';
      return;
    }
    listEl.innerHTML = `
      <table class="data-table" style="font-size:12.5px">
        <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Ngày hoàn thành</th><th>Giá trị</th><th></th></tr></thead>
        <tbody>
          ${filtered.map(c => `
            <tr style="cursor:pointer" onclick="closeModal('modal-completed-history');setTimeout(()=>openWorkflowDetail('${c.id}'),200)">
              <td><span class="code">${escapeHtml(c.entityCode||'-')}</span></td>
              <td>${escapeHtml(c.customerName||'-')}</td>
              <td>${formatDateVN(c.updatedAt)}</td>
              <td class="text-right">${c.totalAmount ? formatShortMoney(c.totalAmount) : '-'}</td>
              <td><i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--ink-3)"></i></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    lucide.createIcons();
  };
  
  document.getElementById('completed-history-search').oninput = (e) => renderList(e.target.value);
  renderList('');
  openModal('modal-completed-history');
}

/**
 * Render 1 card trong Kanban
 */
export function renderKanbanCard(card, stage) {
  // Dùng thông tin customer trực tiếp từ backend (đã filter quyền)
  const custName = card.customerName || '-';
  const custCode = card.customerCode || '';
  const isCustDeleted = custName === '(Khách hàng đã xoá)';
  
  const priorityClass = card.priority === 'Khẩn cấp' ? 'priority-urgent' : 
                        card.priority === 'Cao' ? 'priority-high' : 
                        card.priority === 'Thấp' ? 'priority-low' : '';
  
  // Stages của workflow type hiện tại để xác định prev/next
  const allStages = WORKFLOW_STAGES_FE[state.workflow.currentType] || [];
  const currentIdx = allStages.findIndex(s => s.key === card.currentStage);
  const prevStage = currentIdx > 0 ? allStages[currentIdx - 1] : null;
  const nextStage = currentIdx >= 0 && currentIdx < allStages.length - 1 ? allStages[currentIdx + 1] : null;
  
  // Tiêu đề
  let titleText = '';
  if (card.entityType === 'ticket') {
    titleText = card.entitySubject || custName;
  } else if (card.productNames && card.productNames.length > 0) {
    titleText = card.productNames.slice(0, 2).join(', ') + (card.productNames.length > 2 ? '...' : '');
  } else {
    titleText = custName;
  }
  
  // Meta-right: tiền (nếu được phép xem) HOẶC priority
  let metaRight = '';
  if (card.totalAmount !== null && card.totalAmount !== undefined && card.totalAmount > 0) {
    metaRight = `<span class="kanban-card-amount">${formatShortMoney(card.totalAmount)}</span>`;
  } else if (card.priority) {
    metaRight = `<span>${priorityBadge(card.priority)}</span>`;
  }
  
  // Phase 4B2: Due date badge
  const dueDateBadge = renderDueDateBadge(card.dueDate);
  
  // Phase 4B2: Assignee mini avatar
  let assigneeMini = '';
  if (card.assignedTo) {
    const userMap = {};
    (state.allUsers || []).forEach(u => { userMap[u.id] = u; });
    const u = userMap[card.assignedTo];
    if (u) {
      const initial = (u.fullName || u.username || '?').charAt(0).toUpperCase();
      assigneeMini = `<span class="card-assignee-mini" title="Phụ trách: ${escapeHtml(u.fullName || u.username)}"><span class="mini-avatar">${escapeHtml(initial)}</span></span>`;
    }
  }
  
  // Actions: chỉ hiện nếu có quyền chuyển
  const actions = !card.canMove ? '' : `
    <div class="kanban-card-actions">
      ${prevStage ? `<button class="btn-prev" onclick="event.stopPropagation();moveWorkflowStage('${card.id}','${prevStage.key}','${escapeHtml(prevStage.label).replace(/'/g,'')}')" title="Trả lại ${prevStage.dept}">← ${escapeHtml(prevStage.dept || '')}</button>` : ''}
      ${nextStage ? `<button onclick="event.stopPropagation();moveWorkflowStage('${card.id}','${nextStage.key}','${escapeHtml(nextStage.label).replace(/'/g,'')}')" title="Chuyển sang ${nextStage.label}">${escapeHtml(nextStage.dept || 'Hoàn tất')} →</button>` : ''}
    </div>
  `;
  
  // Phase 4B2: drag attrs - only if canMove
  const dragAttrs = card.canMove ? 
    `draggable="true" ondragstart="kanbanDragStart(event, {id:'${card.id}', currentStage:'${card.currentStage}', canMove:true})" ondragend="kanbanDragEnd(event)"` : 
    'class-extra="no-drag"';
  const dragClass = card.canMove ? '' : 'no-drag';
  const dragHint = card.canMove ? '<span class="drag-handle-hint">⠿ Kéo</span>' : '';
  
  return `
    <div class="kanban-card ${priorityClass} ${dragClass}" data-card-id="${card.id}" ${dragAttrs} onclick="openWorkflowDetail('${card.id}')">
      ${dragHint}
      <div class="kanban-card-header">
        <span class="kanban-card-code">${escapeHtml(card.entityCode || '')}</span>
        <span style="display:flex;gap:4px;align-items:center">
          ${card.customerClassification === 'VIP' ? '<span class="badge-pill vip" style="font-size:9px;padding:1px 5px">VIP</span>' : ''}
          ${assigneeMini}
        </span>
      </div>
      <div class="kanban-card-title">${escapeHtml(titleText)}</div>
      <div class="kanban-card-customer">
        ${isCustDeleted 
          ? '<span class="text-muted" style="font-style:italic">' + escapeHtml(custName) + '</span>' 
          : '<strong>' + escapeHtml(custName) + '</strong>'}
        ${custCode ? '<span style="font-size:10.5px;color:var(--ink-3);margin-left:4px">·' + escapeHtml(custCode) + '</span>' : ''}
      </div>
      ${dueDateBadge ? `<div style="margin-top:6px">${dueDateBadge}</div>` : ''}
      <div class="kanban-card-meta">
        <span>${formatDateVN(card.updatedAt)}</span>
        ${metaRight}
      </div>
      ${actions}
    </div>
  `;
}

/**
 * Render due date badge với màu theo tình trạng:
 * - Quá hạn: đỏ
 * - Hôm nay: xanh dương
 * - Trong 3 ngày: vàng
 * - Còn xa: trung tính
 */
export function renderDueDateBadge(dueDate) {
  if (!dueDate) return '';
  
  let dueDateOnly;
  if (typeof dueDate === 'string') {
    dueDateOnly = dueDate.substring(0, 10);
  } else {
    return '';
  }
  
  const dueObj = new Date(dueDateOnly);
  if (isNaN(dueObj.getTime())) return '';
  
  const now = new Date();
  const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dueObj - todayObj) / (1000 * 60 * 60 * 24));
  
  let cls = '';
  let label = '';
  let icon = 'clock';
  if (diffDays < 0) {
    cls = 'due-overdue';
    icon = 'alert-circle';
    label = `Quá hạn ${Math.abs(diffDays)} ngày`;
  } else if (diffDays === 0) {
    cls = 'due-today';
    icon = 'calendar';
    label = 'Hết hạn hôm nay';
  } else if (diffDays <= 3) {
    cls = 'due-soon';
    icon = 'calendar';
    label = `Còn ${diffDays} ngày`;
  } else {
    cls = '';
    icon = 'calendar';
    label = formatDateVN(dueDateOnly);
  }
  
  return `<span class="due-date-badge ${cls}" title="Hạn: ${formatDateVN(dueDateOnly)}"><i data-lucide="${icon}"></i>${escapeHtml(label)}</span>`;
}

/**
 * Chuyển workflow sang stage mới
 */
export async function moveWorkflowStage(workflowId, newStageKey, newStageLabel) {
  if (!(await confirmDialog({ title: 'Xác nhận', message: `Chuyển sang giai đoạn "${newStageLabel}"?\n\nHành động này sẽ ghi lại lịch sử và thông báo cho phòng ban liên quan.`, type: 'warning' }))) return;
  try {
    await api('workflow.moveStage', { id: workflowId, newStage: newStageKey });
    toast(`Đã chuyển sang "${newStageLabel}"`, 'success');
    loadWorkflows();
  } catch (e) {
    toast(e.message, 'error');
  }
}

/**
 * Mở drawer chi tiết workflow
 */
export async function openWorkflowDetail(workflowId) {
  // Tạo drawer detail dynamically nếu chưa có
  let drawer = document.getElementById('drawer-workflow-detail');
  if (!drawer) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="drawer" id="drawer-workflow-detail">
        <div class="drawer-header">
          <div>
            <h3 id="wfd-title">Chi tiết quy trình</h3>
            <div class="drawer-sub" id="wfd-sub"></div>
          </div>
          <button class="modal-close" onclick="closeAllDrawers()"><i data-lucide="x" style="width:18px;height:18px"></i></button>
        </div>
        <div class="drawer-body" id="wfd-body">
          <div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>
        </div>
        <div class="drawer-footer">
          <button type="button" class="btn btn-ghost" onclick="closeAllDrawers()">Đóng</button>
          <button type="button" class="btn btn-outline" id="wfd-open-entity"><i data-lucide="external-link" style="width:14px;height:14px"></i> Mở Đơn/Ticket</button>
        </div>
      </div>
    `);
    drawer = document.getElementById('drawer-workflow-detail');
    lucide.createIcons();
  }
  
  openDrawer('drawer-workflow-detail');
  document.getElementById('wfd-body').innerHTML = '<div class="empty-state"><div class="spinner dark"></div> Đang tải...</div>';
  
  try {
    const r = await api('workflow.get', null, { id: workflowId });
    const wf = r.workflow;
    const entity = r.entity;
    const customer = r.customer;  // Đã filter theo role ở backend
    const history = r.history || [];
    const orderItems = r.orderItems || [];
    
    const wfTypeLabel = { sales: 'Bán hàng', installation: 'Lắp đặt', maintenance: 'Bảo trì' }[wf.workflowType] || wf.workflowType;
    const stages = WORKFLOW_STAGES_FE[wf.workflowType] || [];
    const currentStage = stages.find(s => s.key === wf.currentStage);
    
    document.getElementById('wfd-title').textContent = `${wfTypeLabel} - ${wf.code}`;
    document.getElementById('wfd-sub').textContent = `${entity ? entity.code : ''} · ${customer ? customer.name : '(KH đã xoá)'}`;
    
    // Nút mở entity - chỉ hiện cho admin/manager (staff KT không cần thiết)
    const openBtn = document.getElementById('wfd-open-entity');
    const role = state.user?.role;
    if (role === 'admin' || role === 'manager' || role === 'boss') {
      openBtn.style.display = '';
      openBtn.onclick = () => {
        closeAllDrawers();
        setTimeout(() => {
          if (wf.entityType === 'order') {
            document.querySelector('.tab[data-tab="sales"]').click();
            setTimeout(() => {
              document.querySelector('[data-panel="sales"] .sub-tab[data-subtab="orders"]').click();
              setTimeout(() => openOrderForm(wf.entityId), 200);
            }, 200);
          } else if (wf.entityType === 'ticket') {
            document.querySelector('.tab[data-tab="support"]').click();
            setTimeout(() => openTicketForm(wf.entityId), 300);
          }
        }, 200);
      };
    } else {
      openBtn.style.display = 'none';
    }
    
    // Render timeline history
    let timelineHtml = '<div class="timeline">';
    history.slice().reverse().forEach((h, idx) => {
      const isLatest = idx === 0;
      const stageObj = stages.find(s => s.key === h.toStage);
      const stageLabel = stageObj ? stageObj.label : h.toStage;
      const deptLabel = h.toDept || (stageObj ? stageObj.dept : '');
      timelineHtml += `
        <div class="timeline-item ${isLatest?'latest':''}">
          <div class="timeline-item-time">${formatDateTimeVN(h.timestamp)}</div>
          <div class="timeline-item-title">
            ${h.fromStage ? `<span style="color:var(--ink-3)">${escapeHtml(h.fromDept||'')} →</span> ` : ''}
            <strong>${escapeHtml(deptLabel)}: ${escapeHtml(stageLabel)}</strong>
          </div>
          <div class="timeline-item-meta">
            Người chuyển: <strong>${escapeHtml(h.userName || '')}</strong>
          </div>
          ${h.note ? `<div class="timeline-item-note">${escapeHtml(h.note)}</div>` : ''}
        </div>
      `;
    });
    timelineHtml += '</div>';
    
    // Render customer info card (chỉ field nào backend trả về - đã filter quyền)
    let customerCard = '';
    if (customer) {
      customerCard = `
        <div class="detail-card" style="margin-bottom:14px">
          <h4>Khách hàng</h4>
          <div class="detail-row"><div class="label">Tên KH</div><div class="value"><strong>${escapeHtml(customer.name)}</strong> ${customer.classification === 'VIP' ? '<span class="badge-pill vip" style="margin-left:6px">VIP</span>' : ''}</div></div>
          ${customer.code ? `<div class="detail-row"><div class="label">Mã KH</div><div class="value">${escapeHtml(customer.code)}</div></div>` : ''}
          ${customer.address ? `<div class="detail-row"><div class="label">Địa chỉ</div><div class="value">${escapeHtml(customer.address)}</div></div>` : ''}
          ${customer.phone ? `<div class="detail-row"><div class="label">Điện thoại</div><div class="value">${formatPhone(customer.phone)}</div></div>` : ''}
          ${customer.email ? `<div class="detail-row"><div class="label">Email</div><div class="value">${escapeHtml(customer.email)}</div></div>` : ''}
          ${customer.taxCode ? `<div class="detail-row"><div class="label">MST</div><div class="value">${escapeHtml(customer.taxCode)}</div></div>` : ''}
        </div>
      `;
    }
    
    // Order items (chỉ cho order workflow)
    let itemsCard = '';
    if (orderItems.length > 0) {
      const showPrice = orderItems[0].unitPrice !== undefined;  // Có price = không phải staff KT
      itemsCard = `
        <div class="detail-card" style="margin-bottom:14px">
          <h4>Hàng hoá / Dịch vụ (${orderItems.length})</h4>
          <table class="data-table" style="margin-top:6px">
            <thead><tr>
              <th>Sản phẩm</th>
              <th class="text-right">SL</th>
              <th>ĐVT</th>
              ${showPrice ? '<th class="text-right">Đơn giá</th><th class="text-right">Thành tiền</th>' : ''}
            </tr></thead>
            <tbody>
              ${orderItems.map(it => `
                <tr>
                  <td>${escapeHtml(it.productName || '-')}</td>
                  <td class="text-right">${escapeHtml(String(it.quantity || 0))}</td>
                  <td>${escapeHtml(it.unit || '')}</td>
                  ${showPrice ? `<td class="text-right">${formatVND(it.unitPrice || 0)}</td><td class="text-right"><strong>${formatVND(it.lineTotal || 0)}</strong></td>` : ''}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    
    // Phase 4B3: Build assignment card (edit inline assignedTo + dueDate + priority)
    const userMap = {};
    (state.allUsers || []).forEach(u => { userMap[u.id] = u; });
    const assignee = wf.assignedTo ? userMap[wf.assignedTo] : null;
    const assigneeName = assignee ? (assignee.fullName || assignee.username) : '';
    const dueLabel = wf.dueDate ? renderDueDateBadge(wf.dueDate) : '';
    const dueRawDate = wf.dueDate ? String(wf.dueDate).substring(0, 10) : '';
    
    // Quyền chỉnh sửa: chỉ user có canMove mới được sửa assignment
    const canEditAssignment = r.canMove === true;
    
    let assignmentCard = '';
    if (wf.status !== 'completed') {
      assignmentCard = `
        <div class="assignment-card">
          <h4><i data-lucide="user-cog" style="width:14px;height:14px"></i> Phân công & Hạn hoàn thành</h4>
          
          <div class="assignment-row" id="wf-assign-row-assignedTo">
            <div class="label">Người phụ trách</div>
            <div>
              <div class="value-display ${!assigneeName ? 'empty' : ''}">${assigneeName ? escapeHtml(assigneeName) : 'Chưa giao'}</div>
              <div class="value-edit">
                <select id="wf-edit-assignedTo">
                  <option value="">-- Chưa giao --</option>
                </select>
              </div>
            </div>
            <div class="row-actions">
              ${canEditAssignment ? `
                <button class="btn-icon-sm" onclick="startEditWorkflowField('assignedTo','${wf.id}')" title="Sửa người phụ trách"><i data-lucide="edit-3" style="width:13px;height:13px"></i></button>
                <button class="btn-icon-sm btn-save" onclick="saveWorkflowField('assignedTo','${wf.id}')" style="display:none" title="Lưu"><i data-lucide="check" style="width:13px;height:13px"></i></button>
                <button class="btn-icon-sm btn-cancel" onclick="cancelEditWorkflowField('assignedTo')" style="display:none" title="Huỷ"><i data-lucide="x" style="width:13px;height:13px"></i></button>
              ` : ''}
            </div>
          </div>
          
          <div class="assignment-row" id="wf-assign-row-dueDate">
            <div class="label">Hạn hoàn thành</div>
            <div>
              <div class="value-display ${!dueLabel ? 'empty' : ''}">${dueLabel || 'Chưa đặt hạn'}</div>
              <div class="value-edit">
                <input type="text" id="wf-edit-dueDate" data-format="date" value="${escapeHtml(dueRawDate ? formatDateVN(dueRawDate) : '')}" placeholder="dd/mm/yyyy" />
              </div>
            </div>
            <div class="row-actions">
              ${canEditAssignment ? `
                <button class="btn-icon-sm" onclick="startEditWorkflowField('dueDate','${wf.id}')" title="Sửa hạn hoàn thành"><i data-lucide="edit-3" style="width:13px;height:13px"></i></button>
                <button class="btn-icon-sm btn-save" onclick="saveWorkflowField('dueDate','${wf.id}')" style="display:none" title="Lưu"><i data-lucide="check" style="width:13px;height:13px"></i></button>
                <button class="btn-icon-sm btn-cancel" onclick="cancelEditWorkflowField('dueDate')" style="display:none" title="Huỷ"><i data-lucide="x" style="width:13px;height:13px"></i></button>
              ` : ''}
            </div>
          </div>
          
          <div class="assignment-row" id="wf-assign-row-priority">
            <div class="label">Mức ưu tiên</div>
            <div>
              <div class="value-display">${priorityBadge(wf.priority || 'Trung bình')}</div>
              <div class="value-edit">
                <select id="wf-edit-priority">
                  <option value="Thấp" ${wf.priority==='Thấp'?'selected':''}>Thấp</option>
                  <option value="Trung bình" ${(!wf.priority||wf.priority==='Trung bình')?'selected':''}>Trung bình</option>
                  <option value="Cao" ${wf.priority==='Cao'?'selected':''}>Cao</option>
                  <option value="Khẩn cấp" ${wf.priority==='Khẩn cấp'?'selected':''}>Khẩn cấp</option>
                </select>
              </div>
            </div>
            <div class="row-actions">
              ${canEditAssignment ? `
                <button class="btn-icon-sm" onclick="startEditWorkflowField('priority','${wf.id}')" title="Sửa ưu tiên"><i data-lucide="edit-3" style="width:13px;height:13px"></i></button>
                <button class="btn-icon-sm btn-save" onclick="saveWorkflowField('priority','${wf.id}')" style="display:none" title="Lưu"><i data-lucide="check" style="width:13px;height:13px"></i></button>
                <button class="btn-icon-sm btn-cancel" onclick="cancelEditWorkflowField('priority')" style="display:none" title="Huỷ"><i data-lucide="x" style="width:13px;height:13px"></i></button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }
    
    document.getElementById('wfd-body').innerHTML = `
      ${assignmentCard}
      <div class="detail-card" style="margin-bottom:14px">
        <h4>Trạng thái hiện tại</h4>
        <div class="detail-row">
          <div class="label">Giai đoạn</div>
          <div class="value"><strong>${currentStage ? escapeHtml(currentStage.label) : escapeHtml(wf.currentStage)}</strong></div>
        </div>
        <div class="detail-row">
          <div class="label">Phòng phụ trách</div>
          <div class="value">${escapeHtml(wf.currentDept || '-')}</div>
        </div>
        <div class="detail-row">
          <div class="label">Trạng thái</div>
          <div class="value">${wf.status === 'completed' ? '<span class="badge-pill success">Đã hoàn thành</span>' : '<span class="badge-pill info">Đang hoạt động</span>'}</div>
        </div>
        ${entity ? `
          <div class="detail-row">
            <div class="label">Liên kết</div>
            <div class="value">${escapeHtml(entity.code || '')}</div>
          </div>
          ${entity.totalAmount !== undefined && entity.totalAmount !== null ? `<div class="detail-row"><div class="label">Giá trị</div><div class="value"><strong>${formatVND(entity.totalAmount)}</strong></div></div>` : ''}
          ${entity.deliveryDate ? `<div class="detail-row"><div class="label">Ngày giao</div><div class="value">${formatDateVN(entity.deliveryDate)}</div></div>` : ''}
          ${entity.shippingAddress ? `<div class="detail-row"><div class="label">Giao đến</div><div class="value">${escapeHtml(entity.shippingAddress)}</div></div>` : ''}
        ` : ''}
      </div>
      ${customerCard}
      ${itemsCard}
      <div class="detail-card">
        <h4>Lịch sử chuyển phòng (${history.length})</h4>
        ${timelineHtml}
      </div>
    `;
    
    // Phase 4B3: populate assignee dropdown sau khi DOM được tạo
    if (canEditAssignment && document.getElementById('wf-edit-assignedTo')) {
      await populateAssignedToDropdown('wf-edit-assignedTo', { emptyLabel: 'Chưa giao' });
      // Set giá trị hiện tại
      if (wf.assignedTo) {
        document.getElementById('wf-edit-assignedTo').value = wf.assignedTo;
      }
    }
    // Init date input cho dueDate
    if (canEditAssignment) {
      initDateInputs(document.getElementById('wfd-body'));
    }
    
    lucide.createIcons();
  } catch (e) {
    document.getElementById('wfd-body').innerHTML = `<div class="empty-state"><p>Lỗi: ${escapeHtml(e.message)}</p></div>`;
  }
}

// ============================================================
// PHASE 4B3 - INLINE EDIT WORKFLOW FIELDS (assignedTo, dueDate, priority)
// ============================================================

/**
 * Bắt đầu sửa 1 field trong assignment card
 */
export function startEditWorkflowField(field, workflowId) {
  const row = document.getElementById('wf-assign-row-' + field);
  if (!row) return;
  row.classList.add('editing');
  // Show save+cancel, hide edit
  row.querySelectorAll('.btn-icon-sm').forEach(b => {
    if (b.classList.contains('btn-save') || b.classList.contains('btn-cancel')) {
      b.style.display = '';
    } else {
      b.style.display = 'none';
    }
  });
  // Focus input
  const input = row.querySelector('.value-edit select, .value-edit input');
  if (input) setTimeout(() => input.focus(), 50);
}

/**
 * Hủy sửa, restore display
 */
export function cancelEditWorkflowField(field) {
  const row = document.getElementById('wf-assign-row-' + field);
  if (!row) return;
  row.classList.remove('editing');
  // Restore button visibility
  row.querySelectorAll('.btn-icon-sm').forEach(b => {
    if (b.classList.contains('btn-save') || b.classList.contains('btn-cancel')) {
      b.style.display = 'none';
    } else {
      b.style.display = '';
    }
  });
}

/**
 * Lưu giá trị mới của field sang backend
 */
export async function saveWorkflowField(field, workflowId) {
  let newValue;
  
  if (field === 'assignedTo') {
    newValue = document.getElementById('wf-edit-assignedTo').value;
  } else if (field === 'priority') {
    newValue = document.getElementById('wf-edit-priority').value;
  } else if (field === 'dueDate') {
    const dateInput = document.getElementById('wf-edit-dueDate');
    // getCustomInputValue parses dd/mm/yyyy → ISO yyyy-mm-dd
    newValue = getCustomInputValue(dateInput) || '';
  } else {
    toast('Trường không hợp lệ', 'error');
    return;
  }
  
  try {
    const payload = { id: workflowId };
    payload[field] = newValue;
    await api('workflow.update', payload);
    toast('Đã cập nhật', 'success');
    cancelEditWorkflowField(field);
    // Reload drawer để hiển thị giá trị mới (kèm badge dueDate)
    openWorkflowDetail(workflowId);
    // Reload Kanban background (cho card cập nhật)
    loadWorkflows();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Event handler cho sub-tabs workflow
document.querySelectorAll('.workflow-tab').forEach(t => {
  t.addEventListener('click', () => {
    const target = t.dataset.wftype;
    document.querySelectorAll('.workflow-tab').forEach(x => x.classList.toggle('active', x.dataset.wftype === target));
    state.workflow.currentType = target;
    loadWorkflows();
  });
});

/**
 * Admin only: tạo workflow cho các đơn/ticket cũ chưa có
 */
export async function workflowBackfill() {
  if (!(await confirmDialog({ title: 'Xác nhận', message: 'Tạo workflow cho TẤT CẢ đơn hàng và ticket cũ chưa có?\n\nLưu ý: Tính năng này chạy 1 lần để bổ sung dữ liệu cũ. Nên chạy sau khi vừa update bản Phase 4B.', type: 'warning' }))) return;
  showLoading('Đang xử lý...');
  try {
    const r = await api('workflow.backfill');
    hideLoading();
    toast(r.message || 'Đã backfill', 'success');
    loadWorkflows();
  } catch (e) {
    hideLoading();
    toast(e.message, 'error');
  }
}


// Expose to window for HTML inline event handlers
window.loadWorkflows = loadWorkflows;
window.filterCompletedCards = filterCompletedCards;
window.renderKanbanBoard = renderKanbanBoard;
window.hasActiveFilters = hasActiveFilters;
window.applyWorkflowFilters = applyWorkflowFilters;
window.clearWorkflowFilters = clearWorkflowFilters;
window.refreshAssigneeFilterOptions = refreshAssigneeFilterOptions;
window.bindWorkflowFilterEvents = bindWorkflowFilterEvents;
window.kanbanDragStart = kanbanDragStart;
window.kanbanDragEnd = kanbanDragEnd;
window.kanbanDragOver = kanbanDragOver;
window.kanbanDragLeave = kanbanDragLeave;
window.kanbanDrop = kanbanDrop;
window.setCompletedFilter = setCompletedFilter;
window.openCompletedHistory = openCompletedHistory;
window.renderKanbanCard = renderKanbanCard;
window.renderDueDateBadge = renderDueDateBadge;
window.moveWorkflowStage = moveWorkflowStage;
window.openWorkflowDetail = openWorkflowDetail;
window.startEditWorkflowField = startEditWorkflowField;
window.cancelEditWorkflowField = cancelEditWorkflowField;
window.saveWorkflowField = saveWorkflowField;
window.workflowBackfill = workflowBackfill;
