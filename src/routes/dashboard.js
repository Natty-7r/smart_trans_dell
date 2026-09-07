const express = require('express');
const router = express.Router();
const TransformerSite = require('../models/TransformerSite');
const SensorReading = require('../models/SensorReading');
const FaultEvent = require('../models/FaultEvent');
const AlertLog = require('../models/AlertLog');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const FieldEngineer = require('../models/FieldEngineer');

// GET /api/dashboard/stats — master KPI aggregation for dashboard
router.get('/stats', (req, res, next) => {
  try {
    const siteStats = TransformerSite.getStats();
    const alertStats = AlertLog.getStats();
    const faultStats = FaultEvent.getStats();
    const maintStats = MaintenanceRecord.getStats();
    const engineerStats = FieldEngineer.getStats();
    const sensorStats = SensorReading.getStats();

    const activeAlerts = alertStats.totals.active_alerts || 0;
    const criticalSites = (siteStats.byStatus.find(s => s.status === 'critical') || {}).count || 0;
    const avgHealthScore = Math.round(siteStats.totals.avg_health_score || 0);
    const totalFinancialImpact = faultStats.totals.total_financial_impact || 0;
    const avgDispatchLatency = Math.round(alertStats.totals.avg_dispatch_latency || 0);
    const avgDetectionDelay = (faultStats.totals.avg_detection_delay || 0).toFixed(1);
    const totalMaintCost = maintStats.totals.total_cost || 0;
    const anomalyRate = sensorStats.totals.total_readings > 0
      ? ((sensorStats.totals.total_anomalies / sensorStats.totals.total_readings) * 100).toFixed(2)
      : 0;

    // Fault era comparison for the PRISM value story
    const prismComparison = FaultEvent.getPreVsPostPrism();
    const preEra = prismComparison.find(e => e.era === 'pre-PRISM') || {};
    const postEra = prismComparison.find(e => e.era === 'post-PRISM') || {};

    const detectionImprovement = preEra.avg_detection_delay && postEra.avg_detection_delay
      ? Math.round((1 - postEra.avg_detection_delay / preEra.avg_detection_delay) * 100)
      : 70;
    const downtimeImprovement = preEra.avg_downtime && postEra.avg_downtime
      ? Math.round((1 - postEra.avg_downtime / preEra.avg_downtime) * 100)
      : 65;

    // Recent active alerts
    const activeAlertList = AlertLog.getRecentActive(10);

    // Top at-risk sites
    const topRisk = TransformerSite.getTopAtRisk(5);

    // Fault time-series (monthly)
    const faultTimeSeries = FaultEvent.getTimeSeries('month');

    // Alert time-series (daily, last 30 days)
    const alertTimeSeries = AlertLog.getTimeSeries('day').slice(-30);

    // Maintenance cost by month
    const maintTimeSeries = MaintenanceRecord.getTimeSeries('month');

    // Sensor anomaly timeline
    const anomalyTimeline = SensorReading.getAnomalyTimeline(30);

    res.json({
      kpis: {
        totalSites: siteStats.totals.total_sites,
        criticalSites,
        activeAlerts,
        avgHealthScore,
        totalFinancialImpact: Math.round(totalFinancialImpact),
        avgDispatchLatencySeconds: avgDispatchLatency,
        avgDetectionDelayHours: parseFloat(avgDetectionDelay),
        totalMaintCost: Math.round(totalMaintCost),
        anomalyRate: parseFloat(anomalyRate),
        totalAnomalies: sensorStats.totals.total_anomalies,
        totalSensorReadings: sensorStats.totals.total_readings,
        subscribersAtRisk: siteStats.totals.total_subscribers_at_risk,
        totalReplValueUsd: siteStats.totals.total_replacement_value,
        onCallEngineers: engineerStats.totals.on_call_count,
        prismTrainedEngineers: engineerStats.totals.prism_trained_count,
        aiConfidence: Math.round((alertStats.totals.avg_ai_confidence || 0) * 100) / 100,
        avgPredictionLeadHours: Math.round((alertStats.totals.avg_prediction_lead || 0) * 10) / 10
      },
      prismImpact: {
        detectionDelayReductionPct: detectionImprovement,
        downtimeReductionPct: downtimeImprovement,
        faultsBefore: preEra.fault_count || 0,
        faultsAfter: postEra.fault_count || 0,
        avgDetectionBefore: preEra.avg_detection_delay || 72,
        avgDetectionAfter: postEra.avg_detection_delay || 0.4,
        avgDowntimeBefore: preEra.avg_downtime || 18,
        avgDowntimeAfter: postEra.avg_downtime || 0.5,
        financialImpactBefore: preEra.total_impact || 0,
        financialImpactAfter: postEra.total_impact || 0
      },
      breakdown: {
        sitesByStatus: siteStats.byStatus,
        sitesByRegion: siteStats.byRegion,
        sitesByRating: siteStats.byRating,
        alertsBySeverity: alertStats.bySeverity,
        alertsByType: alertStats.byType,
        alertsByModel: alertStats.byModel,
        faultsByType: faultStats.byType,
        faultsBySeverity: faultStats.bySeverity,
        maintByClassification: maintStats.byClassification,
        engineersByStatus: engineerStats.byStatus,
        engineersByRegion: engineerStats.byRegion,
        healthDistribution: TransformerSite.getHealthDistribution()
      },
      trends: {
        faultTimeSeries,
        alertTimeSeries,
        maintTimeSeries,
        anomalyTimeline
      },
      live: {
        activeAlerts: activeAlertList,
        topRiskSites: topRisk
      },
      lastUpdated: new Date().toISOString()
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/timeseries
router.get('/timeseries', (req, res, next) => {
  try {
    const metric = req.query.metric || 'faults';
    const interval = req.query.interval || 'month';

    let data;
    if (metric === 'faults') {
      data = FaultEvent.getTimeSeries(interval);
    } else if (metric === 'alerts') {
      data = AlertLog.getTimeSeries(interval);
    } else if (metric === 'maintenance') {
      data = MaintenanceRecord.getTimeSeries(interval);
    } else if (metric === 'anomalies') {
      data = SensorReading.getAnomalyTimeline(90);
    } else {
      data = SensorReading.getFleetTimeSeries(metric, interval);
    }

    res.json({ data, metric, interval });
  } catch (err) { next(err); }
});

module.exports = router;
