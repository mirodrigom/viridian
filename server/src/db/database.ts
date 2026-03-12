import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('database');

const DEFAULT_SERVICES: { name: string; command: string; cwd: string }[] = [
  {
    name: 'D2 Interactive Map',
    command: 'npm run dev',
    cwd: '/home/rodrigom/Documents/proyects/d2-interactive-map',
  },
];

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    log.info({ path: config.dbPath }, 'Database initialized');
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

    CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Untitled Diagram',
      description TEXT DEFAULT '',
      diagram_data TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_diagrams_user_project ON diagrams(user_id, project_path);

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

    -- ─── Management tables ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS management_services (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_management_services_user ON management_services(user_id);

    CREATE TABLE IF NOT EXISTS management_scripts (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      cwd TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_management_scripts_user ON management_scripts(user_id);

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
      agent_a_model TEXT DEFAULT 'claude-sonnet-4-6',
      agent_b_model TEXT DEFAULT 'claude-sonnet-4-6',
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

    -- ─── Manuals table ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS manuals (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Manual',
      prompt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      logo1_data TEXT DEFAULT '',
      logo2_data TEXT DEFAULT '',
      logo1_position TEXT DEFAULT '{"x":50,"y":30,"width":120,"height":60}',
      logo2_position TEXT DEFAULT '{"x":530,"y":30,"width":120,"height":60}',
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_manuals_user_project ON manuals(user_id, project_path);

    -- ─── MCP server configurations ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      server_type TEXT NOT NULL DEFAULT 'stdio',
      command TEXT DEFAULT '',
      args TEXT DEFAULT '[]',
      env TEXT DEFAULT '{}',
      url TEXT DEFAULT '',
      headers TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);

    -- ─── Projects table ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

    CREATE TABLE IF NOT EXISTS project_services (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_project_services_project ON project_services(project_id);

    -- ─── Scheduled tasks tables ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run_at DATETIME,
      next_run_at DATETIME,
      status TEXT DEFAULT 'idle',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduled_task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'running',
      output TEXT DEFAULT '',
      error TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_task_executions_task ON scheduled_task_executions(task_id, started_at DESC);
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

  // ── Autopilot: test verification cycle support ──
  safeAddColumn('autopilot_cycles', 'is_test_verification', "INTEGER DEFAULT 0");
  safeAddColumn('autopilot_configs', 'run_test_verification', "INTEGER DEFAULT 1");

  // ── Multi-provider support ──
  safeAddColumn('sessions', 'provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('session_cache', 'provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('graph_runs', 'provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('autopilot_profiles', 'provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('autopilot_configs', 'agent_a_provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('autopilot_configs', 'agent_b_provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('autopilot_runs', 'agent_a_provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('autopilot_runs', 'agent_b_provider', "TEXT DEFAULT 'claude'");
  safeAddColumn('autopilot_runs', 'agent_a_provider_session_id', "TEXT");
  safeAddColumn('autopilot_runs', 'agent_b_provider_session_id', "TEXT");

  // ── Agent metadata (routing & discovery) ──
  safeAddColumn('autopilot_profiles', 'domain', "TEXT DEFAULT 'general'");
  safeAddColumn('autopilot_profiles', 'routing_from', "TEXT DEFAULT '[]'");
  safeAddColumn('autopilot_profiles', 'routing_to', "TEXT DEFAULT '[]'");
  safeAddColumn('autopilot_profiles', 'capabilities', "TEXT DEFAULT '[]'");

  // ── Internal session tracking (git commit message generation, graph runner, etc.) ──
  safeAddColumn('session_cache', 'is_internal', "INTEGER DEFAULT 0");

  // ── Session preferences (per-conversation settings) ──
  safeAddColumn('session_cache', 'preferences', "TEXT DEFAULT '{}'");

  // ── Management: project scoping ──
  safeAddColumn('management_services', 'project_path', "TEXT DEFAULT ''");
  safeAddColumn('management_scripts', 'project_path', "TEXT DEFAULT ''");

  // ── Manuals: brand colors, PDF enhancement mode ──
  safeAddColumn('manuals', 'brand_colors', "TEXT DEFAULT '[]'");
  safeAddColumn('manuals', 'pdf_data', "TEXT DEFAULT ''");
  safeAddColumn('manuals', 'mode', "TEXT DEFAULT 'generate'");

  // ── Manual versioning ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_versions (
      id TEXT PRIMARY KEY,
      manual_id TEXT NOT NULL REFERENCES manuals(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_manual_versions_manual ON manual_versions(manual_id, created_at);
  `);

  // ── Personas table ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT 'Bot',
      color TEXT DEFAULT '#6366f1',
      system_prompt TEXT NOT NULL DEFAULT '',
      suggested_tools TEXT DEFAULT '[]',
      is_builtin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_personas_user ON personas(user_id);
  `);

  // ── Seed default services for existing users ──
  const existingUsers = db.prepare('SELECT id FROM users').all() as { id: number }[];
  for (const user of existingUsers) {
    seedServicesForUser(db, user.id);
    seedPersonasForUser(db, user.id);
  }

  // ── Provider credential storage ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_config (
      provider_id TEXT PRIMARY KEY,
      env_vars TEXT NOT NULL DEFAULT '{}'
    );
  `);
}

// ── Default service seeding ───────────────────────────────────────────────────

function seedServicesForUser(db: Database.Database, userId: number): void {
  for (const svc of DEFAULT_SERVICES) {
    const exists = db
      .prepare('SELECT 1 FROM management_services WHERE user_id = ? AND cwd = ? AND command = ?')
      .get(userId, svc.cwd, svc.command);
    if (!exists) {
      const next = (db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM management_services WHERE user_id = ?')
        .get(userId) as { next: number }).next;
      db.prepare('INSERT INTO management_services (id, user_id, name, command, cwd, sort_order, project_path) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), userId, svc.name, svc.command, svc.cwd, next, svc.cwd);
    }
  }
}

/** Seed default services for a newly created user. */
export function seedDefaultServicesForNewUser(userId: number): void {
  seedServicesForUser(getDb(), userId);
  seedPersonasForUser(getDb(), userId);
}

// ── Built-in personas ─────────────────────────────────────────────────────────

const BUILTIN_PERSONAS: {
  id: string; name: string; description: string; icon: string; color: string;
  systemPrompt: string; suggestedTools: string[];
}[] = [
  {
    id: 'persona-code-reviewer',
    name: 'Code Reviewer',
    description: 'Focuses on code quality, security vulnerabilities, and best practices',
    icon: 'SearchCode',
    color: '#ef4444',
    systemPrompt: `You are acting as a senior code reviewer. Your primary focus is:

1. **Code Quality** — Identify code smells, anti-patterns, and readability issues
2. **Security** — Flag potential vulnerabilities (injection, XSS, auth issues, secrets in code)
3. **Best Practices** — Suggest idiomatic patterns for the language/framework in use
4. **Performance** — Spot N+1 queries, unnecessary allocations, missing indexes
5. **Error Handling** — Ensure failures are handled gracefully with proper error messages

For each finding:
- Reference specific file and line numbers when possible
- Explain WHY it's an issue (not just what)
- Suggest a concrete fix with code
- Rate severity: critical / warning / suggestion

Be thorough but constructive. Praise good patterns when you see them.`,
    suggestedTools: ['Read', 'Glob', 'Grep'],
  },
  {
    id: 'persona-architect',
    name: 'Architect',
    description: 'System design, architecture decisions, and technical trade-offs',
    icon: 'Building2',
    color: '#8b5cf6',
    systemPrompt: `You are acting as a software architect. Your focus is on high-level system design and architecture decisions.

When advising:
1. **System Design** — Propose clear component boundaries, data flow, and integration patterns
2. **Trade-offs** — Always present pros/cons of different approaches (monolith vs microservices, SQL vs NoSQL, etc.)
3. **Scalability** — Consider future growth, load patterns, and bottlenecks
4. **Maintainability** — Favor designs that are easy to understand, test, and modify
5. **Technology Selection** — Recommend tools and frameworks with justification

Use diagrams (ASCII or Mermaid) when explaining complex architectures. Reference existing patterns in the codebase when applicable. Think in terms of bounded contexts and separation of concerns.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Bash(git log:*)'],
  },
  {
    id: 'persona-uiux-designer',
    name: 'UI/UX Designer',
    description: 'UI design guidance, accessibility, and user experience patterns',
    icon: 'Palette',
    color: '#ec4899',
    systemPrompt: `You are acting as a UI/UX design expert. Your focus areas:

1. **User Experience** — Optimize user flows, reduce friction, improve discoverability
2. **Accessibility (a11y)** — Ensure WCAG 2.1 AA compliance: proper ARIA labels, keyboard navigation, color contrast, screen reader support
3. **Visual Design** — Consistent spacing, typography hierarchy, color usage, and visual balance
4. **Responsive Design** — Mobile-first approach, breakpoint handling, touch targets
5. **Component Patterns** — Suggest proven UI patterns (modals, toasts, data tables, forms)
6. **Micro-interactions** — Appropriate animations, loading states, and feedback

Always consider the end user's perspective. Reference the existing design system/component library when suggesting changes. Provide concrete CSS/component code, not just abstract advice.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'],
  },
  {
    id: 'persona-devops',
    name: 'DevOps Engineer',
    description: 'CI/CD pipelines, deployment, infrastructure, and containerization',
    icon: 'Container',
    color: '#f97316',
    systemPrompt: `You are acting as a DevOps engineer. Your expertise covers:

1. **CI/CD** — Design and optimize build pipelines, automated testing, deployment strategies (blue-green, canary, rolling)
2. **Containerization** — Dockerfile best practices, multi-stage builds, image optimization, Docker Compose
3. **Infrastructure** — Cloud architecture (AWS, GCP, Azure), IaC (Terraform, Pulumi), networking
4. **Monitoring** — Logging strategies, metrics, alerting, observability (Prometheus, Grafana, etc.)
5. **Security** — Container scanning, secrets management, network policies, least privilege
6. **Reliability** — Health checks, graceful shutdown, resource limits, auto-scaling

Provide concrete configuration files and commands. Explain the "why" behind each recommendation. Consider cost optimization alongside reliability.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Bash(docker:*)', 'Bash(git:*)'],
  },
  {
    id: 'persona-tech-writer',
    name: 'Technical Writer',
    description: 'Documentation, READMEs, API docs, and technical communication',
    icon: 'BookOpen',
    color: '#14b8a6',
    systemPrompt: `You are acting as a technical writer. Your focus:

1. **Documentation** — Write clear, well-structured docs with proper headings, examples, and cross-references
2. **API Documentation** — Document endpoints with request/response examples, error codes, and authentication requirements
3. **READMEs** — Create comprehensive yet scannable project READMEs with setup instructions, usage examples, and contribution guidelines
4. **Code Comments** — Write meaningful JSDoc/TSDoc, inline comments that explain "why" not "what"
5. **Changelogs** — Maintain clear changelogs following Keep a Changelog format
6. **Architecture Decision Records** — Document key decisions with context, options considered, and rationale

Write for your audience — adjust technical depth based on whether the reader is a developer, operator, or end user. Use consistent terminology. Include runnable examples wherever possible.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
  },
  {
    id: 'persona-data-analyst',
    name: 'Data Analyst',
    description: 'Data analysis, SQL queries, visualization, and data modeling',
    icon: 'BarChart3',
    color: '#06b6d4',
    systemPrompt: `You are acting as a data analyst. Your areas of expertise:

1. **SQL & Queries** — Write optimized SQL queries, CTEs, window functions, and aggregations
2. **Data Modeling** — Design normalized/denormalized schemas, relationships, indexes
3. **Data Visualization** — Recommend appropriate chart types, create visualization configs
4. **Data Quality** — Identify data issues, suggest validation rules, handle missing data
5. **Analysis** — Statistical analysis, trend identification, correlation discovery
6. **ETL/Pipelines** — Data transformation, migration scripts, batch processing

Always explain your analytical reasoning. When writing queries, include comments explaining the logic. Suggest indexes for frequently-queried patterns. Present findings with context and actionable insights.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Bash(sqlite3:*)', 'Bash(psql:*)'],
  },
  {
    id: 'persona-security-expert',
    name: 'Security Expert',
    description: 'Security audits, vulnerability analysis, and hardening',
    icon: 'ShieldCheck',
    color: '#dc2626',
    systemPrompt: `You are acting as a cybersecurity expert. Your focus areas:

1. **Vulnerability Analysis** — Identify OWASP Top 10 issues: injection, XSS, CSRF, broken auth, security misconfiguration
2. **Authentication & Authorization** — Review auth flows, token handling, session management, RBAC/ABAC
3. **Data Protection** — Encryption at rest/in transit, PII handling, secrets management
4. **Input Validation** — Sanitization, parameterized queries, content security policies
5. **Dependency Security** — Flag vulnerable dependencies, supply chain risks
6. **Infrastructure Security** — Network segmentation, firewall rules, least privilege access
7. **Compliance** — GDPR, SOC2, HIPAA considerations where applicable

Rate findings by severity (Critical/High/Medium/Low). Provide specific remediation steps with code examples. Reference CVEs and security advisories when relevant.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Bash(npm audit:*)'],
  },
  {
    id: 'persona-mentor',
    name: 'Mentor',
    description: 'Teaching, explanations, learning guidance, and pair programming',
    icon: 'GraduationCap',
    color: '#22c55e',
    systemPrompt: `You are acting as a patient and encouraging programming mentor. Your approach:

1. **Teaching** — Explain concepts from first principles, building up complexity gradually
2. **Why, not just How** — Always explain the reasoning behind a pattern or solution
3. **Analogies** — Use real-world analogies to make abstract concepts concrete
4. **Guided Discovery** — Ask leading questions to help the learner arrive at the answer themselves
5. **Multiple Approaches** — Show different ways to solve a problem, explaining trade-offs
6. **Common Pitfalls** — Warn about mistakes beginners commonly make
7. **Resources** — Point to relevant docs, tutorials, and learning materials

Adjust your explanation depth based on the question's complexity. Use code examples liberally. Celebrate progress and good questions. Break down complex tasks into manageable steps. Never be condescending — every question is valid.`,
    suggestedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
  },
];

function seedPersonasForUser(db: Database.Database, userId: number): void {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO personas (id, user_id, name, description, icon, color, system_prompt, suggested_tools, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const p of BUILTIN_PERSONAS) {
    insertStmt.run(
      `${p.id}-${userId}`,
      userId,
      p.name,
      p.description,
      p.icon,
      p.color,
      p.systemPrompt,
      JSON.stringify(p.suggestedTools),
    );
  }
}

/** Load all saved provider env vars into process.env. Call once on startup. */
export function loadProviderConfigs(): void {
  const database = getDb();
  const rows = database.prepare('SELECT provider_id, env_vars FROM provider_config').all() as {
    provider_id: string;
    env_vars: string;
  }[];
  for (const row of rows) {
    try {
      const vars = JSON.parse(row.env_vars) as Record<string, string>;
      for (const [key, value] of Object.entries(vars)) {
        if (value) process.env[key] = value;
      }
    } catch { /* skip invalid JSON */ }
  }
}

/** Merge env vars for a provider into the DB and process.env. */
export function saveProviderConfig(providerId: string, envVars: Record<string, string>): void {
  const database = getDb();
  const existing = database
    .prepare('SELECT env_vars FROM provider_config WHERE provider_id = ?')
    .get(providerId) as { env_vars: string } | undefined;
  const current = existing ? (JSON.parse(existing.env_vars) as Record<string, string>) : {};
  const merged = { ...current, ...envVars };
  database
    .prepare('INSERT OR REPLACE INTO provider_config (provider_id, env_vars) VALUES (?, ?)')
    .run(providerId, JSON.stringify(merged));
  // Also inject into current process
  for (const [key, value] of Object.entries(envVars)) {
    if (value) process.env[key] = value;
  }
}

/** Mark a session as internal (not user-facing) so it's hidden from the chat sidebar. */
export function markSessionInternal(projectDir: string, sessionId: string): void {
  try {
    const database = getDb();
    database.prepare(`
      INSERT INTO session_cache (id, project_dir, title, project_path, message_count, last_active, file_mtime, is_internal)
      VALUES (?, ?, '', '', 0, ?, 0, 1)
      ON CONFLICT(project_dir, id) DO UPDATE SET is_internal = 1
    `).run(sessionId, projectDir, Date.now());
  } catch { /* best effort */ }
}

/** Check if a session is marked as internal in the database. */
export function isSessionInternal(sessionId: string): boolean {
  try {
    const database = getDb();
    const row = database.prepare(
      'SELECT is_internal FROM session_cache WHERE id = ? AND is_internal = 1 LIMIT 1',
    ).get(sessionId) as { is_internal: number } | undefined;
    return !!row;
  } catch { return false; }
}

/** Save the provider used for a session so historical messages can show the correct logo. */
export function upsertSessionProvider(projectDir: string, sessionId: string, provider: string): void {
  try {
    const database = getDb();
    database.prepare(`
      INSERT INTO session_cache (id, project_dir, title, project_path, message_count, last_active, file_mtime, provider)
      VALUES (?, ?, '', '', 0, ?, 0, ?)
      ON CONFLICT(project_dir, id) DO UPDATE SET provider = excluded.provider
    `).run(sessionId, projectDir, Date.now(), provider);
  } catch { /* best effort */ }
}

/** Remove a single env var for a provider from the DB and process.env. */
export function deleteProviderEnvVar(providerId: string, envVarName: string): void {
  const database = getDb();
  const existing = database
    .prepare('SELECT env_vars FROM provider_config WHERE provider_id = ?')
    .get(providerId) as { env_vars: string } | undefined;
  if (!existing) return;
  const current = JSON.parse(existing.env_vars) as Record<string, string>;
  delete current[envVarName];
  database
    .prepare('INSERT OR REPLACE INTO provider_config (provider_id, env_vars) VALUES (?, ?)')
    .run(providerId, JSON.stringify(current));
  delete process.env[envVarName];
}

/** Get session preferences from the cache. */
export function getSessionPreferences(sessionId: string): Record<string, unknown> {
  try {
    const database = getDb();
    const row = database.prepare(
      'SELECT preferences FROM session_cache WHERE id = ? LIMIT 1',
    ).get(sessionId) as { preferences?: string } | undefined;
    if (!row?.preferences) return {};
    return JSON.parse(row.preferences) as Record<string, unknown>;
  } catch { return {}; }
}

/** Merge preferences for a session into the session_cache. */
export function upsertSessionPreferences(
  projectDir: string,
  sessionId: string,
  preferences: Record<string, unknown>,
): void {
  try {
    const database = getDb();
    const existing = database.prepare(
      'SELECT preferences FROM session_cache WHERE id = ? AND project_dir = ? LIMIT 1',
    ).get(sessionId, projectDir) as { preferences?: string } | undefined;
    const current = existing?.preferences ? (JSON.parse(existing.preferences) as Record<string, unknown>) : {};
    const merged = { ...current, ...preferences };
    if (existing) {
      database.prepare(
        'UPDATE session_cache SET preferences = ? WHERE id = ? AND project_dir = ?',
      ).run(JSON.stringify(merged), sessionId, projectDir);
    } else {
      database.prepare(`
        INSERT INTO session_cache (id, project_dir, title, project_path, message_count, last_active, file_mtime, preferences)
        VALUES (?, ?, '', '', 0, ?, 0, ?)
        ON CONFLICT(project_dir, id) DO UPDATE SET preferences = excluded.preferences
      `).run(sessionId, projectDir, Date.now(), JSON.stringify(merged));
    }
  } catch { /* best effort */ }
}

/** Get stored env vars for a provider. */
export function getProviderConfig(providerId: string): Record<string, string> {
  const database = getDb();
  const row = database
    .prepare('SELECT env_vars FROM provider_config WHERE provider_id = ?')
    .get(providerId) as { env_vars: string } | undefined;
  if (!row) return {};
  try { return JSON.parse(row.env_vars) as Record<string, string>; } catch { return {}; }
}
