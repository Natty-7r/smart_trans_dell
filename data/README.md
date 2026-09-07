# PRISM Synthetic Dataset — Safaricom Ethiopia Transformer Monitoring

## Overview

Six entity datasets covering a 21-month operational window (October 2024 – July 2026), with a PRISM system go-live boundary at **15 January 2026**. Data simulates pre- and post-deployment operating conditions to demonstrate measurable impact: detection delay dropping from 72 hours to under 30 minutes, fault resolution from 120 hours to under 4 hours.

All geographic coordinates are realistic Ethiopian locations (Addis Ababa + four regional corridors). All names are culturally appropriate Ethiopian/Amharic names. All sensor thresholds are calibrated against IEC 60076, IEC 60422, and ISO 55000 standards.

---

## Entities & Files

### `transformer_sites.json` — 100 records
Primary asset registry. One record per transformer-equipped network site.

| Field | Description |
|-------|-------------|
| `site_id` | Primary key — format `TF-NNNN` |
| `region` | One of: Addis Ababa, Tigray, Oromia, Amhara, SNNPR |
| `transformer_rating` | 25KVA (14% fault rate), 50KVA (4%), 100KVA (2%), 200KVA (2%) |
| `health_score` | 0–100 composite score (lower = more degraded) |
| `anomaly_type` | `none`, `thermal_degradation`, `oil_moisture_drift`, `vibration_harmonic`, `imminent_failure` |
| `status` | `operational` (≥70), `warning` (50–69), `degraded` (30–49), `critical` (<30) |
| `subscribers_at_risk` | Downstream subscribers served by this site |

**Anomaly injection** (per specification):
- 5 sites: `imminent_failure` (health score 12–32)
- 8 sites: `vibration_harmonic` (health score 34–54)
- 12 sites: `oil_moisture_drift` (health score 54–74)
- 35 sites: `thermal_degradation` (health score 46–68)
- 40 sites: `none` (health score 73–98)

---

### `field_engineers.json` — 100 records
Safaricom Ethiopia infrastructure technicians and engineers.

| Field | Description |
|-------|-------------|
| `engineer_id` | Primary key — format `ENG-NNN` |
| `specialization` | One of 8 domain specialisations (IEC 60076, DGA, OLTC, etc.) |
| `certification_level` | Level 1–5 correlated with years experience |
| `status` | `available`, `on_site`, `off_duty` |
| `total_resolutions` | Cumulative fault resolutions (12–290) |
| `avg_response_time_minutes` | Historical field response time |
| `certifications` | Array: IEC 60076, ISO 55000, ECA licence, NEBOSH, IEC 61850 |

---

### `sensor_readings.json` — 100 records
IoT telemetry sampled across the 7-day window preceding 14 July 2026. Readings are distributed across all 100 sites (cycling by index).

| Field | Description |
|-------|-------------|
| `reading_id` | Primary key — format `SR-NNNNNN` |
| `site_id` | FK → `transformer_sites.site_id` |
| `winding_temperature_c` | 45–88°C nominal; 108–142°C for `imminent_failure` sites |
| `moisture_in_oil_ppm` | 5–22 ppm nominal; 28–50 ppm for `oil_moisture_drift` |
| `vibration_rms_mms` | 0.4–3.2 mm/s nominal; 5.5–10.0 mm/s for `vibration_harmonic` |
| `anomaly_score` | 0–1 Isolation Forest / ensemble score |
| `is_anomaly` | Boolean — true when score > 0.68 on anomalous sites |
| `inference_latency_ms` | 6–28 ms (sub-30s end-to-end per spec) |
| `edge_node` | Dell PowerEdge edge node handling local inference |

---

### `fault_events.json` — 100 records
Historical and current fault records spanning both pre- and post-PRISM eras.

| Field | Description |
|-------|-------------|
| `fault_id` | Primary key — format `FLT-NNNNN` |
| `site_id` | FK → `transformer_sites.site_id` |
| `fault_type` | `unknown` (75%), `overheating` (12%), `insulation_breakdown` (10%), `oil_contamination` (3%) |
| `era` | `pre_prism` (before 15 Jan 2026) or `post_prism` |
| `detection_delay_hours` | Pre-PRISM: 18–96h; post-PRISM: 0.03–1.8h |
| `resolution_time_hours` | Pre-PRISM: 36–120h; post-PRISM: 0.25–3.5h |
| `financial_impact_usd` | Critical: $18K–$85K; High: $5.5K–$22K; Medium: $1.2K–$6.5K |
| `eca_reportable` | True for Critical severity or resolution >8 hours |

**Fault type distribution** matches specification: unknown 70%, overheating 18%, insulation 8%, oil contamination 4%.

---

### `maintenance_records.json` — 100 records
Planned and emergency maintenance work orders with cost, findings, and ISO 55000 compliance flags.

| Field | Description |
|-------|-------------|
| `record_id` | Primary key — format `MR-NNNNN` |
| `site_id` | FK → `transformer_sites.site_id` |
| `engineer_id` | FK → `field_engineers.engineer_id` |
| `classification` | `planned` (63%) or `emergency` (37%) |
| `cost_usd` | Planned: $200–$2,500; Emergency: $1,800–$8,000 |
| `primary_task` | One of 18 IEC/IEEE standard maintenance tasks |
| `iso55000_compliant` | True for all planned records |
| `findings` | Realistic technical findings text |
| `next_scheduled_date` | Planned: +180 days; Emergency follow-up: +30 days |

---

### `alert_logs.json` — 100 records
AI-generated alert events from the post-PRISM period (15 Jan 2026 – 14 Jul 2026).

| Field | Description |
|-------|-------------|
| `alert_id` | Primary key — format `ALT-NNNNN` |
| `site_id` | FK → `transformer_sites.site_id` |
| `assigned_engineer_id` | FK → `field_engineers.engineer_id` |
| `severity` | `Critical` (7%), `High` (24%), `Medium` (42%), `Low` (27%) |
| `dispatch_latency_seconds` | 6–28 seconds (sub-30s spec requirement) |
| `ai_confidence` | Critical: 0.88–0.99; Low: 0.42–0.68 |
| `prediction_lead_hours` | Hours before failure the alert was issued (Critical: 2–28h, High: 12–72h) |
| `model_triggered` | Which ML model fired the alert |
| `status` | `resolved`, `acknowledged`, `pending`, `escalated` |

---

## Entity Relationships

```
transformer_sites (1) ──< sensor_readings   (site_id)
transformer_sites (1) ──< fault_events      (site_id)
transformer_sites (1) ──< maintenance_records (site_id)
transformer_sites (1) ──< alert_logs        (site_id)
field_engineers   (1) ──< maintenance_records (engineer_id)
field_engineers   (1) ──< alert_logs        (assigned_engineer_id)
```

All foreign keys are validated — zero orphan references.

---

## Geographic Distribution

| Region | Sites | Notes |
|--------|-------|-------|
| Addis Ababa | ~45 | 9 sub-cities: Bole, Kirkos, Yeka, Lemi Kura, etc. |
| Oromia | ~20 | Jimma, Adama, Bishoftu, Nekemte corridor |
| Tigray | ~15 | Mekelle, Axum, Adigrat corridor |
| Amhara | ~12 | Bahir Dar, Gondar, Dessie corridor |
| SNNPR | ~8 | Hawassa, Arba Minch corridor |

---

## Regenerating Data

```bash
node data/generate.js   # recreates all JSON files
node data/seed.js       # drops and re-inserts into prism.db
```

The generator uses a fixed seed (`20260714`) for reproducibility. Change `_seed` to generate a different (but still consistent) dataset.

---

## Key Demo Narratives the Data Supports

1. **Before/after PRISM**: `era` field on `fault_events` shows detection delay collapsing from 72h → <2h post go-live
2. **Imminent failure sites**: 5 sites with `anomaly_type = imminent_failure` and `health_score < 32` for dramatic dashboard alerts
3. **Sub-30-second dispatch**: `dispatch_latency_seconds` in `alert_logs` always ≤28s, demonstrating Dell PowerEdge edge-first architecture
4. **Financial impact**: Cumulative `financial_impact_usd` across pre-PRISM faults supports the $2M annual cost narrative
5. **Unknown root causes**: 70% unknown fault type before PRISM mirrors the "70% undetected" blind-spot claim in the business case
