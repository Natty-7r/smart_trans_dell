const express = require('express');
const router = express.Router();
const SensorReading = require('../models/SensorReading');

// GET /api/sensors — list with pagination, search, filter, sort
router.get('/', (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 1000);
    const offset = (page - 1) * limit;

    const filters = {
      search: req.query.search || '',
      site_id: req.query.site_id || '',
      inference_model: req.query.inference_model || '',
      edge_node: req.query.edge_node || '',
      from: req.query.from || '',
      to: req.query.to || '',
      is_anomaly: req.query.is_anomaly !== undefined ? req.query.is_anomaly === 'true' || req.query.is_anomaly === '1' : undefined,
      anomaly_score_min: req.query.anomaly_score_min !== undefined ? parseFloat(req.query.anomaly_score_min) : undefined,
      orderBy: req.query.sortBy || req.query.orderBy || 'timestamp',
      orderDir: (req.query.sortDir || req.query.orderDir || 'DESC').toUpperCase(),
      limit,
      offset
    };

    Object.keys(filters).forEach(k => {
      if (filters[k] === '' || filters[k] === undefined) delete filters[k];
    });

    const result = SensorReading.findAll(req.scope(filters));
    const pages = Math.ceil(result.total / limit);

    res.json({ data: result.data, total: result.total, page, pages, limit });
  } catch (err) { next(err); }
});

// GET /api/sensors/stats
router.get('/stats', (req, res, next) => {
  try {
    res.json(SensorReading.getStats());
  } catch (err) { next(err); }
});

// GET /api/sensors/timeseries — fleet-level time-series
router.get('/timeseries', (req, res, next) => {
  try {
    const field = req.query.metric || req.query.field || 'winding_temperature_c';
    const interval = req.query.interval || 'hour';
    const data = SensorReading.getFleetTimeSeries(field, interval);
    res.json({ data, metric: field, interval });
  } catch (err) { next(err); }
});

// GET /api/sensors/anomalies — anomaly timeline
router.get('/anomalies', (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = SensorReading.getAnomalyTimeline(days);
    res.json({ data, days });
  } catch (err) { next(err); }
});

// GET /api/sensors/export — CSV download
router.get('/export', (req, res, next) => {
  try {
    const filters = {
      site_id: req.query.site_id || '',
      is_anomaly: req.query.is_anomaly !== undefined ? req.query.is_anomaly === 'true' || req.query.is_anomaly === '1' : undefined,
      from: req.query.from || '',
      to: req.query.to || '',
      limit: 5000,
      offset: 0
    };
    Object.keys(filters).forEach(k => { if (filters[k] === '' || filters[k] === undefined) delete filters[k]; });

    const { data } = SensorReading.findAll(req.scope(filters));
    const cols = [
      'reading_id','site_id','timestamp','primary_voltage_v','secondary_voltage_v',
      'phase_a_current_a','phase_b_current_a','phase_c_current_a','neutral_current_a',
      'winding_temperature_c','oil_temperature_c','ambient_temperature_c','oil_level_pct',
      'moisture_in_oil_ppm','vibration_rms_mms','tap_changer_position','load_factor_pct',
      'anomaly_score','is_anomaly','inference_model','inference_latency_ms','edge_node','signal_quality_pct'
    ];

    const escape = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv = [cols.join(','), ...data.map(r => cols.map(c => escape(r[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sensor_readings.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

// GET /api/sensors/:id — single reading
router.get('/:id', (req, res, next) => {
  try {
    const reading = SensorReading.findById(req.params.id);
    if (!reading) { const e = new Error('Reading not found'); e.status = 404; return next(e); }

    const days_since = Math.floor((Date.now() - new Date(reading.timestamp).getTime()) / 86400000);
    res.json({ ...reading, days_since });
  } catch (err) { next(err); }
});

// GET /api/sensors/:id/events — sibling readings for the same site
router.get('/:id/events', (req, res, next) => {
  try {
    const reading = SensorReading.findById(req.params.id);
    if (!reading) { const e = new Error('Reading not found'); e.status = 404; return next(e); }

    const siblings = SensorReading.findBySiteId(reading.site_id, 50);
    res.json({ data: siblings, total: siblings.length });
  } catch (err) { next(err); }
});

module.exports = router;
