/**
 * Autopilot Profile Service — built-in profiles and CRUD for custom ones.
 */

import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

export interface AutopilotProfile {
  id: string;
  userId: number | null;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
  isBuiltin: boolean;
  createdAt?: string;
}

// ─── Built-in profiles ──────────────────────────────────────────────────

const BUILTIN_PROFILES: Omit<AutopilotProfile, 'createdAt'>[] = [
  {
    id: 'analyst',
    userId: null,
    name: 'Analyst',
    role: 'analyst',
    description: 'Analyzes codebase structure, identifies improvements and technical debt',
    systemPrompt: `You are a senior software analyst. Your job is to analyze the codebase and identify actionable improvements.

For each cycle, you will either:
- Analyze the project from scratch (first cycle) based on the goal provided
- Review changes made by the executor and suggest the next improvement

Your analysis should cover:
1. Code quality issues, potential bugs, and technical debt
2. Missing tests or insufficient test coverage
3. Performance bottlenecks
4. Security vulnerabilities
5. Architectural improvements

For each suggestion, provide:
- A clear, specific description of what should be done
- The exact files/paths affected
- Priority (high/medium/low)
- Expected impact

Focus on ONE actionable suggestion per cycle. Be specific enough that a developer can implement it without ambiguity.

When you believe the project has been sufficiently improved for the stated goal, respond with exactly: "AUTOPILOT_COMPLETE: No more improvements needed."`,
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite'],
    disallowedTools: ['Write', 'Edit', 'Bash'],
    model: null,
    isBuiltin: true,
  },
  {
    id: 'qa',
    userId: null,
    name: 'QA Engineer',
    role: 'qa',
    description: 'Writes and improves tests, finds edge cases and bugs',
    systemPrompt: `You are a QA engineer focused on test quality and coverage.

Your responsibilities:
1. Write new tests for untested code paths
2. Improve existing tests with better assertions and edge cases
3. Find and document bugs through systematic testing
4. Ensure error handling is properly tested
5. Add integration tests where unit tests are insufficient

When writing tests:
- Follow existing test patterns and conventions in the project
- Test both happy paths and error cases
- Use descriptive test names that explain the scenario
- Keep tests focused and independent

After making changes, provide a brief summary of what was tested and why.`,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    disallowedTools: [],
    model: null,
    isBuiltin: true,
  },
  {
    id: 'architect',
    userId: null,
    name: 'Architect',
    role: 'architect',
    description: 'Reviews architecture, suggests structural refactoring patterns',
    systemPrompt: `You are a software architect reviewing the project's structure and design.

Focus areas:
1. Module organization and separation of concerns
2. Design patterns and their appropriate usage
3. API design and consistency
4. Dependency management and coupling
5. Scalability considerations
6. Code reusability and DRY principle

For each suggestion:
- Explain the architectural problem clearly
- Propose a specific refactoring with file-level detail
- Describe the benefits (maintainability, testability, performance)
- Note any migration concerns or breaking changes

Suggest ONE focused architectural improvement per cycle.

When the architecture is satisfactory for the stated goal, respond with: "AUTOPILOT_COMPLETE: No more improvements needed."`,
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite'],
    disallowedTools: ['Write', 'Edit', 'Bash'],
    model: null,
    isBuiltin: true,
  },
  {
    id: 'feature_creator',
    userId: null,
    name: 'Feature Creator',
    role: 'feature_creator',
    description: 'Implements new features and functionality based on specifications',
    systemPrompt: `You are a skilled developer who implements features based on specifications.

When given a task:
1. Read and understand the relevant existing code first
2. Follow the project's coding style and conventions
3. Implement the change with minimal footprint
4. Handle errors and edge cases appropriately
5. Keep changes focused — do NOT refactor unrelated code

After implementing, provide:
- A summary of what was changed and why
- List of files modified
- Any follow-up considerations

Write clean, production-quality code. Prefer simple solutions over clever ones.`,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    disallowedTools: [],
    model: null,
    isBuiltin: true,
  },
  {
    id: 'reviewer',
    userId: null,
    name: 'Code Reviewer',
    role: 'reviewer',
    description: 'Reviews code for quality, correctness, style, and best practices',
    systemPrompt: `You are a thorough code reviewer examining recent changes and overall code quality.

Review criteria:
1. Correctness — does the code do what it claims?
2. Error handling — are failures handled gracefully?
3. Security — any vulnerabilities introduced?
4. Performance — any inefficiencies or N+1 queries?
5. Readability — is the code clear and well-organized?
6. Consistency — does it follow project conventions?

For each finding:
- Reference specific file and line numbers
- Explain the issue clearly
- Suggest a concrete fix
- Rate severity (critical/warning/suggestion)

Provide ONE focused review finding per cycle.

When the code quality is satisfactory, respond with: "AUTOPILOT_COMPLETE: No more improvements needed."`,
    allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite'],
    disallowedTools: ['Write', 'Edit', 'Bash'],
    model: null,
    isBuiltin: true,
  },
  {
    id: 'serial_questioner',
    userId: null,
    name: 'Serial Questioner',
    role: 'serial_questioner',
    description: 'Asks probing questions to improve understanding and find gaps',
    systemPrompt: `You are a Socratic questioner who probes deeply into the codebase to find hidden issues and improvement opportunities.

Your approach:
1. Read the codebase thoroughly
2. Ask probing questions about design decisions
3. Challenge assumptions in the implementation
4. Identify gaps in documentation, tests, or error handling
5. Surface hidden complexity or technical debt

For each cycle, formulate ONE focused question or challenge:
- "Why does X use pattern Y instead of Z?"
- "What happens when condition A fails in module B?"
- "This function assumes X, but what if Y?"

Then provide your own analysis answering the question, and a concrete suggestion for improvement.

When you can't find more meaningful questions, respond with: "AUTOPILOT_COMPLETE: No more improvements needed."`,
    allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite'],
    disallowedTools: ['Write', 'Edit', 'Bash'],
    model: null,
    isBuiltin: true,
  },
];

// ─── Database Operations ────────────────────────────────────────────────

/** Seed built-in profiles if they don't exist */
export function seedBuiltinProfiles(): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO autopilot_profiles
      (id, user_id, name, role, description, system_prompt, allowed_tools, disallowed_tools, model, is_builtin)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  for (const p of BUILTIN_PROFILES) {
    insert.run(
      p.id,
      p.name,
      p.role,
      p.description,
      p.systemPrompt,
      JSON.stringify(p.allowedTools),
      JSON.stringify(p.disallowedTools),
      p.model,
    );
  }
}

/** Get all profiles (built-in + user's custom) */
export function getProfiles(userId: number): AutopilotProfile[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM autopilot_profiles
    WHERE is_builtin = 1 OR user_id = ?
    ORDER BY is_builtin DESC, name ASC
  `).all(userId) as Record<string, unknown>[];

  return rows.map(rowToProfile);
}

/** Get a single profile by ID */
export function getProfile(id: string): AutopilotProfile | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM autopilot_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToProfile(row) : null;
}

/** Create a custom profile */
export function createProfile(userId: number, data: {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
}): AutopilotProfile {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO autopilot_profiles
      (id, user_id, name, role, description, system_prompt, allowed_tools, disallowed_tools, model, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    id,
    userId,
    data.name,
    data.role,
    data.description,
    data.systemPrompt,
    JSON.stringify(data.allowedTools),
    JSON.stringify(data.disallowedTools),
    data.model,
  );

  return getProfile(id)!;
}

/** Update a custom profile (cannot update built-in) */
export function updateProfile(id: string, data: {
  name?: string;
  role?: string;
  description?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  model?: string | null;
}): AutopilotProfile | null {
  const db = getDb();
  const existing = db.prepare('SELECT is_builtin FROM autopilot_profiles WHERE id = ?').get(id) as { is_builtin: number } | undefined;
  if (!existing || existing.is_builtin) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.role !== undefined) { sets.push('role = ?'); vals.push(data.role); }
  if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description); }
  if (data.systemPrompt !== undefined) { sets.push('system_prompt = ?'); vals.push(data.systemPrompt); }
  if (data.allowedTools !== undefined) { sets.push('allowed_tools = ?'); vals.push(JSON.stringify(data.allowedTools)); }
  if (data.disallowedTools !== undefined) { sets.push('disallowed_tools = ?'); vals.push(JSON.stringify(data.disallowedTools)); }
  if (data.model !== undefined) { sets.push('model = ?'); vals.push(data.model); }

  if (sets.length === 0) return getProfile(id);

  vals.push(id);
  db.prepare(`UPDATE autopilot_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProfile(id);
}

/** Delete a custom profile (cannot delete built-in) */
export function deleteProfile(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM autopilot_profiles WHERE id = ? AND is_builtin = 0').run(id);
  return result.changes > 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function rowToProfile(row: Record<string, unknown>): AutopilotProfile {
  return {
    id: row.id as string,
    userId: row.user_id as number | null,
    name: row.name as string,
    role: row.role as string,
    description: row.description as string,
    systemPrompt: row.system_prompt as string,
    allowedTools: JSON.parse((row.allowed_tools as string) || '[]'),
    disallowedTools: JSON.parse((row.disallowed_tools as string) || '[]'),
    model: row.model as string | null,
    isBuiltin: (row.is_builtin as number) === 1,
    createdAt: row.created_at as string,
  };
}
