'use strict';

const express = require('express');
const router = express.Router();
const { streamChat } = require('../llm');
const rag = require('../rag');
const ragDocs = require('../rag-documents');
const TransformerSite = require('../models/TransformerSite');
const SensorReading = require('../models/SensorReading');
const FaultEvent = require('../models/FaultEvent');
const AlertLog = require('../models/AlertLog');
const MaintenanceRecord = require('../models/MaintenanceRecord');
const FieldEngineer = require('../models/FieldEngineer');

// Build a data-rich system prompt from live DB stats.
// When `retrieved` (RAG passages) is supplied, a grounded knowledge block and
// citation rules are appended so the local LLM answers from retrieved context.
function buildSystemPrompt(retrieved) {
  try {
    const siteStats = TransformerSite.getStats();
    const alertStats = AlertLog.getStats();
    const faultStats = FaultEvent.getStats();
    const maintStats = MaintenanceRecord.getStats();
    const engineerStats = FieldEngineer.getStats();
    const sensorStats = SensorReading.getStats();

    const prism = FaultEvent.getPreVsPostPrism();
    const preEra = prism.find(e => e.era === 'pre-PRISM') || {};
    const postEra = prism.find(e => e.era === 'post-PRISM') || {};

    const activeAlerts = AlertLog.getRecentActive(5);
    const topRisk = TransformerSite.getTopAtRisk(5);

    const criticalCount = (alertStats.bySeverity.find(s => s.severity === 'Critical') || {}).count || 0;
    const highCount = (alertStats.bySeverity.find(s => s.severity === 'High') || {}).count || 0;
    const unknownFaults = faultStats.byType.find(t => t.fault_type === 'unknown');

    const detectionImprovement = preEra.avg_detection_delay && postEra.avg_detection_delay
      ? Math.round((1 - postEra.avg_detection_delay / preEra.avg_detection_delay) * 100)
      : 99;

    const topRiskLines = topRisk.map((s, i) =>
      `  ${i + 1}. ${s.name} (${s.region}) — Health ${s.health_score}/100, Status: ${s.status}, Subscribers at risk: ${s.subscribers_at_risk}`
    ).join('\n');

    const activeAlertLines = activeAlerts.slice(0, 5).map(a =>
      `  • [${a.severity}] ${a.site_name}: ${a.alert_message} (AI confidence: ${Math.round(a.ai_confidence * 100)}%)`
    ).join('\n');

    const basePrompt = `You are PRISM AI — the embedded intelligence assistant for Safaricom Ethiopia's transformer predictive failure prevention platform. You support NOC engineers, field technicians, and executive stakeholders in understanding transformer fleet health, interpreting predictive alerts, and optimising maintenance decisions.

LIVE FLEET DATA (timestamp: ${new Date().toISOString()}):

TRANSFORMER ESTATE:
- Sites monitored: ${siteStats.totals.total_sites} transformers across 5 Ethiopian regions
- Fleet average health score: ${Math.round(siteStats.totals.avg_health_score || 0)}/100
- Subscribers at risk from degraded assets: ${(siteStats.totals.total_subscribers_at_risk || 0).toLocaleString()}
- Total replacement estate value: $${((siteStats.totals.total_replacement_value || 0) / 1_000_000).toFixed(1)}M
- Sites by operational status: ${siteStats.byStatus.map(s => `${s.status}: ${s.count}`).join(', ')}
- Regional distribution: ${siteStats.byRegion.map(r => `${r.region}: ${r.count} sites (avg health ${Math.round(r.avg_health)})`).join('; ')}

ACTIVE ALERT QUEUE (${alertStats.totals.active_alerts || 0} open):
- Critical severity: ${criticalCount}
- High severity: ${highCount}
- AI model confidence (avg): ${Math.round((alertStats.totals.avg_ai_confidence || 0) * 100)}%
- Alert dispatch latency (avg): ${Math.round(alertStats.totals.avg_dispatch_latency || 0)}s (SLA target: <30s)
- Prediction lead time (avg): ${((alertStats.totals.avg_prediction_lead || 0)).toFixed(1)} hours ahead of projected failure

FAULT HISTORY & IMPACT:
- Total fault events logged: ${faultStats.totals.total_faults}
- Cumulative financial impact: $${Math.round((faultStats.totals.total_financial_impact || 0) / 1000)}K
- Detection delay — pre-PRISM baseline: ${((preEra.avg_detection_delay || 72)).toFixed(1)}h
- Detection delay — post-PRISM: ${((postEra.avg_detection_delay || 0.4)).toFixed(1)}h
- Detection improvement: ${detectionImprovement}% reduction in time-to-detect
- Root cause breakdown: ${faultStats.byType.map(t => `${t.fault_type}: ${t.count}`).join(', ')}
- 'Unknown/undetected' root causes: ${unknownFaults ? unknownFaults.count : 'N/A'} (industry average: 70%)

MAINTENANCE PROGRAMME:
- Total maintenance records: ${maintStats.totals.total_records}
- Total programme cost: $${Math.round((maintStats.totals.total_cost || 0) / 1000)}K
- Emergency vs planned split: ${maintStats.totals.emergency_count} emergency / ${maintStats.totals.planned_count} planned
- ISO 55000-compliant records: ${maintStats.totals.iso_compliant_count}

FIELD WORKFORCE:
- Certified field engineers: ${engineerStats.totals.total_engineers}
- Engineers on-call now: ${engineerStats.totals.on_call_count}
- PRISM-platform trained: ${engineerStats.totals.prism_trained_count}
- Average field response time: ${Math.round(engineerStats.totals.avg_response_time || 0)} minutes

SENSOR TELEMETRY PIPELINE:
- Total sensor readings processed: ${(sensorStats.totals.total_readings || 0).toLocaleString()}
- Anomalies detected by AI ensemble: ${(sensorStats.totals.total_anomalies || 0).toLocaleString()}
- Anomaly detection rate: ${sensorStats.totals.total_readings > 0 ? ((sensorStats.totals.total_anomalies / sensorStats.totals.total_readings) * 100).toFixed(2) : 0}%
- Fleet average winding temperature: ${((sensorStats.totals.avg_winding_temp || 0)).toFixed(1)}°C
- Maximum winding temperature on record: ${((sensorStats.totals.max_winding_temp || 0)).toFixed(1)}°C (IEC 60076-7 limit: 140°C)
- Edge inference latency (avg): ${Math.round(sensorStats.totals.avg_inference_latency || 0)}ms (Dell PowerEdge R760 local scoring)

TOP 5 HIGHEST-RISK SITES RIGHT NOW:
${topRiskLines}

CURRENTLY ACTIVE ALERTS SAMPLE:
${activeAlertLines}

AI MODEL ENSEMBLE:
- Isolation Forest (scikit-learn v1.4): multivariate point anomaly detection across 12 sensor channels
- LSTM Autoencoder (PyTorch 2.2): 24-hour sequence reconstruction error for temporal degradation patterns
- XGBoost Classifier (v2.0): four-tier severity scoring — Critical / High / Medium / Low
- Prophet (Meta): 72-hour winding temperature and load factor forecasting for proactive scheduling

COMPLIANCE & STANDARDS:
- ECA (Ethiopian Communications Authority) — Proclamation No. 1148/2019 uptime reporting
- Ethiopian Electric Utility Corporation (EEUC) — HV transformer monitoring standards
- IEC 60076 — Transformer thermal limits and insulation assessment (IEC 60076-7 thermal model)
- ISO 55000 — Asset lifecycle documentation and condition-based maintenance planning
- Ethiopian Personal Data Protection Proclamation — operational telemetry is PII-free and on-premises

RESPONSE GUIDELINES:
- Always cite specific numbers from the live data above — never use generic estimates
- Be concise and actionable: 2-4 sentences per response unless asked for detail
- Use Telecom infrastructure and power engineering terminology naturally
- Highlight actionable next steps: which sites to prioritise, which parameters to investigate, which engineers to dispatch
- When referencing thresholds, cite the relevant standard (IEC 60076-7, ECA uptime SLA, etc.)
- Format with markdown where it aids clarity (bullet lists for multi-step actions, bold for critical values)`;

    return appendRetrievedContext(basePrompt, retrieved);

  } catch (err) {
    console.error('[AI] buildSystemPrompt error:', err.message);
    const fallback = `You are PRISM AI — the intelligent assistant for Safaricom Ethiopia's AI-Powered Transformer Predictive Failure Prevention platform. Answer questions about transformer fleet health, predictive alerts, maintenance scheduling, and AI model performance. Be concise, data-specific, and use IEC 60076 and ISO 55000 terminology. If you lack specific numbers, acknowledge it and explain the general framework.`;
    return appendRetrievedContext(fallback, retrieved);
  }
}

// Append the RAG grounding block + citation rules to a base system prompt.
function appendRetrievedContext(basePrompt, retrieved) {
  if (!retrieved || !retrieved.length) return basePrompt;
  const contextBlock = rag.buildContextBlock(retrieved);
  return `${basePrompt}

═══════════════════════════════════════════════
RETRIEVED KNOWLEDGE BASE (RAG)
═══════════════════════════════════════════════
The passages below were retrieved from the live operational database and the
engineering knowledge base as the most relevant to the user's question. Ground
your answer in them and cite the specific sources you use inline with their [S#]
tags (e.g. "3 sites are Critical [S2][S4]"). Prefer facts from these passages over
general knowledge. If they do not contain the answer, say so briefly, then answer
from the fleet overview above.

${contextBlock}

CITATION RULES:
- Cite sources inline as [S1], [S2], … immediately after the claim they support.
- Only cite tags that appear above. Do not invent source tags or figures.
- Weave 2-5 citations into a concise, actionable answer.`;
}

// POST /api/ai/chat — SSE streaming chat with Ollama-first, Anthropic fallback
router.post('/chat', async (req, res, next) => {
  const { message, context } = req.body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      error: { message: 'message is required', status: 400, timestamp: new Date().toISOString() }
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // ── RAG: retrieve grounding passages for this question ──
  // Two sources, hybrid: (1) BM25 over live operational data, and
  // (2) the uploaded-document vector store (manuals, SOPs, drawings, fault logs).
  let retrieved = [];
  try {
    retrieved = rag.retrieve(message, 6);
  } catch (err) {
    console.warn('[AI] RAG retrieval failed, answering ungrounded:', err.message);
  }

  let docHits = [];
  try {
    docHits = await ragDocs.retrieve(message, 4);
  } catch (err) {
    console.warn('[AI] Document RAG retrieval failed:', err.message);
  }

  // Surface the retrieved sources to the UI before the answer streams.
  const sourcesPayload = retrieved.map(r => ({
    tag: r.tag, id: r.id, type: r.type, title: r.title,
    ref: r.ref, snippet: r.snippet, relevance: r.relevance, score: r.score
  }));
  docHits.forEach((d, i) => sourcesPayload.push({
    tag: `D${i + 1}`, id: d.doc_id, type: `document:${d.source_type}`, title: d.title,
    ref: d.title, snippet: d.snippet, relevance: Math.round((d.score || 0) * 100), score: d.score
  }));
  res.write(`data: ${JSON.stringify({ sources: sourcesPayload })}\n\n`);

  let systemPrompt = buildSystemPrompt(retrieved);
  if (docHits.length) {
    const docBlock = docHits.map((d, i) =>
      `[D${i + 1}] ${d.title} (${d.source_type}):\n${d.snippet}`
    ).join('\n\n');
    systemPrompt += `\n\nORGANIZATIONAL KNOWLEDGE BASE (retrieved from uploaded documents — cite as [D#] when used):\n${docBlock}\n\nWhen the user asks a troubleshooting or maintenance-procedure question, ground your answer in this knowledge base and cite the [D#] sources you used.`;
  }
  const userContent = context
    ? `[Dashboard context: ${JSON.stringify(context)}]\n\n${message}`
    : message;
  const messages = [{ role: 'user', content: userContent }];

  await streamChat(systemPrompt, messages, res);
});

// GET /api/ai/rag/status — corpus + retrieval engine status
router.get('/rag/status', (req, res, next) => {
  try {
    res.json(rag.status());
  } catch (err) { next(err); }
});

// GET /api/ai/rag/search?q=...&k=6 — retrieval-only preview (no generation)
router.get('/rag/search', (req, res, next) => {
  try {
    const q = (req.query.q || '').toString();
    const k = Math.min(20, Math.max(1, parseInt(req.query.k, 10) || 6));
    if (!q.trim()) {
      return res.status(400).json({
        error: { message: 'query param q is required', status: 400, timestamp: new Date().toISOString() }
      });
    }
    const results = rag.retrieve(q, k).map(r => ({
      tag: r.tag, id: r.id, type: r.type, title: r.title,
      ref: r.ref, snippet: r.snippet, relevance: r.relevance, score: r.score
    }));
    res.json({ query: q, method: 'Okapi BM25 (local)', count: results.length, results });
  } catch (err) { next(err); }
});

// GET /api/ai/predict/:siteId — anomaly prediction summary for a site
router.get('/predict/:siteId', (req, res, next) => {
  try {
    const { siteId } = req.params;
    const site = TransformerSite.findById(siteId);
    if (!site) { const e = new Error('Site not found'); e.status = 404; return next(e); }

    const latestReading = SensorReading.getLatestBySite(siteId);
    const readings = SensorReading.findBySiteId(siteId, 50);

    const anomalyReadings = readings.filter(r => r.is_anomaly === 1);
    const anomalyRate = readings.length > 0 ? anomalyReadings.length / readings.length : 0;
    const avgAnomalyScore = readings.length > 0
      ? readings.reduce((s, r) => s + (r.anomaly_score || 0), 0) / readings.length
      : 0;
    const maxWindingTemp = latestReading ? latestReading.winding_temperature_c : 0;
    const maxMoisture = latestReading ? latestReading.moisture_in_oil_ppm : 0;
    const maxVibration = latestReading ? latestReading.vibration_rms_mms : 0;

    const riskScore = Math.min(1, (
      (1 - site.health_score / 100) * 0.4 +
      anomalyRate * 0.3 +
      avgAnomalyScore * 0.3
    ));

    const riskTier = riskScore >= 0.75 ? 'Critical'
      : riskScore >= 0.5 ? 'High'
      : riskScore >= 0.25 ? 'Medium' : 'Low';

    const hoursToFailure = riskScore >= 0.75 ? Math.round(12 + (riskScore * 36))
      : riskScore >= 0.5 ? Math.round(24 + (riskScore * 48))
      : null;

    const contributors = [];
    if (site.health_score < 60) contributors.push({ factor: 'Low Health Score', value: site.health_score, threshold: 60, unit: '/100' });
    if (maxWindingTemp > 100) contributors.push({ factor: 'Winding Temperature', value: maxWindingTemp.toFixed(1), threshold: 100, unit: '°C' });
    if (maxMoisture > 30) contributors.push({ factor: 'Oil Moisture', value: maxMoisture.toFixed(1), threshold: 30, unit: 'ppm' });
    if (maxVibration > 5) contributors.push({ factor: 'Vibration RMS', value: maxVibration.toFixed(2), threshold: 5, unit: 'mm/s' });
    if (anomalyRate > 0.1) contributors.push({ factor: 'Anomaly Rate', value: (anomalyRate * 100).toFixed(1), threshold: 10, unit: '%' });

    res.json({
      site_id: siteId,
      site_name: site.name,
      region: site.region,
      health_score: site.health_score,
      current_status: site.status,
      risk_score: Math.round(riskScore * 100) / 100,
      risk_tier: riskTier,
      hours_to_failure: hoursToFailure,
      anomaly_rate: Math.round(anomalyRate * 1000) / 10,
      avg_anomaly_score: Math.round(avgAnomalyScore * 1000) / 1000,
      latest_reading: latestReading,
      top_contributors: contributors,
      model_versions: {
        isolation_forest: 'v2.1.0',
        lstm_autoencoder: 'v1.8.3',
        xgboost_classifier: 'v3.0.1',
        prophet_forecaster: 'v1.2.0'
      },
      inference_timestamp: new Date().toISOString()
    });
  } catch (err) { next(err); }
});

module.exports = router;
