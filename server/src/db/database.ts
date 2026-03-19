import { randomUUID } from 'crypto';
import db from './knex.js';
import { createLogger } from '../logger.js';

export { default as db } from './knex.js';
export { runMigrations, isPostgres } from './knex.js';

const log = createLogger('database');

// ── Default services seeded for new users ──────────────────────────────────

const DEFAULT_SERVICES: { name: string; command: string; cwd: string }[] = [
  {
    name: 'D2 Interactive Map',
    command: 'npm run dev',
    cwd: '/home/rodrigom/Documents/proyects/d2-interactive-map',
  },
];

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

// ── Seeding helpers ───────────────────────────────────────────────────────────

async function seedServicesForUser(userId: number): Promise<void> {
  for (const svc of DEFAULT_SERVICES) {
    const exists = await db('management_services')
      .where({ user_id: userId, cwd: svc.cwd, command: svc.command })
      .first();
    if (!exists) {
      const row = await db('management_services')
        .where({ user_id: userId })
        .max('sort_order as max_sort')
        .first();
      const next = ((row as any)?.max_sort ?? -1) + 1;
      await db('management_services').insert({
        id: randomUUID(),
        user_id: userId,
        name: svc.name,
        command: svc.command,
        cwd: svc.cwd,
        sort_order: next,
        project_path: svc.cwd,
      });
    }
  }
}

async function seedPersonasForUser(userId: number): Promise<void> {
  for (const p of BUILTIN_PERSONAS) {
    const id = `${p.id}-${userId}`;
    const exists = await db('personas').where({ id }).first();
    if (!exists) {
      await db('personas').insert({
        id,
        user_id: userId,
        name: p.name,
        description: p.description,
        icon: p.icon,
        color: p.color,
        system_prompt: p.systemPrompt,
        suggested_tools: JSON.stringify(p.suggestedTools),
        is_builtin: 1,
      });
    }
  }
}

/** Seed default services and personas for a newly created user. */
export async function seedDefaultServicesForNewUser(userId: number): Promise<void> {
  await seedServicesForUser(userId);
  await seedPersonasForUser(userId);
}

/** Seed all existing users (called once after migrations). */
export async function seedAllUsers(): Promise<void> {
  const users = await db('users').select('id');
  for (const user of users) {
    await seedServicesForUser(user.id);
    await seedPersonasForUser(user.id);
  }
}

// ── Provider config helpers ──────────────────────────────────────────────────

/** Load all saved provider env vars into process.env. Call once on startup. */
export async function loadProviderConfigs(): Promise<void> {
  const rows = await db('provider_config').select('provider_id', 'env_vars');
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
export async function saveProviderConfig(providerId: string, envVars: Record<string, string>): Promise<void> {
  const existing = await db('provider_config')
    .where({ provider_id: providerId })
    .first();
  const current = existing ? (JSON.parse(existing.env_vars) as Record<string, string>) : {};
  const merged = { ...current, ...envVars };
  await db('provider_config')
    .insert({ provider_id: providerId, env_vars: JSON.stringify(merged) })
    .onConflict('provider_id')
    .merge();
  for (const [key, value] of Object.entries(envVars)) {
    if (value) process.env[key] = value;
  }
}

/** Remove a single env var for a provider from the DB and process.env. */
export async function deleteProviderEnvVar(providerId: string, envVarName: string): Promise<void> {
  const existing = await db('provider_config')
    .where({ provider_id: providerId })
    .first();
  if (!existing) return;
  const current = JSON.parse(existing.env_vars) as Record<string, string>;
  delete current[envVarName];
  await db('provider_config')
    .where({ provider_id: providerId })
    .update({ env_vars: JSON.stringify(current) });
  delete process.env[envVarName];
}

/** Get stored env vars for a provider. */
export async function getProviderConfig(providerId: string): Promise<Record<string, string>> {
  const row = await db('provider_config')
    .where({ provider_id: providerId })
    .first();
  if (!row) return {};
  try { return JSON.parse(row.env_vars) as Record<string, string>; } catch { return {}; }
}

// ── Session helpers ──────────────────────────────────────────────────────────

/** Mark a session as internal (not user-facing) so it's hidden from the chat sidebar. */
export async function markSessionInternal(projectDir: string, sessionId: string): Promise<void> {
  try {
    await db('session_cache')
      .insert({
        id: sessionId,
        project_dir: projectDir,
        title: '',
        project_path: '',
        message_count: 0,
        last_active: Date.now(),
        file_mtime: 0,
        is_internal: 1,
      })
      .onConflict(['project_dir', 'id'])
      .merge({ is_internal: 1 });
  } catch { /* best effort */ }
}

/** Check if a session is marked as internal in the database. */
export async function isSessionInternal(sessionId: string): Promise<boolean> {
  try {
    const row = await db('session_cache')
      .where({ id: sessionId, is_internal: 1 })
      .first();
    return !!row;
  } catch { return false; }
}

/** Save the provider used for a session so historical messages can show the correct logo. */
export async function upsertSessionProvider(projectDir: string, sessionId: string, provider: string): Promise<void> {
  try {
    await db('session_cache')
      .insert({
        id: sessionId,
        project_dir: projectDir,
        title: '',
        project_path: '',
        message_count: 0,
        last_active: Date.now(),
        file_mtime: 0,
        provider,
      })
      .onConflict(['project_dir', 'id'])
      .merge({ provider });
  } catch { /* best effort */ }
}

/** Get session preferences from the cache. */
export async function getSessionPreferences(sessionId: string): Promise<Record<string, unknown>> {
  try {
    const row = await db('session_cache')
      .where({ id: sessionId })
      .select('preferences')
      .first();
    if (!row?.preferences) return {};
    return JSON.parse(row.preferences) as Record<string, unknown>;
  } catch { return {}; }
}

/** Merge preferences for a session into the session_cache. */
export async function upsertSessionPreferences(
  projectDir: string,
  sessionId: string,
  preferences: Record<string, unknown>,
): Promise<void> {
  try {
    const existing = await db('session_cache')
      .where({ id: sessionId, project_dir: projectDir })
      .select('preferences')
      .first();
    const current = existing?.preferences ? (JSON.parse(existing.preferences) as Record<string, unknown>) : {};
    const merged = { ...current, ...preferences };
    if (existing) {
      await db('session_cache')
        .where({ id: sessionId, project_dir: projectDir })
        .update({ preferences: JSON.stringify(merged) });
    } else {
      await db('session_cache')
        .insert({
          id: sessionId,
          project_dir: projectDir,
          title: '',
          project_path: '',
          message_count: 0,
          last_active: Date.now(),
          file_mtime: 0,
          preferences: JSON.stringify(merged),
        })
        .onConflict(['project_dir', 'id'])
        .merge({ preferences: JSON.stringify(merged) });
    }
  } catch { /* best effort */ }
}
