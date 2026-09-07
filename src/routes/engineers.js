const express = require('express');
const router = express.Router();
const FieldEngineer = require('../models/FieldEngineer');
const AlertLog = require('../models/AlertLog');
const MaintenanceRecord = require('../models/MaintenanceRecord');

// GET /api/engineers — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      status: req.query.status || '',
      region: req.query.region || '',
      gender: req.query.gender || '',
      certification_level: req.query.certification_level || '',
      on_call: req.query.on_call !== undefined
        ? req.query.on_call === 'true' || req.query.on_call === '1'
        : undefined,
      prism_trained: req.query.prism_trained !== undefined
        ? req.query.prism_trained === 'true' || req.query.prism_trained === '1'
        : undefined,
      orderBy: req.query.sortBy || req.query.orderBy || 'full_name',
      orderDir: (req.query.sortDir || req.query.orderDir || 'ASC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = FieldEngineer.findAll(filters);
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// GET /api/engineers/oncall
router.get('/oncall', (req, res, next) => {
  try {
    const data = FieldEngineer.findOnCall();
    res.json({ data, total: data.length });
  } catch (err) { next(err); }
});

// GET /api/engineers/stats
router.get('/stats', (req, res, next) => {
  try {
    res.json(FieldEngineer.getStats());
  } catch (err) { next(err); }
});

// GET /api/engineers/export — CSV
router.get('/export', (req, res, next) => {
  try {
    const filters = {
      status: req.query.status || '',
      region: req.query.region || '',
      limit: 1000,
      offset: 0
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '') delete filters[k]; });

    const { data } = FieldEngineer.findAll(filters);
    const cols = [
      'engineer_id','full_name','email','phone','region','home_base','specialization',
      'certification_level','hire_date','years_experience','status','active_assignments',
      'total_resolutions','avg_response_time_minutes','customer_satisfaction_score',
      'on_call','prism_trained'
    ];

    const escape = v => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.join(';') : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="field_engineers.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/engineers/:id — single engineer with related
router.get('/:id', (req, res, next) => {
  try {
    const engineer = FieldEngineer.findById(req.params.id);
    if (!engineer) { const e = new Error('Engineer not found'); e.status = 404; return next(e); }

    const recentAlerts = AlertLog.findByEngineerId(req.params.id).slice(0, 10);
    const recentMaintenance = MaintenanceRecord.findByEngineerId(req.params.id).slice(0, 10);

    const days_since_hired = Math.floor((Date.now() - new Date(engineer.hire_date).getTime()) / 86400000);
    const performance_tier = engineer.customer_satisfaction_score >= 4.5 ? 'Elite'
      : engineer.customer_satisfaction_score >= 4.0 ? 'High'
      : engineer.customer_satisfaction_score >= 3.5 ? 'Standard' : 'Developing';

    res.json({
      ...engineer,
      days_since_hired,
      performance_tier,
      related: {
        recentAlerts,
        recentMaintenance,
        alertCount: recentAlerts.length,
        maintenanceCount: recentMaintenance.length
      }
    });
  } catch (err) { next(err); }
});

// GET /api/engineers/:id/events — alert history for this engineer
router.get('/:id/events', (req, res, next) => {
  try {
    const engineer = FieldEngineer.findById(req.params.id);
    if (!engineer) { const e = new Error('Engineer not found'); e.status = 404; return next(e); }

    const alerts = AlertLog.findByEngineerId(req.params.id);
    const maintenance = MaintenanceRecord.findByEngineerId(req.params.id);

    const events = [
      ...alerts.map(a => ({ ...a, event_kind: 'alert', event_time: a.timestamp })),
      ...maintenance.map(m => ({ ...m, event_kind: 'maintenance', event_time: m.maintenance_date }))
    ].sort((a, b) => b.event_time.localeCompare(a.event_time));

    res.json({ data: events, total: events.length });
  } catch (err) { next(err); }
});

module.exports = router;
