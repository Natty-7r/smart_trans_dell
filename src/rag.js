'use strict';

/**
 * rag.js — Retrieval-Augmented Generation knowledge layer for the PRISM AI Command Console.
 *
 * Fully local, dependency-free retrieval:
 *   1. Builds a document corpus from the live operational database (sites, faults,
 *      alerts, maintenance, engineers) plus a curated telecom/power-engineering
 *      knowledge base (IEC 60076, ISO 55000, ECA, the ML ensemble, PRISM ROI).
 *   2. Indexes it with Okapi BM25 (classic lexical ranking) — no external service,
 *      no embeddings API, runs in-process alongside the local LLM (Ollama).
 *   3. retrieve(query, k) returns the top-k grounding passages with citation tags.
 *
 * Generation is handled by the local LLM in llm.js (Ollama-first, Anthropic fallback);
 * this module supplies the retrieved context that grounds every answer.
 */

const { getDb } = require('./database');

// ───────────────────────────────────────────────────────────────
// Tokenisation
// ───────────────────────────────────────────────────────────────
const STOPWORDS = new Set(
  ('a an the of to in on at for and or is are was were be been being with by from as this ' +
   'that these those it its into over under up down out about which who what when where how ' +
   'why not no do does did has have had will would can could should may might must than then ' +
   'there here your you our we they them their his her he she i me my us if but so such also ' +
   'per via any all each some more most only just very much many both')
    .split(/\s+/)
);

function tokenize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')          // keep decimals/numbers, drop punctuation & symbols
    .split(/\s+/)
    .map(t => t.replace(/^\.+|\.+$/g, '')) // trim stray dots
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

// ───────────────────────────────────────────────────────────────
// Curated knowledge base — authoritative reference documents
// ───────────────────────────────────────────────────────────────
const KNOWLEDGE_DOCS = [
  {
    id: 'KB-IEC60076-THERMAL',
    type: 'standard',
    title: 'IEC 60076-7 — Transformer Thermal Limits & Loading Guide',
    ref: 'IEC 60076-7',
    text: 'IEC 60076-7 defines the thermal loading model for oil-immersed power transformers. ' +
      'Top-oil temperature and winding hot-spot temperature govern insulation ageing. The winding ' +
      'hot-spot temperature limit under normal cyclic loading is 120°C, with 140°C as the absolute ' +
      'short-term emergency ceiling. Sustained winding temperature above 100°C accelerates paper ' +
      'insulation degradation and roughly halves insulation life for every 6-8°C of over-temperature. ' +
      'PRISM sensor thresholds for winding temperature are calibrated against this IEC 60076-7 thermal model, ' +
      'raising predictive alerts before the hot-spot trajectory reaches the 140°C limit.'
  },
  {
    id: 'KB-IEC60076-COND',
    type: 'standard',
    title: 'IEC 60076 — Insulation & Oil Condition Assessment',
    ref: 'IEC 60076',
    text: 'IEC 60076 covers transformer performance, insulation condition and dissolved-gas analysis (DGA). ' +
      'Key condition indicators monitored by PRISM: moisture-in-oil above 30 ppm indicates insulation ' +
      'wetting and elevated breakdown risk; oil level below 60% signals leakage; vibration RMS above 5 mm/s ' +
      'indicates core or winding looseness and harmonic onset. Insulation resistance above 5 GΩ and normal DGA ' +
      'signatures indicate healthy oil. These map to the fault types overheating, insulation breakdown and oil contamination.'
  },
  {
    id: 'KB-ISO55000',
    type: 'standard',
    title: 'ISO 55000 — Asset Management Lifecycle',
    ref: 'ISO 55000',
    text: 'ISO 55000 governs asset management lifecycle documentation, condition-based maintenance planning and ' +
      'risk-assessment audit trails. Every PRISM maintenance record carries an ISO 55000 compliance flag, a ' +
      'planned-versus-emergency classification, cost, parts replaced and findings, providing the auditable ' +
      'condition-based maintenance evidence required for enterprise infrastructure governance.'
  },
  {
    id: 'KB-ECA-1148',
    type: 'regulation',
    title: 'ECA Telecom Sector Reform Proclamation No. 1148/2019',
    ref: 'ECA Proclamation 1148/2019',
    text: 'The Ethiopian Communications Authority (ECA) sets network uptime and SLA reporting obligations under ' +
      'Telecom Sector Reform Proclamation No. 1148/2019. PRISM produces automated audit-trail exports that ' +
      'satisfy ECA uptime evidence requirements. On-premises Dell PowerEdge edge processing keeps operational ' +
      'telemetry in-country, aligning with Ethiopian data residency expectations; no customer PII traverses the system.'
  },
  {
    id: 'KB-EEUC',
    type: 'regulation',
    title: 'EEUC — HV Transformer Monitoring Standards',
    ref: 'EEUC',
    text: 'The Ethiopian Electric Utility Corporation (EEUC) defines high-voltage transformer monitoring, ' +
      'performance documentation and incident-reporting standards for licensed telecom infrastructure operators. ' +
      'PRISM maps sensor telemetry and fault events to EEUC HV monitoring requirements and flags ECA-reportable faults.'
  },
  {
    id: 'KB-AI-ENSEMBLE',
    type: 'ai-model',
    title: 'PRISM AI Model Ensemble',
    ref: 'ML Ensemble',
    text: 'PRISM runs a multi-stage machine-learning ensemble on Dell PowerEdge edge nodes. Isolation Forest ' +
      '(scikit-learn) performs multivariate point-anomaly detection across 12 simultaneous sensor channels. ' +
      'An LSTM Autoencoder (PyTorch) scores 24-hour sequence reconstruction error to catch temporal degradation ' +
      'patterns. An XGBoost classifier assigns four-tier severity risk scoring — Critical, High, Medium, Low. ' +
      'Prophet (Meta) forecasts 72-hour winding temperature and load factor for proactive scheduling. Feature ' +
      'engineering computes rolling statistics, rate-of-change, cross-sensor correlation and Fourier decomposition of vibration.'
  },
  {
    id: 'KB-ROI',
    type: 'business',
    title: 'PRISM Deployment ROI & Business Case',
    ref: 'ROI Model',
    text: 'PRISM delivers a projected 70% reduction in unplanned transformer failures and compresses MTTR from ' +
      '72 hours to under 30 minutes. Maintenance cost falls 25-30%. Five-year cumulative saving is $21.2M against ' +
      'a $1.8M deployment cost — a 58% cost reduction versus the $36.5M unmonitored baseline — with break-even in ' +
      '12-18 months. $9M in customer revenue is protected across 50,000+ at-risk subscribers at $36 ARPU. Transformer ' +
      'lifespan extends 20-30%, reducing $6K-$10K per-unit replacement exposure. Group synergy value across ' +
      'Vodacom/Vodafone OpCos exceeds $1M.'
  },
  {
    id: 'KB-EDGE-ARCH',
    type: 'architecture',
    title: 'Dell Edge-First Architecture',
    ref: 'Edge Architecture',
    text: 'Smart IoT sensor units per transformer capture primary/secondary voltage, phase and neutral current, ' +
      'winding and oil temperature, oil level and moisture, vibration and tap-changer position, transmitting via ' +
      'NB-IoT/4G over encrypted MQTT to Dell PowerEdge R760 edge inference nodes at regional aggregation hubs. ' +
      'Local scoring fires critical alerts in under 30 seconds independent of WAN availability — decisive where ' +
      'backhaul is unreliable. A Dell PowerEdge XE9680 with NVIDIA H100 GPUs handles nightly full-fleet model retraining.'
  },
  {
    id: 'KB-SENSOR-PARAMS',
    type: 'reference',
    title: 'Sensor Parameters & Alert Thresholds',
    ref: 'Sensor Reference',
    text: 'Monitored parameters and nominal ranges: primary voltage 210-240V, secondary voltage 220-240V, phase ' +
      'currents 0-200A, winding temperature 30-120°C (pre-failure spikes to 140°C), oil temperature 25-100°C, ' +
      'oil level 60-100%, moisture-in-oil 5-50 ppm, vibration RMS 0-10 mm/s, tap-changer position 1-17, load factor ' +
      '0-120%. Alert triggers: winding temperature over 100°C, oil moisture over 30 ppm, vibration RMS over 5 mm/s, ' +
      'anomaly rate over 10%, or health score below 60.'
  },
  {
    id: 'KB-FAULT-TYPES',
    type: 'reference',
    title: 'Fault Taxonomy & Root-Cause Blind Spot',
    ref: 'Fault Taxonomy',
    text: 'Fault types and their pre-PRISM distribution: overheating 18%, insulation breakdown 8%, oil contamination 4%, ' +
      'external short circuit, and unknown/undetected 70% — the critical blind spot that manual inspection cannot close. ' +
      '25KVA units carry a 14% fault rate versus 4% for 50KVA units. Before PRISM the average fault detection delay was ' +
      '72 hours; PRISM cuts this to well under an hour, converting unknown root causes into diagnosed, actionable alerts ' +
      'with 48-72 hour predictive lead time.'
  }
];

// ───────────────────────────────────────────────────────────────
// Corpus construction from the live database
// ───────────────────────────────────────────────────────────────
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function buildCorpus() {
  const docs = [];

  // Curated knowledge base
  for (const kb of KNOWLEDGE_DOCS) {
    docs.push({
      id: kb.id, type: kb.type, title: kb.title, ref: kb.ref,
      snippet: kb.text.slice(0, 220), text: kb.text
    });
  }

  const db = getDb();

  // Transformer sites
  try {
    const rows = db.prepare(
      `SELECT site_id, name, region, area, transformer_rating, status, health_score,
              subscribers_at_risk, replacement_cost_usd, manufacturer, anomaly_type,
              eca_asset_class, notes
         FROM transformer_sites`
    ).all();
    for (const s of rows) {
      const text =
        `Transformer site ${s.name} (${s.site_id}) in ${s.region}${s.area ? ', ' + s.area : ''}. ` +
        `Rating ${s.transformer_rating || 'n/a'}. Operational status: ${s.status}. Health score ${num(s.health_score)}/100. ` +
        `${num(s.subscribers_at_risk).toLocaleString()} subscribers at risk. Replacement value $${num(s.replacement_cost_usd).toLocaleString()}. ` +
        `Manufacturer ${s.manufacturer || 'n/a'}. ${s.anomaly_type ? 'Detected degradation pattern: ' + s.anomaly_type + '. ' : ''}` +
        `${s.eca_asset_class ? 'ECA asset class ' + s.eca_asset_class + '. ' : ''}${s.notes || ''}`;
      docs.push({
        id: s.site_id, type: 'site',
        title: `${s.name} — ${s.region} (health ${num(s.health_score)}/100)`,
        ref: s.site_id, snippet: text.slice(0, 220), text
      });
    }
  } catch (e) { console.warn('[RAG] site corpus:', e.message); }

  // Fault events
  try {
    const rows = db.prepare(
      `SELECT fault_id, site_name, region, fault_type, severity, transformer_rating,
              financial_impact_usd, detection_delay_hours, resolution_time_hours,
              subscribers_affected, era, description
         FROM fault_events`
    ).all();
    for (const f of rows) {
      const text =
        `Fault ${f.fault_id} at ${f.site_name} (${f.region}). Type: ${f.fault_type}, severity ${f.severity}, ` +
        `${f.transformer_rating || ''} unit. Financial impact $${num(f.financial_impact_usd).toLocaleString()}. ` +
        `Detection delay ${num(f.detection_delay_hours)}h, resolution ${num(f.resolution_time_hours)}h. ` +
        `${num(f.subscribers_affected).toLocaleString()} subscribers affected. Era: ${f.era}. ${f.description || ''}`;
      docs.push({
        id: f.fault_id, type: 'fault',
        title: `${f.fault_type} fault — ${f.site_name} (${f.severity})`,
        ref: f.fault_id, snippet: text.slice(0, 220), text
      });
    }
  } catch (e) { console.warn('[RAG] fault corpus:', e.message); }

  // Alert logs
  try {
    const rows = db.prepare(
      `SELECT alert_id, site_name, region, severity, alert_type, alert_message,
              ai_confidence, status, model_triggered, prediction_lead_hours, dispatch_latency_seconds
         FROM alert_logs`
    ).all();
    for (const a of rows) {
      const text =
        `Alert ${a.alert_id} at ${a.site_name} (${a.region}). Severity ${a.severity}, type ${a.alert_type}, status ${a.status}. ` +
        `${a.alert_message || ''} AI confidence ${Math.round(num(a.ai_confidence) * 100)}%, triggered by ${a.model_triggered || 'ensemble'}. ` +
        `Prediction lead ${num(a.prediction_lead_hours)}h, dispatch latency ${num(a.dispatch_latency_seconds)}s.`;
      docs.push({
        id: a.alert_id, type: 'alert',
        title: `${a.severity} alert — ${a.site_name} (${a.alert_type})`,
        ref: a.alert_id, snippet: text.slice(0, 220), text
      });
    }
  } catch (e) { console.warn('[RAG] alert corpus:', e.message); }

  // Maintenance records
  try {
    const rows = db.prepare(
      `SELECT record_id, site_name, region, engineer_name, classification, primary_task,
              parts_replaced, cost_usd, status, iso55000_compliant, findings
         FROM maintenance_records`
    ).all();
    for (const m of rows) {
      const text =
        `Maintenance ${m.record_id} at ${m.site_name} (${m.region}) by ${m.engineer_name || 'n/a'}. ` +
        `${m.classification} work: ${m.primary_task || ''}. Cost $${num(m.cost_usd).toLocaleString()}, status ${m.status}. ` +
        `${m.parts_replaced ? 'Parts: ' + m.parts_replaced + '. ' : ''}${m.iso55000_compliant ? 'ISO 55000 compliant. ' : ''}${m.findings || ''}`;
      docs.push({
        id: m.record_id, type: 'maintenance',
        title: `${m.classification} maintenance — ${m.site_name}`,
        ref: m.record_id, snippet: text.slice(0, 220), text
      });
    }
  } catch (e) { console.warn('[RAG] maintenance corpus:', e.message); }

  // Field engineers
  try {
    const rows = db.prepare(
      `SELECT engineer_id, full_name, region, specialization, certification_level,
              years_experience, total_resolutions, avg_response_time_minutes, on_call, prism_trained, bio
         FROM field_engineers`
    ).all();
    for (const e of rows) {
      const text =
        `Field engineer ${e.full_name} (${e.engineer_id}), ${e.region} region. ${e.certification_level || ''}. ` +
        `Specialisation: ${e.specialization || ''}. ${num(e.years_experience)} years experience, ${num(e.total_resolutions)} resolutions, ` +
        `avg response ${num(e.avg_response_time_minutes)} min. ${e.on_call ? 'Currently on-call. ' : ''}${e.prism_trained ? 'PRISM-certified. ' : ''}${e.bio || ''}`;
      docs.push({
        id: e.engineer_id, type: 'engineer',
        title: `${e.full_name} — ${e.region} (${e.certification_level || 'field engineer'})`,
        ref: e.engineer_id, snippet: text.slice(0, 220), text
      });
    }
  } catch (e) { console.warn('[RAG] engineer corpus:', e.message); }

  return docs;
}

// ───────────────────────────────────────────────────────────────
// BM25 index
// ───────────────────────────────────────────────────────────────
const K1 = 1.5;
const B = 0.75;

let _corpus = null;
let _index = null;

function buildIndex(docs) {
  const df = new Map();
  let totalLen = 0;
  for (const d of docs) {
    d.tokens = tokenize(d.title + ' ' + d.text);
    d.titleTokens = new Set(tokenize(d.title));
    d.tf = new Map();
    for (const tok of d.tokens) d.tf.set(tok, (d.tf.get(tok) || 0) + 1);
    d.len = d.tokens.length;
    totalLen += d.len;
    for (const tok of d.tf.keys()) df.set(tok, (df.get(tok) || 0) + 1);
  }
  return { df, avgdl: totalLen / Math.max(1, docs.length), N: docs.length };
}

function ensureIndex() {
  if (_corpus && _index) return;
  _corpus = buildCorpus();
  _index = buildIndex(_corpus);
  console.log(`[RAG] Indexed ${_corpus.length} documents (BM25, ${_index.df.size} unique terms).`);
}

function bm25(doc, qtokens) {
  let score = 0;
  for (const q of qtokens) {
    const n = _index.df.get(q);
    if (!n) continue;
    const f = doc.tf.get(q) || 0;
    if (!f) continue;
    const idf = Math.log(1 + (_index.N - n + 0.5) / (n + 0.5));
    score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (doc.len / _index.avgdl)));
    if (doc.titleTokens.has(q)) score += idf * 0.6; // title match boost
  }
  return score;
}

/**
 * retrieve — top-k grounding passages for a query, ranked by BM25.
 * Returns [{ tag, id, type, title, ref, snippet, text, score, relevance }].
 */
function retrieve(query, k = 6) {
  ensureIndex();
  const q = tokenize(query);
  if (!q.length) return [];
  const scored = [];
  for (const d of _corpus) {
    const s = bm25(d, q);
    if (s > 0) scored.push({ d, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, k);
  const max = top.length ? top[0].s : 1;
  return top.map((x, i) => ({
    tag: `S${i + 1}`,
    id: x.d.id,
    type: x.d.type,
    title: x.d.title,
    ref: x.d.ref,
    snippet: x.d.snippet,
    text: x.d.text,
    score: Math.round(x.s * 1000) / 1000,
    relevance: Math.max(1, Math.round((x.s / max) * 100))
  }));
}

/** Build the citation context block injected into the LLM system prompt. */
function buildContextBlock(results) {
  if (!results || !results.length) return '';
  return results
    .map(r => `[${r.tag}] (${r.type} · ${r.ref}) ${r.title}\n${r.text}`)
    .join('\n\n');
}

/** Corpus / index status for the /rag/status endpoint. */
function status() {
  ensureIndex();
  const byType = {};
  for (const d of _corpus) byType[d.type] = (byType[d.type] || 0) + 1;
  return {
    documents: _corpus.length,
    uniqueTerms: _index.df.size,
    avgDocLength: Math.round(_index.avgdl),
    byType,
    retrieval: 'Okapi BM25 (local, in-process)',
    generation: 'Local LLM — Ollama (Anthropic fallback)',
    embeddingsRequired: false
  };
}

module.exports = { retrieve, buildContextBlock, status, tokenize };
