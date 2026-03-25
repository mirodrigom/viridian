import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
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
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('autopilot');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

// Seed built-in profiles on first load
let seeded = false;
async function ensureSeeded() {
  if (!seeded) {
    await seedBuiltinProfiles();
    seeded = true;
  }
}

// ─── Profiles ───────────────────────────────────────────────────────────

router.get('/profiles', async (req: AuthRequest, res) => {
  await ensureSeeded();
  const profiles = await getProfiles(req.user!.id);
  res.json({ profiles });
});

router.post('/profiles', validate({
  body: z.object({
    name: z.string().min(1),
    systemPrompt: z.string().min(1),
    role: z.string().optional(),
    description: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    model: z.string().nullable().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    subagents: z.array(z.unknown()).optional(),
    mcpServers: z.array(z.unknown()).optional(),
    appendSystemPrompt: z.string().nullable().optional(),
    maxTurns: z.number().nullable().optional(),
    permissionMode: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    difficulty: z.string().nullable().optional(),
  }),
}), async (req: AuthRequest, res) => {
  await ensureSeeded();
  const {
    name, role, description, systemPrompt, allowedTools, disallowedTools, model,
    category, tags, subagents, mcpServers, appendSystemPrompt, maxTurns,
    permissionMode, icon, difficulty,
  } = req.body;
  const profile = await createProfile(req.user!.id, {
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

router.put('/profiles/:id', async (req: AuthRequest, res) => {
  const profile = await updateProfile(req.params.id as string, req.body);
  if (!profile) {
    res.status(404).json({ error: 'Profile not found or is built-in' });
    return;
  }
  res.json(profile);
});

router.delete('/profiles/:id', async (req: AuthRequest, res) => {
  const ok = await deleteProfile(req.params.id as string);
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

router.get('/configs', validate({ query: z.object({ project: z.string().min(1) }) }), async (req: AuthRequest, res) => {
  const { project } = req.query;
  const rows = await db('autopilot_configs')
    .where({ user_id: req.user!.id, project_path: project })
    .orderBy('updated_at', 'desc')
    .select() as ConfigRow[];
  res.json({ configs: rows.map(rowToConfig) });
});

router.post('/configs', validate({
  body: z.object({
    project: z.string().min(1),
    agentAProfile: z.string().min(1),
    agentBProfile: z.string().min(1),
    name: z.string().optional(),
    allowedPaths: z.array(z.string()).optional(),
    agentAModel: z.string().optional(),
    agentBModel: z.string().optional(),
    maxIterations: z.number().optional(),
    maxTokensPerSession: z.number().optional(),
    scheduleEnabled: z.boolean().optional(),
    scheduleStartTime: z.string().nullable().optional(),
    scheduleEndTime: z.string().nullable().optional(),
    scheduleDays: z.array(z.number()).optional(),
    scheduleTimezone: z.string().optional(),
    goalPrompt: z.string().optional(),
    runTestVerification: z.boolean().optional(),
  }),
}), async (req: AuthRequest, res) => {
  const {
    project, name, agentAProfile, agentBProfile, allowedPaths,
    agentAModel, agentBModel, maxIterations, maxTokensPerSession,
    scheduleEnabled, scheduleStartTime, scheduleEndTime, scheduleDays,
    scheduleTimezone, goalPrompt, runTestVerification,
  } = req.body;

  const id = randomUUID();

  await db('autopilot_configs').insert({
    id,
    user_id: req.user!.id,
    project_path: project,
    name: name || 'Autopilot Session',
    agent_a_profile: agentAProfile,
    agent_b_profile: agentBProfile,
    allowed_paths: JSON.stringify(allowedPaths || []),
    agent_a_model: agentAModel || 'claude-sonnet-4-6',
    agent_b_model: agentBModel || 'claude-sonnet-4-6',
    max_iterations: maxIterations || 50,
    max_tokens_per_session: maxTokensPerSession || 500000,
    schedule_enabled: scheduleEnabled ? 1 : 0,
    schedule_start_time: scheduleStartTime || null,
    schedule_end_time: scheduleEndTime || null,
    schedule_days: JSON.stringify(scheduleDays || [1, 2, 3, 4, 5]),
    schedule_timezone: scheduleTimezone || 'UTC',
    goal_prompt: goalPrompt || '',
    run_test_verification: runTestVerification !== false ? 1 : 0,
  });

  const row = await db('autopilot_configs').where({ id }).first() as ConfigRow;
  res.status(201).json(rowToConfig(row));
});

router.put('/configs/:id', async (req: AuthRequest, res) => {
  const existing = await db('autopilot_configs')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
  if (!existing) { res.status(404).json({ error: 'Config not found' }); return; }

  const fields: Record<string, string> = {
    name: 'name', agentAProfile: 'agent_a_profile', agentBProfile: 'agent_b_profile',
    agentAModel: 'agent_a_model', agentBModel: 'agent_b_model',
    maxIterations: 'max_iterations', maxTokensPerSession: 'max_tokens_per_session',
    scheduleStartTime: 'schedule_start_time', scheduleEndTime: 'schedule_end_time',
    scheduleTimezone: 'schedule_timezone', goalPrompt: 'goal_prompt',
  };

  const updates: Record<string, unknown> = {};

  for (const [key, col] of Object.entries(fields)) {
    if (req.body[key] !== undefined) {
      updates[col] = req.body[key];
    }
  }
  // JSON fields
  if (req.body.allowedPaths !== undefined) {
    updates['allowed_paths'] = JSON.stringify(req.body.allowedPaths);
  }
  if (req.body.scheduleDays !== undefined) {
    updates['schedule_days'] = JSON.stringify(req.body.scheduleDays);
  }
  if (req.body.scheduleEnabled !== undefined) {
    updates['schedule_enabled'] = req.body.scheduleEnabled ? 1 : 0;
  }
  if (req.body.runTestVerification !== undefined) {
    updates['run_test_verification'] = req.body.runTestVerification ? 1 : 0;
  }

  if (Object.keys(updates).length > 0) {
    updates['updated_at'] = db.fn.now();
    await db('autopilot_configs')
      .where({ id: req.params.id, user_id: req.user!.id })
      .update(updates);
  }

  const row = await db('autopilot_configs').where({ id: req.params.id }).first() as ConfigRow;
  res.json(rowToConfig(row));
});

router.delete('/configs/:id', async (req: AuthRequest, res) => {
  const deleted = await db('autopilot_configs')
    .where({ id: req.params.id, user_id: req.user!.id })
    .delete();
  if (deleted === 0) {
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

router.get('/runs', async (req: AuthRequest, res) => {
  const { project, limit, offset } = req.query;

  let query = db('autopilot_runs')
    .where({ user_id: req.user!.id })
    .orderBy('started_at', 'desc');

  if (project && typeof project === 'string') {
    query = query.andWhere({ project_path: project });
  }

  if (limit) {
    const n = Number(limit);
    if (!Number.isNaN(n) && n > 0) {
      query = query.limit(n);
    }
  }
  if (offset) {
    const n = Number(offset);
    if (!Number.isNaN(n) && n >= 0) {
      query = query.offset(n);
    }
  }

  const rows = await query.select() as RunRow[];
  res.json({ runs: rows.map(rowToRun) });
});

router.get('/runs/:id', async (req: AuthRequest, res) => {
  const row = await db('autopilot_runs')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as RunRow | undefined;
  if (!row) { res.status(404).json({ error: 'Run not found' }); return; }
  res.json(rowToRun(row));
});

router.get('/runs/:id/cycles', async (req: AuthRequest, res) => {
  // Verify ownership
  const run = await db('autopilot_runs')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
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

  const rows = await db('autopilot_cycles')
    .where({ run_id: req.params.id })
    .orderBy('cycle_number', 'asc')
    .select() as CycleRow[];

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
    const run = await db('autopilot_runs')
      .where({ id: req.params.id, user_id: req.user!.id })
      .first() as RunRow | undefined;
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }

    const cycleNum = Number(req.params.cycleNumber);
    if (Number.isNaN(cycleNum)) {
      res.status(400).json({ error: 'Invalid cycle number' });
      return;
    }

    const cycle = await db('autopilot_cycles')
      .where({ run_id: req.params.id, cycle_number: cycleNum })
      .select('commit_hash')
      .first() as { commit_hash: string | null } | undefined;

    if (!cycle?.commit_hash) {
      res.status(404).json({ error: 'No commit for this cycle' });
      return;
    }

    const diff = await getCommitDiff(run.project_path, cycle.commit_hash);
    res.json({ diff });
  } catch (err) {
    log.warn({ err }, 'Failed to get commit diff');
    res.status(500).json({ error: String(err) });
  }
});

export default router;
