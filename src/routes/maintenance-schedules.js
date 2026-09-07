'use strict';

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { getDb } = require('../database');
const MaintenanceSchedule = require('../models/MaintenanceSchedule');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const FaultEvent = require('../models/FaultEvent');
const AlertLog = require('../models/AlertLog');
const TransformerSite = require('../models/TransformerSite');

function today() {
  return new Date().toISOString().slice(0, 10);
}

// GET /api/maintenance-schedules — list with pagination, search, filter
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      status: req.query.status || '',
      region: req.query.region || '',
      task_type: req.query.task_type || '',
      priority: req.query.priority || '',
      due_before: req.query.due_before || '',
      orderBy: req.query.sortBy || req.query.orderBy || 'next_due_date',
      orderDir: (req.query.sortDir || req.query.orderDir || 'ASC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = MaintenanceSchedule.findAll(req.scope(filters));
    const stats = MaintenanceSchedule.getStats({ siteIds: req.allowedSiteIds || undefined });
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit, stats });
  } catch (err) { next(err); }
});

// GET /api/maintenance-schedules/calendar — schedules due between from..to
router.get('/calendar', (req, res, next) => {
  try {
    const from = req.query.from || today();
    const to = req.query.to || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const data = MaintenanceSchedule.calendar({ from, to, siteIds: req.allowedSiteIds });
    res.json({ data, total: data.length, from, to });
  } catch (err) { next(err); }
});

// GET /api/maintenance-schedules/history/:siteId — unified maintenance history
router.get('/history/:siteId', (req, res, next) => {
  try {
    const siteId = req.params.siteId;
    if (Array.isArray(req.allowedSiteIds) && !req.allowedSiteIds.includes(siteId)) {
      const e = new Error('Forbidden: site outside your allocation');
      e.status = 403;
      return next(e);
    }

    const site = TransformerSite.findById(siteId);
    if (!site) { const e = new Error('Transformer site not found'); e.status = 404; return next(e); }

    const db = getDb();
    const schedules = db.prepare(
      'SELECT * FROM maintenance_schedules WHERE site_id = ? ORDER BY next_due_date ASC'
    ).all(siteId);
    const records = MaintenanceRecord.findBySiteId(siteId);
    const faults = FaultEvent.findBySiteId(siteId);
    const alerts = AlertLog.findBySiteId(siteId);
    const failures = db.prepare(
      'SELECT * FROM failures WHERE site_id = ? ORDER BY created_at DESC'
    ).all(siteId);
    const inspections = db.prepare(
      'SELECT * FROM inspection_logs WHERE site_id = ? ORDER BY scheduled_at DESC'
    ).all(siteId);

    const upcoming = db.prepare(`
      SELECT * FROM maintenance_schedules
      WHERE site_id = ? AND status = 'active' AND next_due_date IS NOT NULL AND next_due_date >= ?
      ORDER BY next_due_date ASC
      LIMIT 1
    `).get(siteId, today()) || null;

    res.json({ site, schedules, records, faults, alerts, failures, inspections, upcoming });
  } catch (err) { next(err); }
});

// POST /api/maintenance-schedules — create
router.post('/', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    const created = MaintenanceSchedule.create({ ...req.body, created_by: req.user.user_id });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /api/maintenance-schedules/:id — single
router.get('/:id', (req, res, next) => {
  try {
    const schedule = MaintenanceSchedule.findById(req.params.id);
    if (!schedule) { const e = new Error('Maintenance schedule not found'); e.status = 404; return next(e); }
    res.json(schedule);
  } catch (err) { next(err); }
});

// PATCH /api/maintenance-schedules/:id — update
router.patch('/:id', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    const updated = MaintenanceSchedule.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/maintenance-schedules/:id/complete — mark complete
router.post('/:id/complete', requireRole('admin', 'regional_manager', 'field_technician'), (req, res, next) => {
  try {
    const completed = MaintenanceSchedule.complete(req.params.id);
    res.json(completed);
  } catch (err) { next(err); }
});

module.exports = router;
