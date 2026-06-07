/* ============================================================
   FORCO AMORE — shared API client (served same-origin from backend)
   Used by customer / admin / delivery / developer dashboards.
   ============================================================ */
(function (global) {
  const API_BASE = '/api/v1';

  const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

  function tokenKey(role) { return 'cg_auth_' + role; }

  function getAuth(role) {
    try { return JSON.parse(localStorage.getItem(tokenKey(role)) || 'null'); }
    catch { return null; }
  }
  function setAuth(role, data) { localStorage.setItem(tokenKey(role), JSON.stringify(data)); }
  function clearAuth(role) { localStorage.removeItem(tokenKey(role)); }

  // Factory: an API bound to a single role/page
  function CGApi(role) {
    const api = {
      role,
      get user() { const a = getAuth(role); return a ? a.user : null; },
      get token() { const a = getAuth(role); return a ? a.accessToken : null; },
      isAuthed() { return !!api.token; },
      logout() { clearAuth(role); },
    };

    api.request = async function (path, { method = 'GET', body, auth = true } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (auth && api.token) headers['Authorization'] = 'Bearer ' + api.token;
      const res = await fetch(API_BASE + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined,
      });
      let data = null;
      const text = await res.text();
      if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
      if (!res.ok) {
        const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
        err.status = res.status; err.code = data && data.code; err.data = data;
        throw err;
      }
      return data;
    };

    api.get = (p) => api.request(p);
    api.post = (p, body, opts) => api.request(p, { method: 'POST', body, ...(opts || {}) });
    api.patch = (p, body) => api.request(p, { method: 'PATCH', body });
    api.put = (p, body) => api.request(p, { method: 'PUT', body });
    api.del = (p) => api.request(p, { method: 'DELETE' });

    api.login = async function (email, password) {
      const data = await api.request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      if (data.user.role !== role) {
        throw new Error(`This login is for ${role}s. That account is a ${data.user.role}.`);
      }
      setAuth(role, data);
      return data.user;
    };

    api.register = async function (payload) {
      const data = await api.request('/auth/register', { method: 'POST', body: payload, auth: false });
      setAuth(role, data);
      return data.user;
    };

    // Socket.IO realtime (requires <script src="/socket.io/socket.io.js">)
    api.connectSocket = function (handlers) {
      if (!global.io || !api.token) return null;
      const socket = global.io({ auth: { token: api.token } });
      if (handlers) for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
      api.socket = socket;
      return socket;
    };

    return api;
  }

  // tiny helpers
  function toast(msg, ms = 2000) {
    let t = document.getElementById('cg-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cg-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(20px);background:#1a2e22;color:#fff;padding:12px 22px;border-radius:30px;font-weight:600;font-family:inherit;opacity:0;pointer-events:none;transition:all .3s;z-index:9999;max-width:90vw;text-align:center';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(20px)'; }, ms);
  }

  const STATUS_LABEL = {
    payment_verification_pending: 'Verifying payment',
    accepted: 'Accepted',
    preparing: 'Preparing',
    ready: 'Ready',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    payment_expired: 'Payment expired',
  };

  global.CG = { CGApi, rupee, toast, getAuth, clearAuth, STATUS_LABEL, API_BASE, saveSettings, loadSettings };

  async function loadSettings() {
    const api = CGApi('admin');
    try {
      const settings = await api.get('/admin/settings');
      document.querySelector('#upiId').value = settings.upi_id || '';
    } catch (e) {
      toast(e.message);
    }
  }

  async function saveSettings() {
    const api = CGApi('admin');
    const upiId = document.querySelector('#upiId').value.trim();
    if (!upiId) {
      toast('Please enter a UPI ID.');
      return;
    }
    try {
      await api.put('/admin/settings', { upi_id: upiId });
      toast('Settings saved successfully!');
    } catch (e) {
      toast(e.message);
    }
  }
})(window);
