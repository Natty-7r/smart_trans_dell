const express = require('express');
const router = express.Router();
const TransformerSite = require('../models/TransformerSite');
const SensorReading = require('../models/SensorReading');
const FaultEvent = require('../models/FaultEvent');
const AlertLog = require('../models/AlertLog');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const { requireRole } = require('../middleware/auth');

// ── E2: site management (Administrator only) ──
// POST /api/sites — create a site
router.post('/', requireRole('admin'), (req, res, next) => {
  try { res.status(201).json(TransformerSite.create(req.body || {})); }
  catch (err) { next(err); }
});

// PATCH /api/sites/:id — edit site metadata
router.patch('/:id', requireRole('admin'), (req, res, next) => {
  try { res.json(TransformerSite.update(req.params.id, req.body || {})); }
  catch (err) { next(err); }
});

// DELETE /api/sites/:id — remove a site
router.delete('/:id', requireRole('admin'), (req, res, next) => {
  try {
    const ok = TransformerSite.remove(req.params.id);
    if (!ok) { const e = new Error('Site not found'); e.status = 404; return next(e); }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/sites — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      status: req.query.status || '',
      region: req.query.region || '',
      transformer_rating: req.query.transformer_rating || '',
      anomaly_type: req.query.anomaly_type || '',
      health_min: req.query.health_min !== undefined ? parseFloat(req.query.health_min) : undefined,
      health_max: req.query.health_max !== undefined ? parseFloat(req.query.health_max) : undefined,
      orderBy: req.query.sortBy || req.query.orderBy || 'health_score',
      orderDir: (req.query.sortDir || req.query.orderDir || 'ASC').toUpperCase(),
      limit,
      offset
    };

    // Remove empty strings so model's buildWhereClause skips them
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const result = TransformerSite.findAll(req.scope(filters));
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// GET /api/sites/stats — site-level stats
router.get('/stats', (req, res, next) => {
  try {
    const stats = TransformerSite.getStats();
    const healthDist = TransformerSite.getHealthDistribution();
    const topAtRisk = TransformerSite.getTopAtRisk(10);
    res.json({ ...stats, healthDistribution: healthDist, topAtRisk });
  } catch (err) { next(err); }
});

// GET /api/sites/geo — GIS markers for map
router.get('/geo', (req, res, next) => {
  try {
    res.json({ data: TransformerSite.getGeoData() });
  } catch (err) { next(err); }
});

// GET /api/sites/export — CSV download
router.get('/export', (req, res, next) => {
  try {
    const filters = {
      search: req.query.search || '',
      status: req.query.status || '',
      region: req.query.region || '',
      transformer_rating: req.query.transformer_rating || '',
      limit: 5000,
      offset: 0
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const { data } = TransformerSite.findAll(req.scope(filters));
    const cols = [
      'site_id','name','region','area','address','transformer_rating','site_type',
      'connectivity','manufacturer','serial_number','installation_date','last_inspection_date',
      'status','health_score','anomaly_type','fault_rate_baseline','active_sensors',
      'ai_monitoring_enabled','subscribers_at_risk','replacement_cost_usd',
      'annual_energy_kwh','eca_asset_class','latitude','longitude'
    ];

    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transformer_sites.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/sites/:id — single site with related data
router.get('/:id', (req, res, next) => {
  try {
    const site = TransformerSite.findById(req.params.id);
    if (!site) { const e = new Error('Site not found'); e.status = 404; return next(e); }

    const latestReading = SensorReading.getLatestBySite(req.params.id);
    const recentReadings = SensorReading.findBySiteId(req.params.id, 20);
    const recentFaults = FaultEvent.findBySiteId(req.params.id).slice(0, 10);
    const recentAlerts = AlertLog.findBySiteId(req.params.id).slice(0, 10);
    const maintenanceHistory = MaintenanceRecord.findBySiteId(req.params.id).slice(0, 10);

    const faultCount = recentFaults.length;
    const alertCount = recentAlerts.length;
    const days_since_inspection = site.last_inspection_date
      ? Math.floor((Date.now() - new Date(site.last_inspection_date).getTime()) / 86400000)
      : null;
    const days_since_alert = site.last_alert_timestamp
      ? Math.floor((Date.now() - new Date(site.last_alert_timestamp).getTime()) / 86400000)
      : null;
    const trend_direction = site.health_score >= 80 ? 'stable' : site.health_score >= 60 ? 'declining' : 'critical';

    res.json({
      ...site,
      days_since_inspection,
      days_since_alert,
      trend_direction,
      related: {
        latestReading,
        recentReadings,
        recentFaults,
        recentAlerts,
        maintenanceHistory,
        faultCount,
        alertCount
      }
    });
  } catch (err) { next(err); }
});

// GET /api/sites/:id/readings — sensor time-series
router.get('/:id/readings', (req, res, next) => {
  try {
    const field = req.query.field || 'winding_temperature_c';
    const hours = parseInt(req.query.hours) || 24;
    const limit = parseInt(req.query.limit) || 100;

    const data = SensorReading.getTimeSeries(req.params.id, field, hours);
    const all = SensorReading.findBySiteId(req.params.id, limit);
    res.json({ data, allReadings: all, total: data.length });
  } catch (err) { next(err); }
});

// GET /api/sites/:id/events — fault + alert event history
router.get('/:id/events', (req, res, next) => {
  try {
    const faults = FaultEvent.findBySiteId(req.params.id);
    const alerts = AlertLog.findBySiteId(req.params.id);

    const events = [
      ...faults.map(f => ({ ...f, event_kind: 'fault', event_time: f.timestamp })),
      ...alerts.map(a => ({ ...a, event_kind: 'alert', event_time: a.timestamp }))
    ].sort((a, b) => b.event_time.localeCompare(a.event_time));

    res.json({ data: events, total: events.length });
  } catch (err) { next(err); }
});

module.exports = router;
