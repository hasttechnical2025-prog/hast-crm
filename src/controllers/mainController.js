const { authenticateRequest, handleError } = require('../middlewares/auth');

const { authLogin, authLogout, authMe, authChangePassword, authAdminResetPassword, authUpdateProfile } = require('./authController');
const { crudList, crudCreate, crudUpdate, crudDelete, crudGet, settingList, settingUpdate, userCreate, userUpdate, customerGet } = require('./crudController');
const { workflowList, workflowGet, workflowMoveStage, workflowUpdate } = require('./workflowController');
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
    } else if (entity === 'workflow') {
      if (method === 'list') {
        result = await workflowList(currentUser, params);
        return res.json({ success: true, data: result });
      } else if (method === 'get') {
        result = await workflowGet(currentUser, params.id || payload.id);
        return res.json({ success: true, data: result });
      } else if (method === 'moveStage') {
        result = await workflowMoveStage(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Chuyển giai đoạn quy trình thành công' });
      } else if (method === 'update') {
        result = await workflowUpdate(currentUser, payload);
        return res.json({ success: true, data: result, message: 'Cập nhật quy trình thành công' });
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
        result = await customerFindDuplicates(currentUser, params.id || payload.id);
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