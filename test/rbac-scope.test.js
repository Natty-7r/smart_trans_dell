'use strict';

const path = require('path');
process.env.TT_DATABASE_FILE = path.join(require('os').tmpdir(), `tt-rbac-${process.pid}.db`);
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { init, getDb } = require('../src/database');
const { getAllowedSiteIds } = require('../src/middleware/auth');
const TransformerSite = require('../src/models/TransformerSite');
const AlertLog = require('../src/models/AlertLog');

test.before(() => { init(); });
test.after(() => { try { fs.unlinkSync(process.env.TT_DATABASE_FILE); } catch (_) {} });

test('admin allocation is unrestricted (null)', () => {
  const admin = getDb().prepare("SELECT * FROM users WHERE role='admin'").get();
  assert.strictEqual(getAllowedSiteIds(admin), null);
});

test('regional_manager is scoped to their region', () => {
  const rm = getDb().prepare("SELECT * FROM users WHERE role='regional_manager'").get();
  const allowed = getAllowedSiteIds(rm);
  assert.ok(Array.isArray(allowed) && allowed.length > 0, 'has scoped sites');
  const regionCount = getDb().prepare('SELECT COUNT(*) c FROM transformer_sites WHERE region = ?').get(rm.region).c;
  assert.strictEqual(allowed.length, regionCount, 'sees exactly their region');
});

test('field_technician is scoped to explicit allocations only', () => {
  const tech = getDb().prepare("SELECT * FROM users WHERE role='field_technician'").get();
  const allowed = getAllowedSiteIds(tech);
  const alloc = getDb().prepare('SELECT COUNT(*) c FROM user_sites WHERE user_id = ?').get(tech.user_id).c;
  assert.strictEqual(allowed.length, alloc, 'sees exactly allocated sites');
});

test('model site-scoping filters rows by siteIds (SQL level)', () => {
  const two = getDb().prepare('SELECT site_id FROM transformer_sites LIMIT 2').all().map(r => r.site_id);
  const res = TransformerSite.findAll({ siteIds: two, limit: 500 });
  assert.strictEqual(res.total, 2, 'only the two scoped sites returned');
  res.data.forEach(s => assert.ok(two.includes(s.site_id)));
});

test('empty allocation yields zero rows (no data leak)', () => {
  const res = TransformerSite.findAll({ siteIds: [], limit: 500 });
  assert.strictEqual(res.total, 0);
  const alerts = AlertLog.findAll({ siteIds: [], limit: 500 });
  assert.strictEqual(alerts.total, 0);
});

test('alerts are scoped to allocated sites', () => {
  const one = getDb().prepare('SELECT site_id FROM alert_logs LIMIT 1').get().site_id;
  const res = AlertLog.findAll({ siteIds: [one], limit: 500 });
  assert.ok(res.total >= 1);
  res.data.forEach(a => assert.strictEqual(a.site_id, one));
});
