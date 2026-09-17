'use strict';

/**
 * seed-extend.js — seed the enhancement entities (idempotent).
 *
 * Runs once (guards on the users table being empty). Creates the RBAC user set,
 * site allocations, regional collaboration groups, preventive-maintenance
 * schedules (and back-links existing history to them), confirmed failures, and
 * an initial health-parameter snapshot for every site.
 *
 * Default credentials are for demo only and MUST be rotated in production —
 * see README "Authentication".
 */

const crypto = require('crypto');
const { getDb } = require('./database');
const { hashPassword } = require('./auth');
const telemetry = require('./services/telemetry');

const ADMIN_PW = process.env.ADMIN_PASSWORD || 'Admin@123';
const USER_PW = process.env.DEFAULT_USER_PASSWORD || 'Password@123';

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function id(prefix) { return `${prefix}-${crypto.randomBytes(4).toString('hex')}`; }
function daysFromNow(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

function seedPlatform(db) {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return; // already seeded

  console.log('Seeding platform (users, groups, schedules, health params)...');

  const insertUser = db.prepare(`
    INSERT INTO users (user_id, username, email, full_name, password_hash, role, region, engineer_id, phone, status, created_by)
    VALUES (@user_id, @username, @email, @full_name, @password_hash, @role, @region, @engineer_id, @phone, 'active', 'system')
  `);
  const allocate = db.prepare('INSERT OR IGNORE INTO user_sites (user_id, site_id, allocated_by) VALUES (?, ?, ?)');

  const regions = db.prepare('SELECT DISTINCT region FROM transformer_sites WHERE region IS NOT NULL ORDER BY region').all().map(r => r.region);
  const sitesByRegion = {};
  for (const r of regions) {
    sitesByRegion[r] = db.prepare('SELECT site_id FROM transformer_sites WHERE region = ? ORDER BY health_score ASC').all(r).map(s => s.site_id);
  }

  const tx = db.transaction(() => {
    // ── Administrator ──
    const adminId = 'USR-admin';
    insertUser.run({
      user_id: adminId, username: 'admin', email: 'admin@safaricom.et', full_name: 'Platform Administrator',
      password_hash: hashPassword(ADMIN_PW), role: 'admin', region: null, engineer_id: null, phone: null
    });

    // ── Regional managers (one per region) ──
    const managerByRegion = {};
    for (const region of regions) {
      const uid = `USR-rm-${slug(region)}`;
      insertUser.run({
        user_id: uid, username: `rm.${slug(region)}`, email: `rm.${slug(region)}@safaricom.et`,
        full_name: `${region} Regional Manager`, password_hash: hashPassword(USER_PW),
        role: 'regional_manager', region, engineer_id: null, phone: null
      });
      managerByRegion[region] = uid;
      // region scoping is automatic, but record explicit allocations too
      for (const sid of sitesByRegion[region]) allocate.run(uid, sid, 'system');
    }

    // ── Field technicians (derived from field_engineers) ──
    const engineers = db.prepare('SELECT engineer_id, full_name, email, region, phone FROM field_engineers LIMIT 12').all();
    let techIdx = 0;
    for (const eng of engineers) {
      const region = eng.region && sitesByRegion[eng.region] ? eng.region : regions[techIdx % regions.length];
      const uid = `USR-tech-${slug(eng.engineer_id)}`;
      insertUser.run({
        user_id: uid, username: `tech.${slug(eng.engineer_id)}`, email: eng.email || `${slug(eng.engineer_id)}@safaricom.et`,
        full_name: eng.full_name || `Technician ${eng.engineer_id}`, password_hash: hashPassword(USER_PW),
        role: 'field_technician', region, engineer_id: eng.engineer_id, phone: eng.phone || null
      });
      // allocate a slice of that region's sites to the technician
      const pool = sitesByRegion[region] || [];
      const slice = pool.slice((techIdx * 3) % Math.max(1, pool.length), ((techIdx * 3) % Math.max(1, pool.length)) + 6);
      for (const sid of slice) allocate.run(uid, sid, adminId);
      techIdx++;
    }

    // ── E3: one collaboration group per region ──
    const insGroup = db.prepare('INSERT INTO collab_groups (group_id, name, description, scope_type, scope_value, created_by) VALUES (?,?,?,?,?,?)');
    const insMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role_in_group) VALUES (?,?,?)');
    const insMsg = db.prepare('INSERT INTO group_messages (message_id, group_id, parent_id, user_id, author_name, body) VALUES (?,?,?,?,?,?)');
    for (const region of regions) {
      const gid = `GRP-${slug(region)}`;
      insGroup.run(gid, `${region} Operations`, `Regional collaboration for ${region} transformer operations`, 'region', region, adminId);
      insMember.run(gid, adminId, 'owner');
      insMember.run(gid, managerByRegion[region], 'owner');
      // technicians in region
      const techs = db.prepare('SELECT user_id, full_name FROM users WHERE role = ? AND region = ?').all('field_technician', region);
      for (const t of techs) insMember.run(gid, t.user_id, 'member');
      insMsg.run(id('MSG'), gid, null, managerByRegion[region], `${region} Regional Manager`,
        `Welcome to the ${region} operations channel. Post inspection findings, share reports, and escalate critical alerts here.`);
    }

    // ── E4: preventive maintenance schedules (one per site) + back-link history ──
    const insSched = db.prepare(`
      INSERT INTO maintenance_schedules
        (schedule_id, site_id, site_name, region, title, task_type, frequency, interval_days,
         last_completed_date, next_due_date, assigned_engineer_id, assigned_engineer_name, priority, status, description, created_by,
         estimated_cost_usd)
      VALUES (@schedule_id,@site_id,@site_name,@region,@title,'preventive',@frequency,@interval_days,
         @last_completed_date,@next_due_date,@assigned_engineer_id,@assigned_engineer_name,@priority,'active',@description,'system',
         @estimated_cost_usd)
    `);
    const sites = db.prepare('SELECT site_id, name, region, health_score, last_inspection_date FROM transformer_sites ORDER BY health_score ASC').all();
    const engPool = db.prepare('SELECT engineer_id, full_name, region FROM field_engineers').all();
    let i = 0;
    for (const s of sites) {
      const sid = `SCH-${s.site_id}`;
      const eng = engPool.find(e => e.region === s.region) || engPool[i % Math.max(1, engPool.length)] || {};
      const dueIn = (i % 12) * 7 + 5; // spread due dates across ~12 weeks
      const priority = s.health_score < 50 ? 'high' : s.health_score < 70 ? 'medium' : 'low';
      const estimated = s.health_score < 50 ? 2200 : s.health_score < 70 ? 950 : 420;
      insSched.run({
        schedule_id: sid, site_id: s.site_id, site_name: s.name, region: s.region,
        title: `Quarterly preventive maintenance — ${s.name}`, frequency: 'quarterly', interval_days: 90,
        last_completed_date: daysFromNow(dueIn - 90), next_due_date: daysFromNow(dueIn),
        assigned_engineer_id: eng.engineer_id || null, assigned_engineer_name: eng.full_name || null,
        priority, estimated_cost_usd: estimated,
        description: 'IEC 60076 preventive inspection: oil, thermal, insulation and mechanical checks.'
      });
      // back-link existing history rows for this site to the schedule
      db.prepare('UPDATE maintenance_records SET schedule_id = ? WHERE site_id = ? AND schedule_id IS NULL').run(sid, s.site_id);
      db.prepare('UPDATE inspection_logs SET schedule_id = ? WHERE site_id = ? AND schedule_id IS NULL').run(sid, s.site_id);
      db.prepare('UPDATE fault_events SET schedule_id = ? WHERE site_id = ? AND schedule_id IS NULL').run(sid, s.site_id);
      db.prepare('UPDATE alert_logs SET schedule_id = ? WHERE site_id = ? AND schedule_id IS NULL').run(sid, s.site_id);
      i++;
    }

    // ── Inspection records (field technician checklists) tied to sites+schedules ──
    const insInspection = db.prepare(`
      INSERT INTO inspection_logs
        (inspection_id, site_id, site_name, region, health_score, risk_tier, priority, status,
         scheduled_by, scheduled_at, due_date, notes, schedule_id)
      VALUES (@inspection_id, @site_id, @site_name, @region, @health_score, @risk_tier, @priority, @status,
         @scheduled_by, @scheduled_at, @due_date, @notes, @schedule_id)
    `);
    const priorities = ['Routine', 'Elevated', 'Priority', 'Urgent'];
    const statuses = ['completed', 'completed', 'in-progress', 'scheduled'];
    let ins = 0;
    for (const s of sites) {
      // 1–2 inspections per site, weighted so low-health sites get more/urgent ones
      const count = s.health_score < 60 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const risk = s.health_score >= 80 ? 'low' : s.health_score >= 60 ? 'moderate' : s.health_score >= 40 ? 'high' : 'critical';
        const priority = s.health_score >= 80 ? 'Routine' : s.health_score >= 60 ? 'Elevated' : s.health_score >= 40 ? 'Priority' : 'Urgent';
        const status = statuses[(ins + k) % statuses.length];
        const offset = (ins % 30) - 10; // some past, some upcoming
        insInspection.run({
          inspection_id: `INS-${slug(s.site_id)}-${k + 1}`,
          site_id: s.site_id, site_name: s.name, region: s.region,
          health_score: s.health_score, risk_tier: risk, priority, status,
          scheduled_by: k === 0 ? 'PRISM AI (auto-flagged)' : 'Regional Manager',
          scheduled_at: new Date(Date.now() - (offset + 15) * 86400000).toISOString(),
          due_date: daysFromNow(offset + 7),
          notes: `${priority} inspection — visual, thermographic and oil-sample checks per IEC 60076. Risk tier: ${risk}.`,
          schedule_id: `SCH-${s.site_id}`
        });
        ins++;
      }
    }
    console.log(`  inspection_logs: ${ins} records`);

    // ── E4: confirmed failures derived from confirmed faults ──
    const insFail = db.prepare(`
      INSERT INTO failures
        (failure_id, site_id, site_name, region, schedule_id, fault_id, failure_type, component, severity,
         occurred_at, detected_at, root_cause, resolution, resolution_status, downtime_hours, cost_usd, parts_replaced, confirmed_by)
      VALUES (@failure_id,@site_id,@site_name,@region,@schedule_id,@fault_id,@failure_type,@component,@severity,
         @occurred_at,@detected_at,@root_cause,@resolution,@resolution_status,@downtime_hours,@cost_usd,@parts_replaced,'system')
    `);
    const confirmedFaults = db.prepare(`
      SELECT * FROM fault_events WHERE root_cause_confirmed = 1 OR severity = 'Critical' LIMIT 40
    `).all();
    const rootCauses = {
      'winding failure': 'Inter-turn insulation breakdown from sustained thermal overload',
      'oil leak': 'Gasket degradation at the main tank seal',
      'overheating': 'Cooling fin blockage combined with sustained overload',
      'bushing failure': 'Moisture ingress and partial discharge at the HV bushing',
      'tap changer fault': 'Contact erosion in the on-load tap changer'
    };
    for (const f of confirmedFaults) {
      const fid = `FAIL-${slug(f.fault_id)}`;
      const comp = (f.fault_type || 'component').split(' ')[0];
      const resolved = !!f.resolved_at;
      insFail.run({
        failure_id: fid, site_id: f.site_id, site_name: f.site_name, region: f.region,
        schedule_id: `SCH-${f.site_id}`, fault_id: f.fault_id,
        failure_type: f.fault_type, component: comp, severity: f.severity || 'high',
        occurred_at: f.timestamp, detected_at: f.timestamp,
        root_cause: rootCauses[(f.fault_type || '').toLowerCase()] || `Confirmed ${f.fault_type || 'equipment'} failure following threshold breach`,
        resolution: resolved ? (f.parts_replaced ? `Replaced ${f.parts_replaced}; returned to service` : 'Component repaired and returned to service') : 'Awaiting parts / field dispatch',
        resolution_status: resolved ? 'resolved' : 'in_progress',
        downtime_hours: f.downtime_hours || 0, cost_usd: f.financial_impact_usd || 0,
        parts_replaced: f.parts_replaced || null
      });
      db.prepare('UPDATE fault_events SET failure_id = ? WHERE fault_id = ?').run(fid, f.fault_id);
    }
  });

  tx();

  // ── E6: initial health-parameter snapshot for all sites ──
  const n = telemetry.refreshAll();
  console.log(`Platform seed complete. Health parameters ingested: ${n}.`);
}

module.exports = { seedPlatform };
