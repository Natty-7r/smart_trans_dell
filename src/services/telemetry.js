'use strict';

/**
 * telemetry.js — telemetry ingestion & Health Index service (E5 + E6).
 *
 * This is the SERVICE BOUNDARY the stakeholders asked for: the rest of the app
 * only talks to this module, never to a raw sensor feed. Today a MockProvider
 * synthesises realistic readings; a production deployment swaps in a provider
 * that reads NB-IoT/MQTT/edge feeds by implementing the same `getSnapshot()`
 * contract and calling `ingest()` — no downstream code changes required.
 *
 *   getSnapshot(site)      → live parameter readings across the 5 categories
 *   ingest(siteId, params) → persist a snapshot into health_parameters
 *   refreshAll()           → tick all sites (mock "live" data)
 *   computeHealthIndex()   → weighted 0..100 index + per-category breakdown
 */

const { getDb } = require('../database');
const { PARAMETERS, CATEGORIES, classify, paramScore } = require('../config/health-params');

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function roundFor(p, v) {
  if (p.unit === '' || p.key === 'power_factor' || p.key === 'polarization_index') return Math.round(v * 100) / 100;
  if (Math.abs(v) >= 100) return Math.round(v);
  return Math.round(v * 10) / 10;
}

/** Generate one parameter value given a 0..1 "stress" level (derived from site health). */
function genValue(p, stress) {
  const jitter = Math.random() - 0.5;
  let val;
  if (p.direction === 'high_bad') {
    val = p.nominal + stress * (p.crit - p.nominal) * 1.15 + (p.warn - p.nominal) * 0.18 * jitter;
  } else if (p.direction === 'low_bad') {
    val = p.nominal - stress * (p.nominal - p.crit) * 1.15 + (p.nominal - p.warn) * 0.18 * jitter;
  } else { // band
    const dir = Math.random() < 0.5 ? -1 : 1;
    val = p.nominal + dir * stress * p.crit * 1.1 + p.warn * 0.25 * jitter;
  }
  return roundFor(p, clamp(val, p.min, p.max));
}

/**
 * MockProvider — deterministic-ish synthetic telemetry driven by a site's
 * health_score so that low-health sites genuinely show warning/critical params.
 */
const MockProvider = {
  name: 'mock',
  getSnapshot(site) {
    const health = typeof site.health_score === 'number' ? site.health_score : 80;
    const stress = clamp((100 - health) / 100, 0, 1);
    const now = new Date().toISOString();
    return PARAMETERS.map(p => {
      const value = genValue(p, stress);
      return {
        site_id: site.site_id,
        category: p.category,
        param_key: p.key,
        label: p.label,
        value,
        unit: p.unit,
        status: classify(p, value),
        threshold_warn: p.warn,
        threshold_crit: p.crit,
        recorded_at: now,
        source: 'mock'
      };
    });
  }
};

// The active provider. Swap here (or via DI) to plug real feeds in later.
let provider = MockProvider;
function setProvider(p) { provider = p; }

/** Persist a snapshot of parameters for a site (upsert on site_id+param_key). */
function ingest(siteId, params) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO health_parameters
      (site_id, category, param_key, label, value, unit, status, threshold_warn, threshold_crit, recorded_at, source)
    VALUES
      (@site_id, @category, @param_key, @label, @value, @unit, @status, @threshold_warn, @threshold_crit, @recorded_at, @source)
    ON CONFLICT(site_id, param_key) DO UPDATE SET
      value=excluded.value, status=excluded.status, recorded_at=excluded.recorded_at,
      threshold_warn=excluded.threshold_warn, threshold_crit=excluded.threshold_crit, source=excluded.source
  `);
  const tx = db.transaction(rows => rows.forEach(r => upsert.run(r)));
  tx(params);
  return params.length;
}

function getSnapshot(site) { return provider.getSnapshot(site); }

/** Refresh (tick) live telemetry for all sites and persist. Returns count. */
function refreshAll() {
  const db = getDb();
  const sites = db.prepare('SELECT site_id, health_score FROM transformer_sites').all();
  let n = 0;
  for (const s of sites) n += ingest(s.site_id, provider.getSnapshot(s));
  return n;
}

/** Latest persisted parameters for a site (from the store). */
function getParameters(siteId) {
  return getDb().prepare(
    'SELECT category, param_key, label, value, unit, status, threshold_warn, threshold_crit, recorded_at FROM health_parameters WHERE site_id = ? ORDER BY category, param_key'
  ).all(siteId);
}

/**
 * Compute the Transformer Health Index from stored parameters.
 * Weighted mean of per-parameter scores (100 = healthy). Falls back to the
 * site's stored health_score if no parameters have been ingested yet.
 */
function computeHealthIndex(siteId) {
  const rows = getParameters(siteId);
  if (!rows.length) {
    const site = getDb().prepare('SELECT health_score FROM transformer_sites WHERE site_id = ?').get(siteId);
    return { index: site ? site.health_score : null, byCategory: {}, status: null, params: 0 };
  }
  const byKey = new Map(PARAMETERS.map(p => [p.key, p]));
  const catAgg = {};
  let wSum = 0, wScore = 0;
  for (const r of rows) {
    const p = byKey.get(r.param_key);
    if (!p) continue;
    const sc = paramScore(p, r.value);
    wSum += p.weight; wScore += sc * p.weight;
    (catAgg[p.category] = catAgg[p.category] || { sum: 0, w: 0, worst: 'normal' });
    catAgg[p.category].sum += sc * p.weight;
    catAgg[p.category].w += p.weight;
    if (r.status === 'critical') catAgg[p.category].worst = 'critical';
    else if (r.status === 'warning' && catAgg[p.category].worst !== 'critical') catAgg[p.category].worst = 'warning';
  }
  const byCategory = {};
  for (const c of CATEGORIES) {
    if (catAgg[c]) byCategory[c] = { score: Math.round(catAgg[c].sum / catAgg[c].w), status: catAgg[c].worst };
  }
  const index = wSum ? Math.round(wScore / wSum) : null;
  const status = index >= 80 ? 'healthy' : index >= 60 ? 'warning' : index >= 40 ? 'at_risk' : 'critical';
  return { index, byCategory, status, params: rows.length };
}

/** Compact "live" reading for the real-time monitor widget. */
function getLiveReading(site) {
  const snap = getSnapshot(site);
  const pick = k => { const r = snap.find(x => x.param_key === k); return r ? r.value : null; };
  return {
    site_id: site.site_id,
    timestamp: new Date().toISOString(),
    primary_voltage_v: pick('primary_voltage_v'),
    secondary_voltage_v: pick('secondary_voltage_v'),
    load_current_a: pick('load_current_a'),
    load_factor_pct: pick('load_factor_pct'),
    power_factor: pick('power_factor'),
    top_oil_temperature_c: pick('top_oil_temperature_c'),
    winding_temperature_c: pick('winding_temperature_c'),
    oil_level_pct: pick('oil_level_pct'),
    vibration_rms_mms: pick('vibration_rms_mms')
  };
}

module.exports = {
  getSnapshot, ingest, refreshAll, getParameters,
  computeHealthIndex, getLiveReading, setProvider, MockProvider
};
