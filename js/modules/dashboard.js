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
// DASHBOARD
// ============================================================
export async function loadDashboard() {

  try {
    const data = await api('report.dashboard', {}, {});
    state.dashboard = data;
    renderDashboardStats(data);
    renderPipeline();
    await renderRevenueChart();
    await renderUpcomingActivities();
    await renderTopDebt();
    updateDuplicateAlert();
  } catch (err) {
    if (err.code === 'UNAUTHORIZED') {
      clearSession();
      showLogin();
      toast('Phiên đăng nhập đã hết hạn', 'warning');
    } else {
      toast(err.message, 'error', 'Lỗi tải dữ liệu');
    }
  } finally {
    hideLoading();
  }
}

export function renderDashboardStats(data) {
  const period = data.period;
  document.getElementById('dashboard-period').textContent =
    `Kỳ báo cáo: ${formatDateVN(period.fromDate)} → ${formatDateVN(period.toDate)}`;

  const grid = document.getElementById('stats-grid');
  const cards = [
    {
      label: 'Doanh thu kỳ này',
      value: formatShortMoney(data.revenue.totalRevenue),
      meta: `${data.revenue.orderCount} đơn · TB ${formatShortMoney(data.revenue.avgOrderValue)}/đơn`,
      cls: 'accent'
    },
    {
      label: 'Đã thu',
      value: formatShortMoney(data.revenue.totalPaid),
      meta: `Công nợ ${formatShortMoney(data.revenue.totalDebt)}`,
      cls: 'success'
    },
    {
      label: 'Khách hàng',
      value: formatNumber(data.customers.total),
      meta: `<strong>+${data.customers.newInPeriod}</strong> mới · ${data.customers.vip} VIP`,
      cls: ''
    },
    {
      label: 'Cơ hội đang mở',
      value: formatNumber(data.opportunities.open),
      meta: `${formatShortMoney(data.opportunities.pipelineValue)} · Win rate ${data.opportunities.winRate}%`,
      cls: ''
    },
    {
      label: 'Hoạt động chờ',
      value: formatNumber(data.activities.pending),
      meta: data.activities.overdue > 0 ? `<strong class="negative">${data.activities.overdue} quá hạn</strong>` : 'Đúng tiến độ',
      cls: data.activities.overdue > 0 ? 'warning' : ''
    },
    {
      label: 'Ticket hỗ trợ mở',
      value: formatNumber(data.tickets.open),
      meta: `${data.tickets.total} tổng cộng`,
      cls: data.tickets.open > 5 ? 'danger' : ''
    },
  ];
  grid.innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <div class="stat-card-label">${c.label}</div>
      <div class="stat-card-value">${c.value}</div>
      <div class="stat-card-meta">${c.meta}</div>
    </div>
  `).join('');
}

export async function renderPipeline() {
  try {
    const data = await api('report.opportunityPipeline');
    const items = data.items || [];
    const max = Math.max(1, ...items.map(i => i.count));
    const html = items.map(s => `
      <div class="pipeline-stage">
        <div class="pipeline-stage-label">${escapeHtml(s.stage)}</div>
        <div class="pipeline-stage-bar">
          <div class="pipeline-stage-fill" style="width:${(s.count/max)*100}%">${s.count > 0 ? s.count : ''}</div>
        </div>
        <div class="pipeline-stage-value">${formatShortMoney(s.totalValue)}</div>
      </div>
    `).join('');
    document.getElementById('pipeline-list').innerHTML = html || '<div class="empty-state"><p>Chưa có dữ liệu</p></div>';
  } catch (e) {
    document.getElementById('pipeline-list').innerHTML = '<div class="empty-state"><p>Không thể tải pipeline</p></div>';
  }
}

export async function renderRevenueChart() {
  try {
    // 12 tháng gần nhất
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = now.toISOString().slice(0, 10);

    const data = await api('report.salesRevenue', {}, { fromDate: fromStr, toDate: toStr, groupBy: 'month' });

    // Đảm bảo đủ 12 tháng (kể cả tháng không có data)
    const monthsMap = {};
    (data.items || []).forEach(it => { monthsMap[it.period] = it; });
    const labels = [], values = [], orderCounts = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      labels.push(`T${d.getMonth()+1}/${String(d.getFullYear()).slice(2)}`);
      values.push(monthsMap[key]?.revenue || 0);
      orderCounts.push(monthsMap[key]?.orderCount || 0);
    }

    if (state.charts.revenue) state.charts.revenue.destroy();
    const ctx = document.getElementById('chart-revenue').getContext('2d');
    state.charts.revenue = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Doanh thu',
          data: values,
          backgroundColor: ctx => {
            const c = ctx.chart.ctx.createLinearGradient(0, 0, 0, 260);
            c.addColorStop(0, '#3949AB');
            c.addColorStop(1, '#5C6BC0');
            return c;
          },
          borderRadius: 4,
          maxBarThickness: 40,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                return ` ${formatVND(values[idx])} (${orderCounts[idx]} đơn)`;
              }
            },
            backgroundColor: '#0F1729',
            padding: 10,
            titleFont: { family: 'Inter Tight', weight: '600' },
            bodyFont: { family: 'Inter Tight' },
          }
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => formatShortMoney(v),
              font: { family: 'Inter Tight', size: 11 },
              color: '#6B7280',
            },
            grid: { color: '#F1F2F6' }
          },
          x: {
            ticks: { font: { family: 'Inter Tight', size: 11 }, color: '#6B7280' },
            grid: { display: false }
          }
        }
      }
    });
  } catch (e) {
    console.error(e);
  }
}

export async function renderUpcomingActivities() {
  try {
    const data = await api('activity.upcoming', {}, { days: 7 });
    const items = (data.items || []).slice(0, 6);
    const list = document.getElementById('upcoming-activities');
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><i data-lucide="calendar-check"></i><p>Không có hoạt động sắp tới</p></div>';
      lucide.createIcons();
      return;
    }
    const typeIcons = { call: 'phone', meeting: 'users', task: 'check-square', email: 'mail', visit: 'map-pin', sms: 'message-square' };
    list.innerHTML = items.map(a => {
      const icon = typeIcons[a.type] || 'activity';
      return `
        <li class="activity-item">
          <div class="activity-icon"><i data-lucide="${icon}"></i></div>
          <div class="activity-body">
            <div class="activity-title">${escapeHtml(a.title)}</div>
            <div class="activity-meta">
              <span>${formatDateTimeVN(a.startTime)}</span>
              <span class="dot"></span>
              <span>${escapeHtml(a.priority || '')}</span>
            </div>
          </div>
        </li>`;
    }).join('');
    lucide.createIcons();
  } catch (e) {
    console.error(e);
  }
}

export async function renderTopDebt() {
  try {
    const data = await api('report.debt');
    const items = (data.items || []).slice(0, 5);
    const list = document.getElementById('top-debt');
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><i data-lucide="circle-check-big"></i><p>Không có công nợ</p></div>';
      lucide.createIcons();
      return;
    }
    list.innerHTML = items.map(c => `
      <li class="activity-item">
        <div class="activity-icon" style="background:#FEF3C7;color:#92400E"><i data-lucide="wallet"></i></div>
        <div class="activity-body">
          <div class="activity-title">${escapeHtml(c.customerName)}</div>
          <div class="activity-meta">
            <span>${escapeHtml(c.customerCode)}</span>
            <span class="dot"></span>
            <span>${c.orderCount} đơn nợ</span>
            <span class="dot"></span>
            <span style="color:var(--danger);font-weight:500">${formatVND(c.totalDebt)}</span>
          </div>
        </div>
      </li>
    `).join('');
    lucide.createIcons();
  } catch (e) {
    console.error(e);
  }
}

export function updateDuplicateAlert() {
  // Phase 3B sẽ cài đặt - hiện chỉ hiện default
}

document.getElementById('btn-refresh-dashboard').addEventListener('click', () => loadDashboard());


// Expose to window for HTML inline event handlers
window.loadDashboard = loadDashboard;
window.renderDashboardStats = renderDashboardStats;
window.renderPipeline = renderPipeline;
window.renderRevenueChart = renderRevenueChart;
window.renderUpcomingActivities = renderUpcomingActivities;
window.renderTopDebt = renderTopDebt;
window.updateDuplicateAlert = updateDuplicateAlert;
