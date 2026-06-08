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
  // TABS STATE
  customers: { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  contacts:  { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  activities:{ items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  opps:      { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  quotes:    { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  orders:    { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  tickets:   { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  campaigns: { items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  notes:     { items: [], page: 1, pageSize: 30, total: 0, search: '', filters: {} },
  messages:  { items: [], page: 1, pageSize: 30, total: 0, search: '', filters: {} },
  users:     { items: [], page: 1, pageSize: 50, total: 0, search: '', filters: {} },
  adminProds:{ items: [], page: 1, pageSize: 20, total: 0, search: '', filters: {} },
  depts:     { items: [] },
  tags:      { items: [] },
  settings:  {},
  // CACHES
  products: [],
  allCustomers: [],
  currentEditing: null,
  salesDocMode: 'quote'
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
