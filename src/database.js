const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB file is overridable (TT_DATABASE_FILE) so tests / alternate deployments
// can use an isolated database without touching the seeded prism.db.
const DB_PATH = process.env.TT_DATABASE_FILE || path.join(__dirname, '..', 'prism.db');
const DATA_DIR = path.join(__dirname, '..', 'data');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS transformer_sites (
      site_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      area TEXT,
      latitude REAL,
      longitude REAL,
      address TEXT,
      transformer_rating TEXT,
      site_type TEXT,
      connectivity TEXT,
      manufacturer TEXT,
      serial_number TEXT,
      installation_date TEXT,
      last_inspection_date TEXT,
      status TEXT DEFAULT 'healthy',
      health_score INTEGER DEFAULT 100,
      anomaly_type TEXT,
      fault_rate_baseline REAL DEFAULT 0,
      active_sensors INTEGER DEFAULT 0,
      ai_monitoring_enabled INTEGER DEFAULT 1,
      last_alert_timestamp TEXT,
      subscribers_at_risk INTEGER DEFAULT 0,
      replacement_cost_usd INTEGER DEFAULT 0,
      annual_energy_kwh INTEGER DEFAULT 0,
      eca_asset_class TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sites_status ON transformer_sites(status);
    CREATE INDEX IF NOT EXISTS idx_sites_region ON transformer_sites(region);
    CREATE INDEX IF NOT EXISTS idx_sites_rating ON transformer_sites(transformer_rating);
    CREATE INDEX IF NOT EXISTS idx_sites_health ON transformer_sites(health_score);
    CREATE INDEX IF NOT EXISTS idx_sites_name ON transformer_sites(name);
    CREATE INDEX IF NOT EXISTS idx_sites_status_region ON transformer_sites(status, region);

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reading_id TEXT UNIQUE NOT NULL,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      timestamp TEXT NOT NULL,
      primary_voltage_v REAL,
      secondary_voltage_v REAL,
      phase_a_current_a REAL,
      phase_b_current_a REAL,
      phase_c_current_a REAL,
      neutral_current_a REAL,
      winding_temperature_c REAL,
      oil_temperature_c REAL,
      ambient_temperature_c REAL,
      oil_level_pct REAL,
      moisture_in_oil_ppm REAL,
      vibration_rms_mms REAL,
      tap_changer_position INTEGER,
      load_factor_pct REAL,
      anomaly_score REAL DEFAULT 0,
      is_anomaly INTEGER DEFAULT 0,
      inference_model TEXT,
      inference_latency_ms INTEGER,
      edge_node TEXT,
      signal_quality_pct REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_readings_site ON sensor_readings(site_id);
    CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON sensor_readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_readings_anomaly ON sensor_readings(is_anomaly);
    CREATE INDEX IF NOT EXISTS idx_readings_site_ts ON sensor_readings(site_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_readings_anomaly_score ON sensor_readings(anomaly_score);

    CREATE TABLE IF NOT EXISTS fault_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fault_id TEXT UNIQUE NOT NULL,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      site_name TEXT,
      region TEXT,
      fault_type TEXT,
      severity TEXT,
      timestamp TEXT NOT NULL,
      detection_method TEXT,
      detection_delay_hours REAL,
      resolution_time_hours REAL,
      downtime_hours REAL,
      transformer_rating TEXT,
      financial_impact_usd REAL DEFAULT 0,
      subscribers_affected INTEGER DEFAULT 0,
      description TEXT,
      root_cause_confirmed INTEGER DEFAULT 0,
      era TEXT,
      parts_replaced TEXT,
      work_order_id TEXT,
      eca_reportable INTEGER DEFAULT 0,
      iec60076_severity_code TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_faults_site ON fault_events(site_id);
    CREATE INDEX IF NOT EXISTS idx_faults_timestamp ON fault_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_faults_severity ON fault_events(severity);
    CREATE INDEX IF NOT EXISTS idx_faults_type ON fault_events(fault_type);
    CREATE INDEX IF NOT EXISTS idx_faults_era ON fault_events(era);
    CREATE INDEX IF NOT EXISTS idx_faults_severity_era ON fault_events(severity, era);
    CREATE INDEX IF NOT EXISTS idx_faults_region ON fault_events(region);

    CREATE TABLE IF NOT EXISTS maintenance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT UNIQUE NOT NULL,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      site_name TEXT,
      region TEXT,
      engineer_id TEXT,
      engineer_name TEXT,
      classification TEXT,
      maintenance_date TEXT,
      cost_usd REAL DEFAULT 0,
      primary_task TEXT,
      parts_replaced TEXT,
      duration_hours REAL,
      status TEXT DEFAULT 'completed',
      access_notes TEXT,
      iso55000_compliant INTEGER DEFAULT 0,
      work_order_id TEXT,
      findings TEXT,
      next_scheduled_date TEXT,
      approved_by TEXT,
      eca_audit_trail INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_maint_site ON maintenance_records(site_id);
    CREATE INDEX IF NOT EXISTS idx_maint_date ON maintenance_records(maintenance_date);
    CREATE INDEX IF NOT EXISTS idx_maint_class ON maintenance_records(classification);
    CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_records(status);
    CREATE INDEX IF NOT EXISTS idx_maint_engineer ON maintenance_records(engineer_id);
    CREATE INDEX IF NOT EXISTS idx_maint_region ON maintenance_records(region);
    CREATE INDEX IF NOT EXISTS idx_maint_class_date ON maintenance_records(classification, maintenance_date);

    CREATE TABLE IF NOT EXISTS alert_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT UNIQUE NOT NULL,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      site_name TEXT,
      region TEXT,
      assigned_engineer_id TEXT,
      assigned_engineer_name TEXT,
      severity TEXT,
      alert_type TEXT,
      timestamp TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      alert_message TEXT,
      ai_confidence REAL,
      dispatch_latency_seconds INTEGER,
      prediction_lead_hours REAL,
      status TEXT DEFAULT 'active',
      resolution_time_minutes REAL,
      notification_channels TEXT,
      model_triggered TEXT,
      is_false_positive INTEGER DEFAULT 0,
      acknowledged_by TEXT,
      escalation_reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_site ON alert_logs(site_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alert_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alert_logs(severity);
    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alert_logs(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON alert_logs(alert_type);
    CREATE INDEX IF NOT EXISTS idx_alerts_engineer ON alert_logs(assigned_engineer_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_severity_status ON alert_logs(severity, status);
    CREATE INDEX IF NOT EXISTS idx_alerts_region ON alert_logs(region);

    CREATE TABLE IF NOT EXISTS field_engineers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      engineer_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      gender TEXT,
      email TEXT,
      phone TEXT,
      region TEXT,
      home_base TEXT,
      specialization TEXT,
      certification_level TEXT,
      certifications TEXT,
      hire_date TEXT,
      years_experience REAL DEFAULT 0,
      status TEXT DEFAULT 'available',
      active_assignments INTEGER DEFAULT 0,
      total_resolutions INTEGER DEFAULT 0,
      avg_response_time_minutes INTEGER DEFAULT 0,
      customer_satisfaction_score REAL DEFAULT 0,
      languages TEXT,
      vehicle TEXT,
      bio TEXT,
      on_call INTEGER DEFAULT 0,
      prism_trained INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_engineers_status ON field_engineers(status);
    CREATE INDEX IF NOT EXISTS idx_engineers_region ON field_engineers(region);
    CREATE INDEX IF NOT EXISTS idx_engineers_name ON field_engineers(full_name);
    CREATE INDEX IF NOT EXISTS idx_engineers_oncall ON field_engineers(on_call);
    CREATE INDEX IF NOT EXISTS idx_engineers_specialization ON field_engineers(specialization);

    CREATE TABLE IF NOT EXISTS inspection_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id TEXT UNIQUE NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT,
      region TEXT,
      health_score INTEGER,
      risk_tier TEXT,
      priority TEXT DEFAULT 'Routine',
      status TEXT DEFAULT 'scheduled',
      scheduled_by TEXT,
      scheduled_at TEXT DEFAULT (datetime('now')),
      due_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inspections_site ON inspection_logs(site_id);
    CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspection_logs(status);
    CREATE INDEX IF NOT EXISTS idx_inspections_region ON inspection_logs(region);
    CREATE INDEX IF NOT EXISTS idx_inspections_scheduled ON inspection_logs(scheduled_at);
  `);
}

function loadJson(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${filename}:`, e.message);
    return [];
  }
}

function seedDatabase(database) {
  const siteCount = database.prepare('SELECT COUNT(*) as c FROM transformer_sites').get().c;
  if (siteCount > 0) return;

  console.log('Seeding database from JSON files...');

  const insertSite = database.prepare(`
    INSERT OR IGNORE INTO transformer_sites
    (site_id, name, region, area, latitude, longitude, address, transformer_rating,
     site_type, connectivity, manufacturer, serial_number, installation_date,
     last_inspection_date, status, health_score, anomaly_type, fault_rate_baseline,
     active_sensors, ai_monitoring_enabled, last_alert_timestamp, subscribers_at_risk,
     replacement_cost_usd, annual_energy_kwh, eca_asset_class, notes)
    VALUES
    (@site_id, @name, @region, @area, @latitude, @longitude, @address, @transformer_rating,
     @site_type, @connectivity, @manufacturer, @serial_number, @installation_date,
     @last_inspection_date, @status, @health_score, @anomaly_type, @fault_rate_baseline,
     @active_sensors, @ai_monitoring_enabled, @last_alert_timestamp, @subscribers_at_risk,
     @replacement_cost_usd, @annual_energy_kwh, @eca_asset_class, @notes)
  `);

  const insertReading = database.prepare(`
    INSERT OR IGNORE INTO sensor_readings
    (reading_id, site_id, timestamp, primary_voltage_v, secondary_voltage_v,
     phase_a_current_a, phase_b_current_a, phase_c_current_a, neutral_current_a,
     winding_temperature_c, oil_temperature_c, ambient_temperature_c, oil_level_pct,
     moisture_in_oil_ppm, vibration_rms_mms, tap_changer_position, load_factor_pct,
     anomaly_score, is_anomaly, inference_model, inference_latency_ms, edge_node, signal_quality_pct)
    VALUES
    (@reading_id, @site_id, @timestamp, @primary_voltage_v, @secondary_voltage_v,
     @phase_a_current_a, @phase_b_current_a, @phase_c_current_a, @neutral_current_a,
     @winding_temperature_c, @oil_temperature_c, @ambient_temperature_c, @oil_level_pct,
     @moisture_in_oil_ppm, @vibration_rms_mms, @tap_changer_position, @load_factor_pct,
     @anomaly_score, @is_anomaly, @inference_model, @inference_latency_ms, @edge_node, @signal_quality_pct)
  `);

  const insertFault = database.prepare(`
    INSERT OR IGNORE INTO fault_events
    (fault_id, site_id, site_name, region, fault_type, severity, timestamp,
     detection_method, detection_delay_hours, resolution_time_hours, downtime_hours,
     transformer_rating, financial_impact_usd, subscribers_affected, description,
     root_cause_confirmed, era, parts_replaced, work_order_id, eca_reportable,
     iec60076_severity_code, resolved_at)
    VALUES
    (@fault_id, @site_id, @site_name, @region, @fault_type, @severity, @timestamp,
     @detection_method, @detection_delay_hours, @resolution_time_hours, @downtime_hours,
     @transformer_rating, @financial_impact_usd, @subscribers_affected, @description,
     @root_cause_confirmed, @era, @parts_replaced, @work_order_id, @eca_reportable,
     @iec60076_severity_code, @resolved_at)
  `);

  const insertMaint = database.prepare(`
    INSERT OR IGNORE INTO maintenance_records
    (record_id, site_id, site_name, region, engineer_id, engineer_name, classification,
     maintenance_date, cost_usd, primary_task, parts_replaced, duration_hours, status,
     access_notes, iso55000_compliant, work_order_id, findings, next_scheduled_date,
     approved_by, eca_audit_trail)
    VALUES
    (@record_id, @site_id, @site_name, @region, @engineer_id, @engineer_name, @classification,
     @maintenance_date, @cost_usd, @primary_task, @parts_replaced, @duration_hours, @status,
     @access_notes, @iso55000_compliant, @work_order_id, @findings, @next_scheduled_date,
     @approved_by, @eca_audit_trail)
  `);

  const insertAlert = database.prepare(`
    INSERT OR IGNORE INTO alert_logs
    (alert_id, site_id, site_name, region, assigned_engineer_id, assigned_engineer_name,
     severity, alert_type, timestamp, acknowledged_at, resolved_at, alert_message,
     ai_confidence, dispatch_latency_seconds, prediction_lead_hours, status,
     resolution_time_minutes, notification_channels, model_triggered, is_false_positive,
     acknowledged_by, escalation_reason)
    VALUES
    (@alert_id, @site_id, @site_name, @region, @assigned_engineer_id, @assigned_engineer_name,
     @severity, @alert_type, @timestamp, @acknowledged_at, @resolved_at, @alert_message,
     @ai_confidence, @dispatch_latency_seconds, @prediction_lead_hours, @status,
     @resolution_time_minutes, @notification_channels, @model_triggered, @is_false_positive,
     @acknowledged_by, @escalation_reason)
  `);

  const insertEngineer = database.prepare(`
    INSERT OR IGNORE INTO field_engineers
    (engineer_id, full_name, first_name, last_name, gender, email, phone, region,
     home_base, specialization, certification_level, certifications, hire_date,
     years_experience, status, active_assignments, total_resolutions,
     avg_response_time_minutes, customer_satisfaction_score, languages, vehicle, bio,
     on_call, prism_trained)
    VALUES
    (@engineer_id, @full_name, @first_name, @last_name, @gender, @email, @phone, @region,
     @home_base, @specialization, @certification_level, @certifications, @hire_date,
     @years_experience, @status, @active_assignments, @total_resolutions,
     @avg_response_time_minutes, @customer_satisfaction_score, @languages, @vehicle, @bio,
     @on_call, @prism_trained)
  `);

  const seedAll = database.transaction(() => {
    const sites = loadJson('transformer_sites.json');
    for (const s of sites) {
      insertSite.run({
        ...s,
        ai_monitoring_enabled: s.ai_monitoring_enabled ? 1 : 0
      });
    }
    console.log(`  transformer_sites: ${sites.length} records`);

    const readings = loadJson('sensor_readings.json');
    for (const r of readings) {
      insertReading.run({
        ...r,
        is_anomaly: r.is_anomaly ? 1 : 0
      });
    }
    console.log(`  sensor_readings: ${readings.length} records`);

    const faults = loadJson('fault_events.json');
    for (const f of faults) {
      insertFault.run({
        ...f,
        root_cause_confirmed: f.root_cause_confirmed ? 1 : 0,
        eca_reportable: f.eca_reportable ? 1 : 0
      });
    }
    console.log(`  fault_events: ${faults.length} records`);

    const maints = loadJson('maintenance_records.json');
    for (const m of maints) {
      insertMaint.run({
        ...m,
        parts_replaced: m.parts_replaced || null,
        iso55000_compliant: m.iso55000_compliant ? 1 : 0,
        eca_audit_trail: m.eca_audit_trail ? 1 : 0
      });
    }
    console.log(`  maintenance_records: ${maints.length} records`);

    const alerts = loadJson('alert_logs.json');
    for (const a of alerts) {
      insertAlert.run({
        ...a,
        notification_channels: Array.isArray(a.notification_channels)
          ? JSON.stringify(a.notification_channels)
          : a.notification_channels,
        is_false_positive: a.is_false_positive ? 1 : 0,
        prediction_lead_hours: a.prediction_lead_hours || null,
        resolution_time_minutes: a.resolution_time_minutes || null,
        escalation_reason: a.escalation_reason || null
      });
    }
    console.log(`  alert_logs: ${alerts.length} records`);

    const engineers = loadJson('field_engineers.json');
    for (const e of engineers) {
      insertEngineer.run({
        ...e,
        certifications: Array.isArray(e.certifications) ? JSON.stringify(e.certifications) : e.certifications,
        languages: Array.isArray(e.languages) ? JSON.stringify(e.languages) : e.languages,
        on_call: e.on_call ? 1 : 0,
        prism_trained: e.prism_trained ? 1 : 0
      });
    }
    console.log(`  field_engineers: ${engineers.length} records`);
  });

  seedAll();
  console.log('Database seeding complete.');
}

function init() {
  const database = getDb();
  createSchema(database);
  seedDatabase(database);

  // Additive enhancements (auth/RBAC, groups, schedules, health params, RAG docs).
  // Required lazily so this module has no load-order dependency on them.
  const { extendSchema } = require('./db-extend');
  const { seedPlatform } = require('./seed-extend');
  extendSchema(database);
  seedPlatform(database);

  return database;
}

module.exports = { getDb, init, seedDatabase };
