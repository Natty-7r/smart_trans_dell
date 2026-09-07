/**
 * Seed script — loads all JSON datasets into SQLite via better-sqlite3.
 * Called on server startup (or standalone: node data/seed.js).
 * CommonJS.
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'prism.db');

function loadJSON(filename) {
  const fp = path.join(__dirname, filename);
  if (!fs.existsSync(fp)) throw new Error(`Missing data file: ${fp}`);
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function seed(dbPath) {
  const db = new Database(dbPath || DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Schema ─────────────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS transformer_sites (
      site_id                TEXT PRIMARY KEY,
      name                   TEXT,
      region                 TEXT,
      area                   TEXT,
      latitude               REAL,
      longitude              REAL,
      address                TEXT,
      transformer_rating     TEXT,
      site_type              TEXT,
      connectivity           TEXT,
      manufacturer           TEXT,
      serial_number          TEXT,
      installation_date      TEXT,
      last_inspection_date   TEXT,
      status                 TEXT,
      health_score           INTEGER,
      anomaly_type           TEXT,
      fault_rate_baseline    REAL,
      active_sensors         INTEGER,
      ai_monitoring_enabled  INTEGER,
      last_alert_timestamp   TEXT,
      subscribers_at_risk    INTEGER,
      replacement_cost_usd   INTEGER,
      annual_energy_kwh      INTEGER,
      eca_asset_class        TEXT,
      notes                  TEXT
    );

    CREATE TABLE IF NOT EXISTS field_engineers (
      engineer_id                TEXT PRIMARY KEY,
      full_name                  TEXT,
      first_name                 TEXT,
      last_name                  TEXT,
      gender                     TEXT,
      email                      TEXT,
      phone                      TEXT,
      region                     TEXT,
      home_base                  TEXT,
      specialization             TEXT,
      certification_level        TEXT,
      certifications             TEXT,
      hire_date                  TEXT,
      years_experience           REAL,
      status                     TEXT,
      active_assignments         INTEGER,
      total_resolutions          INTEGER,
      avg_response_time_minutes  INTEGER,
      customer_satisfaction_score REAL,
      languages                  TEXT,
      vehicle                    TEXT,
      bio                        TEXT,
      on_call                    INTEGER,
      prism_trained              INTEGER
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      reading_id               TEXT PRIMARY KEY,
      site_id                  TEXT REFERENCES transformer_sites(site_id),
      timestamp                TEXT,
      primary_voltage_v        REAL,
      secondary_voltage_v      REAL,
      phase_a_current_a        REAL,
      phase_b_current_a        REAL,
      phase_c_current_a        REAL,
      neutral_current_a        REAL,
      winding_temperature_c    REAL,
      oil_temperature_c        REAL,
      ambient_temperature_c    REAL,
      oil_level_pct            REAL,
      moisture_in_oil_ppm      REAL,
      vibration_rms_mms        REAL,
      tap_changer_position     INTEGER,
      load_factor_pct          REAL,
      anomaly_score            REAL,
      is_anomaly               INTEGER,
      inference_model          TEXT,
      inference_latency_ms     INTEGER,
      edge_node                TEXT,
      signal_quality_pct       REAL
    );

    CREATE TABLE IF NOT EXISTS fault_events (
      fault_id               TEXT PRIMARY KEY,
      site_id                TEXT REFERENCES transformer_sites(site_id),
      site_name              TEXT,
      region                 TEXT,
      fault_type             TEXT,
      severity               TEXT,
      timestamp              TEXT,
      detection_method       TEXT,
      detection_delay_hours  REAL,
      resolution_time_hours  REAL,
      downtime_hours         REAL,
      transformer_rating     TEXT,
      financial_impact_usd   INTEGER,
      subscribers_affected   INTEGER,
      description            TEXT,
      root_cause_confirmed   INTEGER,
      era                    TEXT,
      parts_replaced         TEXT,
      work_order_id          TEXT,
      eca_reportable         INTEGER,
      iec60076_severity_code TEXT,
      resolved_at            TEXT
    );

    CREATE TABLE IF NOT EXISTS maintenance_records (
      record_id           TEXT PRIMARY KEY,
      site_id             TEXT REFERENCES transformer_sites(site_id),
      site_name           TEXT,
      region              TEXT,
      engineer_id         TEXT REFERENCES field_engineers(engineer_id),
      engineer_name       TEXT,
      classification      TEXT,
      maintenance_date    TEXT,
      cost_usd            INTEGER,
      primary_task        TEXT,
      parts_replaced      TEXT,
      duration_hours      REAL,
      status              TEXT,
      access_notes        TEXT,
      iso55000_compliant  INTEGER,
      work_order_id       TEXT,
      findings            TEXT,
      next_scheduled_date TEXT,
      approved_by         TEXT,
      eca_audit_trail     INTEGER
    );

    CREATE TABLE IF NOT EXISTS alert_logs (
      alert_id                  TEXT PRIMARY KEY,
      site_id                   TEXT REFERENCES transformer_sites(site_id),
      site_name                 TEXT,
      region                    TEXT,
      assigned_engineer_id      TEXT REFERENCES field_engineers(engineer_id),
      assigned_engineer_name    TEXT,
      severity                  TEXT,
      alert_type                TEXT,
      timestamp                 TEXT,
      acknowledged_at           TEXT,
      resolved_at               TEXT,
      alert_message             TEXT,
      ai_confidence             REAL,
      dispatch_latency_seconds  INTEGER,
      prediction_lead_hours     REAL,
      status                    TEXT,
      resolution_time_minutes   INTEGER,
      notification_channels     TEXT,
      model_triggered           TEXT,
      is_false_positive         INTEGER,
      acknowledged_by           TEXT,
      escalation_reason         TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sr_site    ON sensor_readings(site_id);
    CREATE INDEX IF NOT EXISTS idx_sr_ts      ON sensor_readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_fe_site    ON fault_events(site_id);
    CREATE INDEX IF NOT EXISTS idx_fe_era     ON fault_events(era);
    CREATE INDEX IF NOT EXISTS idx_fe_type    ON fault_events(fault_type);
    CREATE INDEX IF NOT EXISTS idx_mr_site    ON maintenance_records(site_id);
    CREATE INDEX IF NOT EXISTS idx_mr_class   ON maintenance_records(classification);
    CREATE INDEX IF NOT EXISTS idx_al_site    ON alert_logs(site_id);
    CREATE INDEX IF NOT EXISTS idx_al_sev     ON alert_logs(severity);
    CREATE INDEX IF NOT EXISTS idx_al_status  ON alert_logs(status);
    CREATE INDEX IF NOT EXISTS idx_ts_region  ON transformer_sites(region);
    CREATE INDEX IF NOT EXISTS idx_ts_status  ON transformer_sites(status);
  `);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function upsertAll(table, rows, buildParams) {
    const stmt = db.prepare(buildParams(rows[0]));
    const insertMany = db.transaction(data => { for (const row of data) stmt.run(row); });
    insertMany(rows.map(r => flattenRow(r)));
  }

  function flattenRow(r) {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      if (Array.isArray(v)) out[k] = JSON.stringify(v);
      else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
      else out[k] = v;
    }
    return out;
  }

  function buildInsert(table, sample) {
    const cols = Object.keys(sample);
    const placeholders = cols.map(c => `@${c}`).join(', ');
    return `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  }

  // ── Load & insert ──────────────────────────────────────────────────────────
  const tables = [
    { file: 'transformer_sites.json',   table: 'transformer_sites'   },
    { file: 'field_engineers.json',     table: 'field_engineers'      },
    { file: 'sensor_readings.json',     table: 'sensor_readings'      },
    { file: 'fault_events.json',        table: 'fault_events'         },
    { file: 'maintenance_records.json', table: 'maintenance_records'  },
    { file: 'alert_logs.json',          table: 'alert_logs'           },
  ];

  for (const { file, table } of tables) {
    const rows = loadJSON(file);
    if (!rows.length) continue;

    // Build insert from first row's keys, then bulk-insert
    const flat = rows.map(r => flattenRow(r));
    const cols = Object.keys(flat[0]);
    const ph   = cols.map(c => `@${c}`).join(', ');
    const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${ph})`);
    const run  = db.transaction(data => { for (const row of data) stmt.run(row); });
    run(flat);
    console.log(`  ✅  Seeded ${table.padEnd(24)} ${rows.length} rows`);
  }

  db.close();
  return DB_PATH;
}

// ── Run standalone ─────────────────────────────────────────────────────────────
if (require.main === module) {
  console.log('\n🌱 PRISM Database Seeder — Safaricom Ethiopia\n');
  try {
    seed();
    console.log('\n✨ Database ready:', DB_PATH, '\n');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

module.exports = { seed, DB_PATH };
