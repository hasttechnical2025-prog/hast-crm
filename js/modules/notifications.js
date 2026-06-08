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
  timeAgo
} from '../utils.js';

// ============================================================
// TOPBAR DROPDOWNS (Phase 3D fix #6, #7)
// ============================================================

// Toggle sidebar
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  const ws = document.querySelector('.workspace');
  ws.classList.toggle('sidebar-collapsed');
  const isCollapsed = ws.classList.contains('sidebar-collapsed');
  // Đổi icon
  const btn = document.getElementById('btn-toggle-sidebar');
  btn.innerHTML = `<i data-lucide="${isCollapsed?'panel-left-open':'panel-left-close'}" style="width:18px;height:18px"></i>`;
  // Lưu preference vào localStorage
  localStorage.setItem('hast_sidebar_collapsed', isCollapsed ? '1' : '0');
  lucide.createIcons();
});

// Khôi phục trạng thái sidebar từ localStorage khi load
export function restoreSidebarState() {
  if (localStorage.getItem('hast_sidebar_collapsed') === '1') {
    const ws = document.querySelector('.workspace');
    ws.classList.add('sidebar-collapsed');
    const btn = document.getElementById('btn-toggle-sidebar');
    btn.innerHTML = '<i data-lucide="panel-left-open" style="width:18px;height:18px"></i>';
    lucide.createIcons();
  }
}

// Settings dropdown
document.getElementById('btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('notif-dropdown').classList.remove('show');
  document.getElementById('settings-dropdown').classList.toggle('show');
  lucide.createIcons();
});

// Notifications dropdown
document.getElementById('btn-notifications').addEventListener('click', async (e) => {
  e.stopPropagation();
  document.getElementById('settings-dropdown').classList.remove('show');
  const dropdown = document.getElementById('notif-dropdown');
  dropdown.classList.toggle('show');
  if (dropdown.classList.contains('show')) {
    await loadNotifications();
  }
});

// Click outside → close dropdowns
document.addEventListener('click', (e) => {
  if (!e.target.closest('#btn-notifications') && !e.target.closest('#notif-dropdown')) {
    document.getElementById('notif-dropdown').classList.remove('show');
  }
  if (!e.target.closest('#btn-settings') && !e.target.closest('#settings-dropdown')) {
    document.getElementById('settings-dropdown').classList.remove('show');
  }
});

export async function loadNotifications() {
  const body = document.getElementById('notif-body');
  body.innerHTML = '<div class="notif-empty"><div class="spinner dark"></div> Đang tải...</div>';
  try {
    const notifications = [];
    
    // === 1. Phase 4C: Notifications thực tế từ backend ===
    let backendNotifs = { items: [], unreadCount: 0 };
    try {
      backendNotifs = await api('notification.list', null, { limit: 15 });
    } catch (e) { /* ignore - có thể sheet Notifications chưa tạo */ }
    
    (backendNotifs.items || []).forEach(n => {
      // Icon theo type
      const iconMap = {
        workflow_assigned: 'inbox',
        workflow_moved: 'git-branch',
        ticket_assigned: 'life-buoy',
        ticket_updated: 'life-buoy',
        customer_approved: 'user-check',
        customer_rejected: 'user-x',
        order_payment: 'credit-card',
        mention: 'at-sign',
      };
      const clsMap = {
        ticket_assigned: 'warning',
        customer_rejected: 'warning',
      };
      notifications.push({
        id: n.id,
        icon: iconMap[n.type] || 'bell',
        cls: clsMap[n.type] || (n.priority === 'high' ? 'warning' : ''),
        title: n.title,
        meta: n.message + ' · ' + timeAgo(n.createdAt),
        unread: n.isRead !== 'TRUE',
        onClick: () => navigateToNotificationEntity(n),
      });
    });
    
    // === 2. Activities sắp tới / quá hạn (legacy, vẫn giữ) ===
    try {
      const upcoming = await api('activity.upcoming', null, { days: 3 });
      const upItems = (upcoming.items || []).slice(0, 3);
      upItems.forEach(a => {
        const overdue = a.startTime && new Date(a.startTime) < new Date();
        notifications.push({
          icon: overdue ? 'alert-triangle' : 'calendar',
          cls: overdue ? 'warning' : '',
          title: (overdue ? 'Quá hạn: ' : '') + a.title,
          meta: formatDateTimeVN(a.startTime),
          unread: overdue,
          onClick: () => { closeAllDropdowns(); switchTab('activities'); }
        });
      });
    } catch (e) {}
    
    // === 3. Khách hàng chờ duyệt (chỉ admin/manager) ===
    if (state.user.role === 'admin' || state.user.role === 'manager') {
      try {
        const pending = await api('customer.list', null, { approvalStatus: 'pending', pageSize: 3 });
        (pending.items || []).forEach(c => {
          notifications.push({
            icon: 'user-check',
            cls: '',
            title: 'KH chờ duyệt: ' + c.name,
            meta: c.code + ' · ' + timeAgo(c.createdAt),
            unread: true,
            onClick: () => { closeAllDropdowns(); switchTab('customers'); }
          });
        });
      } catch (e) {}
    }
    
    // === Render ===
    const unreadCount = backendNotifs.unreadCount || notifications.filter(n => n.unread).length;
    const headerActions = unreadCount > 0 ? 
      `<button class="btn-link-action" onclick="markAllNotificationsRead()" title="Đánh dấu tất cả đã đọc"><i data-lucide="check-check" style="width:13px;height:13px"></i> Đánh dấu đã đọc</button>` : '';
    
    document.querySelector('.notif-header').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <span>Thông báo${unreadCount > 0 ? ' <span class="header-badge">'+unreadCount+'</span>' : ''}</span>
        ${headerActions}
      </div>
    `;
    
    if (notifications.length === 0) {
      body.innerHTML = '<div class="notif-empty"><i data-lucide="bell-off" style="width:24px;height:24px;color:var(--ink-3);margin-bottom:8px"></i><br>Không có thông báo nào</div>';
      document.getElementById('notif-badge').style.display = 'none';
    } else {
      body.innerHTML = notifications.map((n, i) => `
        <div class="notif-item ${n.unread ? 'unread' : ''}" onclick="window._notifClick(${i})">
          <div class="notif-icon ${n.cls||''}"><i data-lucide="${n.icon}" style="width:16px;height:16px"></i></div>
          <div class="notif-content">
            <div class="notif-title">${escapeHtml(n.title)}</div>
            <div class="notif-meta">${escapeHtml(n.meta||'')}</div>
          </div>
          ${n.unread ? '<div class="notif-dot"></div>' : ''}
        </div>
      `).join('');
      window._notifClick = async (i) => {
        const notif = notifications[i];
        // Đánh dấu read nếu là notification từ backend
        if (notif.id && notif.unread) {
          try {
            await api('notification.markRead', { id: notif.id });
            updateNotifBadge();
          } catch (e) {}
        }
        if (notif.onClick) notif.onClick();
      };
      updateNotifBadge(unreadCount);
      lucide.createIcons();
    }
  } catch (e) {
    body.innerHTML = `<div class="notif-empty">Lỗi: ${escapeHtml(e.message)}</div>`;
  }
}

/**
 * Đánh dấu tất cả notification đã đọc
 */
export async function markAllNotificationsRead() {
  try {
    await api('notification.markAllRead');
    toast('Đã đánh dấu tất cả là đã đọc', 'success');
    // Force update ngay: ẩn badge + clear unread highlight
    updateNotifBadge(0);
    document.querySelectorAll('#notif-body .notif-item.unread').forEach(el => {
      el.classList.remove('unread');
      const dot = el.querySelector('.notif-dot');
      if (dot) dot.remove();
    });
    // Cập nhật header count
    const header = document.querySelector('.notif-header .header-badge');
    if (header) header.remove();
    // Reload đầy đủ
    loadNotifications();
  } catch (e) { toast(e.message, 'error'); }
}

/**
 * Cập nhật badge số notification chưa đọc
 */
export function updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (count === undefined) {
    // Fetch lại từ backend
    api('notification.list', null, { limit: 1 })
      .then(r => updateNotifBadge(r.unreadCount || 0))
      .catch(() => {});
    return;
  }
  if (count > 0) {
    badge.style.display = '';
    badge.textContent = count > 99 ? '99+' : String(count);
  } else {
    badge.style.display = 'none';
    badge.textContent = '';
  }
}

/**
 * Navigate đến entity liên quan khi click notification
 */
export function navigateToNotificationEntity(notif) {
  closeAllDropdowns();
  if (!notif.entityType || !notif.entityId) return;
  
  if (notif.entityType === 'workflow') {
    switchTab('workflow');
    setTimeout(() => openWorkflowDetail(notif.entityId), 300);
  } else if (notif.entityType === 'ticket') {
    switchTab('support');
    setTimeout(() => openTicketForm(notif.entityId), 300);
  } else if (notif.entityType === 'order') {
    switchTab('sales');
    setTimeout(() => {
      document.querySelector('[data-panel="sales"] .sub-tab[data-subtab="orders"]')?.click();
      setTimeout(() => openOrderForm(notif.entityId), 200);
    }, 200);
  } else if (notif.entityType === 'customer') {
    switchTab('customers');
    setTimeout(() => openCustomerDetail(notif.entityId), 300);
  }
}

/**
 * Helper: chuyển sang 1 tab bất kỳ bằng code
 */
export function switchTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (tab) tab.click();
}

export function closeAllDropdowns() {
  document.getElementById('notif-dropdown').classList.remove('show');
  document.getElementById('settings-dropdown').classList.remove('show');
}
export function openMyProfile() {
  closeAllDropdowns();
  document.getElementById('btn-user-menu').click();
}
export function openChangePasswordFromMenu() {
  closeAllDropdowns();
  setTimeout(() => openModal('modal-change-password'), 100);
}
export function goToAdminTab() {
  closeAllDropdowns();
  switchTab('admin');
}
export function reloadApp() {
  window.location.reload();
}


// Expose to window for HTML inline event handlers
window.restoreSidebarState = restoreSidebarState;
window.loadNotifications = loadNotifications;
window.markAllNotificationsRead = markAllNotificationsRead;
window.updateNotifBadge = updateNotifBadge;
window.navigateToNotificationEntity = navigateToNotificationEntity;
window.switchTab = switchTab;
window.closeAllDropdowns = closeAllDropdowns;
window.openMyProfile = openMyProfile;
window.openChangePasswordFromMenu = openChangePasswordFromMenu;
window.goToAdminTab = goToAdminTab;
window.reloadApp = reloadApp;
