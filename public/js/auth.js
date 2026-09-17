/* auth.js — client-side authentication gate, bearer-token fetch patch and
 * role-based UI gating for the Transformer Titan platform (E1).
 *
 * Loaded first (in <head>) so the fetch() patch is installed before any API
 * call. Server-side RBAC is authoritative; this only improves UX by hiding
 * actions the user isn't permitted to perform. */
(function () {
  'use strict';

  var TOKEN_KEY = 'tt_token';
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}

  var TT_AUTH = window.TT_AUTH = {
    token: token,
    user: null,
    permissions: {},
    allowedSiteIds: null,
    isRole: function (r) { return TT_AUTH.user && TT_AUTH.user.role === r; },
    hasPerm: function (p) { return !!TT_AUTH.permissions[p]; },
    logout: doLogout,
    // download links can't set headers → carry the token as a query param
    tokenParam: function () { return TT_AUTH.token ? ('token=' + encodeURIComponent(TT_AUTH.token)) : ''; }
  };

  // ── 1. Patch fetch to attach the bearer token for same-origin /api calls ──
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isApi = url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0;
      var isLogin = url.indexOf('/api/auth/login') !== -1;
      if (isApi && !isLogin && TT_AUTH.token) {
        init = init || {};
        var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
        if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + TT_AUTH.token);
        init.headers = headers;
      }
    } catch (e) { /* fall through to normal fetch */ }
    return _fetch(input, init);
  };

  // ── 2. Bootstrap on DOM ready: validate session or show the login gate ──
  document.addEventListener('DOMContentLoaded', function () {
    if (!TT_AUTH.token) { showLogin(); return; }
    fetch('/api/auth/me')
      .then(function (r) { if (!r.ok) throw new Error('unauth'); return r.json(); })
      .then(function (data) {
        TT_AUTH.user = data.user;
        TT_AUTH.permissions = (data.user && data.user.permissions) || {};
        TT_AUTH.allowedSiteIds = data.allowedSiteIds;
        applyGating();
        injectUserChip();
        document.dispatchEvent(new CustomEvent('tt-auth-ready', { detail: TT_AUTH }));
      })
      .catch(function () { clearToken(); showLogin(); });
  });

  function clearToken() { TT_AUTH.token = null; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function doLogout() {
    fetch('/api/auth/logout', { method: 'POST' }).finally(function () {
      clearToken(); location.reload();
    });
  }

  // ── 3. Role/permission gating of nav + any [data-role]/[data-perm] element ──
  function applyGating() {
    document.querySelectorAll('[data-role]').forEach(function (el) {
      var roles = el.getAttribute('data-role').split(',').map(function (s) { return s.trim(); });
      el.style.display = roles.indexOf(TT_AUTH.user.role) !== -1 ? '' : 'none';
    });
    document.querySelectorAll('[data-perm]').forEach(function (el) {
      el.style.display = TT_AUTH.hasPerm(el.getAttribute('data-perm')) ? '' : 'none';
    });
  }
  TT_AUTH.applyGating = applyGating;

  // The user control is a compact avatar button with a dropdown menu — never a
  // wide inline row — so it can never get squeezed off-screen by an overflowing
  // topbar (a wide chip appended last was previously the first thing clipped on
  // narrower viewports, which made "Sign out" unreachable).
  function injectUserChip() {
    var bar = document.getElementById('topbar');
    if (!bar || document.getElementById('tt-user-chip')) return;
    var u = TT_AUTH.user;
    var roleLabel = { admin: 'Administrator', regional_manager: 'Regional Manager', field_technician: 'Field Technician' }[u.role] || u.role;
    var initial = (u.full_name || u.username || '?').slice(0, 1).toUpperCase();

    var wrap = document.createElement('div');
    wrap.id = 'tt-user-chip';
    wrap.style.cssText = 'position:relative;margin-left:8px;flex-shrink:0';
    wrap.innerHTML =
      '<button id="tt-user-btn" title="Account" style="width:34px;height:34px;border-radius:50%;border:1px solid var(--border);' +
        'background:linear-gradient(135deg,var(--accent-dark),var(--accent-orange));display:flex;align-items:center;justify-content:center;' +
        'font-weight:700;color:#fff;font-size:13px;cursor:pointer">' + esc(initial) + '</button>' +
      '<div id="tt-user-menu" style="display:none;position:absolute;right:0;top:calc(100% + 8px);min-width:220px;' +
        'background:var(--surface,#1F2937);border:1px solid var(--border,#4B5563);border-radius:10px;' +
        'box-shadow:0 12px 32px rgba(0,0,0,.45);z-index:200;overflow:hidden">' +
        '<div style="padding:12px 14px;border-bottom:1px solid var(--border)">' +
          '<div style="font-weight:600;font-size:13px;color:var(--text)">' + esc(u.full_name || u.username) + '</div>' +
          '<div style="color:var(--muted);font-size:11px;margin-top:2px">' + esc(roleLabel) + (u.region ? ' · ' + esc(u.region) : '') + '</div>' +
        '</div>' +
        '<button id="tt-logout" style="display:flex;align-items:center;gap:8px;width:100%;padding:10px 14px;background:none;' +
          'border:none;color:var(--text);font-size:13px;cursor:pointer;text-align:left">⏻ Sign out</button>' +
      '</div>';
    bar.appendChild(wrap);

    var menu = document.getElementById('tt-user-menu');
    var btn = document.getElementById('tt-user-btn');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', function (e) {
      if (menu.style.display !== 'none' && !wrap.contains(e.target)) menu.style.display = 'none';
    });
    document.getElementById('tt-logout').addEventListener('click', doLogout);
  }

  // ── 4. Login overlay ──
  function showLogin() {
    if (document.getElementById('tt-login')) return;
    var ov = document.createElement('div');
    ov.id = 'tt-login';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:radial-gradient(1200px 600px at 50% -10%,rgba(217,119,6,.15),transparent),#0b1220;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif';
    ov.innerHTML =
      '<form id="tt-login-form" style="width:360px;max-width:92vw;background:var(--surface,#1F2937);border:1px solid var(--border,#4B5563);border-radius:14px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
          '<div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,#B45309,#EA580C);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff">TT</div>' +
          '<div><div style="font-weight:700;color:#F9FAFB;font-size:15px">Transformer Titan</div>' +
          '<div style="color:#9CA3AF;font-size:11px">Predictive Maintenance Platform · Dell AI Factory</div></div>' +
        '</div>' +
        '<div style="color:#9CA3AF;font-size:12px;margin:14px 0 12px">Sign in to continue</div>' +
        '<input id="tt-username" placeholder="Username" autocomplete="username" style="width:100%;margin-bottom:10px;padding:10px 12px;background:#111827;border:1px solid #4B5563;border-radius:8px;color:#F9FAFB;font-size:14px">' +
        '<input id="tt-password" type="password" placeholder="Password" autocomplete="current-password" style="width:100%;margin-bottom:10px;padding:10px 12px;background:#111827;border:1px solid #4B5563;border-radius:8px;color:#F9FAFB;font-size:14px">' +
        '<div id="tt-login-error" style="color:#EF4444;font-size:12px;min-height:16px;margin-bottom:8px"></div>' +
        '<button type="submit" id="tt-login-btn" style="width:100%;padding:11px;background:linear-gradient(135deg,#B45309,#EA580C);border:none;border-radius:8px;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Sign in</button>' +
        '<div style="margin-top:14px;color:#6B7280;font-size:11px;line-height:1.6;border-top:1px solid #374151;padding-top:10px">' +
          '<b style="color:#9CA3AF">Demo accounts</b><br>' +
          'Administrator — <code>admin</code> / <code>Admin@123</code><br>' +
          'Regional Mgr — <code>rm.oromia</code> / <code>Password@123</code><br>' +
          'Technician — <code>tech.eng-003</code> / <code>Password@123</code>' +
        '</div>' +
      '</form>';
    document.body.appendChild(ov);
    var form = document.getElementById('tt-login-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('tt-login-btn');
      var errEl = document.getElementById('tt-login-error');
      errEl.textContent = '';
      btn.disabled = true; btn.textContent = 'Signing in…';
      fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: val('tt-username'), password: val('tt-password') })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error((res.j.error && res.j.error.message) || 'Login failed');
          TT_AUTH.token = res.j.token;
          try { localStorage.setItem(TOKEN_KEY, res.j.token); } catch (e) {}
          location.reload();
        })
        .catch(function (err) {
          errEl.textContent = err.message || 'Login failed';
          btn.disabled = false; btn.textContent = 'Sign in';
        });
    });
    setTimeout(function () { var u = document.getElementById('tt-username'); if (u) u.focus(); }, 50);
  }

  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
})();
