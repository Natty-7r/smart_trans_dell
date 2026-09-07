/**
 * Synthetic data generator for PRISM — Safaricom Ethiopia Transformer Predictive Failure Prevention
 * Generates 100 records per entity with sector-authentic Ethiopian telecom data.
 * CommonJS — run with: node data/generate.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Deterministic pseudo-random (reproducible dataset) ─────────────────────
let _seed = 20260714;
function rand() {
  _seed ^= _seed << 13;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5;
  return ((_seed >>> 0) / 0xFFFFFFFF);
}
function randInt(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function randFloat(min, max, dp = 2) { return parseFloat((rand() * (max - min) + min).toFixed(dp)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
function pickWeighted(arr, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Date utilities ──────────────────────────────────────────────────────────
const NOW = new Date('2026-07-14T10:00:00Z');
const PRISM_GO_LIVE = new Date('2026-01-15T00:00:00Z');
const DATA_START = new Date('2024-10-01T00:00:00Z');

function randDate(start, end) {
  return new Date(start.getTime() + rand() * (end.getTime() - start.getTime()));
}
function addHours(d, h) { return new Date(d.getTime() + h * 3_600_000); }
function addDays(d, n)  { return new Date(d.getTime() + n * 86_400_000); }
function datStr(d)      { return d.toISOString().split('T')[0]; }
function pad(n, w = 4)  { return String(n).padStart(w, '0'); }

// ─── Name corpus — culturally appropriate Ethiopian names ────────────────────
const FIRST_M = [
  'Abebe','Kebede','Tadesse','Girma','Bekele','Haile','Tesfaye','Mulugeta','Alemu',
  'Mekonnen','Getachew','Yohannes','Solomon','Daniel','Samuel','Dawit','Bereket',
  'Biniam','Eyob','Elias','Henok','Natnael','Robel','Tsegaye','Wondwossen',
  'Zerihun','Amanuel','Fisseha','Kassa','Girmay','Tekle','Mussie','Yonas',
  'Biruk','Mekdes','Surafel','Hailemichael','Tewodros','Ermias','Brhane'
];
const FIRST_F = [
  'Tigist','Meron','Hiwot','Selamawit','Almaz','Bethlehem','Birhan','Azezefit',
  'Mahlet','Rahel','Sara','Selam','Frehiwot','Genet','Hana','Liya','Mariam',
  'Netsanet','Rediet','Yeshi','Azeb','Blen','Eden','Fikirte','Kalkidan',
  'Lula','Meseret','Nigist','Senait','Tsion'
];
const LAST_N = [
  'Abebe','Gebre','Haile','Teferi','Bekele','Wolde','Desta','Alemu','Tadesse',
  'Mekonnen','Girma','Lemma','Tesfaye','Mulugeta','Yimer','Bogale','Seifu',
  'Nigatu','Woldemariam','Assefa','Berhane','Demeke','Eshetu','Fekadu','Gizaw',
  'Habte','Ketema','Lakew','Mamo','Negash','Regassa','Shiferaw','Tilahun',
  'Urgessa','Wako','Yalew','Zeleke','Amare','Dagne','Getu'
];

function makeName(gender) {
  const first = pick(gender === 'F' ? FIRST_F : FIRST_M);
  const last  = pick(LAST_N);
  return { first, last, full: `${first} ${last}`, gender };
}

// ─── Geography ───────────────────────────────────────────────────────────────
const REGIONS = [
  { name: 'Addis Ababa', latR: [8.85, 9.20], lonR: [38.65, 38.90], w: 45 },
  { name: 'Tigray',      latR: [13.20, 14.10], lonR: [39.20, 40.00], w: 15 },
  { name: 'Oromia',      latR: [7.30, 8.50],  lonR: [36.50, 38.00], w: 20 },
  { name: 'Amhara',      latR: [11.20, 12.20], lonR: [37.00, 38.00], w: 12 },
  { name: 'SNNPR',       latR: [6.80, 7.40],  lonR: [38.20, 39.00], w: 8  },
];

const AREAS = {
  'Addis Ababa': ['Bole','Kirkos','Arada','Lideta','Yeka','Kolfe Keranio','Nifas Silk-Lafto',
                  'Akaki Kality','Gulele','Addis Ketema','Lemi Kura','Bole Sub-City','Bole Bulbula',
                  'Sar Bet','CMC','Ayat','Kara Kore','Kotebe','Ferensay Legasion'],
  'Tigray':      ['Mekelle','Axum','Adwa','Shire','Wukro','Adigrat','Humera','Maychew','Alamata'],
  'Oromia':      ['Jimma','Adama','Nekemte','Shashemene','Bishoftu','Assela','Ambo','Gimbi','Robe'],
  'Amhara':      ['Bahir Dar','Gondar','Dessie','Debre Birhan','Debre Markos','Debre Tabor','Weldiya'],
  'SNNPR':       ['Hawassa','Arba Minch','Wolaita Sodo','Dilla','Yirgalem','Bonga','Jinka'],
};

function regionArea(rname) { return pick(AREAS[rname] || ['Unknown']); }
function pickRegion() { return pickWeighted(REGIONS, REGIONS.map(r => r.w)); }

// ─── Domain constants ─────────────────────────────────────────────────────────
const RATINGS  = ['25KVA','50KVA','100KVA','200KVA'];
const RAT_W    = [35, 40, 18, 7];
const SITE_TYPES = [
  'Urban BTS','Suburban BTS','Rural BTS','Aggregation Hub',
  'Microwave Link Site','Distribution Node','NOC Feeder Point'
];
const MAKERS = ['ABB','Siemens','Eaton','Schneider Electric','Hyundai Electric','TBEA','Wilson Transformer'];
const CONNECTIVITY = ['NB-IoT','4G LTE','NB-IoT/4G Dual-Mode'];
const CONN_W = [28, 42, 30];
const EDGE_NODES = ['EDGE-AAB-01','EDGE-AAB-02','EDGE-TGR-01','EDGE-ORM-01','EDGE-AMH-01','EDGE-SNN-01'];

const ANOMALY_TYPES = ['none','thermal_degradation','oil_moisture_drift','vibration_harmonic','imminent_failure'];

// Build anomaly pool matching spec: 5 imminent, 8 vibration, 12 moisture, 35 thermal, rest none
function buildAnomalyPool(n) {
  const pool = [
    ...Array(5).fill('imminent_failure'),
    ...Array(8).fill('vibration_harmonic'),
    ...Array(12).fill('oil_moisture_drift'),
    ...Array(35).fill('thermal_degradation'),
    ...Array(Math.max(0, n - 60)).fill('none'),
  ];
  return shuffle(pool).slice(0, n);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. TransformerSite (100 records) ────────────────────────────────────────
function genSites(n = 100) {
  const anomalyPool = buildAnomalyPool(n);
  const sites = [];

  for (let i = 0; i < n; i++) {
    const region = pickRegion();
    const area   = regionArea(region.name);
    const lat    = randFloat(region.latR[0], region.latR[1], 6);
    const lon    = randFloat(region.lonR[0], region.lonR[1], 6);
    const rating = pickWeighted(RATINGS, RAT_W);
    const atype  = anomalyPool[i];

    let healthScore;
    if      (atype === 'imminent_failure')   healthScore = randInt(12, 32);
    else if (atype === 'vibration_harmonic') healthScore = randInt(34, 54);
    else if (atype === 'thermal_degradation')healthScore = randInt(46, 68);
    else if (atype === 'oil_moisture_drift') healthScore = randInt(54, 74);
    else                                      healthScore = randInt(73, 98);

    const status = healthScore < 30 ? 'critical'
                 : healthScore < 50 ? 'degraded'
                 : healthScore < 70 ? 'warning'
                 : 'operational';

    const ratingKVA      = parseInt(rating);
    const baseFaultRate  = ratingKVA === 25 ? 0.14 : ratingKVA === 50 ? 0.04 : 0.02;
    const installDate    = randDate(new Date('2018-01-01'), new Date('2024-06-01'));
    const lastInspection = randDate(new Date('2026-01-01'), new Date('2026-06-30'));
    const siteType       = pick(SITE_TYPES);

    const siteNotes = {
      imminent_failure:    `CRITICAL: Multiple sensor channels exceeding IEC 60076-7 emergency limits. Winding temp spike trajectory confirmed by LSTM autoencoder. Emergency dispatch active. ${area} site serves key Safaricom BTS cluster.`,
      thermal_degradation: `Gradual winding temperature elevation (+0.8°C/day) tracked over 30 days. LSTM reconstruction error trending upward. Scheduled intervention recommended within 7 days per IEC 60076-7 thermal model guidance.`,
      oil_moisture_drift:  `Moisture-in-oil readings at ${randInt(26, 44)} ppm, above IEC 60422 caution threshold of 25 ppm. Possible conservator seal degradation. Oil sampling dispatched to CESI laboratory, Addis Ababa.`,
      vibration_harmonic:  `Vibration RMS at ${randFloat(5.5, 8.5, 1)} mm/s with harmonic onset pattern at 100 Hz. Isolation Forest flagging multivariate anomaly. OLTC mechanism tap changer inspection pending within 72 hours.`,
      none:                `Nominal operating parameters. All channels within IEC 60076 specification. Next ISO 55000 lifecycle maintenance scheduled per approved asset management plan.`,
    };

    sites.push({
      site_id:                  `TF-${pad(i + 1)}`,
      name:                     `${area} ${siteType} ${pad(i + 1, 3)}`,
      region:                   region.name,
      area,
      latitude:                 lat,
      longitude:                lon,
      address:                  `${area}, ${region.name}, Ethiopia`,
      transformer_rating:       rating,
      site_type:                siteType,
      connectivity:             pickWeighted(CONNECTIVITY, CONN_W),
      manufacturer:             pick(MAKERS),
      serial_number:            `SN-${randInt(100000, 999999)}`,
      installation_date:        datStr(installDate),
      last_inspection_date:     datStr(lastInspection),
      status,
      health_score:             healthScore,
      anomaly_type:             atype,
      fault_rate_baseline:      baseFaultRate,
      active_sensors:           randInt(8, 12),
      ai_monitoring_enabled:    true,
      last_alert_timestamp:     atype !== 'none' ? randDate(new Date('2026-06-01'), NOW).toISOString() : null,
      subscribers_at_risk:      atype !== 'none' ? randInt(50, 8000) : 0,
      replacement_cost_usd:     ratingKVA === 25 ? 6000 : ratingKVA === 50 ? 8500 : ratingKVA === 100 ? 14000 : 25000,
      annual_energy_kwh:        randInt(80000, 650000),
      eca_asset_class:          ratingKVA <= 50 ? 'Class B' : 'Class A',
      notes:                    siteNotes[atype] || siteNotes.none,
    });
  }
  return sites;
}

// ─── 2. SensorReading (100 records, recent 7-day window) ─────────────────────
function genSensorReadings(sites, n = 100) {
  const readings = [];
  const windowMs = 7 * 24 * 3_600_000;

  for (let i = 0; i < n; i++) {
    const site   = sites[i % sites.length];
    const atype  = site.anomaly_type;
    const ts     = new Date(NOW.getTime() - rand() * windowMs);
    const isAnom = atype !== 'none' && rand() < 0.38;

    const ambient = randFloat(18, 36, 1);

    let windingTemp, oilTemp;
    if (atype === 'imminent_failure') {
      windingTemp = randFloat(108, 142, 1);
      oilTemp     = randFloat(82, 108, 1);
    } else if (isAnom && atype === 'thermal_degradation') {
      windingTemp = randFloat(88, 115, 1);
      oilTemp     = randFloat(68, 88, 1);
    } else {
      windingTemp = randFloat(48, 88, 1);
      oilTemp     = randFloat(38, 68, 1);
    }

    const ratingKVA = parseInt(site.transformer_rating);
    const loadFactor = randFloat(30, isAnom ? 112 : 92, 1);
    const maxA       = ratingKVA * 4;
    const baseI      = (loadFactor / 100) * maxA;

    const moistureInOil = (isAnom && atype === 'oil_moisture_drift')
      ? randFloat(28, 50, 1)
      : randFloat(5, 22, 1);

    const vibrationRMS = (isAnom && atype === 'vibration_harmonic')
      ? randFloat(5.5, 10.0, 2)
      : atype === 'imminent_failure'
        ? randFloat(3.8, 7.5, 2)
        : randFloat(0.4, 3.2, 2);

    const anomalyScore = isAnom
      ? randFloat(0.68, 0.99, 3)
      : randFloat(0.02, 0.32, 3);

    readings.push({
      reading_id:          `SR-${pad(i + 1, 6)}`,
      site_id:             site.site_id,
      timestamp:           ts.toISOString(),
      primary_voltage_v:   randFloat(210, 240, 1),
      secondary_voltage_v: randFloat(218, 240, 1),
      phase_a_current_a:   randFloat(Math.max(0, baseI * 0.88), baseI * 1.12, 1),
      phase_b_current_a:   randFloat(Math.max(0, baseI * 0.85), baseI * 1.08, 1),
      phase_c_current_a:   randFloat(Math.max(0, baseI * 0.86), baseI * 1.10, 1),
      neutral_current_a:   randFloat(0, isAnom ? 18 : 8, 1),
      winding_temperature_c: windingTemp,
      oil_temperature_c:   oilTemp,
      ambient_temperature_c: ambient,
      oil_level_pct:       (isAnom && atype === 'imminent_failure') ? randFloat(60, 72, 1) : randFloat(82, 98, 1),
      moisture_in_oil_ppm: moistureInOil,
      vibration_rms_mms:   vibrationRMS,
      tap_changer_position: randInt(1, 17),
      load_factor_pct:     loadFactor,
      anomaly_score:       anomalyScore,
      is_anomaly:          isAnom,
      inference_model:     pick(['isolation_forest','lstm_autoencoder','xgboost_ensemble','multi_model']),
      inference_latency_ms: randInt(6, 28),
      edge_node:           pick(EDGE_NODES),
      signal_quality_pct:  randFloat(88, 100, 1),
    });
  }
  return readings;
}

// ─── 3. FaultEvent (100 records) ──────────────────────────────────────────────
const FAULT_TYPES = ['overheating','insulation_breakdown','oil_contamination','unknown'];
const FAULT_W     = [18, 8, 4, 70];

const FAULT_DESC = {
  overheating: [
    'Winding temperature exceeded 120°C IEC 60076-7 thermal limit for 4+ hours. Buchholz relay operated. Emergency load shedding activated.',
    'Thermal runaway on primary winding. Oil temperature at 101°C. PRISM LSTM autoencoder issued 52-hour advance warning. Controlled shutdown executed.',
    'Sustained overload at 134% rated capacity causing thermal stress accumulation. Protective relay tripped. Cooling fan found seized on inspection.',
    'Hot spot temperature modelled at 148°C using IEC 60076-7 method. Winding insulation degradation confirmed by DGA. Transformer withdrawn from service.',
  ],
  insulation_breakdown: [
    'Dissolved gas analysis confirms insulation paper pyrolysis: CO at 3,400 ppm, C2H2 at 840 ppm. Rogers ratio analysis: thermal fault >700°C. HV winding replaced.',
    'Partial discharge activity detected via high-frequency CT. Insulation resistance fallen to 380 MΩ at 5kV — below EEUC minimum 500 MΩ threshold.',
    'Turn-to-turn short on HV winding confirmed on teardown. Cumulative thermal exposure estimated at 35% accelerated ageing beyond rated lifecycle.',
    'Resonance overvoltage event during switching caused inter-turn insulation puncture. Bushing flashover scar identified. Full rewinding required.',
  ],
  oil_contamination: [
    'Oil dielectric strength 22 kV — below IEC 60422 minimum 30 kV threshold. Water ingress through cracked conservator gasket confirmed. Full oil replacement.',
    'Moisture content at 46 ppm exceeding IEC 60422 limit. Furan analysis indicates Type 1 paper degradation stage. Prioritised for accelerated replacement.',
    'Oxidation inhibitor depletion and sludge formation confirmed. Acid number at 0.15 mg KOH/g — above disposal threshold. Oil fully replaced with Nynas Nytro Taurus.',
  ],
  unknown: [
    'Buchholz relay trip with no corresponding thermal or electrical anomaly found on post-fault inspection. Pre-PRISM blind spot. Root cause unresolved.',
    'Spontaneous protection relay operation. Post-fault testing within all specification limits. Root cause: undetermined. Monitoring frequency increased.',
    'Intermittent voltage instability leading to protection trip. No physical damage or sensor anomaly detected prior to event. Classified as unknown — 70% pool.',
    'Off-schedule outage with no preceding SCADA alert. Manual inspection clear. Pre-PRISM detection gap exposed. Classified as unknown root cause.',
    'Circuit breaker operated unexpectedly. Fault recorder trace inconclusive. No physical damage found. This type represents 70% of pre-PRISM fault events.',
    'Trip on differential relay. Through-fault energy calculated at 1.4 kA²s — within specification. Source: external grid event or ferroresonance suspected.',
  ],
};

function genFaultEvents(sites, n = 100) {
  const faults = [];
  const SEVERITIES   = ['Critical','High','Medium','Low'];
  const SEVERITY_W   = [15, 25, 35, 25];
  const DET_METHODS  = { pre: ['manual_inspection','operator_report','customer_complaint','Ethio Telecom NOC alert'],
                          post: ['sensor_threshold_breach','ai_prediction_lstm','ai_prediction_xgboost','isolation_forest_alert','ensemble_alert'] };

  for (let i = 0; i < n; i++) {
    const site      = sites[i % sites.length];
    const fType     = pickWeighted(FAULT_TYPES, FAULT_W);
    const severity  = pickWeighted(SEVERITIES, SEVERITY_W);
    const ts        = randDate(DATA_START, NOW);
    const isPrePrism= ts < PRISM_GO_LIVE;

    const detectDelay  = isPrePrism ? randFloat(18, 96, 1) : randFloat(0.03, 1.8, 2);
    const resolutionH  = isPrePrism ? randFloat(36, 120, 1) : randFloat(0.25, 3.5, 1);
    const downtime     = resolutionH * randFloat(0.65, 0.90, 2);

    const impact = severity === 'Critical' ? randInt(18000, 85000)
                 : severity === 'High'     ? randInt(5500, 22000)
                 : severity === 'Medium'   ? randInt(1200, 6500)
                 : randInt(250, 1800);

    const partsMap = {
      overheating:         pick(['Buchholz relay','thermometer probe','cooling fan motor','winding assembly','radiator valve']),
      insulation_breakdown:pick(['HV winding assembly','LV bushing','insulation paper rewind','nitrogen pressure gauge']),
      oil_contamination:   pick(['transformer oil (IEC 60296 grade)','conservator gasket set','silica gel breather','oil filter assembly']),
      unknown:             'No parts replaced — root cause unconfirmed',
    };

    faults.push({
      fault_id:                  `FLT-${pad(i + 1, 5)}`,
      site_id:                   site.site_id,
      site_name:                 site.name,
      region:                    site.region,
      fault_type:                fType,
      severity,
      timestamp:                 ts.toISOString(),
      detection_method:          isPrePrism ? pick(DET_METHODS.pre) : pick(DET_METHODS.post),
      detection_delay_hours:     detectDelay,
      resolution_time_hours:     resolutionH,
      downtime_hours:            parseFloat(downtime.toFixed(2)),
      transformer_rating:        site.transformer_rating,
      financial_impact_usd:      impact,
      subscribers_affected:      randInt(15, 6000),
      description:               pick(FAULT_DESC[fType] || FAULT_DESC.unknown),
      root_cause_confirmed:      fType !== 'unknown',
      era:                       isPrePrism ? 'pre_prism' : 'post_prism',
      parts_replaced:            partsMap[fType],
      work_order_id:             `WO-${randInt(10000, 99999)}`,
      eca_reportable:            severity === 'Critical' || resolutionH > 8,
      iec60076_severity_code:    severity === 'Critical' ? 'E3' : severity === 'High' ? 'E2' : severity === 'Medium' ? 'E1' : 'W1',
      resolved_at:               addHours(ts, resolutionH).toISOString(),
    });
  }
  return faults;
}

// ─── 4. MaintenanceRecord (100 records) ──────────────────────────────────────
const MAINT_TASKS = [
  'Oil sampling and dissolved gas analysis (DGA) — IEC 60599',
  'Winding resistance measurement (CPC 100 bridge)',
  'Turns ratio measurement (TTR) at all tap positions',
  'Insulation resistance — 1-min and 10-min PI test at 5kV',
  'Oil dielectric strength test per IEC 60156',
  'Buchholz relay functional test and gas extraction',
  'Cooling system inspection and fan performance verification',
  'Conservator, silica gel breather, and oil preservation system check',
  'Tap changer contact resistance measurement (OLTC)',
  'Thermal image scan (IEC 60076-7 thermal model)',
  'Protective relay calibration and coordination test',
  'Earthing system continuity and resistance measurement (IEC 60364)',
  'OLTC drive mechanism and motor drive inspection',
  'Bushing insulation power factor and capacitance test',
  'Oil top-up, degassing, and moisture removal (zeolite)',
  'Cable termination, gland, and cable box inspection',
  'Load tap changer oil filter replacement',
  'Pressure relief device functional test',
];

const PARTS_LIST = [
  'Transformer oil — Nynas Nytro Taurus 60L',
  'Silica gel breather cartridge (standard 3 kg)',
  'Buchholz relay (Qualitrol 900-series)',
  'Cooling fan motor (150W 3-phase)',
  'Conservator gasket set (EPDM)',
  'HV bushing 66 kV (ABB type PBU)',
  'LV bushing 11 kV (Siemens type)',
  'OLTC contact set (ABB UNISTAR)',
  'Winding thermometer (Qualitrol 118-TF)',
  'Pressure relief device (Qualitrol 208)',
  'Cable termination kit (Raychem 36kV)',
  'Oil filter element (Pall HC9800)',
  'Moisture-in-oil sensor (Vaisala MMP8)',
  'Vibration accelerometer (PCB Piezotronics)',
  'Nitrogen cylinder (industrial grade, 50L)',
];

const ACCESS_NOTES = [
  'Site access via Safaricom NOC gate — 24h advance notice required. Guard on duty 06:00–22:00.',
  'Muddy access road in rainy season (Jun–Sep) — 4WD vehicle and spare tyre mandatory.',
  'Within EEUC substation compound. EEUC permit form EEU-M-22 required, 48h lead time. Hard hat and arc flash PPE mandatory.',
  'Rooftop equipment — access key at NOC Addis Ababa. Lift to Floor 8, then ladder. Fall arrest harness required.',
  'Rural site — 2.5h drive from Addis Ababa. Overnight stay may be required. Fuel at petrol station 4km east.',
  'High-security compound — biometric badge. Contact Regional Security Manager Dawit Lemma (+251911XXXXXX) 24h prior.',
  'No mains power for tools — bring portable generator and 20L petrol. Generator available at Oromia regional hub.',
  'Near Addis Ring Road — heavy traffic 07:00–09:00 and 17:00–20:00. Plan site arrival before 06:30 for morning work.',
  'Shared compound with EthioTelecom. Safaricom engineer must wear company ID at all times. Log entry with compound security.',
  'Market days (Mon/Thu) cause road congestion in Merkato area — add 45 min to travel estimate.',
];

const APPROVED_BY = [
  'Hassan Mohammed — NOC Infrastructure Manager',
  'Tigist Lemma — Head of Network Operations',
  'Solomon Bekele — Regional Director, Addis Ababa',
  'Meron Assefa — Asset Lifecycle Manager',
  'Yohannes Girma — VP Network Engineering',
  'Selam Teferi — Compliance and ECA Liaison',
];

function genMaintenanceRecords(sites, engineers, n = 100) {
  const records = [];

  for (let i = 0; i < n; i++) {
    const site    = sites[i % sites.length];
    const eng     = engineers[i % engineers.length];
    const classif = pickWeighted(['planned','emergency'], [63, 37]);
    const dt      = randDate(DATA_START, NOW);
    const cost    = classif === 'emergency' ? randInt(1800, 8000) : randInt(200, 2500);
    const task    = pick(MAINT_TASKS);
    const hasPart = rand() < 0.58;
    const durationH = classif === 'emergency' ? randFloat(2, 9, 1) : randFloat(1, 4.5, 1);
    const status  = dt > new Date('2026-06-20')
                  ? pick(['in_progress','scheduled'])
                  : 'completed';

    const findingsPlanned = [
      'All parameters within IEC 60076 specification. Insulation resistance >5 GΩ. Oil DGA normal. Cleared for continued service.',
      `Oil dielectric strength ${randInt(48, 72)} kV (min threshold 40 kV). Moisture ${randInt(8, 18)} ppm. No action required.`,
      'Minor oil seep at conservator gasket flange. Gasket replacement raised as PM work order for next scheduled window.',
      `Tap changer position ${randInt(8, 12)} showing contact resistance elevation (${randInt(20, 26)} mΩ vs ${randInt(16, 19)} mΩ baseline). Monitor at next cycle.`,
      'Thermal scan clear — all connection points within 5°C of ambient baseline. Earthing continuity 0.08 Ω confirmed.',
    ];
    const findingsEmergency = [
      `Winding temperature at ${randInt(118, 138)}°C on arrival. Cooling fan seized. Fan replaced, oil refreshed. Unit returned to service in ${randInt(4, 7)} hours.`,
      `Oil moisture at ${randInt(38, 48)} ppm confirmed. Full oil drain and replacement with Nynas Nytro Taurus completed. Dried under vacuum for 3 hours.`,
      `Tap changer contact erosion at ${randInt(42, 65)}% wear. Contact set replaced. OLTC drive tested across all 17 positions. Unit cleared for service.`,
      'Buchholz relay gas accumulation — genuine internal fault. DGA sample dispatched to CESI Ethiopia laboratory. Unit isolated pending results.',
      'HV bushing surface flashover scar identified. Cleaned with IPA, re-treated with Syl-Off silicone compound. Insulation test passed at 5 kV.',
    ];

    records.push({
      record_id:          `MR-${pad(i + 1, 5)}`,
      site_id:            site.site_id,
      site_name:          site.name,
      region:             site.region,
      engineer_id:        eng.engineer_id,
      engineer_name:      eng.full_name,
      classification:     classif,
      maintenance_date:   datStr(dt),
      cost_usd:           cost,
      primary_task:       task,
      parts_replaced:     hasPart ? pick(PARTS_LIST) : null,
      duration_hours:     durationH,
      status,
      access_notes:       pick(ACCESS_NOTES),
      iso55000_compliant: classif === 'planned',
      work_order_id:      `WO-${randInt(10000, 99999)}`,
      findings:           pick(classif === 'emergency' ? findingsEmergency : findingsPlanned),
      next_scheduled_date: datStr(addDays(dt, classif === 'emergency' ? 30 : 180)),
      approved_by:        pick(APPROVED_BY),
      eca_audit_trail:    true,
    });
  }
  return records;
}

// ─── 5. AlertLog (100 records) ────────────────────────────────────────────────
const ALERT_MSGS = {
  Critical: [
    'CRITICAL: Winding temperature 139°C — IEC 60076-7 emergency threshold exceeded. Immediate shutdown authorised.',
    'CRITICAL: Buchholz relay gas accumulation confirmed — possible internal arc fault. Emergency dispatch NOW.',
    'CRITICAL: XGBoost risk score 0.97 — multi-parameter anomaly ensemble. Predicted failure within 4–6 hours.',
    'CRITICAL: Oil level at 61% — conservator breach suspected. Site de-energisation recommended immediately.',
    'CRITICAL: Phase A current imbalance 28% + winding temp 132°C + vibration 8.4 mm/s — imminent failure signature.',
  ],
  High: [
    'HIGH: Winding temperature trending +9°C/hr. LSTM reconstruction error 0.86. Physical inspection within 24 hours required.',
    'HIGH: Moisture-in-oil at 40 ppm — IEC 60422 Level 3 caution threshold exceeded. Oil sampling and DGA required.',
    'HIGH: Vibration RMS 7.4 mm/s — harmonic signature at 100 Hz. OLTC tap changer mechanism inspection required within 48 hours.',
    'HIGH: Load factor at 112% sustained 3 hours. Thermal stress accumulation risk. Load redistribution to adjacent feeder recommended.',
    'HIGH: Anomaly score 0.82 on Isolation Forest — multivariate point anomaly across 6 of 12 sensor channels.',
  ],
  Medium: [
    'MEDIUM: Oil temperature 14°C above seasonal baseline. Cooling fan degradation suspected. Inspection at next available window.',
    'MEDIUM: Phase B current imbalance 8.5% (threshold 3%). Unbalanced load on LV distribution network suspected.',
    'MEDIUM: Tap changer sticking at position 14. OLTC drive motor showing elevated current draw. Inspect within 7 days.',
    'MEDIUM: Neutral current elevated at 19A — single-phase loading imbalance. Customer load investigation recommended.',
    'MEDIUM: Oil moisture trending upward from 12 ppm to 22 ppm over 14 days. Rate-of-change flag triggered by Prophet model.',
  ],
  Low: [
    'LOW: Ambient temperature 39°C — monitoring for thermal cascade effect. Telemetry frequency increased to 15s intervals.',
    'LOW: Oil level at 83% — minor decrease from baseline. Visual inspection recommended at next planned maintenance visit.',
    'LOW: Vibration RMS at 3.9 mm/s — approaching harmonic onset threshold. Baseline vibration measurement recommended.',
    'LOW: Load factor at 94% during peak hour (18:00–20:00). Within specification but approaching thermal threshold. NOC awareness flagged.',
    'LOW: Winding temperature 5°C above 30-day rolling mean. Possibly weather-related. Monitor for sustained elevation pattern.',
  ],
};

const ALERT_TYPES = ['thermal_anomaly','oil_degradation','vibration_anomaly','voltage_deviation','load_overload','multi_parameter_anomaly','moisture_drift'];
const MODELS = ['isolation_forest','lstm_autoencoder','xgboost_classifier','prophet_forecast','ensemble_multi_model'];

function genAlertLogs(sites, engineers, n = 100) {
  const alerts = [];
  const SEVS   = ['Critical','High','Medium','Low'];
  const SEV_W  = [10, 20, 40, 30];
  const NOTIF  = [['push','sms'],['push','email'],['push','sms','email'],['push'],['push','email','noc_dashboard']];

  for (let i = 0; i < n; i++) {
    const site   = sites[i % sites.length];
    const eng    = engineers[randInt(0, engineers.length - 1)];
    const sev    = pickWeighted(SEVS, SEV_W);
    const ts     = randDate(PRISM_GO_LIVE, NOW);

    const ackOffsetMin = sev === 'Critical' ? randFloat(1, 8, 1) : randFloat(3, 25, 1);
    const resMinutes   = sev === 'Critical' ? randInt(8, 55)
                       : sev === 'High'     ? randInt(20, 140)
                       : sev === 'Medium'   ? randInt(45, 520)
                       : randInt(80, 1800);

    const acknowledgedAt = addHours(ts, ackOffsetMin / 60);
    const resolvedAt     = addHours(ts, resMinutes / 60);

    const STATUS_OPTS = sev === 'Critical' ? ['resolved','escalated']
                      : sev === 'High'     ? ['resolved','acknowledged','escalated']
                      : ['resolved','acknowledged','pending'];
    const STATUS_W    = sev === 'Critical' ? [78, 22] : sev === 'High' ? [68, 22, 10] : [58, 32, 10];
    const status = pickWeighted(STATUS_OPTS, STATUS_W);

    const dispatchSec     = randInt(6, 28);
    const aiConfidence    = sev === 'Critical' ? randFloat(0.88, 0.99, 3)
                           : sev === 'High'     ? randFloat(0.72, 0.92, 3)
                           : sev === 'Medium'   ? randFloat(0.55, 0.80, 3)
                           : randFloat(0.42, 0.68, 3);
    const predLeadHours   = sev === 'Critical' ? randFloat(2, 28, 1)
                           : sev === 'High'     ? randFloat(12, 72, 1)
                           : null;

    alerts.push({
      alert_id:                    `ALT-${pad(i + 1, 5)}`,
      site_id:                     site.site_id,
      site_name:                   site.name,
      region:                      site.region,
      assigned_engineer_id:        eng.engineer_id,
      assigned_engineer_name:      eng.full_name,
      severity:                    sev,
      alert_type:                  pick(ALERT_TYPES),
      timestamp:                   ts.toISOString(),
      acknowledged_at:             status !== 'pending' ? acknowledgedAt.toISOString() : null,
      resolved_at:                 status === 'resolved' ? resolvedAt.toISOString() : null,
      alert_message:               pick(ALERT_MSGS[sev]),
      ai_confidence:               aiConfidence,
      dispatch_latency_seconds:    dispatchSec,
      prediction_lead_hours:       predLeadHours,
      status,
      resolution_time_minutes:     status === 'resolved' ? resMinutes : null,
      notification_channels:       pick(NOTIF),
      model_triggered:             pick(MODELS),
      is_false_positive:           rand() < 0.04,
      acknowledged_by:             status !== 'pending' ? eng.full_name : null,
      escalation_reason:           status === 'escalated' ? 'No acknowledgement within SLA window — auto-escalated to Regional Director' : null,
    });
  }
  return alerts;
}

// ─── 6. FieldEngineer (100 records) ──────────────────────────────────────────
const SPECIALIZATIONS = [
  'High Voltage Transformer Maintenance (IEC 60076)',
  'OLTC and Tap Changer Mechanism Specialist',
  'Oil Analysis, DGA and Condition Assessment (IEC 60599)',
  'Protection, Control and SCADA Systems',
  'Power Electronics and UPS Systems',
  'Civil, Site Infrastructure and Grounding',
  'Telemetry, IoT and Edge Computing Systems',
  'Electrical Safety, ECA Compliance and Auditing',
];

const CERT_LEVELS = [
  'Level 1 — Field Technician',
  'Level 2 — Senior Technician',
  'Level 3 — Electrical Engineer',
  'Level 4 — Senior Engineer (Chartered)',
  'Level 5 — Principal Engineer / Subject Matter Expert',
];

const VEHICLES = [
  'Toyota Land Cruiser 200 Series (4WD)',
  'Toyota Hilux GD6 4WD Double Cab',
  'Mitsubishi L200 Triton 4WD',
  'Isuzu D-Max 4WD',
  'Nissan Patrol GR Y61 4WD',
];

function genEngineers(n = 100) {
  const engineers = [];
  const regionNames = REGIONS.map(r => r.name);

  for (let i = 0; i < n; i++) {
    const gender = rand() < 0.28 ? 'F' : 'M';
    const name   = makeName(gender);
    const region = regionNames[i % regionNames.length];
    const hireDate = randDate(new Date('2019-01-01'), new Date('2026-01-01'));
    const yearsExp = parseFloat(((NOW - hireDate) / (365.25 * 86400 * 1000)).toFixed(1));
    const spec   = SPECIALIZATIONS[i % SPECIALIZATIONS.length];

    const cert = yearsExp > 5
      ? pick(['Level 3 — Electrical Engineer','Level 4 — Senior Engineer (Chartered)','Level 5 — Principal Engineer / Subject Matter Expert'])
      : yearsExp > 2
        ? pick(['Level 2 — Senior Technician','Level 3 — Electrical Engineer'])
        : 'Level 1 — Field Technician';

    const totalRes  = randInt(12, 290);
    const avgRespMin= randInt(10, 48);
    const csat      = randFloat(3.8, 5.0, 1);
    const status    = pickWeighted(['available','on_site','off_duty'], [55, 30, 15]);

    const certs = ['IEC 60076 Transformer Maintenance Certification'];
    if (yearsExp > 2)  certs.push('ISO 55000 Asset Management Practitioner');
    if (yearsExp > 4)  certs.push('ECA Licensed Electrical Engineer (Ethiopia)');
    if (rand() < 0.4)  certs.push('NEBOSH International Certificate in H&S');
    if (rand() < 0.25) certs.push('IEC 61850 Substation Automation Specialist');

    const langs = ['Amharic', 'English'];
    if (rand() < 0.32) langs.push('Oromiffa');
    if (rand() < 0.18) langs.push('Tigrinya');
    if (rand() < 0.08) langs.push('Somali');

    engineers.push({
      engineer_id:               `ENG-${pad(i + 1, 3)}`,
      full_name:                 name.full,
      first_name:                name.first,
      last_name:                 name.last,
      gender:                    name.gender,
      email:                     `${name.first.toLowerCase()}.${name.last.toLowerCase()}@safaricom.et`,
      phone:                     `+251${pick(['911','912','913','914','921','922'])}${randInt(100000, 999999)}`,
      region,
      home_base:                 regionArea(region),
      specialization:            spec,
      certification_level:       cert,
      certifications:            certs,
      hire_date:                 datStr(hireDate),
      years_experience:          yearsExp,
      status,
      active_assignments:        status === 'on_site' ? randInt(1, 3) : 0,
      total_resolutions:         totalRes,
      avg_response_time_minutes: avgRespMin,
      customer_satisfaction_score: csat,
      languages:                 langs,
      vehicle:                   pick(VEHICLES),
      bio:                       `${cert} specialising in ${spec}. ${Math.floor(yearsExp)} years with Safaricom Ethiopia infrastructure division. ${totalRes} confirmed transformer fault resolutions. Average field response time ${avgRespMin} minutes.`,
      on_call:                   rand() < 0.45,
      prism_trained:             yearsExp > 0.5,
    });
  }
  return engineers;
}

// ─── Write helpers ────────────────────────────────────────────────────────────
function writeJSON(filename, data) {
  const fp = path.join(__dirname, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✅  ${filename.padEnd(32)} ${data.length} records`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log('\n🔄 PRISM Synthetic Data Generator — Safaricom Ethiopia Transformer Monitoring\n');

// Realistic fleet volumes (not a flat 100 each): a 100-transformer estate
// monitored by a right-sized field team, with high-frequency edge telemetry and
// a plausible funnel of alerts → faults, plus routine maintenance history.
const sites        = genSites(100);
const engineers    = genEngineers(28);
const sensorReadings   = genSensorReadings(sites, 6000);
const faultEvents      = genFaultEvents(sites, 240);
const maintenanceRecords = genMaintenanceRecords(sites, engineers, 520);
const alertLogs        = genAlertLogs(sites, engineers, 680);

writeJSON('transformer_sites.json',   sites);
writeJSON('field_engineers.json',     engineers);
writeJSON('sensor_readings.json',     sensorReadings);
writeJSON('fault_events.json',        faultEvents);
writeJSON('maintenance_records.json', maintenanceRecords);
writeJSON('alert_logs.json',          alertLogs);

// ─── Summary ──────────────────────────────────────────────────────────────────
const critSites   = sites.filter(s => s.status === 'critical').length;
const anomSites   = sites.filter(s => s.anomaly_type !== 'none').length;
const critAlerts  = alertLogs.filter(a => a.severity === 'Critical').length;
const emergMaint  = maintenanceRecords.filter(m => m.classification === 'emergency').length;
const prePrismF   = faultEvents.filter(f => f.era === 'pre_prism').length;
const postPrismF  = faultEvents.filter(f => f.era === 'post_prism').length;

console.log('\n📊 Dataset Summary');
console.log(`   Sites          : ${sites.length} total | ${critSites} critical | ${anomSites} with active anomalies`);
console.log(`   Sensor Readings: ${sensorReadings.length}`);
console.log(`   Fault Events   : ${faultEvents.length} | pre-PRISM ${prePrismF} | post-PRISM ${postPrismF}`);
console.log(`   Maintenance    : ${maintenanceRecords.length} | ${emergMaint} emergency`);
console.log(`   Alert Logs     : ${alertLogs.length} | ${critAlerts} Critical severity`);
console.log(`   Engineers      : ${engineers.length}`);
console.log('\n✨ Generation complete — ready for seed.js\n');
