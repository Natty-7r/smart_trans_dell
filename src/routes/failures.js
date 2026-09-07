'use strict';

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const Failure = require('../models/Failure');

// GET /api/failures — list with pagination, search, filter
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      region: req.query.region || '',
      resolution_status: req.query.resolution_status || '',
      severity: req.query.severity || '',
      orderBy: req.query.sortBy || req.query.orderBy || 'created_at',
      orderDir: (req.query.sortDir || req.query.orderDir || 'DESC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = Failure.findAll(req.scope(filters));
    const stats = Failure.getStats({ siteIds: req.allowedSiteIds || undefined });
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit, stats });
  } catch (err) { next(err); }
});

// POST /api/failures — create
router.post('/', requireRole('admin', 'regional_manager', 'field_technician'), (req, res, next) => {
  try {
    const created = Failure.create({ ...req.body, confirmed_by: req.body.confirmed_by || req.user.user_id });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /api/failures/:id — single
router.get('/:id', (req, res, next) => {
  try {
    const failure = Failure.findById(req.params.id);
    if (!failure) { const e = new Error('Failure not found'); e.status = 404; return next(e); }
    res.json(failure);
  } catch (err) { next(err); }
});

// PATCH /api/failures/:id — update
router.patch('/:id', requireRole('admin', 'regional_manager', 'field_technician'), (req, res, next) => {
  try {
    const updated = Failure.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
