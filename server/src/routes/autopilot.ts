import { Router } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getDb } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import {
  getProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  seedBuiltinProfiles,
} from '../services/autopilot-profiles.js';
import { getCommitDiff } from '../services/autopilot-git.js';
import { randomUUID } from 'crypto';

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

// Seed built-in profiles on first load
let seeded = false;
function ensureSeeded() {
  if (!seeded) {
    seedBuiltinProfiles();
    seeded = true;
  }
}

// ─── Profiles ───────────────────────────────────────────────────────────

router.get('/profiles', (req: AuthRequest, res) => {
  ensureSeeded();
  const profiles = getProfiles(req.user!.id);
  res.json({ profiles });
});

router.post('/profiles', (req: AuthRequest, res) => {
  ensureSeeded();
  const {
    name, role, description, systemPrompt, allowedTools, disallowedTools, model,
    category, tags, subagents, mcpServers, appendSystemPrompt, maxTurns,
    permissionMode, icon, difficulty,
  } = req.body;
  if (!name || !systemPrompt) {
    res.status(400).json({ error: 'name and systemPrompt are required' });
    return;
  }
  const profile = createProfile(req.user!.id, {
    name,
    role: role || 'custom',
    description: description || '',
    systemPrompt,
    allowedTools: allowedTools || [],
    disallowedTools: disallowedTools || [],
    model: model || null,
    category: category || 'general',
    tags: tags || [],
    subagents: subagents || [],
    mcpServers: mcpServers || [],
    appendSystemPrompt: appendSystemPrompt || null,
    maxTurns: maxTurns || null,
    permissionMode: permissionMode || null,
    icon: icon || null,
    difficulty: difficulty || null,
  });
  res.status(201).json(profile);
});

router.put('/profiles/:id', (req: AuthRequest, res) => {
  const profile = updateProfile(req.params.id, req.body);
  if (!profile) {
    res.status(404).json({ error: 'Profile not found or is built-in' });
    return;
  }
  res.json(profile);
});

router.delete('/profiles/:id', (req: AuthRequest, res) => {
  const ok = deleteProfile(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Profile not found or is built-in' });
    return;
  }
  res.json({ ok: true });
});

// ─── Configs ────────────────────────────────────────────────────────────

interface ConfigRow {
  id: string;
  user_id: number;
  project_path: string;
  name: string;
  agent_a_profile: string;
  agent_b_profile: string;
  allowed_paths: string;
  agent_a_model: string;
  agent_b_model: string;
  max_iterations: number;
  max_tokens_per_session: number;
  schedule_enabled: number;
  schedule_start_time: string | null;
  schedule_end_time: string | null;
  schedule_days: string;
  schedule_timezone: string;
  goal_prompt: string;
  run_test_verification: number;
  created_at: string;
  updated_at: string;
}

function rowToConfig(row: ConfigRow) {
  return {
    id: row.id,
    projectPath: row.project_path,
    name: row.name,
    agentAProfile: row.agent_a_profile,
    agentBProfile: row.agent_b_profile,
    allowedPaths: safeJsonParse<string[]>(row.allowed_paths, []),
    agentAModel: row.agent_a_model,
    agentBModel: row.agent_b_model,
    maxIterations: row.max_iterations,
    maxTokensPerSession: row.max_tokens_per_session,
    scheduleEnabled: row.schedule_enabled === 1,
    scheduleStartTime: row.schedule_start_time,
    scheduleEndTime: row.schedule_end_time,
    scheduleDays: safeJsonParse<number[]>(row.schedule_days, [1, 2, 3, 4, 5]),
    scheduleTimezone: row.schedule_timezone,
    goalPrompt: row.goal_prompt,
    runTestVerification: row.run_test_verification === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/configs', (req: AuthRequest, res) => {
  const { project } = req.query;
  if (!project || typeof project !== 'string') {
    res.status(400).json({ error: 'project query param required' });
    return;
  }
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM autopilot_configs WHERE user_id = ? AND project_path = ? ORDER BY updated_at DESC',
  ).all(req.user!.id, project) as ConfigRow[];
  res.json({ configs: rows.map(rowToConfig) });
});

router.post('/configs', (req: AuthRequest, res) => {
  const {
    project, name, agentAProfile, agentBProfile, allowedPaths,
    agentAModel, agentBModel, maxIterations, maxTokensPerSession,
    scheduleEnabled, scheduleStartTime, scheduleEndTime, scheduleDays,
    scheduleTimezone, goalPrompt, runTestVerification,
  } = req.body;

  if (!project || !agentAProfile || !agentBProfile) {
    res.status(400).json({ error: 'project, agentAProfile, and agentBProfile are required' });
    return;
  }

  const db = getDb();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO autopilot_configs
      (id, user_id, project_path, name, agent_a_profile, agent_b_profile,
       allowed_paths, agent_a_model, agent_b_model, max_iterations, max_tokens_per_session,
       schedule_enabled, schedule_start_time, schedule_end_time, schedule_days,
       schedule_timezone, goal_prompt, run_test_verification)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user!.id, project,
    name || 'Autopilot Session',
    agentAProfile, agentBProfile,
    JSON.stringify(allowedPaths || []),
    agentAModel || 'claude-sonnet-4-20250514',
    agentBModel || 'claude-sonnet-4-20250514',
    maxIterations || 50,
    maxTokensPerSession || 500000,
    scheduleEnabled ? 1 : 0,
    scheduleStartTime || null,
    scheduleEndTime || null,
    JSON.stringify(scheduleDays || [1, 2, 3, 4, 5]),
    scheduleTimezone || 'UTC',
    goalPrompt || '',
    runTestVerification !== false ? 1 : 0,
  );

  const row = db.prepare('SELECT * FROM autopilot_configs WHERE id = ?').get(id) as ConfigRow;
  res.status(201).json(rowToConfig(row));
});

router.put('/configs/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM autopilot_configs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Config not found' }); return; }

  const fields: Record<string, string> = {
    name: 'name', agentAProfile: 'agent_a_profile', agentBProfile: 'agent_b_profile',
    agentAModel: 'agent_a_model', agentBModel: 'agent_b_model',
    maxIterations: 'max_iterations', maxTokensPerSession: 'max_tokens_per_session',
    scheduleStartTime: 'schedule_start_time', scheduleEndTime: 'schedule_end_time',
    scheduleTimezone: 'schedule_timezone', goalPrompt: 'goal_prompt',
  };

  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const [key, col] of Object.entries(fields)) {
    if (req.body[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(req.body[key]);
    }
  }
  // JSON fields
  if (req.body.allowedPaths !== undefined) {
    sets.push('allowed_paths = ?');
    vals.push(JSON.stringify(req.body.allowedPaths));
  }
  if (req.body.scheduleDays !== undefined) {
    sets.push('schedule_days = ?');
    vals.push(JSON.stringify(req.body.scheduleDays));
  }
  if (req.body.scheduleEnabled !== undefined) {
    sets.push('schedule_enabled = ?');
    vals.push(req.body.scheduleEnabled ? 1 : 0);
  }
  if (req.body.runTestVerification !== undefined) {
    sets.push('run_test_verification = ?');
    vals.push(req.body.runTestVerification ? 1 : 0);
  }

  if (sets.length > 0) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(req.params.id, req.user!.id);
    db.prepare(`UPDATE autopilot_configs SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
  }

  const row = db.prepare('SELECT * FROM autopilot_configs WHERE id = ?').get(req.params.id) as ConfigRow;
  res.json(rowToConfig(row));
});

router.delete('/configs/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM autopilot_configs WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Config not found' });
    return;
  }
  res.json({ ok: true });
});

// ─── Runs ───────────────────────────────────────────────────────────────

interface RunRow {
  id: string;
  config_id: string | null;
  project_path: string;
  status: string;
  branch_name: string | null;
  commit_count: number;
  cycle_count: number;
  agent_a_input_tokens: number;
  agent_a_output_tokens: number;
  agent_b_input_tokens: number;
  agent_b_output_tokens: number;
  agent_a_profile_id: string | null;
  agent_b_profile_id: string | null;
  goal_prompt: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

function rowToRun(row: RunRow) {
  return {
    id: row.id,
    configId: row.config_id,
    projectPath: row.project_path,
    status: row.status,
    branchName: row.branch_name,
    commitCount: row.commit_count,
    cycleCount: row.cycle_count,
    tokens: {
      agentA: { inputTokens: row.agent_a_input_tokens, outputTokens: row.agent_a_output_tokens },
      agentB: { inputTokens: row.agent_b_input_tokens, outputTokens: row.agent_b_output_tokens },
    },
    agentAProfileId: row.agent_a_profile_id,
    agentBProfileId: row.agent_b_profile_id,
    goalPrompt: row.goal_prompt || '',
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

router.get('/runs', (req: AuthRequest, res) => {
  const { project, limit, offset } = req.query;
  const db = getDb();

  let query = 'SELECT * FROM autopilot_runs WHERE user_id = ?';
  const params: unknown[] = [req.user!.id];

  if (project && typeof project === 'string') {
    query += ' AND project_path = ?';
    params.push(project);
  }

  query += ' ORDER BY started_at DESC';

  if (limit) {
    const n = Number(limit);
    if (!Number.isNaN(n) && n > 0) {
      query += ' LIMIT ?';
      params.push(n);
    }
  }
  if (offset) {
    const n = Number(offset);
    if (!Number.isNaN(n) && n >= 0) {
      query += ' OFFSET ?';
      params.push(n);
    }
  }

  const rows = db.prepare(query).all(...params) as RunRow[];
  res.json({ runs: rows.map(rowToRun) });
});

router.get('/runs/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM autopilot_runs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id) as RunRow | undefined;
  if (!row) { res.status(404).json({ error: 'Run not found' }); return; }
  res.json(rowToRun(row));
});

router.get('/runs/:id/cycles', (req: AuthRequest, res) => {
  const db = getDb();
  // Verify ownership
  const run = db.prepare(
    'SELECT id FROM autopilot_runs WHERE id = ? AND user_id = ?',
  ).get(req.params.id, req.user!.id);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

  interface CycleRow {
    id: string;
    cycle_number: number;
    agent_a_prompt: string | null;
    agent_a_response: string | null;
    agent_a_tokens_in: number;
    agent_a_tokens_out: number;
    agent_b_prompt: string | null;
    agent_b_response: string | null;
    agent_b_tokens_in: number;
    agent_b_tokens_out: number;
    commit_hash: string | null;
    commit_message: string | null;
    files_changed: string;
    status: string;
    is_test_verification: number;
    started_at: string;
    completed_at: string | null;
  }

  const rows = db.prepare(
    'SELECT * FROM autopilot_cycles WHERE run_id = ? ORDER BY cycle_number ASC',
  ).all(req.params.id) as CycleRow[];

  res.json({
    cycles: rows.map((r) => ({
      id: r.id,
      cycleNumber: r.cycle_number,
      agentA: {
        prompt: r.agent_a_prompt,
        response: r.agent_a_response,
        tokens: { inputTokens: r.agent_a_tokens_in, outputTokens: r.agent_a_tokens_out },
      },
      agentB: {
        prompt: r.agent_b_prompt,
        response: r.agent_b_response,
        tokens: { inputTokens: r.agent_b_tokens_in, outputTokens: r.agent_b_tokens_out },
      },
      commit: r.commit_hash ? {
        hash: r.commit_hash,
        message: r.commit_message,
        filesChanged: safeJsonParse<string[]>(r.files_changed, []),
      } : null,
      status: r.status,
      isTestVerification: r.is_test_verification === 1,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    })),
  });
});

router.get('/runs/:id/diff/:cycleNumber', async (req: AuthRequest, res) => {
  try {
    const db = getDb();
    const run = db.prepare(
      'SELECT * FROM autopilot_runs WHERE id = ? AND user_id = ?',
    ).get(req.params.id, req.user!.id) as RunRow | undefined;
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    const cycleNum = Number(req.params.cycleNumber);
    if (Number.isNaN(cycleNum)) {
      res.status(400).json({ error: 'Invalid cycle number' });
      return;
    }

    const cycle = db.prepare(
      'SELECT commit_hash FROM autopilot_cycles WHERE run_id = ? AND cycle_number = ?',
    ).get(req.params.id, cycleNum) as { commit_hash: string | null } | undefined;

    if (!cycle?.commit_hash) {
      res.status(404).json({ error: 'No commit for this cycle' });
      return;
    }

    const diff = await getCommitDiff(run.project_path, cycle.commit_hash);
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
