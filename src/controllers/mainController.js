const { supabase } = require('../config');
const { authenticateRequest, handleError } = require('../middlewares/auth');
const { snakeToCamel } = require('../utils/helpers');

const { authLogin, authLogout, authMe, authChangePassword, authAdminResetPassword, authUpdateProfile } = require('./authController');
const { crudList, crudCreate, crudUpdate, crudDelete, crudGet, settingList, settingUpdate, userCreate, userUpdate, customerGet } = require('./crudController');
const {
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
} = require('./kanbanController');
const { reportDashboard, mockReportResponse } = require('./reportController');
const { customerApprove, customerReject, customerFindDuplicates, customerMerge } = require('./customerController');
const { notificationList, notificationMarkRead, notificationMarkAllRead } = require('./notificationController');

async function handleRequest(req, res) {
  try {
    const action = req.body.action;
    const token = req.body.token || req.headers['authorization']?.split(' ')[1];
    const payload = req.body.payload || {};
    const params = req.body.params || {};

    if (!action) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Thiếu tham số action' } });
    }

    if (action === 'auth.login') {
      const data = await authLogin(payload, req.ip);
      return res.json({ success: true, data, message: 'Đăng nhập thành công' });
    }

    // Lấy thông tin công khai của công ty (dùng cho trang đăng nhập khi chưa có token)
    if (action === 'company.getPublicInfo') {
      const { data } = await supabase
        .from('crm_settings')
        .select('*')
        .like('key', 'company.%');
      const settings = {};
      if (data) {
        data.forEach(r => { settings[r.key] = r.value; });
      }

      // Tự động gán mặc định nếu thiếu trong DB để Admin có thể thấy và chỉnh sửa trên UI
      const defaults = {
        'company.loginHeadline': 'Quản trị quan hệ <em>khách hàng</em><br>một cách <em>tinh tế</em>.',
        'company.loginTagline': 'Hệ thống CRM nội bộ dành cho đội ngũ Kinh doanh, Kỹ thuật và Kế toán của Công ty Cổ phần Siêu Thanh Hà Nội — đối tác chính hãng của Konica Minolta, Fuji Xerox, Kyocera và Epson tại Việt Nam.',
        'company.loginFooter': '© 2026 Siêu Thanh Hà Nội'
      };

      let needsUpsert = false;
      const upsertRows = [];
      for (const [k, v] of Object.entries(defaults)) {
        if (!settings[k]) {
          settings[k] = v;
          upsertRows.push({ key: k, value: v });
          needsUpsert = true;
        }
      }

      if (needsUpsert) {
        supabase.from('crm_settings').upsert(upsertRows).then(() => {}).catch(() => {});
      }

      return res.json({ success: true, data: settings });
    }

    const currentUser = await authenticateRequest(token);

    let result;

    const entityToTable = {
      customer: 'crm_customers',
      contact: 'crm_contacts',
      tag: 'crm_tags',
      product: 'crm_products',
      opportunity: 'crm_opportunities',
      quote: 'crm_quotes',
      order: 'crm_orders',
      orderItem: 'crm_order_items',
      ticket: 'crm_support_tickets',
      activity: 'crm_activities',
      campaign: 'crm_campaigns',
      note: 'crm_notes',
      message: 'crm_messages',
      user: 'crm_users',
      department: 'crm_departments'
    };

    const [entity, method] = action.split('.');

    if (entity === 'auth') {
      if (method === 'logout') {
        result = await authLogout(token);
        return res.json({ success: true, data: result, message: 'Đăng xuất thành công' });
      } else if (method === 'me') {
        result = await authMe(currentUser);
        return res.json({ success: true, data: result });
      } else if (method === 'changePassword') {
        result = await authChangePassword(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Đổi mật khẩu thành công' });
      } else if (method === 'updateProfile') {
        result = await authUpdateProfile(currentUser, payload);
        return res.json({ success: true, data: result });
      } else if (method === 'resetPassword') {
        result = await authAdminResetPassword(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Reset mật khẩu thành công' });
      }
    } else if (entity === 'kanban') {
      // === Kanban v2 (spec §6) — phá Kanban cũ "workflow.*", thay bằng "kanban.*" ===
      // method: config.get | board.get | card.get | card.create | card.update | move
      //         | rentalPeriod.create | notifications.list | notifications.read | debt.scan
      const sub = action.substring('kanban.'.length); // ví dụ 'payment.add'
      if (sub === 'config.get') {
        result = await kanbanConfigGet(currentUser);
        return res.json({ success: true, data: result });
      } else if (sub === 'board.get') {
        result = await kanbanBoardGet(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (sub === 'card.get') {
        result = await kanbanCardGet(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (sub === 'card.update') {
        result = await kanbanCardUpdate(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Cập nhật thẻ thành công' });
      } else if (sub === 'card.forceClose') {
        result = await kanbanCardForceClose(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Đã đóng thẻ (ghi lý do)' });
      } else if (sub === 'move') {
        result = await kanbanMove(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Đã chuyển stage' });
      } else if (sub === 'rentalPeriod.create') {
        result = await kanbanRentalPeriodCreate(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Đã sinh kỳ thuê mới' });
      } else if (sub === 'payment.add') {
        result = await kanbanPaymentAdd(currentUser, payload);
        return res.json({ success: true, data: result, message: result.pending ? 'Đã ghi khoản chờ xác nhận' : 'Đã ghi nhận thanh toán' });
      } else if (sub === 'payment.confirm') {
        result = await kanbanPaymentConfirm(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Đã xác nhận thanh toán' });
      } else if (sub === 'payment.list') {
        result = await kanbanPaymentList(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (sub === 'payment.summaryByOrder') {
        result = await kanbanPaymentSummaryByOrder(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (sub === 'notifications.list') {
        result = await kanbanNotificationsList(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (sub === 'notifications.read') {
        result = await kanbanNotificationsRead(currentUser, payload);
        return res.json({ success: true, data: result });
      } else if (sub === 'debt.scan') {
        result = await kanbanDebtScan(currentUser);
        return res.json({ success: true, data: result });
      }
    } else if (entity === 'report') {
      if (method === 'dashboard') {
        result = await reportDashboard(currentUser, params);
        return res.json({ success: true, data: result });
      } else {
        result = mockReportResponse();
        return res.json({ success: true, data: result });
      }
    } else if (entity === 'setting') {
      if (method === 'list') {
        result = await settingList(currentUser);
        return res.json({ success: true, data: result });
      } else if (method === 'update') {
        result = await settingUpdate(currentUser, payload.key, payload.value);
        return res.json({ success: true, data: result });
      }
    } else if (entity === 'permissions') {
      if (method === 'get') {
        const settings = await settingList(currentUser);
        let matrix = {};
        try {
          if (settings['permissions.matrix']) {
            matrix = JSON.parse(settings['permissions.matrix']);
          }
        } catch (e) {}
        return res.json({ success: true, data: { matrix } });
      } else if (method === 'update') {
        const jsonStr = JSON.stringify(payload.matrix);
        result = await settingUpdate(currentUser, 'permissions.matrix', jsonStr);
        return res.json({ success: true, data: result, message: 'Đã cập nhật phân quyền' });
      }
    } else if (entity === 'customer') {
      if (method === 'approve') {
        result = await customerApprove(currentUser, payload.id);
        return res.json({ success: true, data: result, message: 'Đã duyệt khách hàng' });
      } else if (method === 'reject') {
        result = await customerReject(currentUser, payload.id, payload.reason);
        return res.json({ success: true, data: result, message: 'Đã từ chối khách hàng' });
      } else if (method === 'findDuplicates') {
        result = await customerFindDuplicates(currentUser, params.id || payload.id || payload.customerData);
        return res.json({ success: true, data: result });
      } else if (method === 'merge') {
        result = await customerMerge(currentUser, payload.primaryId, payload.secondaryIds);
        return res.json({ success: true, data: result, message: 'Đã gộp khách hàng' });
      }
    } else if (entity === 'notification') {
      if (method === 'list') {
        result = await notificationList(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (method === 'markRead') {
        result = await notificationMarkRead(currentUser, payload.id);
        return res.json({ success: true, data: result });
      } else if (method === 'markAllRead') {
        result = await notificationMarkAllRead(currentUser);
        return res.json({ success: true, data: result });
      }
    } else if (entity === 'quote') {
      if (method === 'export') {
        const downloadUrl = `/api/export?type=quote&id=${payload.id}&format=${payload.format || 'docx'}&token=${token}`;
        return res.json({
          success: true,
          data: {
            downloadUrl,
            fileName: `BaoGia_${payload.id}.${payload.format || 'docx'}`,
            fileId: payload.id
          }
        });
      }
    } else if (entity === 'order') {
      if (method === 'export') {
        const downloadUrl = `/api/export?type=order&id=${payload.id}&format=${payload.format || 'docx'}&token=${token}`;
        return res.json({
          success: true,
          data: {
            downloadUrl,
            fileName: `DonHang_${payload.id}.${payload.format || 'docx'}`,
            fileId: payload.id
          }
        });
      }
    }

    if (entityToTable[entity]) {
      const tableName = entityToTable[entity];
      switch (method) {
        case 'list':
          result = await crudList(tableName, currentUser, params);
          return res.json({ success: true, data: result });
        case 'get':
          if (entity === 'customer') {
            result = await customerGet(currentUser, params.id || payload.id);
          } else if (entity === 'quote' || entity === 'order') {
            const docId = params.id || payload.id;
            const doc = await crudGet(tableName, currentUser, docId);
            const { data: items } = await supabase
              .from('crm_order_items')
              .select('*, product:crm_products(*)')
              .eq('parent_id', docId)
              .eq('is_deleted', false);
            result = {
              [entity]: doc,
              items: snakeToCamel(items || [])
            };
          } else {
            result = await crudGet(tableName, currentUser, params.id || payload.id);
          }
          return res.json({ success: true, data: result });
        case 'create':
          if (entity === 'user') {
            result = await userCreate(currentUser, payload);
          } else {
            result = await crudCreate(tableName, currentUser, payload);
          }
          return res.json({ success: true, data: result, message: 'Tạo bản ghi thành công' });
        case 'update':
          if (entity === 'user') {
            result = await userUpdate(currentUser, payload.id, payload);
          } else {
            result = await crudUpdate(tableName, currentUser, payload.id, payload);
          }
          return res.json({ success: true, data: result, message: 'Cập nhật thành công' });
        case 'delete':
          result = await crudDelete(tableName, currentUser, payload.id || params.id);
          return res.json({ success: true, data: result, message: 'Đã xoá bản ghi' });
      }
    }

    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: `Action không hợp lệ hoặc chưa được hỗ trợ: ${action}` } });
  } catch (err) {
    return handleError(err, res);
  }
}

module.exports = {
  handleRequest
};