'use strict';

const path = require('path');
process.env.TT_DATABASE_FILE = path.join(require('os').tmpdir(), `tt-maint-${process.pid}.db`);
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { init, getDb } = require('../src/database');
const MaintenanceSchedule = require('../src/models/MaintenanceSchedule');
const Failure = require('../src/models/Failure');

test.before(() => { init(); });
test.after(() => { try { fs.unlinkSync(process.env.TT_DATABASE_FILE); } catch (_) {} });

test('seeded history is linked back to a maintenance schedule (E4)', () => {
  const db = getDb();
  // every maintenance_record for a seeded site should carry a schedule_id
  const orphan = db.prepare('SELECT COUNT(*) c FROM maintenance_records WHERE schedule_id IS NULL').get().c;
  assert.strictEqual(orphan, 0, 'all maintenance records linked to a schedule');
  const sched = db.prepare('SELECT * FROM maintenance_schedules LIMIT 1').get();
  assert.ok(sched && sched.schedule_id.startsWith('SCH-'));
});

test('confirmed faults are linked to failure records', () => {
  const db = getDb();
  const linkedFault = db.prepare('SELECT * FROM fault_events WHERE failure_id IS NOT NULL').get();
  assert.ok(linkedFault, 'at least one fault promoted to a failure');
  const fail = db.prepare('SELECT * FROM failures WHERE failure_id = ?').get(linkedFault.failure_id);
  assert.ok(fail && fail.root_cause, 'failure has a root cause');
});

test('creating a schedule validates the site and computes next due on completion', () => {
  const site = getDb().prepare('SELECT site_id FROM transformer_sites LIMIT 1').get().site_id;
  const sched = MaintenanceSchedule.create({ site_id: site, title: 'Test PM', interval_days: 30 });
  assert.ok(sched.schedule_id, 'schedule created');
  assert.strictEqual(sched.site_id, site);
  const done = MaintenanceSchedule.complete(sched.schedule_id);
  assert.ok(done.last_completed_date, 'completion date set');
  assert.ok(done.next_due_date > done.last_completed_date, 'next due advanced');
});

test('creating a schedule for an unknown site is rejected', () => {
  assert.throws(() => MaintenanceSchedule.create({ site_id: 'NOPE-999', title: 'x' }));
});

test('failure records aggregate stats', () => {
  const site = getDb().prepare('SELECT site_id FROM transformer_sites LIMIT 1').get().site_id;
  Failure.create({ site_id: site, failure_type: 'winding failure', severity: 'high', cost_usd: 1000, downtime_hours: 5 });
  const stats = Failure.getStats({});
  assert.ok(stats.total >= 1);
  assert.ok(stats.totalCostUsd >= 1000);
});
