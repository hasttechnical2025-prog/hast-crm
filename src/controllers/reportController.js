const { supabase } = require('../config');

// Helper Lấy ngày giờ hiện tại
function getMonthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function reportDashboard(currentUser, params) {
  params = params || {};
  const fromDate = params.fromDate || getMonthStart();
  const toDate = params.toDate || todayISO();

  // Helper để lấy data
  const fetchData = async (tableName) => {
    let query = supabase.from(tableName).select('*').eq('is_deleted', false);
    // Áp dụng quyền
    if (currentUser.role !== 'admin' && currentUser.role !== 'boss') {
      if (currentUser.role === 'manager') {
        const orQuery = [];
        if (tableName !== 'crm_customers') orQuery.push(`department_id.eq.${currentUser.department_id}`);
        orQuery.push(`assigned_to.eq.${currentUser.id}`);
        query = query.or(orQuery.join(','));
      } else { // staff
        query = query.or(`assigned_to.eq.${currentUser.id},created_by.eq.${currentUser.id}`);
      }
    }
    const { data } = await query;
    return data || [];
  };

  const [orders, customers, opportunities, activities, tickets] = await Promise.all([
    fetchData('crm_orders'),
    fetchData('crm_customers'),
    fetchData('crm_opportunities'),
    fetchData('crm_activities'),
    fetchData('crm_support_tickets')
  ]);

  // Lọc khoảng thời gian cho orders
  const periodOrders = orders.filter(o => {
    const d = o.created_at ? o.created_at.substring(0, 10) : '';
    return d >= fromDate && d <= toDate;
  });

  const totalRevenue = periodOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0);
  const totalPaid = periodOrders.reduce((s, o) => s + (parseFloat(o.paid_amount) || 0), 0);
  const totalDebt = orders.reduce((s, o) => s + (parseFloat(o.total_amount) - parseFloat(o.paid_amount) || 0), 0);

  const openOpps = opportunities.filter(o => o.stage !== 'Thắng' && o.stage !== 'Thua');
  const wonOpps = opportunities.filter(o => o.stage === 'Thắng');
  const lostOpps = opportunities.filter(o => o.stage === 'Thua');
  const pipelineValue = openOpps.reduce((s, o) => s + (parseFloat(o.value) || 0), 0);
  const winRate = (wonOpps.length + lostOpps.length) > 0 ? (wonOpps.length / (wonOpps.length + lostOpps.length) * 100).toFixed(1) : 0;

  const pendingActivities = activities.filter(a => a.status === 'Chờ xử lý' || a.status === 'Đang làm');
  const overdueActivities = activities.filter(a => {
    if (a.status === 'Hoàn thành' || a.status === 'Bỏ qua') return false;
    return a.due_date && new Date(a.due_date) < new Date();
  });

  const openTickets = tickets.filter(t => t.status === 'Mới' || t.status === 'Đang xử lý' || t.status === 'Chờ KH phản hồi');

  return {
    period: { fromDate, toDate },
    revenue: {
      totalRevenue,
      totalPaid,
      totalDebt,
      orderCount: periodOrders.length,
      avgOrderValue: periodOrders.length > 0 ? Math.round(totalRevenue / periodOrders.length) : 0,
    },
    customers: {
      total: customers.length,
      newInPeriod: customers.filter(c => {
        const d = c.created_at ? c.created_at.substring(0, 10) : '';
        return d >= fromDate && d <= toDate;
      }).length,
      vip: customers.filter(c => c.classification === 'VIP').length,
      pending: customers.filter(c => c.approval_status === 'pending').length,
    },
    opportunities: {
      total: opportunities.length,
      open: openOpps.length,
      won: wonOpps.length,
      lost: lostOpps.length,
      pipelineValue,
      winRate: parseFloat(winRate),
    },
    activities: {
      pending: pendingActivities.length,
      overdue: overdueActivities.length,
    },
    tickets: {
      open: openTickets.length,
      total: tickets.length,
    }
  };
}

// Hàm dự phòng cho các báo cáo khác để tránh lỗi hiển thị
function mockReportResponse() {
  return { status: 'Under Construction', message: 'Tính năng báo cáo này đang được cập nhật...' };
}

module.exports = {
  reportDashboard,
  mockReportResponse
};