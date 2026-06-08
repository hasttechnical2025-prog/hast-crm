import { state } from './state.js';
import { isNodeAPI, CURRENT_API_URL, WEB_APP_URL } from './config.js';
import { showLoading, hideLoading } from './utils.js';

// API CLIENT
// ============================================================
/**
 * Gọi API tới Apps Script Web App.
 *
 * QUAN TRỌNG về CORS:
 * - Apps Script trả về redirect 302 → googleusercontent.com
 * - Không được dùng custom Content-Type headers (sẽ trigger preflight, mà Apps Script không trả OPTIONS)
 * - Giải pháp: dùng FormData (browser tự set Content-Type=multipart/form-data, simple request)
 *   HOẶC URLSearchParams (application/x-www-form-urlencoded, simple request)
 * - Cả 2 đều KHÔNG trigger preflight = an toàn cross-origin
 *
 * Backend đã được code để parse JSON từ e.postData.contents, mà FormData/URLSearchParams
 * cũng đặt nội dung vào e.postData.contents, nên backend đọc được.
 */
export async function api(action, payload = null, params = {}, options = {}) {
  // Bật màng che loading đối với các tác vụ ghi/sửa/xoá (mutations) để người dùng không tưởng app bị treo
  const isMutation = !action.includes('.list') &&
                     !action.includes('.get') &&
                     !action.includes('auth.me') &&
                     !action.includes('report.dashboard') &&
                     action !== 'auth.login';

  const useLoader = isMutation && !options.silent;
  if (useLoader) showLoading('Đang xử lý...');

  try {
    // Nếu sử dụng Node.js API (Chạy cục bộ hoặc Vercel)
    if (isNodeAPI) {
      const res = await fetch(CURRENT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: action,
          token: state.token,
          payload: payload || {},
          params: params || {}
        })
      });
      return await parseResponse(res);
    }

    // Fallback về Google Apps Script cũ
    const hasPayload = payload && Object.keys(payload).length > 0;

    if (!hasPayload) {
      // GET request - dùng query params (simple request, no preflight)
      const url = new URL(WEB_APP_URL);
      url.searchParams.set('action', action);
      if (state.token) url.searchParams.set('token', state.token);
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
      return await parseResponse(res);
    }

    // POST request - dùng URLSearchParams với 1 trường duy nhất chứa JSON
    const body = new URLSearchParams();
    body.append('payload', JSON.stringify({
      action: action,
      token: state.token,
      payload: payload,
    }));

    const res = await fetch(WEB_APP_URL, {
      method: 'POST',
      body: body,
      redirect: 'follow',
    });
    return await parseResponse(res);
  } finally {
    if (useLoader) hideLoading();
  }
}

export async function parseResponse(res) {
  let data;
  try {
    data = await res.json();
  } catch (e) {
    const text = await res.text().catch(() => '');
    throw new Error('Server trả về dữ liệu không phải JSON. Có thể URL backend sai hoặc deployment chưa đúng. Response: ' + text.slice(0, 200));
  }
  if (!data.success) {
    const err = new Error(data.error?.message || 'Lỗi không xác định');
    err.code = data.error?.code;
    throw err;
  }
  return data.data;
}



// Expose to window for HTML inline event handlers
window.api = api;
window.parseResponse = parseResponse;
