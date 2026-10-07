require('dotenv').config({ override: false });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3012;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure upload directories exist (RAG documents + collaboration files)
const fs = require('fs');
const uploadBase = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
for (const d of ['documents', 'groups']) {
  fs.mkdirSync(path.join(uploadBase, d), { recursive: true });
}

// Initialise DB (schema + seed) at startup
const { init } = require('./src/database');
init();

// Health check
app.get('/health', (req, res) => {
  const { getDb } = require('./src/database');
  let dataLoaded = false;
  try {
    dataLoaded = getDb().prepare('SELECT COUNT(*) as c FROM transformer_sites').get().c > 0;
  } catch (_) { }
  res.json({
    status: 'ok',
    port: PORT,
    useCase: 'AI-Powered Transformer Predictive Failure Prevention for Safaricom Ethiopia Network',
    dataLoaded,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    memoryUsage: process.memoryUsage()
  });
});

// ── Authentication (E1): login is public; everything else requires a session ──
const { requireAuth, scopeResponses } = require('./src/middleware/auth');
app.use('/api/auth', require('./src/routes/auth'));

// Global gate: every /api route below this line requires a valid bearer token,
// and responses are site-scoped (defense-in-depth) to the caller's allocation.
app.use('/api', requireAuth, scopeResponses);

// Entity routes (now authenticated + scoped)
app.use('/api/sites', require('./src/routes/sites'));
app.use('/api/sensors', require('./src/routes/sensors'));
app.use('/api/alerts', require('./src/routes/alerts'));
app.use('/api/faults', require('./src/routes/faults'));
app.use('/api/maintenance', require('./src/routes/maintenance'));
app.use('/api/maintenance-schedules', require('./src/routes/maintenance-schedules'));
app.use('/api/failures', require('./src/routes/failures'));
app.use('/api/engineers', require('./src/routes/engineers'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/inspections', require('./src/routes/inspections'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/health', require('./src/routes/health'));
app.use('/api/documents', require('./src/routes/documents'));

// Collaboration (E3): groups router also exposes an escalations sub-router
const groupsRouter = require('./src/routes/groups');
app.use('/api/groups', groupsRouter);
app.use('/api/escalations', groupsRouter.escalations);

// Aggregate /api/stats convenience endpoint
app.get('/api/stats', (req, res, next) => {
  try {
    const TransformerSite = require('./src/models/TransformerSite');
    const AlertLog = require('./src/models/AlertLog');
    const FaultEvent = require('./src/models/FaultEvent');
    const MaintenanceRecord = require('./src/models/MaintenanceRecord');
    const FieldEngineer = require('./src/models/FieldEngineer');
    const SensorReading = require('./src/models/SensorReading');

    const siteStats = TransformerSite.getStats();
    const alertStats = AlertLog.getStats();
    const faultStats = FaultEvent.getStats();
    const maintStats = MaintenanceRecord.getStats();
    const engStats = FieldEngineer.getStats();
    const sensorStats = SensorReading.getStats();

    res.json({
      totalRecords: {
        sites: siteStats.totals.total_sites,
        alerts: alertStats.totals.total_alerts,
        faults: faultStats.totals.total_faults,
        maintenance: maintStats.totals.total_records,
        engineers: engStats.totals.total_engineers,
        sensorReadings: sensorStats.totals.total_readings
      },
      kpis: {
        avgHealthScore: Math.round(siteStats.totals.avg_health_score || 0),
        activeAlerts: alertStats.totals.active_alerts,
        totalFinancialImpact: Math.round(faultStats.totals.total_financial_impact || 0),
        avgDispatchLatencySeconds: Math.round(alertStats.totals.avg_dispatch_latency || 0),
        avgPredictionLeadHours: Math.round((alertStats.totals.avg_prediction_lead || 0) * 10) / 10,
        avgAiConfidence: Math.round((alertStats.totals.avg_ai_confidence || 0) * 100) / 100,
        avgDetectionDelayHours: Math.round((faultStats.totals.avg_detection_delay || 0) * 10) / 10,
        totalMaintCost: Math.round(maintStats.totals.total_cost || 0),
        subscribersAtRisk: siteStats.totals.total_subscribers_at_risk,
        onCallEngineers: engStats.totals.on_call_count
      },
      trends: {
        faults: FaultEvent.getTimeSeries('month'),
        alerts: AlertLog.getTimeSeries('day').slice(-30)
      },
      breakdown: {
        sitesByStatus: siteStats.byStatus,
        alertsBySeverity: alertStats.bySeverity,
        faultsByType: faultStats.byType
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (err) { next(err); }
});

// API 404 handler (only for /api prefix)
app.use('/api', (req, res, next) => {
  res.status(404).json({
    error: { message: `API endpoint not found: ${req.originalUrl}`, status: 404, timestamp: new Date().toISOString() }
  });
});

// SPA fallback for all other GET requests
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
const { errorHandler } = require('./src/middleware/error');
app.use(errorHandler);

app.listen(PORT, () => {
  console.log('Transformer Titan | AI-Powered Transformer Predictive Failure Prevention ready on port ' + PORT);
});

module.exports = app;
