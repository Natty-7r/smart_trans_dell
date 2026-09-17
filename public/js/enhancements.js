/* enhancements.js — TT enterprise views (E2..E7) for the Transformer RAG SPA.
 * Vanilla JS, no build step. Renders into #view-* containers via window.TT_VIEWS.
 * All colors use the dark-theme CSS variables declared in index.html. */
(function () {
  'use strict';

  /* ────────────────────────────── helpers ────────────────────────────── */

  var A = function () { return window.TT_AUTH || { user: {}, permissions: {}, hasPerm: function () { return false; }, isRole: function () { return false; }, tokenParam: function () { return ''; }, allowedSiteIds: null }; };
  function perm(name) { try { return !!A().hasPerm(name); } catch (e) { return false; } }
  function isRole() { try { return A().isRole.apply(A(), arguments); } catch (e) { return false; } }
  function toast(msg, type) { if (typeof window.toast === 'function') window.toast(msg, type || 'info'); else if (type === 'error') alert(msg); }
  function icons() { try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch (e) {} }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'style') node.style.cssText = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    });
    if (html != null) node.innerHTML = html;
    return node;
  }

  function fmtDate(v, withTime) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return esc(v);
    var s = d.toISOString().slice(0, 10);
    if (withTime) s += ' ' + d.toISOString().slice(11, 16);
    return s;
  }
  function relTime(v) {
    if (!v) return '';
    var d = new Date(v); if (isNaN(d.getTime())) return esc(v);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return fmtDate(v);
  }
  function money(v) { if (v == null || v === '') return '—'; var n = Number(v); if (isNaN(n)) return esc(v); return '$' + n.toLocaleString(); }

  /* ── fetch wrappers (fetch is already auth-patched by auth.js) ── */
  function handle(p) {
    return p.then(function (r) {
      var ct = r.headers.get('content-type') || '';
      var body = ct.indexOf('application/json') >= 0 ? r.json() : r.text();
      if (!r.ok) return body.then(function (b) {
        var m = (b && b.error && b.error.message) || (b && b.message) || ('HTTP ' + r.status);
        throw new Error(m);
      });
      return body;
    });
  }
  function ttGet(url) { return handle(fetch(url)); }
  function ttPost(url, obj) { return handle(fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) })); }
  function ttPatch(url, obj) { return handle(fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) })); }
  function ttDelete(url) { return handle(fetch(url, { method: 'DELETE' })); }
  function ttForm(url, formData) { return handle(fetch(url, { method: 'POST', body: formData })); }

  function rowsOf(resp) { return (resp && resp.data) || (Array.isArray(resp) ? resp : []) || []; }

  /* ── UI building blocks ── */
  function badge(text, kind) {
    return '<span class="tt-badge tt-badge-' + (kind || 'muted') + '">' + esc(text) + '</span>';
  }
  function statusKind(s) {
    s = (s || '').toLowerCase();
    if (['critical', 'high', 'open', 'overdue', 'failed', 'error', 'at_risk'].indexOf(s) >= 0) return 'danger';
    if (['warning', 'medium', 'in_progress', 'pending', 'due', 'declining', 'acknowledged'].indexOf(s) >= 0) return 'warning';
    if (['healthy', 'low', 'resolved', 'completed', 'active', 'indexed', 'closed', 'normal', 'stable'].indexOf(s) >= 0) return 'success';
    if (['electrical', 'vector'].indexOf(s) >= 0) return 'info';
    return 'muted';
  }
  function roleBadge(r) {
    var map = { admin: 'danger', regional_manager: 'info', field_technician: 'success' };
    return badge((r || '').replace(/_/g, ' '), map[r] || 'muted');
  }
  function statCard(label, value, kind) {
    return '<div class="tt-stat"><div class="tt-stat-v" style="color:' + (kind || 'var(--text)') + '">' + esc(value) + '</div><div class="tt-stat-l">' + esc(label) + '</div></div>';
  }
  function empty(msg) { return '<div class="tt-empty">' + esc(msg || 'No records') + '</div>'; }

  /* Build a table. cols: [{h,render(row)}]. */
  function table(cols, data, onRow) {
    if (!data || !data.length) return empty();
    var h = '<div class="tt-tablewrap"><table class="tt-table"><thead><tr>';
    cols.forEach(function (c) { h += '<th>' + esc(c.h) + '</th>'; });
    h += '</tr></thead><tbody></tbody></table></div>';
    var wrap = el('div', null, h);
    var tb = wrap.querySelector('tbody');
    data.forEach(function (row, i) {
      var tr = el('tr', onRow ? { class: 'tt-clickable' } : null);
      cols.forEach(function (c) {
        var td = el('td', null, c.render(row, i));
        tr.appendChild(td);
      });
      if (onRow) tr.addEventListener('click', function (e) {
        if (e.target.closest('button,a,select,input,textarea,label')) return;
        onRow(row);
      });
      tb.appendChild(tr);
    });
    return wrap;
  }

  /* Inner tab bar. tabs=[{id,label}], onSel(id). Returns {bar,body}. */
  function innerTabs(tabs, active, onSel) {
    var bar = el('div', { class: 'tt-tabs' });
    var body = el('div', { class: 'tt-tabbody' });
    tabs.forEach(function (t) {
      var b = el('button', { class: 'tt-tab' + (t.id === active ? ' active' : '') }, esc(t.label));
      b.addEventListener('click', function () {
        bar.querySelectorAll('.tt-tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        onSel(t.id, body);
      });
      bar.appendChild(b);
    });
    return { bar: bar, body: body };
  }

  /* Modal with Save. onSave(formEl) may return a promise; resolve closes it. */
  function modal(title, bodyHtml, onSave, saveLabel) {
    var back = el('div', { class: 'tt-modal-back' });
    var box = el('div', { class: 'tt-modal' });
    box.innerHTML = '<div class="tt-modal-h"><span>' + esc(title) + '</span><button class="tt-x" data-x>&times;</button></div>' +
      '<form class="tt-modal-b"></form>' +
      '<div class="tt-modal-f">' +
      (onSave ? '<button type="button" class="tt-btn" data-save>' + esc(saveLabel || 'Save') + '</button>' : '') +
      '<button type="button" class="tt-btn tt-btn-ghost" data-x>Close</button></div>';
    box.querySelector('.tt-modal-b').innerHTML = bodyHtml;
    back.appendChild(box);
    document.body.appendChild(back);
    function close() { if (back.parentNode) back.parentNode.removeChild(back); }
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    box.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', close); });
    var save = box.querySelector('[data-save]');
    if (save) save.addEventListener('click', function () {
      var form = box.querySelector('.tt-modal-b');
      var res;
      try { res = onSave(form, close); } catch (e) { toast(e.message, 'error'); return; }
      if (res && typeof res.then === 'function') {
        save.disabled = true;
        res.then(function () { close(); }).catch(function (e) { toast(e.message || 'Save failed', 'error'); save.disabled = false; });
      } else if (res !== false) { close(); }
    });
    icons();
    return { close: close, box: box, form: box.querySelector('.tt-modal-b') };
  }

  function fieldVal(form, name) { var n = form.querySelector('[name="' + name + '"]'); return n ? n.value : ''; }

  /* ── site cache (used by many selectors) ── */
  var _sites = null;
  function loadSites() {
    if (_sites) return Promise.resolve(_sites);
    return ttGet('/api/sites?limit=500').then(function (r) { _sites = rowsOf(r); return _sites; }).catch(function () { return []; });
  }
  function siteOptions(sites, selected, includeBlank) {
    var h = includeBlank ? '<option value="">' + esc(includeBlank) + '</option>' : '';
    (sites || []).forEach(function (s) {
      h += '<option value="' + attr(s.site_id) + '"' + (s.site_id === selected ? ' selected' : '') + '>' + esc(s.name || s.site_id) + ' (' + esc(s.region || '') + ')</option>';
    });
    return h;
  }
  function siteRegion(sites, siteId) {
    var s = (sites || []).filter(function (x) { return x.site_id === siteId; })[0];
    return s ? s.region : '';
  }

  var _engineers = null;
  function loadEngineers() {
    if (_engineers) return Promise.resolve(_engineers);
    return ttGet('/api/engineers?limit=200&orderBy=full_name&orderDir=ASC').then(function (r) {
      _engineers = rowsOf(r);
      return _engineers;
    }).catch(function () { return []; });
  }
  function engineerOptions(engineers, selectedId, region) {
    var h = '<option value="">Unassigned</option>';
    var same = [];
    var other = [];
    (engineers || []).forEach(function (e) {
      if (region && e.region === region) same.push(e);
      else other.push(e);
    });
    var render = function (e) {
      return '<option value="' + attr(e.engineer_id) + '"' + (e.engineer_id === selectedId ? ' selected' : '') + '>' +
        esc(e.full_name || e.engineer_id) +
        (e.specialization ? ' — ' + esc(e.specialization) : '') +
        (e.region && e.region !== region ? ' · ' + esc(e.region) : '') +
        '</option>';
    };
    if (same.length) {
      h += '<optgroup label="' + esc(region) + '">' + same.map(render).join('') + '</optgroup>';
      if (other.length) h += '<optgroup label="Other regions">' + other.map(render).join('') + '</optgroup>';
    } else {
      h += other.map(render).join('');
    }
    return h;
  }
  function savingsHtml(est, act) {
    if (act == null || act === '' || isNaN(Number(act))) return '<span style="color:var(--muted)">—</span>';
    var s = Number(est || 0) - Number(act);
    var col = s >= 0 ? CV.success : CV.danger;
    var verb = s >= 0 ? 'saved ' : 'over ';
    return '<span style="color:' + col + ';font-weight:600">' + verb + money(Math.abs(s)) + '</span>';
  }

  /* ── live polling management ── */
  var liveTimers = [];
  function stopLive() { liveTimers.forEach(function (t) { clearInterval(t); }); liveTimers = []; }
  function poll(fn, ms) { fn(); var t = setInterval(fn, ms); liveTimers.push(t); return t; }

  /* ── chart instance registry ── */
  var charts = {};
  function destroyChart(k) { if (charts[k]) { try { charts[k].destroy(); } catch (e) {} charts[k] = null; } }
  var CV = {
    bg: '#111827', surface: '#1F2937', card: '#374151', border: '#4B5563',
    accent: '#D97706', text: '#F9FAFB', muted: '#9CA3AF',
    danger: '#EF4444', warning: '#F59E0B', success: '#10B981', info: '#3B82F6', orange: '#EA580C'
  };
  function healthColor(idx) {
    if (idx == null) return CV.muted;
    if (idx >= 80) return CV.success; if (idx >= 60) return CV.warning; if (idx >= 40) return CV.orange; return CV.danger;
  }
  function statusColor(s) {
    s = (s || '').toLowerCase();
    if (s === 'critical' || s === 'danger') return CV.danger;
    if (s === 'warning') return CV.warning;
    if (s === 'at_risk') return CV.orange;
    if (s === 'healthy' || s === 'normal' || s === 'success') return CV.success;
    return CV.muted;
  }

  /* ═══════════════════════════ style injection ═══════════════════════════ */
  function injectStyles() {
    if (document.getElementById('tt-enh-styles')) return;
    var css = [
      ':root{}',
      '.tt-wrap{color:var(--text);font-family:Inter,system-ui,sans-serif;font-size:13px}',
      '.tt-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}',
      '.tt-h h2{font-size:19px;font-weight:600;margin:0;display:flex;align-items:center;gap:8px}',
      '.tt-sub{color:var(--muted);font-size:12px;margin-top:2px}',
      '.tt-grid{display:grid;gap:12px}',
      '.tt-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px}',
      '.tt-stat{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}',
      '.tt-stat-v{font-size:24px;font-weight:700;line-height:1.1}',
      '.tt-stat-l{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-top:4px}',
      '.tt-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px}',
      '.tt-card-t{font-size:13px;font-weight:600;color:var(--text);margin-bottom:10px;display:flex;align-items:center;gap:6px}',
      '.tt-tablewrap{overflow:auto;border:1px solid var(--border);border-radius:10px}',
      '.tt-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.tt-table th{text-align:left;padding:9px 12px;background:var(--card);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border);white-space:nowrap}',
      '.tt-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:middle}',
      '.tt-table tbody tr:last-child td{border-bottom:none}',
      '.tt-table tbody tr:hover{background:rgba(255,255,255,.03)}',
      '.tt-clickable{cursor:pointer}',
      '.tt-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:600;text-transform:capitalize;line-height:1.5;white-space:nowrap}',
      '.tt-badge-muted{background:#4B556333;color:var(--muted);border:1px solid var(--border)}',
      '.tt-badge-danger{background:#EF444422;color:#FCA5A5;border:1px solid #EF444455}',
      '.tt-badge-warning{background:#F59E0B22;color:#FCD34D;border:1px solid #F59E0B55}',
      '.tt-badge-success{background:#10B98122;color:#6EE7B7;border:1px solid #10B98155}',
      '.tt-badge-info{background:#3B82F622;color:#93C5FD;border:1px solid #3B82F655}',
      '.tt-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px;flex-wrap:wrap}',
      '.tt-tab{background:transparent;border:none;color:var(--muted);padding:8px 14px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;font-family:inherit}',
      '.tt-tab:hover{color:var(--text)}',
      '.tt-tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}',
      '.tt-btn{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}',
      '.tt-btn:hover{background:var(--accent-dark)}',
      '.tt-btn:disabled{opacity:.5;cursor:default}',
      '.tt-btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text)}',
      '.tt-btn-ghost:hover{background:var(--card)}',
      '.tt-btn-sm{padding:4px 10px;font-size:11.5px;border-radius:6px}',
      '.tt-btn-danger{background:var(--danger)}.tt-btn-danger:hover{background:#DC2626}',
      '.tt-toggle{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}',
      '.tt-toggle button{background:var(--surface);color:var(--muted);border:none;padding:7px 16px;cursor:pointer;font-size:12.5px;font-family:inherit}',
      '.tt-toggle button.active{background:var(--accent);color:#fff;font-weight:600}',
      '.tt-input,.tt-select,.tt-textarea{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:12.5px;font-family:inherit;width:100%;box-sizing:border-box}',
      '.tt-input:focus,.tt-select:focus,.tt-textarea:focus{outline:none;border-color:var(--accent)}',
      '.tt-textarea{resize:vertical;min-height:64px}',
      '.tt-form-row{margin-bottom:12px}.tt-form-row label{display:block;font-size:11px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.03em}',
      '.tt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.tt-toolbar{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}',
      '.tt-toolbar .tt-input,.tt-toolbar .tt-select{width:auto;min-width:150px}',
      '.tt-empty{color:var(--muted);text-align:center;padding:28px;font-size:13px;background:var(--surface);border:1px dashed var(--border);border-radius:10px}',
      '.tt-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}',
      '.tt-modal{background:var(--surface);border:1px solid var(--border);border-radius:14px;width:100%;max-width:560px;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
      '.tt-modal-h{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);font-size:15px;font-weight:600}',
      '.tt-x{background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1}',
      '.tt-modal-b{padding:18px}',
      '.tt-modal-f{padding:14px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}',
      '.tt-2pane{display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start}',
      '@media(max-width:820px){.tt-2pane{grid-template-columns:1fr}.tt-form-grid{grid-template-columns:1fr}}',
      '.tt-list-item{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer}',
      '.tt-list-item:hover{border-color:var(--accent)}',
      '.tt-list-item.active{border-color:var(--accent);background:var(--card)}',
      '.tt-gauge-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap}',
      '.tt-tank{width:70px;height:180px;border:2px solid var(--border);border-radius:10px;position:relative;overflow:hidden;background:var(--bg)}',
      '.tt-tank-fill{position:absolute;bottom:0;left:0;right:0;transition:height .5s,background .5s}',
      '.tt-tank-label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;text-shadow:0 1px 3px #000}',
      '.tt-msg{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px}',
      '.tt-msg-reply{margin-left:28px;border-left:2px solid var(--accent)}',
      '.tt-msg-meta{font-size:11px;color:var(--muted);margin-bottom:4px;display:flex;gap:8px;align-items:center}',
      '.tt-msg-body{font-size:13px;white-space:pre-wrap;word-break:break-word}',
      '.tt-link{color:var(--info);cursor:pointer;font-size:11.5px;background:none;border:none;padding:0;font-family:inherit}',
      '.tt-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}',
      '.tt-cal-h{text-align:center;font-size:11px;color:var(--muted);padding:4px;font-weight:600}',
      '.tt-cal-cell{min-height:78px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px;font-size:11px}',
      '.tt-cal-cell.other{opacity:.35}.tt-cal-cell.today{border-color:var(--accent)}',
      '.tt-cal-day{color:var(--muted);font-size:11px;margin-bottom:2px}',
      '.tt-chip{display:block;font-size:10px;padding:2px 5px;border-radius:4px;margin-bottom:2px;cursor:pointer;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.tt-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;flex-shrink:0}',
      '.tt-tl-item{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start}',
      '.tt-tl-item:last-child{border-bottom:none}',
      '.tt-banner{display:flex;gap:20px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:14px}',
      '.tt-banner .k{font-size:11px;color:var(--muted)}.tt-banner .v{font-size:18px;font-weight:700}',
      '.tt-livecard{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center}',
      '.tt-livecard .lv{font-size:22px;font-weight:700}.tt-livecard .ll{font-size:10.5px;color:var(--muted);text-transform:uppercase;margin-top:2px}',
      '.tt-inline-err{color:#FCA5A5;background:#EF444415;border:1px solid #EF444455;border-radius:8px;padding:10px 12px;font-size:12.5px}',
      '.tt-chk{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);padding:2px 0;text-transform:none}',
      '.tt-chk input{width:auto}'
    ].join('\n');
    var s = el('style', { id: 'tt-enh-styles' }, css);
    document.head.appendChild(s);
  }

  function shell(title, iconName, subtitle, rightHtml) {
    return '<div class="tt-h"><div><h2>' + (iconName ? '<i data-lucide="' + iconName + '"></i>' : '') + esc(title) + '</h2>' +
      (subtitle ? '<div class="tt-sub">' + esc(subtitle) + '</div>' : '') + '</div>' +
      '<div class="tt-h-right">' + (rightHtml || '') + '</div></div>';
  }
  function showErr(container, e) {
    container.innerHTML = '<div class="tt-wrap"><div class="tt-inline-err">Failed to load: ' + esc(e.message || e) + '</div></div>';
  }

  /* view functions (declared here, referenced from TT_VIEWS registry below) */
  var TT_VIEWS_health, TT_VIEWS_maintenance, TT_VIEWS_groups, TT_VIEWS_knowledge, TT_VIEWS_admin;

  /* ═══════════════════════════ E5+E6 : HEALTH ═══════════════════════════ */
  var healthState = { mode: null, siteId: null, trend: [] };

  TT_VIEWS_health = function (container) {
    stopLive();
    if (healthState.mode === null) healthState.mode = perm('executiveDashboard') ? 'exec' : 'eng';
    renderHealthShell(container);
  };

  function renderHealthShell(container) {
    var canExec = perm('executiveDashboard');
    var toggle = '<div class="tt-toggle">' +
      (canExec ? '<button data-m="exec" class="' + (healthState.mode === 'exec' ? 'active' : '') + '">Executive</button>' : '') +
      '<button data-m="eng" class="' + (healthState.mode === 'eng' ? 'active' : '') + '">Engineer</button></div>';
    var refreshBtn = (perm('manageSites') || isRole('admin', 'regional_manager')) ?
      '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-refresh style="margin-left:8px"><i data-lucide="refresh-cw"></i>Refresh telemetry</button>' : '';
    container.innerHTML = '<div class="tt-wrap">' +
      shell('Transformer Health Index', 'activity', 'Fleet health analytics & real-time monitoring', toggle + refreshBtn) +
      '<div id="tt-health-body"></div></div>';
    container.querySelectorAll('[data-m]').forEach(function (b) {
      b.addEventListener('click', function () { healthState.mode = b.getAttribute('data-m'); renderHealthShell(container); });
    });
    var rb = container.querySelector('[data-refresh]');
    if (rb) rb.addEventListener('click', function () {
      rb.disabled = true;
      ttPost('/api/health/refresh').then(function () { toast('Telemetry refreshed', 'success'); renderHealthShell(container); })
        .catch(function (e) { toast(e.message, 'error'); rb.disabled = false; });
    });
    icons();
    var body = container.querySelector('#tt-health-body');
    if (healthState.mode === 'exec') renderExec(body); else renderEng(body, container);
  }

  function renderExec(body) {
    stopLive();
    body.innerHTML = '<div class="tt-empty">Loading fleet index…</div>';
    ttGet('/api/health/index').then(function (d) {
      d = d || {};
      var dist = d.distribution || {};
      var idx = d.fleetIndex;
      body.innerHTML =
        '<div class="tt-cards">' +
        statCard('Fleet Health Index', idx == null ? '—' : idx, healthColor(idx)) +
        statCard('Sites Monitored', d.siteCount || 0) +
        statCard('Healthy', dist.healthy || 0, CV.success) +
        statCard('Warning', dist.warning || 0, CV.warning) +
        statCard('At Risk', dist.at_risk || 0, CV.orange) +
        statCard('Critical', dist.critical || 0, CV.danger) +
        '</div>' +
        '<div class="tt-grid" style="grid-template-columns:1fr 1fr 1fr">' +
        '<div class="tt-card"><div class="tt-card-t">Fleet Index</div><div style="position:relative;height:200px"><canvas id="tt-gauge"></canvas></div></div>' +
        '<div class="tt-card"><div class="tt-card-t">Health Distribution</div><div style="height:200px"><canvas id="tt-dist"></canvas></div></div>' +
        '<div class="tt-card"><div class="tt-card-t">Score by Category</div><div style="height:200px"><canvas id="tt-cat"></canvas></div></div>' +
        '</div>' +
        '<div class="tt-card"><div class="tt-card-t"><i data-lucide="alert-triangle"></i>Worst Performing Sites</div><div id="tt-worst"></div></div>';
      icons();
      drawGauge(idx);
      drawDist(dist);
      drawCat(d.byCategory || {});
      var worst = d.worstSites || [];
      var w = table([
        { h: 'Site', render: function (r) { return esc(r.name || r.site_id); } },
        { h: 'Region', render: function (r) { return esc(r.region || '—'); } },
        { h: 'Index', render: function (r) { return '<span style="font-weight:700;color:' + healthColor(r.index) + '">' + esc(r.index) + '</span>'; } },
        { h: 'Status', render: function (r) { return badge(r.status, statusKind(r.status)); } }
      ], worst, function (r) { healthState.mode = 'eng'; healthState.siteId = r.site_id; var c = document.getElementById('view-health'); renderHealthShell(c); });
      var wc = document.getElementById('tt-worst'); wc.innerHTML = ''; wc.appendChild(w);
    }).catch(function (e) { showErr(body, e); });
  }

  function drawGauge(idx) {
    destroyChart('gauge');
    var ctx = document.getElementById('tt-gauge'); if (!ctx) return;
    var val = idx == null ? 0 : idx;
    charts.gauge = new Chart(ctx, {
      type: 'doughnut',
      data: { datasets: [{ data: [val, 100 - val], backgroundColor: [healthColor(idx), CV.card], borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, circumference: 180, rotation: 270, cutout: '72%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      },
      plugins: [{
        id: 'ctr', afterDraw: function (c) {
          var a = c.ctx, m = c.chartArea; a.save();
          a.textAlign = 'center'; a.fillStyle = healthColor(idx);
          a.font = '700 40px Inter, sans-serif';
          a.fillText(idx == null ? '—' : idx, (m.left + m.right) / 2, m.bottom - 8);
          a.fillStyle = CV.muted; a.font = '12px Inter, sans-serif';
          a.fillText('/ 100', (m.left + m.right) / 2, m.bottom + 12);
          a.restore();
        }
      }]
    });
  }
  function drawDist(dist) {
    destroyChart('dist');
    var ctx = document.getElementById('tt-dist'); if (!ctx) return;
    charts.dist = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Healthy', 'Warning', 'At Risk', 'Critical'],
        datasets: [{ data: [dist.healthy || 0, dist.warning || 0, dist.at_risk || 0, dist.critical || 0], backgroundColor: [CV.success, CV.warning, CV.orange, CV.danger], borderWidth: 0 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'bottom', labels: { color: CV.muted, font: { size: 11 }, boxWidth: 12 } } } }
    });
  }
  function drawCat(byCat) {
    destroyChart('cat');
    var ctx = document.getElementById('tt-cat'); if (!ctx) return;
    var keys = ['electrical', 'thermal', 'oil', 'insulation', 'mechanical'];
    charts.cat = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: keys.map(function (k) { return k.charAt(0).toUpperCase() + k.slice(1); }),
        datasets: [{ data: keys.map(function (k) { return byCat[k] == null ? 0 : byCat[k]; }), backgroundColor: keys.map(function (k) { return healthColor(byCat[k]); }), borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { y: { max: 100, ticks: { color: CV.muted }, grid: { color: CV.border } }, x: { ticks: { color: CV.muted, font: { size: 10 } }, grid: { display: false } } }
      }
    });
  }

  function renderEng(body, container) {
    stopLive();
    body.innerHTML = '<div class="tt-card"><div class="tt-form-row" style="max-width:420px;margin:0"><label>Select transformer site</label><select class="tt-select" id="tt-site-sel"><option value="">Loading sites…</option></select></div></div>' +
      '<div id="tt-eng-detail"></div>' +
      '<div class="tt-card"><div class="tt-card-t"><i data-lucide="droplet"></i>Fleet Oil Overview</div><div id="tt-oil-list"></div></div>';
    icons();
    loadSites().then(function (sites) {
      var sel = document.getElementById('tt-site-sel');
      if (!sel) return;
      sel.innerHTML = siteOptions(sites, healthState.siteId, 'Select a site…');
      sel.addEventListener('change', function () { healthState.siteId = sel.value; healthState.trend = []; loadEngSite(sel.value); });
      if (healthState.siteId) { sel.value = healthState.siteId; loadEngSite(healthState.siteId); }
    });
    loadOilOverview();
  }

  function loadOilOverview() {
    var c = document.getElementById('tt-oil-list'); if (!c) return;
    ttGet('/api/health/oil').then(function (rows) {
      rows = Array.isArray(rows) ? rows : rowsOf(rows);
      if (!rows.length) { c.innerHTML = empty(); return; }
      c.innerHTML = '';
      c.appendChild(table([
        { h: 'Site', render: function (r) { return esc(r.name || r.site_id); } },
        { h: 'Region', render: function (r) { return esc(r.region || '—'); } },
        { h: 'Oil Level', render: function (r) { return '<span style="font-weight:700;color:' + statusColor(r.status) + '">' + esc(r.oil_level_pct) + '%</span>'; } },
        { h: 'Status', render: function (r) { return badge(r.status, statusKind(r.status)); } }
      ], rows));
    }).catch(function (e) { c.innerHTML = '<div class="tt-inline-err">' + esc(e.message) + '</div>'; });
  }

  function loadEngSite(siteId) {
    stopLive();
    var d = document.getElementById('tt-eng-detail'); if (!d || !siteId) { if (d) d.innerHTML = ''; return; }
    d.innerHTML = '<div class="tt-empty">Loading site health…</div>';
    ttGet('/api/health/site/' + encodeURIComponent(siteId)).then(function (resp) {
      resp = resp || {};
      var params = resp.parameters || {};
      d.innerHTML =
        '<div class="tt-card"><div class="tt-card-t"><i data-lucide="gauge"></i>Live Telemetry <span style="color:var(--success);font-size:11px;margin-left:6px">● polling 3s</span></div><div class="tt-cards" id="tt-live"></div></div>' +
        '<div class="tt-grid" style="grid-template-columns:220px 1fr">' +
        '<div class="tt-card"><div class="tt-card-t">Oil Level</div><div class="tt-gauge-wrap" style="justify-content:center"><div class="tt-tank"><div class="tt-tank-fill" id="tt-tankfill"></div><div class="tt-tank-label" id="tt-tanklbl"></div></div></div></div>' +
        '<div class="tt-card"><div class="tt-card-t">Winding Temperature Trend</div><div style="height:180px"><canvas id="tt-trend"></canvas></div></div>' +
        '</div>' +
        '<div class="tt-card"><div class="tt-card-t"><i data-lucide="list"></i>Parameters by Category</div><div id="tt-params"></div></div>' +
        '<div class="tt-card"><div class="tt-card-t"><i data-lucide="bell"></i>Alarm History</div>' +
        '<div class="tt-toolbar"><input class="tt-input" id="tt-alarm-q" placeholder="Filter alarms…"></div><div id="tt-alarms"></div></div>';
      icons();
      renderParams(params);
      renderAlarms(siteId);
      startTrend();
      poll(function () { pollLive(siteId); }, 3000);
    }).catch(function (e) { showErr(d, e); });
  }

  var LIVE = [
    { k: 'primary_voltage_v', l: 'Primary V', u: 'V' },
    { k: 'load_current_a', l: 'Load Current', u: 'A' },
    { k: 'load_factor_pct', l: 'Load Factor', u: '%' },
    { k: 'top_oil_temperature_c', l: 'Top Oil Temp', u: '°C' },
    { k: 'winding_temperature_c', l: 'Winding Temp', u: '°C' },
    { k: 'power_factor', l: 'Power Factor', u: '' }
  ];
  function pollLive(siteId) {
    ttGet('/api/health/live/' + encodeURIComponent(siteId)).then(function (r) {
      r = r || {};
      var c = document.getElementById('tt-live'); if (!c) return;
      c.innerHTML = LIVE.map(function (p) {
        var v = r[p.k]; return '<div class="tt-livecard"><div class="lv">' + (v == null ? '—' : esc(v)) + '<span style="font-size:12px;color:var(--muted)"> ' + esc(p.u) + '</span></div><div class="ll">' + esc(p.l) + '</div></div>';
      }).join('');
      // oil tank
      var oil = r.oil_level_pct;
      var fill = document.getElementById('tt-tankfill'), lbl = document.getElementById('tt-tanklbl');
      if (fill && oil != null) {
        var col = oil <= 55 ? CV.danger : oil <= 70 ? CV.warning : CV.success;
        fill.style.height = Math.max(0, Math.min(100, oil)) + '%';
        fill.style.background = col;
        lbl.textContent = oil + '%';
        lbl.style.color = '#fff';
      }
      // trend
      var wt = r.winding_temperature_c;
      if (wt != null && charts.trend) {
        var t = new Date().toLocaleTimeString().slice(0, 8);
        healthState.trend.push({ t: t, v: wt });
        if (healthState.trend.length > 20) healthState.trend.shift();
        charts.trend.data.labels = healthState.trend.map(function (x) { return x.t; });
        charts.trend.data.datasets[0].data = healthState.trend.map(function (x) { return x.v; });
        charts.trend.update('none');
      }
    }).catch(function () {});
  }
  function startTrend() {
    destroyChart('trend');
    var ctx = document.getElementById('tt-trend'); if (!ctx) return;
    charts.trend = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Winding °C', data: [], borderColor: CV.accent, backgroundColor: CV.accent + '22', fill: true, tension: .3, pointRadius: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
        scales: { y: { ticks: { color: CV.muted }, grid: { color: CV.border } }, x: { ticks: { color: CV.muted, font: { size: 9 }, maxTicksLimit: 6 }, grid: { display: false } } }
      }
    });
  }
  function renderParams(grouped) {
    var c = document.getElementById('tt-params'); if (!c) return;
    var cats = ['electrical', 'thermal', 'oil', 'insulation', 'mechanical'];
    var any = false;
    var h = '';
    cats.forEach(function (cat) {
      var list = grouped[cat] || [];
      if (!list.length) return;
      any = true;
      h += '<div style="font-size:12px;font-weight:600;color:var(--accent);margin:12px 0 6px;text-transform:capitalize">' + esc(cat) + '</div>';
      h += '<div class="tt-tablewrap"><table class="tt-table"><thead><tr><th>Parameter</th><th>Value</th><th>Status</th><th>Warn</th><th>Crit</th></tr></thead><tbody>';
      list.forEach(function (p) {
        h += '<tr><td>' + esc(p.label) + '</td><td style="font-weight:600;color:' + statusColor(p.status) + '">' + esc(p.value) + ' ' + esc(p.unit || '') + '</td><td>' + badge(p.status, statusKind(p.status)) + '</td><td style="color:var(--muted)">' + esc(p.threshold_warn) + '</td><td style="color:var(--muted)">' + esc(p.threshold_crit) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    });
    c.innerHTML = any ? h : empty('No parameters recorded');
  }
  function renderAlarms(siteId) {
    var c = document.getElementById('tt-alarms'); if (!c) return;
    ttGet('/api/alerts?site_id=' + encodeURIComponent(siteId) + '&limit=100').then(function (r) {
      var rows = rowsOf(r);
      function draw(q) {
        var f = q ? rows.filter(function (a) { return JSON.stringify(a).toLowerCase().indexOf(q.toLowerCase()) >= 0; }) : rows;
        c.innerHTML = '';
        c.appendChild(table([
          { h: 'Severity', render: function (a) { return badge(a.severity, statusKind(a.severity)); } },
          { h: 'Type', render: function (a) { return esc(a.alert_type || '—'); } },
          { h: 'Message', render: function (a) { return esc(a.alert_message || a.message || '—'); } },
          { h: 'Time', render: function (a) { return fmtDate(a.timestamp, true); } },
          { h: 'Status', render: function (a) { return badge(a.status, statusKind(a.status)); } }
        ], f));
      }
      draw('');
      var qi = document.getElementById('tt-alarm-q');
      if (qi) qi.addEventListener('input', function () { draw(qi.value); });
    }).catch(function (e) { c.innerHTML = '<div class="tt-inline-err">' + esc(e.message) + '</div>'; });
  }

  /* ═══════════════════════════ E4 : MAINTENANCE ═══════════════════════════ */
  var mtnTab = 'schedules';
  var mtnHistSite = null;
  TT_VIEWS_maintenance = function (container) {
    stopLive();
    container.innerHTML = '<div class="tt-wrap">' + shell('Maintenance', 'wrench', 'Schedules, calendar, failures & full history') + '<div id="tt-mtn-tabs"></div><div id="tt-mtn-body"></div></div>';
    icons();
    var tabs = innerTabs([
      { id: 'schedules', label: 'Schedules' }, { id: 'calendar', label: 'Calendar' },
      { id: 'failures', label: 'Failures' }, { id: 'history', label: 'History' }
    ], mtnTab, function (id) { mtnTab = id; renderMtn(id); });
    document.getElementById('tt-mtn-tabs').appendChild(tabs.bar);
    renderMtn(mtnTab);
  };
  function mtnBody() { return document.getElementById('tt-mtn-body'); }
  function renderMtn(id) {
    var b = mtnBody(); b.innerHTML = '<div class="tt-empty">Loading…</div>';
    if (id === 'schedules') mtnSchedules(b);
    else if (id === 'calendar') mtnCalendar(b);
    else if (id === 'failures') mtnFailures(b);
    else mtnHistory(b);
  }

  var canSched = function () { return perm('manageSchedules'); };
  function mtnSchedules(b, filters) {
    filters = filters || {};
    var qs = Object.keys(filters).filter(function (k) { return filters[k]; }).map(function (k) { return k + '=' + encodeURIComponent(filters[k]); }).join('&');
    ttGet('/api/maintenance-schedules' + (qs ? '?' + qs : '')).then(function (r) {
      var rows = rowsOf(r), st = r.stats || {};
      var mayComplete = canSched() || isRole('field_technician');
      b.innerHTML =
        '<div class="tt-cards">' + statCard('Total', st.total || 0) + statCard('Overdue', st.overdue || 0, CV.danger) +
        statCard('Due Soon', st.dueSoon || 0, CV.warning) +
        statCard('Open estimate', money(st.openEstimatedUsd || 0), CV.info) +
        statCard('Actual spend', money(st.actualSpendUsd || 0), CV.orange) +
        statCard('Cost saved', money(st.savedUsd || 0), (st.savedUsd || 0) >= 0 ? CV.success : CV.danger) + '</div>' +
        '<div class="tt-toolbar"><input class="tt-input" id="ms-q" placeholder="Search…" value="' + attr(filters.search || '') + '">' +
        '<select class="tt-select" id="ms-status"><option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="paused">Paused</option></select>' +
        (canSched() ? '<button class="tt-btn" id="ms-new" style="margin-left:auto"><i data-lucide="plus"></i>New schedule</button>' : '') + '</div>' +
        '<div id="ms-table"></div>';
      icons();
      document.getElementById('ms-status').value = filters.status || '';
      var apply = function () { mtnSchedules(b, { search: document.getElementById('ms-q').value, status: document.getElementById('ms-status').value }); };
      document.getElementById('ms-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') apply(); });
      document.getElementById('ms-status').addEventListener('change', apply);
      var newBtn = document.getElementById('ms-new'); if (newBtn) newBtn.addEventListener('click', function () { scheduleModal(null, function () { renderMtn('schedules'); }); });
      var cols = [
        { h: 'Site', render: function (s) { return esc(s.site_name || s.site_id); } },
        { h: 'Title', render: function (s) { return esc(s.title); } },
        { h: 'Frequency', render: function (s) { return esc(s.frequency || s.task_type || '—'); } },
        { h: 'Next Due', render: function (s) { return fmtDate(s.next_due_date); } },
        { h: 'Priority', render: function (s) { return badge(s.priority || '—', statusKind(s.priority)); } },
        { h: 'Status', render: function (s) { return badge(s.status || '—', statusKind(s.status)); } },
        { h: 'Engineer', render: function (s) { return esc(s.assigned_engineer_name || 'Unassigned'); } },
        { h: 'Estimated', render: function (s) { return money(s.estimated_cost_usd); } },
        { h: 'Last actual', render: function (s) { return money(s.last_actual_cost_usd); } },
        { h: 'Saved', render: function (s) {
          if (s.total_saved_usd == null && s.last_actual_cost_usd == null) return '—';
          if (s.last_actual_cost_usd != null) return savingsHtml(s.estimated_cost_usd, s.last_actual_cost_usd);
          return savingsHtml(s.total_estimated_cost_usd, Number(s.total_estimated_cost_usd || 0) - Number(s.total_saved_usd || 0));
        } },
        { h: '', render: function (s) {
          var h = '';
          if (mayComplete && s.status === 'active') h += '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-complete="' + attr(s.schedule_id) + '">Complete</button> ';
          if (canSched()) h += '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-edit="' + attr(s.schedule_id) + '">Edit</button>';
          return h;
        } }
      ];
      var t = table(cols, rows);
      var tc = document.getElementById('ms-table'); tc.innerHTML = ''; tc.appendChild(rows.length ? t : el('div', null, empty('No schedules')));
      tc.querySelectorAll('[data-complete]').forEach(function (btn) { btn.addEventListener('click', function () {
        var s = rows.filter(function (x) { return x.schedule_id === btn.getAttribute('data-complete'); })[0];
        completeScheduleModal(s, function () { renderMtn('schedules'); });
      }); });
      tc.querySelectorAll('[data-edit]').forEach(function (btn) { btn.addEventListener('click', function () {
        var s = rows.filter(function (x) { return x.schedule_id === btn.getAttribute('data-edit'); })[0];
        scheduleModal(s, function () { renderMtn('schedules'); });
      }); });
    }).catch(function (e) { showErr(b, e); });
  }

  function scheduleModal(s, done) {
    s = s || {};
    Promise.all([loadSites(), loadEngineers()]).then(function (pair) {
      var sites = pair[0];
      var engineers = pair[1];
      var region = siteRegion(sites, s.site_id);
      var body =
        '<div class="tt-form-row"><label>Site</label><select class="tt-select" name="site_id">' + siteOptions(sites, s.site_id, 'Select site…') + '</select></div>' +
        '<div class="tt-form-row"><label>Title</label><input class="tt-input" name="title" value="' + attr(s.title || '') + '"></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Frequency</label><input class="tt-input" name="frequency" value="' + attr(s.frequency || '') + '" placeholder="e.g. quarterly"></div>' +
        '<div class="tt-form-row"><label>Interval (days)</label><input class="tt-input" type="number" name="interval_days" value="' + attr(s.interval_days || 90) + '"></div></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Next Due Date</label><input class="tt-input" type="date" name="next_due_date" value="' + attr((s.next_due_date || '').slice(0, 10)) + '"></div>' +
        '<div class="tt-form-row"><label>Priority</label><select class="tt-select" name="priority"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></div></div>' +
        '<div class="tt-form-row"><label>Assigned Engineer</label><select class="tt-select" name="assigned_engineer_id">' + engineerOptions(engineers, s.assigned_engineer_id, region) + '</select></div>' +
        '<div class="tt-form-row"><label>Estimated cost (USD)</label><input class="tt-input" type="number" min="0" step="0.01" name="estimated_cost_usd" value="' + attr(s.estimated_cost_usd != null ? s.estimated_cost_usd : '') + '" placeholder="Planned visit budget"></div>' +
        (s.last_actual_cost_usd != null ? '<div class="tt-form-row"><label>Last actual / savings</label><div>' + money(s.last_actual_cost_usd) + ' · ' + savingsHtml(s.estimated_cost_usd, s.last_actual_cost_usd) + '</div></div>' : '') +
        '<div class="tt-form-row"><label>Description</label><textarea class="tt-textarea" name="description">' + esc(s.description || '') + '</textarea></div>';
      var m = modal(s.schedule_id ? 'Edit Schedule' : 'New Schedule', body, function (form) {
        var payload = {
          site_id: fieldVal(form, 'site_id'), title: fieldVal(form, 'title'), frequency: fieldVal(form, 'frequency'),
          interval_days: parseInt(fieldVal(form, 'interval_days')) || 90, next_due_date: fieldVal(form, 'next_due_date'),
          priority: fieldVal(form, 'priority'),
          assigned_engineer_id: fieldVal(form, 'assigned_engineer_id') || null,
          estimated_cost_usd: fieldVal(form, 'estimated_cost_usd') === '' ? null : Number(fieldVal(form, 'estimated_cost_usd')),
          description: fieldVal(form, 'description')
        };
        if (!payload.site_id || !payload.title) throw new Error('Site and title are required');
        if (payload.estimated_cost_usd == null || isNaN(payload.estimated_cost_usd)) throw new Error('Estimated cost is required');
        var p = s.schedule_id ? ttPatch('/api/maintenance-schedules/' + encodeURIComponent(s.schedule_id), payload) : ttPost('/api/maintenance-schedules', payload);
        return p.then(function () { toast('Saved', 'success'); done(); });
      });
      if (s.priority) m.form.querySelector('[name="priority"]').value = s.priority;
      var siteSel = m.form.querySelector('[name="site_id"]');
      var engSel = m.form.querySelector('[name="assigned_engineer_id"]');
      siteSel.addEventListener('change', function () {
        var keep = engSel.value;
        engSel.innerHTML = engineerOptions(engineers, keep, siteRegion(sites, siteSel.value));
      });
    });
  }

  function completeScheduleModal(s, done) {
    s = s || {};
    loadEngineers().then(function (engineers) {
      var est = Number(s.estimated_cost_usd) || 0;
      var body =
        '<div class="tt-form-row"><label>Site</label><div>' + esc(s.site_name || s.site_id) + '</div></div>' +
        '<div class="tt-form-row"><label>Work</label><div>' + esc(s.title || 'Scheduled maintenance') + '</div></div>' +
        '<div class="tt-form-row"><label>Assigned engineer</label><select class="tt-select" name="assigned_engineer_id">' +
          engineerOptions(engineers, s.assigned_engineer_id, s.region) + '</select></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Estimated cost</label><div style="font-weight:600">' + money(est) + '</div></div>' +
        '<div class="tt-form-row"><label>Actual cost (USD)</label><input class="tt-input" type="number" min="0" step="0.01" name="actual_cost_usd" value="" placeholder="Enter actual spend" required></div></div>' +
        '<div class="tt-form-row"><label>This visit savings</label><div id="tt-save-preview">' + savingsHtml(est, '') + '</div></div>' +
        '<div class="tt-form-row"><label>Notes</label><textarea class="tt-textarea" name="notes" placeholder="Parts used, findings, access notes…"></textarea></div>';
      var m = modal('Complete maintenance', body, function (form) {
        var actual = fieldVal(form, 'actual_cost_usd');
        if (actual === '' || isNaN(Number(actual)) || Number(actual) < 0) throw new Error('Actual cost is required');
        var payload = {
          actual_cost_usd: Number(actual),
          assigned_engineer_id: fieldVal(form, 'assigned_engineer_id') || null,
          notes: fieldVal(form, 'notes')
        };
        return ttPost('/api/maintenance-schedules/' + encodeURIComponent(s.schedule_id) + '/complete', payload).then(function (r) {
          var saved = r && r.completion ? r.completion.saved_usd : (est - Number(actual));
          var msg = saved >= 0 ? 'Completed — saved ' + money(saved) + ' vs estimate' : 'Completed — ' + money(Math.abs(saved)) + ' over estimate';
          toast(msg, saved >= 0 ? 'success' : 'info');
          done();
        });
      }, 'Complete visit');
      var inp = m.form.querySelector('[name="actual_cost_usd"]');
      var preview = m.form.querySelector('#tt-save-preview');
      var updatePreview = function () { preview.innerHTML = savingsHtml(est, inp.value); };
      inp.addEventListener('input', updatePreview);
      setTimeout(function () { inp.focus(); }, 50);
    });
  }

  function mtnCalendar(b) {
    var now = mtnCalendar._d || new Date();
    mtnCalendar._d = now;
    var y = now.getFullYear(), mo = now.getMonth();
    var first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
    var fromS = first.toISOString().slice(0, 10), toS = last.toISOString().slice(0, 10);
    var monthName = first.toLocaleString('en', { month: 'long', year: 'numeric' });
    b.innerHTML = '<div class="tt-toolbar"><button class="tt-btn tt-btn-ghost tt-btn-sm" id="cal-prev">‹ Prev</button><div style="font-weight:600;font-size:15px;min-width:180px;text-align:center">' + esc(monthName) + '</div><button class="tt-btn tt-btn-ghost tt-btn-sm" id="cal-next">Next ›</button></div><div id="cal-grid"><div class="tt-empty">Loading…</div></div>';
    document.getElementById('cal-prev').addEventListener('click', function () { mtnCalendar._d = new Date(y, mo - 1, 1); mtnCalendar(b); });
    document.getElementById('cal-next').addEventListener('click', function () { mtnCalendar._d = new Date(y, mo + 1, 1); mtnCalendar(b); });
    ttGet('/api/maintenance-schedules/calendar?from=' + fromS + '&to=' + toS).then(function (r) {
      var rows = rowsOf(r);
      var byDay = {};
      rows.forEach(function (s) { var d = (s.next_due_date || '').slice(0, 10); if (!d) return; (byDay[d] = byDay[d] || []).push(s); });
      var grid = document.getElementById('cal-grid');
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var h = '<div class="tt-cal">';
      days.forEach(function (d) { h += '<div class="tt-cal-h">' + d + '</div>'; });
      var start = first.getDay();
      var todayS = new Date().toISOString().slice(0, 10);
      for (var i = 0; i < start; i++) h += '<div class="tt-cal-cell other"></div>';
      for (var day = 1; day <= last.getDate(); day++) {
        var ds = new Date(y, mo, day).toISOString().slice(0, 10);
        h += '<div class="tt-cal-cell' + (ds === todayS ? ' today' : '') + '"><div class="tt-cal-day">' + day + '</div>';
        (byDay[ds] || []).forEach(function (s) {
          var overdue = ds < todayS && s.status === 'active';
          var col = (overdue || s.priority === 'high') ? CV.danger : s.priority === 'medium' ? CV.warning : CV.success;
          h += '<span class="tt-chip" style="background:' + col + '" data-id="' + attr(s.schedule_id) + '" title="' + attr(s.title) + '">' + esc(s.title) + '</span>';
        });
        h += '</div>';
      }
      h += '</div>';
      grid.innerHTML = h;
      grid.querySelectorAll('[data-id]').forEach(function (chip) { chip.addEventListener('click', function () {
        var s = rows.filter(function (x) { return x.schedule_id === chip.getAttribute('data-id'); })[0];
        if (canSched()) scheduleModal(s, function () { mtnCalendar(b); });
        else scheduleInfo(s);
      }); });
    }).catch(function (e) { document.getElementById('cal-grid').innerHTML = '<div class="tt-inline-err">' + esc(e.message) + '</div>'; });
  }
  function scheduleInfo(s) {
    s = s || {};
    modal('Schedule: ' + (s.title || ''),
      '<div class="tt-form-row"><label>Site</label><div>' + esc(s.site_name || s.site_id) + '</div></div>' +
      '<div class="tt-form-row"><label>Next Due</label><div>' + fmtDate(s.next_due_date) + '</div></div>' +
      '<div class="tt-form-row"><label>Priority</label><div>' + badge(s.priority || '—', statusKind(s.priority)) + '</div></div>' +
      '<div class="tt-form-row"><label>Status</label><div>' + badge(s.status || '—', statusKind(s.status)) + '</div></div>' +
      '<div class="tt-form-row"><label>Assigned engineer</label><div>' + esc(s.assigned_engineer_name || 'Unassigned') + '</div></div>' +
      '<div class="tt-form-row"><label>Estimated cost</label><div>' + money(s.estimated_cost_usd) + '</div></div>' +
      '<div class="tt-form-row"><label>Last actual / savings</label><div>' + money(s.last_actual_cost_usd) + ' · ' + savingsHtml(s.estimated_cost_usd, s.last_actual_cost_usd) + '</div></div>' +
      '<div class="tt-form-row"><label>Description</label><div>' + esc(s.description || '—') + '</div></div>', null);
  }

  var canFail = function () { return isRole('admin', 'regional_manager', 'field_technician'); };
  function mtnFailures(b, filters) {
    filters = filters || {};
    var qs = Object.keys(filters).filter(function (k) { return filters[k]; }).map(function (k) { return k + '=' + encodeURIComponent(filters[k]); }).join('&');
    ttGet('/api/failures' + (qs ? '?' + qs : '')).then(function (r) {
      var rows = rowsOf(r), st = r.stats || {};
      b.innerHTML =
        '<div class="tt-cards">' + statCard('Total', st.total || 0) + statCard('Open', st.open || 0, CV.danger) +
        statCard('Resolved', st.resolved || 0, CV.success) + '</div>' +
        '<div class="tt-toolbar"><input class="tt-input" id="fl-q" placeholder="Search…" value="' + attr(filters.search || '') + '">' +
        '<select class="tt-select" id="fl-sev"><option value="">All severity</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select>' +
        (canFail() ? '<button class="tt-btn" id="fl-new" style="margin-left:auto"><i data-lucide="plus"></i>Log failure</button>' : '') + '</div>' +
        '<div id="fl-table"></div>';
      icons();
      document.getElementById('fl-sev').value = filters.severity || '';
      var apply = function () { mtnFailures(b, { search: document.getElementById('fl-q').value, severity: document.getElementById('fl-sev').value }); };
      document.getElementById('fl-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') apply(); });
      document.getElementById('fl-sev').addEventListener('change', apply);
      var nb = document.getElementById('fl-new'); if (nb) nb.addEventListener('click', function () { failureModal(null, function () { renderMtn('failures'); }); });
      var cols = [
        { h: 'Site', render: function (f) { return esc(f.site_name || f.site_id); } },
        { h: 'Type', render: function (f) { return esc(f.failure_type); } },
        { h: 'Component', render: function (f) { return esc(f.component || '—'); } },
        { h: 'Severity', render: function (f) { return badge(f.severity, statusKind(f.severity)); } },
        { h: 'Status', render: function (f) { return badge(f.resolution_status, statusKind(f.resolution_status)); } },
        { h: 'Root Cause', render: function (f) { return esc(f.root_cause || '—'); } },
        { h: 'Cost', render: function (f) { return money(f.cost_usd); } },
        { h: '', render: function (f) { return canFail() ? '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-edit="' + attr(f.failure_id) + '">Edit</button>' : ''; } }
      ];
      var t = table(cols, rows);
      var tc = document.getElementById('fl-table'); tc.innerHTML = ''; tc.appendChild(rows.length ? t : el('div', null, empty('No failures')));
      tc.querySelectorAll('[data-edit]').forEach(function (btn) { btn.addEventListener('click', function () {
        var f = rows.filter(function (x) { return x.failure_id === btn.getAttribute('data-edit'); })[0];
        failureModal(f, function () { renderMtn('failures'); });
      }); });
    }).catch(function (e) { showErr(b, e); });
  }
  function failureModal(f, done) {
    f = f || {};
    loadSites().then(function (sites) {
      var body =
        '<div class="tt-form-row"><label>Site</label><select class="tt-select" name="site_id">' + siteOptions(sites, f.site_id, 'Select site…') + '</select></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Failure Type</label><input class="tt-input" name="failure_type" value="' + attr(f.failure_type || '') + '"></div>' +
        '<div class="tt-form-row"><label>Component</label><input class="tt-input" name="component" value="' + attr(f.component || '') + '"></div></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Severity</label><select class="tt-select" name="severity"><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div>' +
        '<div class="tt-form-row"><label>Status</label><select class="tt-select" name="resolution_status"><option value="open">open</option><option value="in_progress">in_progress</option><option value="resolved">resolved</option></select></div></div>' +
        '<div class="tt-form-row"><label>Root Cause</label><textarea class="tt-textarea" name="root_cause">' + esc(f.root_cause || '') + '</textarea></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Cost (USD)</label><input class="tt-input" type="number" name="cost_usd" value="' + attr(f.cost_usd != null ? f.cost_usd : '') + '"></div>' +
        '<div class="tt-form-row"><label>Downtime (h)</label><input class="tt-input" type="number" name="downtime_hours" value="' + attr(f.downtime_hours != null ? f.downtime_hours : '') + '"></div></div>';
      var m = modal(f.failure_id ? 'Edit Failure' : 'Log Failure', body, function (form) {
        var payload = {
          site_id: fieldVal(form, 'site_id'), failure_type: fieldVal(form, 'failure_type'), component: fieldVal(form, 'component'),
          severity: fieldVal(form, 'severity'), resolution_status: fieldVal(form, 'resolution_status'), root_cause: fieldVal(form, 'root_cause'),
          cost_usd: parseFloat(fieldVal(form, 'cost_usd')) || 0, downtime_hours: parseFloat(fieldVal(form, 'downtime_hours')) || 0
        };
        if (!payload.site_id || !payload.failure_type) throw new Error('Site and failure type are required');
        var p = f.failure_id ? ttPatch('/api/failures/' + encodeURIComponent(f.failure_id), payload) : ttPost('/api/failures', payload);
        return p.then(function () { toast('Saved', 'success'); done(); });
      });
      if (f.severity) m.form.querySelector('[name="severity"]').value = f.severity;
      if (f.resolution_status) m.form.querySelector('[name="resolution_status"]').value = f.resolution_status;
    });
  }

  function mtnHistory(b) {
    b.innerHTML = '<div class="tt-card"><div class="tt-form-row" style="max-width:420px;margin:0"><label>Select transformer site</label><select class="tt-select" id="hist-sel"><option value="">Loading…</option></select></div></div><div id="hist-body"></div>';
    loadSites().then(function (sites) {
      var sel = document.getElementById('hist-sel');
      sel.innerHTML = siteOptions(sites, mtnHistSite, 'Select a site…');
      sel.addEventListener('change', function () { mtnHistSite = sel.value; loadHistory(sel.value); });
      if (mtnHistSite) { sel.value = mtnHistSite; loadHistory(mtnHistSite); }
    });
  }
  function loadHistory(siteId) {
    var c = document.getElementById('hist-body'); if (!c) return;
    if (!siteId) { c.innerHTML = ''; return; }
    c.innerHTML = '<div class="tt-empty">Loading history…</div>';
    ttGet('/api/maintenance-schedules/history/' + encodeURIComponent(siteId)).then(function (r) {
      r = r || {};
      var up = r.upcoming;
      var items = [];
      var add = function (arr, type, color, dateKey, labelFn) {
        (arr || []).forEach(function (x) { items.push({ type: type, color: color, date: x[dateKey] || x.created_at || x.timestamp, label: labelFn(x) }); });
      };
      add(r.records, 'Maintenance', CV.success, 'performed_at', function (x) {
        var cost = x.cost_usd != null ? ' · ' + money(x.cost_usd) : '';
        var save = (x.estimated_cost_usd != null && x.cost_usd != null) ? ' · ' + savingsHtml(x.estimated_cost_usd, x.cost_usd).replace(/<[^>]+>/g, '') : '';
        return (x.primary_task || x.task_type || x.notes || 'Maintenance record') + cost + save;
      });
      add(r.faults, 'Fault', CV.orange, 'timestamp', function (x) { return x.fault_type || x.description || 'Fault event'; });
      add(r.alerts, 'Alert', CV.warning, 'timestamp', function (x) { return x.alert_message || x.alert_type || 'Alert'; });
      add(r.failures, 'Failure', CV.danger, 'created_at', function (x) { return (x.failure_type || 'Failure') + (x.component ? ' — ' + x.component : ''); });
      add(r.inspections, 'Inspection', CV.info, 'scheduled_at', function (x) { return x.inspection_type || x.notes || 'Inspection'; });
      add(r.schedules, 'Schedule', CV.accent, 'next_due_date', function (x) { return x.title; });
      items = items.filter(function (i) { return i.date; }).sort(function (a, b2) { return String(b2.date).localeCompare(String(a.date)); });
      var h = '';
      h += '<div class="tt-card"><div class="tt-card-t"><i data-lucide="calendar-clock"></i>Upcoming Maintenance</div>' +
        (up ? '<div><strong>' + esc(up.title) + '</strong> — due ' + fmtDate(up.next_due_date) + ' ' + badge(up.priority || '—', statusKind(up.priority)) + '</div>' : empty('No upcoming schedule')) + '</div>';
      h += '<div class="tt-card"><div class="tt-card-t"><i data-lucide="history"></i>Unified Maintenance History</div><div id="hist-tl">' +
        (items.length ? '' : empty('No history records')) + '</div></div>';
      c.innerHTML = h;
      icons();
      if (items.length) {
        var tl = document.getElementById('hist-tl');
        tl.innerHTML = items.map(function (it) {
          return '<div class="tt-tl-item"><span class="tt-dot" style="background:' + it.color + ';margin-top:4px"></span><div style="flex:1"><div style="font-size:12px">' + badge(it.type, 'muted') + ' <span style="color:var(--muted);margin-left:6px">' + fmtDate(it.date, true) + '</span></div><div style="margin-top:2px">' + esc(it.label) + '</div></div></div>';
        }).join('');
      }
    }).catch(function (e) { showErr(c, e); });
  }

  /* ═══════════════════════════ E3 : GROUPS ═══════════════════════════ */
  var grpState = { id: null, tab: 'messages', replyTo: null };
  var canGroup = function () { return perm('manageSites') || isRole('regional_manager', 'admin'); };

  TT_VIEWS_groups = function (container) {
    stopLive();
    container.innerHTML = '<div class="tt-wrap">' + shell('Collaboration', 'users', 'Regional teams, messaging, files & escalations',
      canGroup() ? '<button class="tt-btn" id="grp-new"><i data-lucide="plus"></i>New group</button>' : '') +
      '<div class="tt-2pane"><div id="grp-list"><div class="tt-empty">Loading…</div></div><div id="grp-detail" class="tt-card"><div class="tt-empty">Select a group</div></div></div></div>';
    icons();
    var nb = document.getElementById('grp-new'); if (nb) nb.addEventListener('click', groupModal);
    loadGroupList();
  };
  function loadGroupList() {
    ttGet('/api/groups').then(function (r) {
      var rows = rowsOf(r);
      var c = document.getElementById('grp-list'); if (!c) return;
      if (!rows.length) { c.innerHTML = empty('No groups'); return; }
      c.innerHTML = '';
      rows.forEach(function (g) {
        var item = el('div', { class: 'tt-list-item' + (g.group_id === grpState.id ? ' active' : '') },
          '<div style="font-weight:600;display:flex;justify-content:space-between;align-items:center">' + esc(g.name) +
          (g.open_escalations ? ' ' + badge(g.open_escalations + ' esc', 'danger') : '') + '</div>' +
          '<div class="tt-sub">' + esc((g.scope_type || '') + ': ' + (g.scope_value || '')) + '</div>' +
          '<div class="tt-sub">' + esc((g.member_count || 0) + ' members · ' + (g.message_count || 0) + ' messages') + '</div>');
        item.addEventListener('click', function () { grpState.id = g.group_id; grpState.replyTo = null; loadGroupList(); openGroup(g); });
        c.appendChild(item);
      });
    }).catch(function (e) { var c = document.getElementById('grp-list'); if (c) c.innerHTML = '<div class="tt-inline-err">' + esc(e.message) + '</div>'; });
  }
  function groupModal() {
    modal('New Group',
      '<div class="tt-form-row"><label>Name</label><input class="tt-input" name="name"></div>' +
      '<div class="tt-form-row"><label>Description</label><textarea class="tt-textarea" name="description"></textarea></div>' +
      '<div class="tt-form-grid"><div class="tt-form-row"><label>Scope Type</label><select class="tt-select" name="scope_type"><option value="region">region</option><option value="site">site</option></select></div>' +
      '<div class="tt-form-row"><label>Scope Value</label><input class="tt-input" name="scope_value" placeholder="region name or site id"></div></div>',
      function (form) {
        var payload = { name: fieldVal(form, 'name'), description: fieldVal(form, 'description'), scope_type: fieldVal(form, 'scope_type'), scope_value: fieldVal(form, 'scope_value') };
        if (!payload.name || !payload.scope_value) throw new Error('Name and scope value are required');
        return ttPost('/api/groups', payload).then(function () { toast('Group created', 'success'); loadGroupList(); });
      });
  }
  function openGroup(g) {
    var d = document.getElementById('grp-detail'); if (!d) return;
    d.innerHTML = '<div class="tt-card-t">' + esc(g.name) + '</div><div id="grp-tabs"></div><div id="grp-tabbody"></div>';
    var tabs = innerTabs([
      { id: 'messages', label: 'Messages' }, { id: 'files', label: 'Files' },
      { id: 'members', label: 'Members' }, { id: 'escalations', label: 'Escalations' }
    ], grpState.tab, function (id) { grpState.tab = id; renderGrpTab(g); });
    document.getElementById('grp-tabs').appendChild(tabs.bar);
    renderGrpTab(g);
  }
  function renderGrpTab(g) {
    var b = document.getElementById('grp-tabbody'); if (!b) return;
    b.innerHTML = '<div class="tt-empty">Loading…</div>';
    if (grpState.tab === 'messages') grpMessages(g, b);
    else if (grpState.tab === 'files') grpFiles(g, b);
    else if (grpState.tab === 'members') grpMembers(g, b);
    else grpEscalations(g, b);
  }
  function grpMessages(g, b) {
    ttGet('/api/groups/' + encodeURIComponent(g.group_id) + '/messages').then(function (r) {
      var msgs = rowsOf(r);
      var roots = msgs.filter(function (m) { return !m.parent_id; });
      var repliesBy = {};
      msgs.filter(function (m) { return m.parent_id; }).forEach(function (m) { (repliesBy[m.parent_id] = repliesBy[m.parent_id] || []).push(m); });
      var h = '<div id="grp-msgs" style="max-height:420px;overflow:auto;margin-bottom:12px">';
      if (!roots.length) h += empty('No messages yet');
      roots.forEach(function (m) {
        h += msgHtml(m, false);
        (repliesBy[m.message_id] || []).forEach(function (rp) { h += msgHtml(rp, true); });
      });
      h += '</div>';
      h += '<div id="grp-replyto"></div><div class="tt-form-row" style="margin:0"><textarea class="tt-textarea" id="grp-composer" placeholder="Write a message…"></textarea></div>' +
        '<div style="margin-top:8px;display:flex;gap:8px"><button class="tt-btn" id="grp-send"><i data-lucide="send"></i>Send</button></div>';
      b.innerHTML = h;
      icons();
      updateReplyIndicator();
      b.querySelectorAll('[data-reply]').forEach(function (btn) { btn.addEventListener('click', function () { grpState.replyTo = btn.getAttribute('data-reply'); updateReplyIndicator(); }); });
      document.getElementById('grp-send').addEventListener('click', function () {
        var body = document.getElementById('grp-composer').value.trim();
        if (!body) return;
        var payload = { body: body }; if (grpState.replyTo) payload.parent_id = grpState.replyTo;
        ttPost('/api/groups/' + encodeURIComponent(g.group_id) + '/messages', payload).then(function () { grpState.replyTo = null; renderGrpTab(g); }).catch(function (e) { toast(e.message, 'error'); });
      });
    }).catch(function (e) { showErr(b, e); });
  }
  function msgHtml(m, isReply) {
    return '<div class="tt-msg' + (isReply ? ' tt-msg-reply' : '') + '"><div class="tt-msg-meta"><strong>' + esc(m.author_name || 'User') + '</strong><span>' + relTime(m.created_at) + '</span>' +
      (isReply ? '' : ' <button class="tt-link" data-reply="' + attr(m.message_id) + '">Reply</button>') + '</div><div class="tt-msg-body">' + esc(m.body) + '</div></div>';
  }
  function updateReplyIndicator() {
    var c = document.getElementById('grp-replyto'); if (!c) return;
    if (grpState.replyTo) c.innerHTML = '<div class="tt-sub" style="margin-bottom:6px">Replying to a message · <button class="tt-link" id="grp-cancelreply">cancel</button></div>';
    else c.innerHTML = '';
    var cx = document.getElementById('grp-cancelreply'); if (cx) cx.addEventListener('click', function () { grpState.replyTo = null; updateReplyIndicator(); });
  }
  function grpFiles(g, b) {
    ttGet('/api/groups/' + encodeURIComponent(g.group_id) + '/files').then(function (r) {
      var files = rowsOf(r);
      var h = '<div class="tt-form-row"><label>Upload file</label><input class="tt-input" type="file" id="gf-file"></div>' +
        '<div class="tt-form-row"><label>Description</label><input class="tt-input" id="gf-desc" placeholder="Optional description"></div>' +
        '<div style="margin-bottom:14px"><button class="tt-btn" id="gf-up"><i data-lucide="upload"></i>Upload</button></div><div id="gf-list"></div>';
      b.innerHTML = h; icons();
      document.getElementById('gf-up').addEventListener('click', function () {
        var fi = document.getElementById('gf-file');
        if (!fi.files.length) { toast('Choose a file', 'error'); return; }
        var fd = new FormData(); fd.append('file', fi.files[0]); fd.append('description', document.getElementById('gf-desc').value);
        ttForm('/api/groups/' + encodeURIComponent(g.group_id) + '/files', fd).then(function () { toast('Uploaded', 'success'); renderGrpTab(g); }).catch(function (e) { toast(e.message, 'error'); });
      });
      var lc = document.getElementById('gf-list');
      lc.appendChild(table([
        { h: 'Name', render: function (f) { return esc(f.original_name); } },
        { h: 'Size', render: function (f) { return f.size_bytes ? Math.round(f.size_bytes / 1024) + ' KB' : '—'; } },
        { h: 'Uploader', render: function (f) { return esc(f.uploader_name || '—'); } },
        { h: 'Date', render: function (f) { return fmtDate(f.created_at); } },
        { h: 'Description', render: function (f) { return esc(f.description || '—'); } },
        { h: '', render: function (f) { return '<a class="tt-link" target="_blank" href="' + attr(f.download_url + '?' + A().tokenParam()) + '">Download</a>'; } }
      ], files));
    }).catch(function (e) { showErr(b, e); });
  }
  function grpMembers(g, b) {
    ttGet('/api/groups/' + encodeURIComponent(g.group_id) + '/members').then(function (r) {
      var members = rowsOf(r);
      var mgr = isRole('admin', 'regional_manager');
      var h = '';
      if (mgr) {
        if (isRole('admin')) h += '<div class="tt-toolbar"><select class="tt-select" id="gm-user"><option value="">Loading users…</option></select><button class="tt-btn tt-btn-sm" id="gm-add">Add member</button></div>';
        else h += '<div class="tt-sub" style="margin-bottom:10px">Only administrators can browse the full user directory. Add members via the admin console.</div>';
      }
      h += '<div id="gm-table"></div>';
      b.innerHTML = h; icons();
      var cols = [
        { h: 'Name', render: function (m) { return esc(m.full_name || m.username || m.user_id); } },
        { h: 'Role', render: function (m) { return roleBadge(m.role); } },
        { h: 'In Group', render: function (m) { return esc(m.role_in_group || 'member'); } }
      ];
      if (mgr) cols.push({ h: '', render: function (m) { return '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-rm="' + attr(m.user_id) + '">Remove</button>'; } });
      var tc = document.getElementById('gm-table');
      tc.appendChild(members.length ? table(cols, members) : el('div', null, empty('No members')));
      tc.querySelectorAll('[data-rm]').forEach(function (btn) { btn.addEventListener('click', function () {
        ttDelete('/api/groups/' + encodeURIComponent(g.group_id) + '/members/' + encodeURIComponent(btn.getAttribute('data-rm'))).then(function () { toast('Removed', 'success'); renderGrpTab(g); }).catch(function (e) { toast(e.message, 'error'); });
      }); });
      if (isRole('admin')) {
        ttGet('/api/users').then(function (ur) {
          var users = rowsOf(ur); var sel = document.getElementById('gm-user'); if (!sel) return;
          sel.innerHTML = '<option value="">Select user…</option>' + users.map(function (u) { return '<option value="' + attr(u.user_id) + '">' + esc((u.full_name || u.username) + ' (' + u.role + ')') + '</option>'; }).join('');
          document.getElementById('gm-add').addEventListener('click', function () {
            if (!sel.value) return;
            ttPost('/api/groups/' + encodeURIComponent(g.group_id) + '/members', { user_id: sel.value }).then(function () { toast('Added', 'success'); renderGrpTab(g); }).catch(function (e) { toast(e.message, 'error'); });
          });
        }).catch(function () {});
      }
    }).catch(function (e) { showErr(b, e); });
  }
  function grpEscalations(g, b) {
    ttGet('/api/escalations?group_id=' + encodeURIComponent(g.group_id)).then(function (r) {
      var escs = rowsOf(r);
      loadSites().then(function (sites) {
        var canResolve = perm('resolveEscalation');
        var h = '<div class="tt-card" style="background:var(--bg)"><div class="tt-card-t">Raise Escalation</div>' +
          '<div class="tt-form-row"><label>Title</label><input class="tt-input" id="es-title"></div>' +
          '<div class="tt-form-row"><label>Description</label><textarea class="tt-textarea" id="es-desc"></textarea></div>' +
          '<div class="tt-form-grid"><div class="tt-form-row"><label>Site</label><select class="tt-select" id="es-site">' + siteOptions(sites, null, 'None') + '</select></div>' +
          '<div class="tt-form-row"><label>Priority</label><select class="tt-select" id="es-pri"><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div></div>' +
          '<button class="tt-btn" id="es-raise"><i data-lucide="alert-triangle"></i>Raise</button></div>';
        h += '<div id="es-list"></div>';
        b.innerHTML = h; icons();
        document.getElementById('es-raise').addEventListener('click', function () {
          var payload = { title: document.getElementById('es-title').value, description: document.getElementById('es-desc').value, site_id: document.getElementById('es-site').value || undefined, priority: document.getElementById('es-pri').value, group_id: g.group_id };
          if (!payload.title) { toast('Title required', 'error'); return; }
          ttPost('/api/escalations', payload).then(function () { toast('Escalation raised', 'success'); renderGrpTab(g); }).catch(function (e) { toast(e.message, 'error'); });
        });
        var lc = document.getElementById('es-list');
        if (!escs.length) { lc.innerHTML = empty('No escalations'); return; }
        lc.innerHTML = escs.map(function (e2) {
          var body = '<div class="tt-card"><div style="display:flex;justify-content:space-between;align-items:center"><strong>' + esc(e2.title) + '</strong><span>' + badge(e2.priority || '—', statusKind(e2.priority)) + ' ' + badge(e2.status || '—', statusKind(e2.status)) + '</span></div>' +
            '<div class="tt-sub" style="margin:4px 0">' + esc(e2.site_id || 'No site') + ' · raised by ' + esc(e2.raised_by_name || '—') + '</div>' +
            '<div style="font-size:12.5px">' + esc(e2.description || '') + '</div>';
          if (canResolve) {
            body += '<div class="tt-form-grid" style="margin-top:10px"><div class="tt-form-row" style="margin:0"><label>Status</label><select class="tt-select" data-es-status="' + attr(e2.escalation_id) + '"><option value="open">open</option><option value="in_progress">in_progress</option><option value="resolved">resolved</option></select></div>' +
              '<div class="tt-form-row" style="margin:0"><label>Resolution Notes</label><input class="tt-input" data-es-notes="' + attr(e2.escalation_id) + '" value="' + attr(e2.resolution_notes || '') + '"></div></div>' +
              '<button class="tt-btn tt-btn-sm" style="margin-top:8px" data-es-save="' + attr(e2.escalation_id) + '">Update</button>';
          }
          body += '</div>';
          return body;
        }).join('');
        lc.querySelectorAll('[data-es-status]').forEach(function (s) { s.value = (escs.filter(function (x) { return x.escalation_id === s.getAttribute('data-es-status'); })[0] || {}).status || 'open'; });
        lc.querySelectorAll('[data-es-save]').forEach(function (btn) { btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-es-save');
          var st = lc.querySelector('[data-es-status="' + id + '"]').value;
          var notes = lc.querySelector('[data-es-notes="' + id + '"]').value;
          ttPatch('/api/escalations/' + encodeURIComponent(id), { status: st, resolution_notes: notes }).then(function () { toast('Updated', 'success'); renderGrpTab(g); }).catch(function (e) { toast(e.message, 'error'); });
        }); });
      });
    }).catch(function (e) { showErr(b, e); });
  }

  /* ═══════════════════════════ E7 : KNOWLEDGE ═══════════════════════════ */
  TT_VIEWS_knowledge = function (container) {
    stopLive();
    container.innerHTML = '<div class="tt-wrap">' + shell('Knowledge Base', 'book-open', 'RAG document store powering the AI assistant') +
      '<div id="kb-banner"></div>' +
      (perm('uploadDocuments') ? '<div class="tt-card" id="kb-upload"></div>' : '') +
      '<div class="tt-card"><div class="tt-card-t"><i data-lucide="search"></i>Test Retrieval</div><div class="tt-toolbar"><input class="tt-input" id="kb-q" placeholder="Ask a question to preview RAG results…" style="flex:1;min-width:220px"><button class="tt-btn" id="kb-search">Search</button></div><div id="kb-results"></div></div>' +
      '<div class="tt-card"><div class="tt-card-t"><i data-lucide="files"></i>Documents</div><div id="kb-docs"></div></div></div>';
    icons();
    loadKbStatus();
    if (perm('uploadDocuments')) renderKbUpload();
    loadKbDocs();
    document.getElementById('kb-search').addEventListener('click', kbSearch);
    document.getElementById('kb-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') kbSearch(); });
  };
  function loadKbStatus() {
    ttGet('/api/documents/status').then(function (s) {
      s = s || {};
      var avail = s.embeddingsAvailable;
      document.getElementById('kb-banner').innerHTML = '<div class="tt-banner">' +
        '<div><div class="k">Embedding Model</div><div class="v" style="font-size:14px">' + esc(s.embedModel || s.embeddingModel || '—') + '</div></div>' +
        '<div><div class="k">Embeddings</div><div class="v">' + (avail ? '<span style="color:var(--success)">● Online</span>' : '<span style="color:var(--danger)">● Offline (lexical)</span>') + '</div></div>' +
        '<div><div class="k">Documents</div><div class="v">' + (s.documents || 0) + '</div></div>' +
        '<div><div class="k">Indexed</div><div class="v">' + (s.indexed || 0) + '</div></div>' +
        '<div><div class="k">Chunks</div><div class="v">' + (s.chunks || 0) + '</div></div>' +
        '<div><div class="k">Embedded Chunks</div><div class="v">' + (s.embeddedChunks || 0) + '</div></div></div>';
    }).catch(function (e) { var c = document.getElementById('kb-banner'); if (c) c.innerHTML = '<div class="tt-inline-err">' + esc(e.message) + '</div>'; });
  }
  function renderKbUpload() {
    var c = document.getElementById('kb-upload'); if (!c) return;
    loadSites().then(function (sites) {
      c.innerHTML = '<div class="tt-card-t"><i data-lucide="upload-cloud"></i>Add Document</div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Title</label><input class="tt-input" id="kb-title"></div>' +
        '<div class="tt-form-row"><label>Source Type</label><select class="tt-select" id="kb-type"><option value="manual">manual</option><option value="drawing">drawing</option><option value="failure_history">failure_history</option><option value="sop">sop</option><option value="fault_log">fault_log</option><option value="other">other</option></select></div></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Description</label><input class="tt-input" id="kb-desc"></div>' +
        '<div class="tt-form-row"><label>Site (optional)</label><select class="tt-select" id="kb-site">' + siteOptions(sites, null, 'None') + '</select></div></div>' +
        '<div class="tt-form-row"><label>Upload File</label><input class="tt-input" type="file" id="kb-file"></div>' +
        '<div class="tt-form-row"><label>…or Paste Text</label><textarea class="tt-textarea" id="kb-text" placeholder="Paste document content here"></textarea></div>' +
        '<button class="tt-btn" id="kb-ingest"><i data-lucide="database"></i>Ingest</button><span id="kb-ingest-res" style="margin-left:12px;font-size:12px"></span>';
      icons();
      document.getElementById('kb-ingest').addEventListener('click', function () {
        var fd = new FormData();
        fd.append('title', document.getElementById('kb-title').value);
        fd.append('source_type', document.getElementById('kb-type').value);
        fd.append('description', document.getElementById('kb-desc').value);
        var site = document.getElementById('kb-site').value; if (site) fd.append('site_id', site);
        var fi = document.getElementById('kb-file'), txt = document.getElementById('kb-text').value.trim();
        if (fi.files.length) fd.append('file', fi.files[0]);
        else if (txt) fd.append('text', txt);
        else { toast('Provide a file or pasted text', 'error'); return; }
        var btn = document.getElementById('kb-ingest'); btn.disabled = true;
        document.getElementById('kb-ingest-res').textContent = 'Ingesting…';
        ttForm('/api/documents', fd).then(function (d) {
          document.getElementById('kb-ingest-res').innerHTML = badge(d.status || 'done', statusKind(d.status)) + ' ' + (d.chunk_count != null ? d.chunk_count + ' chunks' : '');
          toast('Document ingested', 'success'); btn.disabled = false;
          loadKbStatus(); loadKbDocs();
        }).catch(function (e) { document.getElementById('kb-ingest-res').textContent = ''; toast(e.message, 'error'); btn.disabled = false; });
      });
    });
  }
  function loadKbDocs() {
    var c = document.getElementById('kb-docs'); if (!c) return;
    ttGet('/api/documents').then(function (r) {
      var docs = rowsOf(r);
      var canUp = perm('uploadDocuments');
      var cols = [
        { h: 'Title', render: function (d) { return esc(d.title); } },
        { h: 'Type', render: function (d) { return badge(d.source_type, 'info'); } },
        { h: 'Status', render: function (d) { return badge(d.status, statusKind(d.status)); } },
        { h: 'Chunks', render: function (d) { return esc(d.chunk_count != null ? d.chunk_count : '—'); } },
        { h: 'Uploaded By', render: function (d) { return esc(d.uploaded_by_name || '—'); } },
        { h: 'Date', render: function (d) { return fmtDate(d.created_at); } }
      ];
      if (canUp) cols.push({ h: '', render: function (d) { return '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-reix="' + attr(d.doc_id) + '">Reindex</button> <button class="tt-btn tt-btn-danger tt-btn-sm" data-del="' + attr(d.doc_id) + '">Delete</button>'; } });
      c.innerHTML = '';
      c.appendChild(docs.length ? table(cols, docs) : el('div', null, empty('No documents')));
      c.querySelectorAll('[data-reix]').forEach(function (btn) { btn.addEventListener('click', function () {
        btn.disabled = true;
        ttPost('/api/documents/' + encodeURIComponent(btn.getAttribute('data-reix')) + '/reindex').then(function () { toast('Reindexed', 'success'); loadKbStatus(); loadKbDocs(); }).catch(function (e) { toast(e.message, 'error'); btn.disabled = false; });
      }); });
      c.querySelectorAll('[data-del]').forEach(function (btn) { btn.addEventListener('click', function () {
        if (!confirm('Delete this document?')) return;
        ttDelete('/api/documents/' + encodeURIComponent(btn.getAttribute('data-del'))).then(function () { toast('Deleted', 'success'); loadKbStatus(); loadKbDocs(); }).catch(function (e) { toast(e.message, 'error'); });
      }); });
    }).catch(function (e) { showErr(c, e); });
  }
  function kbSearch() {
    var q = document.getElementById('kb-q').value.trim(); if (!q) return;
    var c = document.getElementById('kb-results'); c.innerHTML = '<div class="tt-empty">Searching…</div>';
    ttGet('/api/documents/search?q=' + encodeURIComponent(q) + '&k=5').then(function (r) {
      var res = (r && r.results) || rowsOf(r);
      if (!res.length) { c.innerHTML = empty('No matches'); return; }
      c.innerHTML = res.map(function (x) {
        return '<div class="tt-card" style="background:var(--bg);margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center"><strong>' + esc(x.title || x.doc_title || 'Chunk') + '</strong>' +
          '<span>' + badge(x.source_type || '—', 'muted') + ' ' + badge(x.method || (x.score != null && x.method === undefined ? 'vector' : 'lexical'), statusKind(x.method)) + (x.score != null ? ' <span class="tt-sub">score ' + (Math.round(x.score * 1000) / 1000) + '</span>' : '') + '</span></div>' +
          '<div style="font-size:12.5px;color:var(--muted);margin-top:6px;white-space:pre-wrap">' + esc((x.snippet || x.text || x.content || '').slice(0, 320)) + '</div></div>';
      }).join('');
    }).catch(function (e) { showErr(c, e); });
  }

  /* ═══════════════════════════ E2 : ADMIN ═══════════════════════════ */
  var admTab = 'users';
  TT_VIEWS_admin = function (container) {
    stopLive();
    container.innerHTML = '<div class="tt-wrap">' + shell('Administration', 'shield', 'User management & site configuration') + '<div id="adm-tabs"></div><div id="adm-body"></div></div>';
    icons();
    var tabs = innerTabs([{ id: 'users', label: 'Users' }, { id: 'sites', label: 'Sites' }], admTab, function (id) { admTab = id; renderAdm(id); });
    document.getElementById('adm-tabs').appendChild(tabs.bar);
    renderAdm(admTab);
  };
  function renderAdm(id) {
    var b = document.getElementById('adm-body'); b.innerHTML = '<div class="tt-empty">Loading…</div>';
    if (id === 'users') admUsers(b); else admSites(b);
  }
  function admUsers(b) {
    ttGet('/api/users').then(function (r) {
      var users = rowsOf(r);
      b.innerHTML = '<div class="tt-toolbar"><button class="tt-btn" id="au-new" style="margin-left:auto"><i data-lucide="user-plus"></i>New user</button></div><div id="au-table"></div>';
      icons();
      document.getElementById('au-new').addEventListener('click', function () { userModal(null, function () { renderAdm('users'); }); });
      var cols = [
        { h: 'Username', render: function (u) { return esc(u.username); } },
        { h: 'Full Name', render: function (u) { return esc(u.full_name || '—'); } },
        { h: 'Role', render: function (u) { return roleBadge(u.role); } },
        { h: 'Region', render: function (u) { return esc(u.region || '—'); } },
        { h: 'Status', render: function (u) { return badge(u.status, statusKind(u.status)); } },
        { h: 'Sites', render: function (u) { return esc((u.site_ids && u.site_ids.length) || u.site_count || 0); } },
        { h: 'Last Login', render: function (u) { return fmtDate(u.last_login_at || u.last_login, true); } },
        { h: '', render: function (u) { return '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-edit="' + attr(u.user_id) + '">Edit</button> ' + (u.status === 'active' ? '<button class="tt-btn tt-btn-danger tt-btn-sm" data-deact="' + attr(u.user_id) + '">Deactivate</button>' : ''); } }
      ];
      var tc = document.getElementById('au-table');
      tc.appendChild(users.length ? table(cols, users) : el('div', null, empty('No users')));
      tc.querySelectorAll('[data-edit]').forEach(function (btn) { btn.addEventListener('click', function () {
        var u = users.filter(function (x) { return x.user_id === btn.getAttribute('data-edit'); })[0];
        userModal(u, function () { renderAdm('users'); });
      }); });
      tc.querySelectorAll('[data-deact]').forEach(function (btn) { btn.addEventListener('click', function () {
        if (!confirm('Deactivate this user?')) return;
        ttPost('/api/users/' + encodeURIComponent(btn.getAttribute('data-deact')) + '/deactivate').then(function () { toast('Deactivated', 'success'); renderAdm('users'); }).catch(function (e) { toast(e.message, 'error'); });
      }); });
    }).catch(function (e) { showErr(b, e); });
  }
  function userModal(u, done) {
    u = u || {};
    loadSites().then(function (sites) {
      var byRegion = {};
      sites.forEach(function (s) { (byRegion[s.region || 'Other'] = byRegion[s.region || 'Other'] || []).push(s); });
      var allocated = u.site_ids || [];
      var checks = Object.keys(byRegion).sort().map(function (reg) {
        return '<div style="margin-top:6px;font-size:11px;color:var(--accent);font-weight:600">' + esc(reg) + '</div>' +
          byRegion[reg].map(function (s) {
            return '<label class="tt-chk"><input type="checkbox" name="site_ids" value="' + attr(s.site_id) + '"' + (allocated.indexOf(s.site_id) >= 0 ? ' checked' : '') + '> ' + esc(s.name || s.site_id) + '</label>';
          }).join('');
      }).join('');
      var body =
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Username</label><input class="tt-input" name="username" value="' + attr(u.username || '') + '"' + (u.user_id ? ' readonly' : '') + '></div>' +
        '<div class="tt-form-row"><label>Password ' + (u.user_id ? '(blank = unchanged)' : '') + '</label><input class="tt-input" type="password" name="password"></div></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Full Name</label><input class="tt-input" name="full_name" value="' + attr(u.full_name || '') + '"></div>' +
        '<div class="tt-form-row"><label>Email</label><input class="tt-input" name="email" value="' + attr(u.email || '') + '"></div></div>' +
        '<div class="tt-form-grid"><div class="tt-form-row"><label>Role</label><select class="tt-select" name="role"><option value="field_technician">field_technician</option><option value="regional_manager">regional_manager</option><option value="admin">admin</option></select></div>' +
        '<div class="tt-form-row"><label>Region</label><input class="tt-input" name="region" value="' + attr(u.region || '') + '"></div></div>' +
        '<div class="tt-form-row"><label>Phone</label><input class="tt-input" name="phone" value="' + attr(u.phone || '') + '"></div>' +
        '<div class="tt-form-row"><label>Site Allocation</label><div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px">' + (checks || '<span class="tt-sub">No sites</span>') + '</div></div>';
      var m = modal(u.user_id ? 'Edit User' : 'New User', body, function (form) {
        var siteIds = Array.prototype.slice.call(form.querySelectorAll('[name="site_ids"]:checked')).map(function (c) { return c.value; });
        var payload = {
          username: fieldVal(form, 'username'), full_name: fieldVal(form, 'full_name'), email: fieldVal(form, 'email'),
          role: fieldVal(form, 'role'), region: fieldVal(form, 'region'), phone: fieldVal(form, 'phone'), site_ids: siteIds
        };
        var pw = fieldVal(form, 'password'); if (pw) payload.password = pw;
        if (!payload.username) throw new Error('Username is required');
        if (!u.user_id && !pw) throw new Error('Password is required for new users');
        var p = u.user_id ? ttPatch('/api/users/' + encodeURIComponent(u.user_id), payload) : ttPost('/api/users', payload);
        return p.then(function () { toast('Saved', 'success'); done(); });
      });
      if (u.role) m.form.querySelector('[name="role"]').value = u.role;
    });
  }
  function admSites(b) {
    ttGet('/api/sites?limit=500').then(function (r) {
      var sites = rowsOf(r);
      b.innerHTML = '<div class="tt-toolbar"><button class="tt-btn" id="as-new" style="margin-left:auto"><i data-lucide="plus"></i>New site</button></div><div id="as-table"></div>';
      icons();
      document.getElementById('as-new').addEventListener('click', function () { siteModal(null, function () { renderAdm('sites'); }); });
      var cols = [
        { h: 'Site ID', render: function (s) { return esc(s.site_id); } },
        { h: 'Name', render: function (s) { return esc(s.name); } },
        { h: 'Region', render: function (s) { return esc(s.region || '—'); } },
        { h: 'Status', render: function (s) { return badge(s.status, statusKind(s.status)); } },
        { h: 'Health', render: function (s) { return '<span style="font-weight:700;color:' + healthColor(s.health_score) + '">' + esc(s.health_score) + '</span>'; } },
        { h: '', render: function (s) { return '<button class="tt-btn tt-btn-ghost tt-btn-sm" data-edit="' + attr(s.site_id) + '">Edit</button> <button class="tt-btn tt-btn-danger tt-btn-sm" data-del="' + attr(s.site_id) + '">Delete</button>'; } }
      ];
      var tc = document.getElementById('as-table');
      tc.appendChild(sites.length ? table(cols, sites) : el('div', null, empty('No sites')));
      tc.querySelectorAll('[data-edit]').forEach(function (btn) { btn.addEventListener('click', function () {
        var s = sites.filter(function (x) { return x.site_id === btn.getAttribute('data-edit'); })[0];
        siteModal(s, function () { renderAdm('sites'); });
      }); });
      tc.querySelectorAll('[data-del]').forEach(function (btn) { btn.addEventListener('click', function () {
        if (!confirm('Delete this site?')) return;
        ttDelete('/api/sites/' + encodeURIComponent(btn.getAttribute('data-del'))).then(function () { _sites = null; toast('Deleted', 'success'); renderAdm('sites'); }).catch(function (e) { toast(e.message, 'error'); });
      }); });
    }).catch(function (e) { showErr(b, e); });
  }
  function siteModal(s, done) {
    s = s || {};
    var body =
      '<div class="tt-form-grid"><div class="tt-form-row"><label>Name</label><input class="tt-input" name="name" value="' + attr(s.name || '') + '"></div>' +
      '<div class="tt-form-row"><label>Region</label><input class="tt-input" name="region" value="' + attr(s.region || '') + '"></div></div>' +
      '<div class="tt-form-grid"><div class="tt-form-row"><label>Area</label><input class="tt-input" name="area" value="' + attr(s.area || '') + '"></div>' +
      '<div class="tt-form-row"><label>Site Type</label><input class="tt-input" name="site_type" value="' + attr(s.site_type || '') + '"></div></div>' +
      '<div class="tt-form-grid"><div class="tt-form-row"><label>Latitude</label><input class="tt-input" type="number" step="any" name="latitude" value="' + attr(s.latitude != null ? s.latitude : '') + '"></div>' +
      '<div class="tt-form-row"><label>Longitude</label><input class="tt-input" type="number" step="any" name="longitude" value="' + attr(s.longitude != null ? s.longitude : '') + '"></div></div>' +
      '<div class="tt-form-grid"><div class="tt-form-row"><label>Transformer Rating</label><input class="tt-input" name="transformer_rating" value="' + attr(s.transformer_rating || '') + '"></div>' +
      '<div class="tt-form-row"><label>Status</label><select class="tt-select" name="status"><option value="operational">operational</option><option value="maintenance">maintenance</option><option value="offline">offline</option><option value="at_risk">at_risk</option></select></div></div>' +
      '<div class="tt-form-grid"><div class="tt-form-row"><label>Health Score</label><input class="tt-input" type="number" name="health_score" value="' + attr(s.health_score != null ? s.health_score : '') + '"></div>' +
      '<div class="tt-form-row"><label>Subscribers at Risk</label><input class="tt-input" type="number" name="subscribers_at_risk" value="' + attr(s.subscribers_at_risk != null ? s.subscribers_at_risk : '') + '"></div></div>' +
      '<div class="tt-form-row"><label>Notes</label><textarea class="tt-textarea" name="notes">' + esc(s.notes || '') + '</textarea></div>';
    var m = modal(s.site_id ? 'Edit Site' : 'New Site', body, function (form) {
      var payload = {
        name: fieldVal(form, 'name'), region: fieldVal(form, 'region'), area: fieldVal(form, 'area'), site_type: fieldVal(form, 'site_type'),
        latitude: parseFloat(fieldVal(form, 'latitude')) || null, longitude: parseFloat(fieldVal(form, 'longitude')) || null,
        transformer_rating: fieldVal(form, 'transformer_rating'), status: fieldVal(form, 'status'),
        health_score: fieldVal(form, 'health_score') !== '' ? parseFloat(fieldVal(form, 'health_score')) : null,
        subscribers_at_risk: fieldVal(form, 'subscribers_at_risk') !== '' ? parseInt(fieldVal(form, 'subscribers_at_risk')) : null,
        notes: fieldVal(form, 'notes')
      };
      if (!payload.name) throw new Error('Name is required');
      var p = s.site_id ? ttPatch('/api/sites/' + encodeURIComponent(s.site_id), payload) : ttPost('/api/sites', payload);
      return p.then(function () { _sites = null; toast('Saved', 'success'); done(); });
    });
    if (s.status) m.form.querySelector('[name="status"]').value = s.status;
  }

  /* ═══════════════════════════ register ═══════════════════════════ */
  injectStyles();
  window.TT_VIEWS = {
    health: TT_VIEWS_health,
    maintenance: TT_VIEWS_maintenance,
    groups: TT_VIEWS_groups,
    knowledge: TT_VIEWS_knowledge,
    admin: TT_VIEWS_admin
  };

  // External focus hooks — let other parts of the app (e.g. the Data Explorer
  // site detail panel) deep-link into a specific site's Fleet Health / history.
  window.TT_FOCUS = {
    healthSite: function (siteId) {
      healthState.mode = 'eng'; healthState.siteId = siteId; healthState.trend = [];
      if (window.showView) window.showView('health');
      var c = document.getElementById('view-health');
      if (c) renderHealthShell(c);
    },
    maintenanceHistory: function (siteId) {
      mtnTab = 'history'; mtnHistSite = siteId;
      if (window.showView) window.showView('maintenance');
      var c = document.getElementById('view-maintenance');
      if (c) TT_VIEWS_maintenance(c);
    }
  };
})();
