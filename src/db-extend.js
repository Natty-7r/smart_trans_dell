'use strict';

/**
 * db-extend.js — additive schema for the production-readiness enhancements.
 *
 * Everything here is idempotent (CREATE TABLE IF NOT EXISTS + guarded ADD COLUMN)
 * so it runs safely against a fresh DB *and* an already-seeded one (the remote
 * container ships with the original 7 tables already populated). Keeping the new
 * schema in its own module leaves the original database.js untouched.
 */

/** Add a column only if it doesn't already exist (SQLite has no ADD COLUMN IF NOT EXISTS). */
function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function extendSchema(db) {
  db.exec(`
    -- ── E1: Authentication & RBAC ──────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      full_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'field_technician',   -- admin | regional_manager | field_technician
      region TEXT,                                      -- home region (for regional_manager scoping)
      engineer_id TEXT,                                 -- optional link to field_engineers
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',            -- active | inactive
      last_login TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_region ON users(region);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- ── E2: Site allocation (user ↔ site many-to-many) ─────────
    CREATE TABLE IF NOT EXISTS user_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(user_id),
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      allocated_by TEXT,
      allocated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, site_id)
    );
    CREATE INDEX IF NOT EXISTS idx_usersites_user ON user_sites(user_id);
    CREATE INDEX IF NOT EXISTS idx_usersites_site ON user_sites(site_id);

    -- ── E3: Regional collaboration groups ──────────────────────
    CREATE TABLE IF NOT EXISTS collab_groups (
      group_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      scope_type TEXT NOT NULL DEFAULT 'region',        -- region | site
      scope_value TEXT NOT NULL,                         -- region name or site_id
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_groups_scope ON collab_groups(scope_type, scope_value);

    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL REFERENCES collab_groups(group_id),
      user_id TEXT NOT NULL REFERENCES users(user_id),
      role_in_group TEXT DEFAULT 'member',              -- owner | member
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gmembers_group ON group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_gmembers_user ON group_members(user_id);

    CREATE TABLE IF NOT EXISTS group_messages (
      message_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES collab_groups(group_id),
      parent_id TEXT,                                    -- threading: null = root message
      user_id TEXT NOT NULL,
      author_name TEXT,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gmsg_group ON group_messages(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_gmsg_parent ON group_messages(parent_id);

    CREATE TABLE IF NOT EXISTS group_files (
      file_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES collab_groups(group_id),
      user_id TEXT,
      uploader_name TEXT,
      filename TEXT NOT NULL,                            -- stored filename
      original_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      path TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gfiles_group ON group_files(group_id);

    CREATE TABLE IF NOT EXISTS escalations (
      escalation_id TEXT PRIMARY KEY,
      group_id TEXT REFERENCES collab_groups(group_id),
      site_id TEXT,
      alert_id TEXT,
      fault_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium',                    -- low | medium | high | critical
      status TEXT DEFAULT 'open',                        -- open | in_progress | resolved
      raised_by TEXT,
      raised_by_name TEXT,
      assigned_to_role TEXT,
      assigned_to_user TEXT,
      resolution_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_esc_status ON escalations(status);
    CREATE INDEX IF NOT EXISTS idx_esc_site ON escalations(site_id);
    CREATE INDEX IF NOT EXISTS idx_esc_group ON escalations(group_id);

    -- ── E4: Preventive maintenance schedules + failures ────────
    CREATE TABLE IF NOT EXISTS maintenance_schedules (
      schedule_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      site_name TEXT,
      region TEXT,
      title TEXT NOT NULL,
      task_type TEXT DEFAULT 'preventive',              -- preventive | predictive | corrective
      frequency TEXT,                                    -- monthly | quarterly | biannual | annual
      interval_days INTEGER DEFAULT 90,
      last_completed_date TEXT,
      next_due_date TEXT,
      assigned_engineer_id TEXT,
      assigned_engineer_name TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'active',                      -- active | paused | completed
      description TEXT,
      estimated_cost_usd REAL,
      last_actual_cost_usd REAL,
      total_estimated_cost_usd REAL DEFAULT 0,
      total_actual_cost_usd REAL DEFAULT 0,
      total_saved_usd REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sched_site ON maintenance_schedules(site_id);
    CREATE INDEX IF NOT EXISTS idx_sched_due ON maintenance_schedules(next_due_date);
    CREATE INDEX IF NOT EXISTS idx_sched_status ON maintenance_schedules(status);

    CREATE TABLE IF NOT EXISTS failures (
      failure_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      site_name TEXT,
      region TEXT,
      schedule_id TEXT,
      fault_id TEXT,
      failure_type TEXT,
      component TEXT,
      severity TEXT DEFAULT 'high',
      occurred_at TEXT,
      detected_at TEXT,
      root_cause TEXT,
      resolution TEXT,
      resolution_status TEXT DEFAULT 'open',            -- open | in_progress | resolved
      downtime_hours REAL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      parts_replaced TEXT,
      confirmed_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fail_site ON failures(site_id);
    CREATE INDEX IF NOT EXISTS idx_fail_schedule ON failures(schedule_id);
    CREATE INDEX IF NOT EXISTS idx_fail_status ON failures(resolution_status);

    -- ── E6: Health parameters (normalized, multi-category) ─────
    CREATE TABLE IF NOT EXISTS health_parameters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL REFERENCES transformer_sites(site_id),
      category TEXT NOT NULL,                            -- electrical|thermal|oil|insulation|mechanical
      param_key TEXT NOT NULL,
      label TEXT,
      value REAL,
      unit TEXT,
      status TEXT DEFAULT 'normal',                      -- normal | warning | critical
      threshold_warn REAL,
      threshold_crit REAL,
      recorded_at TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'telemetry',
      UNIQUE(site_id, param_key)
    );
    CREATE INDEX IF NOT EXISTS idx_hp_site ON health_parameters(site_id);
    CREATE INDEX IF NOT EXISTS idx_hp_cat ON health_parameters(category);
    CREATE INDEX IF NOT EXISTS idx_hp_status ON health_parameters(status);

    -- ── E7: RAG document store + vector chunks ─────────────────
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT DEFAULT 'other',                 -- manual|drawing|failure_history|sop|fault_log|other
      original_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      path TEXT,
      description TEXT,
      site_id TEXT,
      uploaded_by TEXT,
      uploaded_by_name TEXT,
      status TEXT DEFAULT 'pending',                     -- pending | indexed | failed
      char_count INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      embed_model TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      indexed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(source_type);

    CREATE TABLE IF NOT EXISTS document_chunks (
      chunk_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(doc_id),
      chunk_index INTEGER,
      content TEXT NOT NULL,
      token_count INTEGER,
      embedding TEXT,                                    -- JSON float array (vector store)
      embed_model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(doc_id);
  `);

  // Link the existing record types back to a maintenance schedule (E4).
  addColumnIfMissing(db, 'maintenance_records', 'schedule_id', 'TEXT');
  addColumnIfMissing(db, 'fault_events', 'schedule_id', 'TEXT');
  addColumnIfMissing(db, 'alert_logs', 'schedule_id', 'TEXT');
  addColumnIfMissing(db, 'inspection_logs', 'schedule_id', 'TEXT');
  // Failure linkage from a fault (a confirmed fault becomes a failure record).
  addColumnIfMissing(db, 'fault_events', 'failure_id', 'TEXT');

  // Estimated vs actual cost tracking on schedules (completion captures actual).
  addColumnIfMissing(db, 'maintenance_schedules', 'estimated_cost_usd', 'REAL');
  addColumnIfMissing(db, 'maintenance_schedules', 'last_actual_cost_usd', 'REAL');
  addColumnIfMissing(db, 'maintenance_schedules', 'total_estimated_cost_usd', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'maintenance_schedules', 'total_actual_cost_usd', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'maintenance_schedules', 'total_saved_usd', 'REAL DEFAULT 0');
  addColumnIfMissing(db, 'maintenance_records', 'estimated_cost_usd', 'REAL');

  db.prepare(`
    UPDATE maintenance_schedules
    SET estimated_cost_usd = CASE
      WHEN priority = 'high' THEN 2200
      WHEN priority = 'medium' THEN 950
      ELSE 420
    END
    WHERE estimated_cost_usd IS NULL
  `).run();

  // One-time backfill of running totals from existing linked history.
  db.prepare(`
    UPDATE maintenance_schedules SET
      last_actual_cost_usd = (
        SELECT cost_usd FROM maintenance_records
        WHERE maintenance_records.schedule_id = maintenance_schedules.schedule_id
        ORDER BY maintenance_date DESC LIMIT 1
      ),
      total_actual_cost_usd = COALESCE((
        SELECT SUM(cost_usd) FROM maintenance_records
        WHERE maintenance_records.schedule_id = maintenance_schedules.schedule_id
      ), 0),
      total_estimated_cost_usd = COALESCE((
        SELECT COUNT(*) FROM maintenance_records
        WHERE maintenance_records.schedule_id = maintenance_schedules.schedule_id
      ), 0) * COALESCE(estimated_cost_usd, 0),
      total_saved_usd = (
        COALESCE((
          SELECT COUNT(*) FROM maintenance_records
          WHERE maintenance_records.schedule_id = maintenance_schedules.schedule_id
        ), 0) * COALESCE(estimated_cost_usd, 0)
      ) - COALESCE((
        SELECT SUM(cost_usd) FROM maintenance_records
        WHERE maintenance_records.schedule_id = maintenance_schedules.schedule_id
      ), 0)
    WHERE last_actual_cost_usd IS NULL
      AND EXISTS (
        SELECT 1 FROM maintenance_records
        WHERE maintenance_records.schedule_id = maintenance_schedules.schedule_id
      )
  `).run();
}

module.exports = { extendSchema, addColumnIfMissing };
