'use strict';

/**
 * routes/health.js — Transformer Health Index API (E6).
 *
 * Mounted at /api/health behind the global requireAuth, so every request has
 * req.user, req.allowedSiteIds (null = unrestricted) and req.scope(filters).
 * All endpoints respect the caller's site allocation.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireRole } = require('../middleware/auth');
const TransformerSite = require('../models/TransformerSite');
const telemetry = require('../services/telemetry');
const { CATEGORIES, PARAMETERS } = require('../config/health-params');

/** Scoped site_id set: null = unrestricted (admin), else the allowed array. */
function scopedSiteIds(req) {
  return req.allowedSiteIds || null;
}

/** Fetch the scoped list of sites (reuses the model's siteIds IN filter). */
function scopedSites(req) {
  return TransformerSite.findAll({ siteIds: scopedSiteIds(req) || undefined, limit: 5000 }).data;
}

/** True if the caller may access the given site. */
function canAccess(req, siteId) {
  return !Array.isArray(req.allowedSiteIds) || req.allowedSiteIds.includes(siteId);
}

/** Group a flat parameter list into an object keyed by category. */
function groupByCategory(params) {
  const grouped = {};
  for (const c of CATEGORIES) grouped[c] = [];
  for (const p of params) {
    (grouped[p.category] = grouped[p.category] || []).push(p);
  }
  return grouped;
}

// GET /api/health/thresholds — parameter catalog for the UI
router.get('/thresholds', (req, res, next) => {
  try {
    res.json({ categories: CATEGORIES, parameters: PARAMETERS });
  } catch (err) { next(err); }
});

// GET /api/health/index — fleet-level Health Index summary (scoped)
router.get('/index', (req, res, next) => {
  try {
    const sites = scopedSites(req);
    const distribution = { healthy: 0, warning: 0, at_risk: 0, critical: 0 };
    const catAgg = {};
    for (const c of CATEGORIES) catAgg[c] = { sum: 0, n: 0 };
    let indexSum = 0, indexCount = 0;
    const scored = [];

    for (const site of sites) {
      const hi = telemetry.computeHealthIndex(site.site_id);
      const idx = hi.index;
      if (idx == null) continue;
      indexSum += idx;
      indexCount += 1;

      const status = idx >= 80 ? 'healthy' : idx >= 60 ? 'warning' : idx >= 40 ? 'at_risk' : 'critical';
      distribution[status] += 1;

      for (const c of CATEGORIES) {
        if (hi.byCategory[c]) { catAgg[c].sum += hi.byCategory[c].score; catAgg[c].n += 1; }
      }

      scored.push({ site_id: site.site_id, name: site.name, region: site.region, index: idx, status });
    }

    const byCategory = {};
    for (const c of CATEGORIES) byCategory[c] = catAgg[c].n ? Math.round(catAgg[c].sum / catAgg[c].n) : null;

    const worstSites = scored.sort((a, b) => a.index - b.index).slice(0, 8);

    res.json({
      fleetIndex: indexCount ? Math.round(indexSum / indexCount) : null,
      siteCount: sites.length,
      distribution,
      byCategory,
      worstSites
    });
  } catch (err) { next(err); }
});

// GET /api/health/oil — oil-status overview across scoped sites
router.get('/oil', (req, res, next) => {
  try {
    const allowed = req.allowedSiteIds;
    const params = {};
    let scope = '';
    if (Array.isArray(allowed)) {
      if (allowed.length === 0) return res.json([]);
      const ph = allowed.map((_, i) => `@__sid${i}`).join(',');
      scope = `AND t.site_id IN (${ph})`;
      allowed.forEach((s, i) => { params[`__sid${i}`] = s; });
    }
    const rows = getDb().prepare(`
      SELECT t.site_id, t.name, t.region, hp.value AS oil_level_pct, hp.status
      FROM health_parameters hp
      JOIN transformer_sites t ON t.site_id = hp.site_id
      WHERE hp.param_key = 'oil_level_pct' ${scope}
      ORDER BY hp.value ASC
    `).all(params);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/health/site/:siteId — full health detail for one site
router.get('/site/:siteId', (req, res, next) => {
  try {
    const { siteId } = req.params;
    if (!canAccess(req, siteId)) {
      return res.status(403).json({ error: { message: 'Forbidden: site outside your allocation', status: 403, timestamp: new Date().toISOString() } });
    }
    const site = TransformerSite.findById(siteId);
    if (!site) { const e = new Error('Site not found'); e.status = 404; return next(e); }

    res.json({
      site,
      index: telemetry.computeHealthIndex(siteId),
      parameters: groupByCategory(telemetry.getParameters(siteId)),
      live: telemetry.getLiveReading(site)
    });
  } catch (err) { next(err); }
});

// GET /api/health/parameters/:siteId — stored parameters grouped by category
router.get('/parameters/:siteId', (req, res, next) => {
  try {
    const { siteId } = req.params;
    if (!canAccess(req, siteId)) {
      return res.status(403).json({ error: { message: 'Forbidden: site outside your allocation', status: 403, timestamp: new Date().toISOString() } });
    }
    const grouped = groupByCategory(telemetry.getParameters(siteId));
    grouped.computedIndex = telemetry.computeHealthIndex(siteId);
    res.json(grouped);
  } catch (err) { next(err); }
});

// GET /api/health/live/:siteId — compact real-time reading (re-samples each call)
router.get('/live/:siteId', (req, res, next) => {
  try {
    const { siteId } = req.params;
    if (!canAccess(req, siteId)) {
      return res.status(403).json({ error: { message: 'Forbidden: site outside your allocation', status: 403, timestamp: new Date().toISOString() } });
    }
    const site = TransformerSite.findById(siteId);
    if (!site) { const e = new Error('Site not found'); e.status = 404; return next(e); }
    res.json(telemetry.getLiveReading(site));
  } catch (err) { next(err); }
});

// POST /api/health/refresh — regenerate the mock live snapshot for all sites
router.post('/refresh', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    const refreshed = telemetry.refreshAll();
    res.json({ refreshed });
  } catch (err) { next(err); }
});

module.exports = router;
