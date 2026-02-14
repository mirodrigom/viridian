import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    runMigrations(db);
  }
  return db;
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      claude_session_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      revoked INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      details TEXT DEFAULT '',
      status TEXT DEFAULT 'todo',
      priority TEXT DEFAULT 'medium',
      parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      dependency_ids TEXT DEFAULT '[]',
      prd_source TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_user_project ON tasks(user_id, project_path);

    CREATE TABLE IF NOT EXISTS graphs (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Untitled Graph',
      description TEXT DEFAULT '',
      graph_data TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_graphs_user_project ON graphs(user_id, project_path);

    CREATE TABLE IF NOT EXISTS graph_runs (
      id TEXT PRIMARY KEY,
      graph_id TEXT REFERENCES graphs(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      final_output TEXT,
      error TEXT,
      timeline TEXT DEFAULT '[]',
      executions TEXT DEFAULT '{}',
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_graph_runs_graph ON graph_runs(graph_id);
    CREATE INDEX IF NOT EXISTS idx_graph_runs_user_project ON graph_runs(user_id, project_path);

    CREATE TABLE IF NOT EXISTS session_cache (
      id TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      title TEXT NOT NULL,
      project_path TEXT DEFAULT '',
      message_count INTEGER DEFAULT 0,
      last_active INTEGER NOT NULL,
      file_mtime INTEGER NOT NULL,
      PRIMARY KEY (project_dir, id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_cache_active ON session_cache(last_active DESC);

    -- ─── Autopilot tables ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS autopilot_profiles (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      description TEXT DEFAULT '',
      system_prompt TEXT NOT NULL,
      allowed_tools TEXT DEFAULT '[]',
      disallowed_tools TEXT DEFAULT '[]',
      model TEXT,
      is_builtin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_autopilot_profiles_user ON autopilot_profiles(user_id);

    CREATE TABLE IF NOT EXISTS autopilot_configs (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Autopilot Session',
      agent_a_profile TEXT NOT NULL,
      agent_b_profile TEXT NOT NULL,
      allowed_paths TEXT DEFAULT '[]',
      agent_a_model TEXT DEFAULT 'claude-sonnet-4-20250514',
      agent_b_model TEXT DEFAULT 'claude-sonnet-4-20250514',
      max_iterations INTEGER DEFAULT 50,
      max_tokens_per_session INTEGER DEFAULT 500000,
      schedule_enabled INTEGER DEFAULT 0,
      schedule_start_time TEXT,
      schedule_end_time TEXT,
      schedule_days TEXT DEFAULT '[1,2,3,4,5]',
      schedule_timezone TEXT DEFAULT 'UTC',
      goal_prompt TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_autopilot_configs_user ON autopilot_configs(user_id);

    CREATE TABLE IF NOT EXISTS autopilot_runs (
      id TEXT PRIMARY KEY,
      config_id TEXT REFERENCES autopilot_configs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      branch_name TEXT,
      commit_count INTEGER DEFAULT 0,
      cycle_count INTEGER DEFAULT 0,
      agent_a_input_tokens INTEGER DEFAULT 0,
      agent_a_output_tokens INTEGER DEFAULT 0,
      agent_b_input_tokens INTEGER DEFAULT 0,
      agent_b_output_tokens INTEGER DEFAULT 0,
      agent_a_claude_session_id TEXT,
      agent_a_profile_id TEXT,
      agent_b_profile_id TEXT,
      goal_prompt TEXT DEFAULT '',
      agent_b_claude_session_id TEXT,
      rate_limited_until DATETIME,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paused_at DATETIME,
      completed_at DATETIME,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_autopilot_runs_config ON autopilot_runs(config_id);
    CREATE INDEX IF NOT EXISTS idx_autopilot_runs_status ON autopilot_runs(status);

    CREATE TABLE IF NOT EXISTS autopilot_cycles (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES autopilot_runs(id) ON DELETE CASCADE,
      cycle_number INTEGER NOT NULL,
      agent_a_prompt TEXT,
      agent_a_response TEXT,
      agent_a_tokens_in INTEGER DEFAULT 0,
      agent_a_tokens_out INTEGER DEFAULT 0,
      agent_b_prompt TEXT,
      agent_b_response TEXT,
      agent_b_tokens_in INTEGER DEFAULT 0,
      agent_b_tokens_out INTEGER DEFAULT 0,
      commit_hash TEXT,
      commit_message TEXT,
      files_changed TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_autopilot_cycles_run ON autopilot_cycles(run_id, cycle_number);
  `);

  // ── Incremental migrations (safe to run multiple times) ──────────
  const safeAddColumn = (table: string, column: string, type: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch {
      // Column already exists — ignore
    }
  };

  safeAddColumn('autopilot_runs', 'agent_a_profile_id', "TEXT");
  safeAddColumn('autopilot_runs', 'agent_b_profile_id', "TEXT");
  safeAddColumn('autopilot_runs', 'goal_prompt', "TEXT DEFAULT ''");

  // ── Autopilot profiles: extended fields for subagents, MCP, categorization ──
  safeAddColumn('autopilot_profiles', 'category', "TEXT DEFAULT 'general'");
  safeAddColumn('autopilot_profiles', 'tags', "TEXT DEFAULT '[]'");
  safeAddColumn('autopilot_profiles', 'subagents', "TEXT DEFAULT '[]'");
  safeAddColumn('autopilot_profiles', 'mcp_servers', "TEXT DEFAULT '[]'");
  safeAddColumn('autopilot_profiles', 'append_system_prompt', "TEXT");
  safeAddColumn('autopilot_profiles', 'max_turns', "INTEGER");
  safeAddColumn('autopilot_profiles', 'permission_mode', "TEXT");
  safeAddColumn('autopilot_profiles', 'icon', "TEXT");
  safeAddColumn('autopilot_profiles', 'difficulty', "TEXT");
}
