'use strict';

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

// All user-management endpoints are Administrator-only.
router.use(requireAuth, requireRole('admin'));

// GET /api/users
router.get('/', (req, res, next) => {
  try {
    res.json({ data: User.findAll({
      role: req.query.role || '', region: req.query.region || '',
      status: req.query.status || '', search: req.query.search || ''
    }), stats: User.getStats() });
  } catch (err) { next(err); }
});

// GET /api/users/stats
router.get('/stats', (req, res, next) => {
  try { res.json(User.getStats()); } catch (err) { next(err); }
});

// POST /api/users
router.post('/', (req, res, next) => {
  try {
    const user = User.create({ ...req.body, created_by: req.user.user_id });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// GET /api/users/:id
router.get('/:id', (req, res, next) => {
  try {
    const u = User.findById(req.params.id);
    if (!u) { const e = new Error('User not found'); e.status = 404; return next(e); }
    res.json(u);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id
router.patch('/:id', (req, res, next) => {
  try {
    res.json(User.update(req.params.id, { ...req.body, updated_by: req.user.user_id }));
  } catch (err) { next(err); }
});

// POST /api/users/:id/deactivate
router.post('/:id/deactivate', (req, res, next) => {
  try {
    if (req.params.id === req.user.user_id) {
      return res.status(400).json({ error: { message: 'You cannot deactivate your own account', status: 400, timestamp: new Date().toISOString() } });
    }
    res.json(User.deactivate(req.params.id));
  } catch (err) { next(err); }
});

// POST /api/users/:id/sites — set allocations
router.post('/:id/sites', (req, res, next) => {
  try {
    const siteIds = Array.isArray(req.body.site_ids) ? req.body.site_ids : [];
    User.setSites(req.params.id, siteIds, req.user.user_id);
    res.json(User.findById(req.params.id));
  } catch (err) { next(err); }
});

module.exports = router;
