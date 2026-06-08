import { STORAGE_KEY } from './config.js';

// ============================================================
// STATE
// ============================================================
export const state = {
  token: null,
  user: null,
  currentTab: 'dashboard',
  dashboard: null,
  charts: {},
};

// ============================================================
// SESSION (localStorage)
// ============================================================
export function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user, savedAt: Date.now() }));
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Token có hạn 8h, nếu lưu quá 8h thì coi như hết
    if (Date.now() - data.savedAt > 8 * 3600 * 1000) {
      clearSession();
      return null;
    }
    state.token = data.token;
    state.user = data.user;
    return data;
  } catch (e) {
    return null;
  }
}

export function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(STORAGE_KEY);
}


window.state = state;
window.saveSession = saveSession;
window.loadSession = loadSession;
window.clearSession = clearSession;
