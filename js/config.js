// ============================================================
// CONFIG - Đổi WEB_APP_URL khi đổi deployment
// ============================================================
export const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwxDIrE-IdOu4dUm8KO7GFQ6SH0gmlCdCddCkk41BztI2idp9FM7EINunuW7KCG1qfHig/exec';
export const LOCAL_NODE_URL = 'http://localhost:5000/api';
export const VERCEL_NODE_URL = 'https://hast-crm.vercel.app/api';

// Xác định backend để gọi:
const searchParams = new URLSearchParams(window.location.search);
export const useLegacy = searchParams.get('legacy') === 'true' || searchParams.get('api') === 'gas';
export const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const CURRENT_API_URL = useLegacy ? WEB_APP_URL : (isLocal ? LOCAL_NODE_URL : VERCEL_NODE_URL);
export const isNodeAPI = !useLegacy;

// Sử dụng key lưu session khác nhau để tài khoản Vercel/Node.js không đè lên tài khoản cũ
export const STORAGE_KEY = isNodeAPI ? 'hast_crm_session_node' : 'hast_crm_session';
