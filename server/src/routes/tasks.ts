import { Router } from 'express';
import { randomUUID } from 'crypto';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { db } from '../db/database.js';
import { getProvider, getDefaultProvider } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import { getHomeDir, cwdToHash } from '../utils/platform.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('tasks');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

/** Normalize path separators to forward slashes for consistent DB matching. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Delete the JSONL session file that Claude CLI creates, so it doesn't appear in the chat sidebar. */
async function cleanupClaudeSession(sessionId: string | undefined, projectPath: string) {
  if (!sessionId) return;
  try {
    const encodedCwd = cwdToHash(projectPath);
    const jsonlPath = join(getHomeDir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
    unlinkSync(jsonlPath);
  } catch { /* ignore if file doesn't exist */ }
  try {
    const encodedCwd = cwdToHash(projectPath);
    await db('session_cache').where({ project_dir: encodedCwd, id: sessionId }).delete();
  } catch { /* ignore */ }
}

interface TaskRow {
  id: string;
  user_id: number;
  project_path: string;
  title: string;
  description: string;
  details: string;
  status: string;
  priority: string;
  parent_id: string | null;
  dependency_ids: string;
  prd_source: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow) {
  return {
    id: row.id,
    projectPath: row.project_path,
    title: row.title,
    description: row.description,
    details: row.details,
    status: row.status,
    priority: row.priority,
    parentId: row.parent_id,
    dependencyIds: safeJsonParse<string[]>(row.dependency_ids, []),
    prdSource: row.prd_source,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET / — list tasks for a project
router.get('/', validate({ query: z.object({ project: z.string().min(1) }).passthrough() }), async (req: AuthRequest, res) => {
  const { project, status, priority, parentId } = req.query;

  let query = db('tasks')
    .where({ user_id: req.user!.id, project_path: normalizePath(project as string) });

  if (status && typeof status === 'string') {
    query = query.where({ status });
  }
  if (priority && typeof priority === 'string') {
    query = query.where({ priority });
  }
  if (parentId === 'null') {
    query = query.whereNull('parent_id');
  } else if (parentId && typeof parentId === 'string') {
    query = query.where({ parent_id: parentId });
  }

  query = query.orderBy('sort_order', 'asc').orderBy('created_at', 'asc');

  const rows = await query.select() as TaskRow[];
  res.json({ tasks: rows.map(rowToTask) });
});

// GET /:id — get single task
router.get('/:id', async (req: AuthRequest, res) => {
  const row = await db('tasks')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as TaskRow | undefined;
  if (!row) { res.status(404).json({ error: 'Task not found' }); return; }

  // Include subtasks
  const subtasks = await db('tasks')
    .where({ parent_id: row.id, user_id: req.user!.id })
    .orderBy('sort_order', 'asc')
    .select() as TaskRow[];
  res.json({ task: rowToTask(row), subtasks: subtasks.map(rowToTask) });
});

// POST / — create task
router.post('/', validate({
  body: z.object({
    title: z.string().min(1),
    project: z.string().min(1),
    description: z.string().optional(),
    details: z.string().optional(),
    priority: z.string().optional(),
    parentId: z.string().nullable().optional(),
    dependencyIds: z.array(z.string()).optional(),
  }),
}), async (req: AuthRequest, res) => {
  const { title, description, details, project, priority, parentId, dependencyIds } = req.body;

  const id = randomUUID();
  const normalizedProject = normalizePath(project);

  const maxOrderRow = await db('tasks')
    .where({ user_id: req.user!.id, project_path: normalizedProject })
    .where(function () {
      if (parentId) {
        this.where({ parent_id: parentId });
      } else {
        this.whereNull('parent_id');
      }
    })
    .max('sort_order as next')
    .first() as { next: number | null };

  const nextOrder = (maxOrderRow?.next ?? -1) + 1;

  await db('tasks').insert({
    id,
    user_id: req.user!.id,
    project_path: normalizedProject,
    title,
    description: description || '',
    details: details || '',
    priority: priority || 'medium',
    parent_id: parentId || null,
    dependency_ids: JSON.stringify(dependencyIds || []),
    sort_order: nextOrder,
  });

  const row = await db('tasks').where({ id }).first() as TaskRow;
  res.status(201).json(rowToTask(row));
});

// PUT /:id — update task
router.put('/:id', async (req: AuthRequest, res) => {
  const existing = await db('tasks')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as TaskRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }

  const { title, description, details, status, priority, parentId, dependencyIds, sortOrder } = req.body;

  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (details !== undefined) updates.details = details;
  if (status !== undefined) updates.status = status;
  if (priority !== undefined) updates.priority = priority;
  if (parentId !== undefined) updates.parent_id = parentId || null;
  if (dependencyIds !== undefined) updates.dependency_ids = JSON.stringify(dependencyIds);
  if (sortOrder !== undefined) updates.sort_order = sortOrder;

  if (Object.keys(updates).length === 0) { res.json({ task: rowToTask(existing), parentUpdate: null }); return; }

  updates.updated_at = db.fn.now();

  await db('tasks').where({ id: req.params.id, user_id: req.user!.id }).update(updates);
  const row = await db('tasks').where({ id: req.params.id }).first() as TaskRow;

  // Auto-sync parent status when a subtask's status changes
  let parentUpdate: ReturnType<typeof rowToTask> | null = null;
  if (status !== undefined && row.parent_id) {
    const siblings = await db('tasks')
      .where({ parent_id: row.parent_id, user_id: req.user!.id })
      .select('status') as { status: string }[];

    const allDone = siblings.every(s => s.status === 'done');
    const allTodo = siblings.every(s => s.status === 'todo');
    const newParentStatus = allDone ? 'done' : allTodo ? 'todo' : 'in_progress';

    const parent = await db('tasks')
      .where({ id: row.parent_id, user_id: req.user!.id })
      .first() as TaskRow | undefined;

    if (parent && parent.status !== newParentStatus) {
      await db('tasks')
        .where({ id: parent.id })
        .update({ status: newParentStatus, updated_at: db.fn.now() });

      const updatedParent = await db('tasks').where({ id: parent.id }).first() as TaskRow;
      parentUpdate = rowToTask(updatedParent);
    }
  }

  res.json({ task: rowToTask(row), parentUpdate });
});

// DELETE /:id — delete task (cascades to subtasks)
router.delete('/:id', async (req: AuthRequest, res) => {
  const existing = await db('tasks')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('id')
    .first();
  if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }

  await db('tasks').where({ id: req.params.id, user_id: req.user!.id }).delete();
  // Also delete subtasks
  await db('tasks').where({ parent_id: req.params.id, user_id: req.user!.id }).delete();
  res.json({ ok: true });
});

// POST /reorder — reorder tasks
router.post('/reorder', validate({
  body: z.object({ taskIds: z.array(z.string()) }),
}), async (req: AuthRequest, res) => {
  const { taskIds } = req.body;
  await db.transaction(async (trx) => {
    for (let index = 0; index < taskIds.length; index++) {
      await trx('tasks')
        .where({ id: taskIds[index], user_id: req.user!.id })
        .update({ sort_order: index, updated_at: trx.fn.now() });
    }
  });
  res.json({ ok: true });
});

type ParsedTask = {
  title: string;
  description: string;
  priority: string;
  dependencyTitles: string[];
  subtasks?: Array<{ title: string; description: string; priority: string }>;
};

/** Parse JSON task lines from Claude output and save them to the DB. */
async function saveTasksToDb(fullText: string, prdSnippet: string, userId: number, project: string): Promise<ReturnType<typeof rowToTask>[]> {
  project = normalizePath(project);
  const parsedTasks: ParsedTask[] = [];
  for (const line of fullText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.title) parsedTasks.push(parsed);
    } catch { /* skip non-JSON lines */ }
  }
  if (parsedTasks.length === 0) return [];

  const allIds: string[] = [];
  const titleToId = new Map<string, string>();

  await db.transaction(async (trx) => {
    for (let i = 0; i < parsedTasks.length; i++) {
      const t = parsedTasks[i];
      const id = randomUUID();
      titleToId.set(t.title, id);
      allIds.push(id);
      await trx('tasks').insert({
        id,
        user_id: userId,
        project_path: project,
        title: t.title,
        description: t.description || '',
        priority: t.priority || 'medium',
        prd_source: prdSnippet,
        sort_order: i,
      });
    }

    for (const t of parsedTasks) {
      const parentId = titleToId.get(t.title);
      if (!parentId || !t.subtasks) continue;
      for (let j = 0; j < t.subtasks.length; j++) {
        const st = t.subtasks[j];
        const subId = randomUUID();
        allIds.push(subId);
        await trx('tasks').insert({
          id: subId,
          user_id: userId,
          project_path: project,
          title: st.title,
          description: st.description || '',
          priority: st.priority || 'medium',
          parent_id: parentId,
          prd_source: prdSnippet,
          sort_order: j,
        });
      }
    }

    for (const t of parsedTasks) {
      const id = titleToId.get(t.title);
      if (!id) continue;
      const depIds = (t.dependencyTitles || []).map((title: string) => titleToId.get(title)).filter(Boolean);
      if (depIds.length > 0) {
        await trx('tasks').where({ id }).update({ dependency_ids: JSON.stringify(depIds) });
      }
    }
  });

  const allRows = await db('tasks')
    .whereIn('id', allIds)
    .orderByRaw('parent_id IS NOT NULL, sort_order ASC')
    .select() as TaskRow[];
  return allRows.map(rowToTask);
}

const JSON_OUTPUT_PROMPT = `Now output the complete task list as JSON. For each parent task (epic/feature), output a JSON object on its own line:
- title: short epic title (imperative form)
- description: 1-2 sentence summary
- priority: "high", "medium", or "low"
- dependencyTitles: array of other parent task titles this depends on (empty array if none)
- subtasks: array of 2-5 objects each with: title, description, priority

Each parent task MUST have subtasks. Output ONLY JSON objects, one per line. No markdown, no explanations, no code fences.`;

// POST /parse-prd — use AI to break a PRD into tasks (SSE stream)
router.post('/parse-prd', validate({
  body: z.object({
    prd: z.string().min(1),
    project: z.string().min(1),
    providerId: z.string().optional(),
  }),
}), (req: AuthRequest, res) => {
  const { prd, project, providerId } = req.body;
  const provider = providerId ? getProvider(providerId as ProviderId) : getDefaultProvider();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const prompt = `You are a project manager AI. Parse the following PRD (Product Requirements Document) into a hierarchical list of parent tasks (epics/features), each with specific subtasks.

${JSON_OUTPUT_PROMPT}

PRD:
${prd}`;

  const abortController = new AbortController();
  let fullText = '';
  let claudeSessionId: string | undefined;

  res.on('close', () => abortController.abort());

  const timeout = setTimeout(() => {
    abortController.abort();
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Request timed out after 5 minutes' })}\n\n`);
    res.end();
  }, 5 * 60_000);

  (async () => {
    try {
      for await (const msg of provider.query({
        prompt,
        cwd: project,
        permissionMode: 'plan',
        abortSignal: abortController.signal,
      })) {
        if (msg.type === 'text_delta') {
          fullText += msg.text;
          res.write(`event: delta\ndata: ${JSON.stringify({ text: msg.text })}\n\n`);
        }
        if (msg.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ error: msg.error })}\n\n`);
        }
        if (msg.type === 'system' && msg.sessionId) claudeSessionId = msg.sessionId;
        if (msg.type === 'result' && msg.sessionId) claudeSessionId = msg.sessionId;
      }

      const savedTasks = await saveTasksToDb(fullText, prd.substring(0, 500), req.user!.id, project);

      clearTimeout(timeout);
      res.write(`event: done\ndata: ${JSON.stringify({ tasks: savedTasks })}\n\n`);
      res.end();
      cleanupClaudeSession(claudeSessionId, project);
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : 'PRD parsing failed';
      res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
      cleanupClaudeSession(claudeSessionId, project);
    }
  })();
});

// POST /prd-chat — one turn of a conversational PRD analysis (SSE stream)
router.post('/prd-chat', validate({
  body: z.object({
    message: z.string().min(1),
    project: z.string().min(1),
    sessionId: z.string().optional(),
    prd: z.string().optional(),
    providerId: z.string().optional(),
  }),
}), (req: AuthRequest, res) => {
  const { message, project, sessionId, prd, providerId } = req.body;
  const provider = providerId ? getProvider(providerId as ProviderId) : getDefaultProvider();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // First message: include the PRD as context
  const prompt = !sessionId && prd
    ? `You are a project manager AI helping to plan implementation tasks from a PRD. Analyze the PRD and describe how you'd break it into epics and subtasks. Be concise. Ask clarifying questions if the PRD is ambiguous.\n\nPRD:\n${prd}\n\n${message}`
    : message;

  const abortController = new AbortController();
  let newSessionId: string | undefined;

  res.on('close', () => abortController.abort());

  const timeout = setTimeout(() => {
    abortController.abort();
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Request timed out after 5 minutes' })}\n\n`);
    res.end();
  }, 5 * 60_000);

  (async () => {
    try {
      for await (const msg of provider.query({
        prompt,
        cwd: project,
        permissionMode: 'plan',
        noTools: true,
        sessionId: sessionId || undefined,
        abortSignal: abortController.signal,
        appendSystemPrompt: 'IMPORTANT: Do NOT use any tools, file reads, or shell commands. Respond with plain conversational text only based on the PRD content provided in this conversation. Do not attempt to explore the codebase.',
      })) {
        if (msg.type === 'text_delta') {
          res.write(`event: delta\ndata: ${JSON.stringify({ text: msg.text })}\n\n`);
        }
        if (msg.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ error: msg.error })}\n\n`);
        }
        if (msg.type === 'system' && msg.sessionId) newSessionId = msg.sessionId;
        if (msg.type === 'result' && msg.sessionId) newSessionId = msg.sessionId;
      }

      clearTimeout(timeout);
      res.write(`event: done\ndata: ${JSON.stringify({ sessionId: newSessionId })}\n\n`);
      res.end();
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = err instanceof Error ? err.message : 'Chat failed';
      res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`);
      res.end();
    }
  })();
});

// POST /prd-finalize — generate JSON tasks from conversation, save to DB (SSE stream)
router.post('/prd-finalize', validate({
  body: z.object({
    project: z.string().min(1),
    sessionId: z.string().min(1),
    prd: z.string().optional(),
    providerId: z.string().optional(),
  }),
}), (req: AuthRequest, res) => {
  const { project, sessionId, prd, providerId } = req.body;
  const provider = providerId ? getProvider(providerId as ProviderId) : getDefaultProvider();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const abortController = new AbortController();
  let fullText = '';
  let finalSessionId: string | undefined;

  res.on('close', () => abortController.abort());

  const timeout = setTimeout(() => {
    abortController.abort();
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Request timed out after 5 minutes' })}\n\n`);
    res.end();
  }, 5 * 60_000);

  (async () => {
    try {
      for await (const msg of provider.query({
        prompt: JSON_OUTPUT_PROMPT,
        cwd: project,
        permissionMode: 'plan',
        noTools: true,
        sessionId,
        abortSignal: abortController.signal,
        appendSystemPrompt: 'IMPORTANT: Do NOT use any tools or file reads. Output ONLY the JSON task objects as plain text, one per line. No tool calls, no markdown, no explanations.',
      })) {
        if (msg.type === 'text_delta') {
          fullText += msg.text;
          res.write(`event: delta\ndata: ${JSON.stringify({ text: msg.text })}\n\n`);
        }
        if (msg.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ error: msg.error })}\n\n`);
        }
        if (msg.type === 'system' && msg.sessionId) finalSessionId = msg.sessionId;
        if (msg.type === 'result' && msg.sessionId) finalSessionId = msg.sessionId;
      }

      const savedTasks = await saveTasksToDb(fullText, (prd || '').substring(0, 500), req.user!.id, project);

      clearTimeout(timeout);
      res.write(`event: done\ndata: ${JSON.stringify({ tasks: savedTasks })}\n\n`);
      res.end();
      cleanupClaudeSession(finalSessionId, project);
    } catch (err) {
      clearTimeout(timeout);
      const errMsg = err instanceof Error ? err.message : 'Finalization failed';
      res.write(`event: error\ndata: ${JSON.stringify({ error: errMsg })}\n\n`);
      res.end();
    }
  })();
});

// POST /:id/expand — use AI to break a task into subtasks (SSE stream)
router.post('/:id/expand', async (req: AuthRequest, res) => {
  const task = await db('tasks')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as TaskRow | undefined;
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  const provider = req.body?.providerId ? getProvider(req.body.providerId as ProviderId) : getDefaultProvider();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const prompt = `Break down the following task into smaller subtasks (3-7 subtasks).

Task: ${task.title}
Description: ${task.description}
${task.details ? `Details: ${task.details}` : ''}

For each subtask, output a JSON object on its own line:
- title: short subtask title (imperative form)
- description: 1-2 sentence summary
- priority: "high", "medium", or "low"

Output ONLY the JSON objects, one per line. No markdown, no explanations.`;

  const abortController = new AbortController();
  let fullText = '';
  let claudeSessionId: string | undefined;

  res.on('close', () => abortController.abort());

  const expandTimeout = setTimeout(() => {
    abortController.abort();
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Request timed out after 5 minutes' })}\n\n`);
    res.end();
  }, 5 * 60_000);

  (async () => {
    try {
      for await (const msg of provider.query({
        prompt,
        cwd: task.project_path,
        permissionMode: 'plan',
        abortSignal: abortController.signal,
      })) {
        if (msg.type === 'text_delta') {
          fullText += msg.text;
          res.write(`event: delta\ndata: ${JSON.stringify({ text: msg.text })}\n\n`);
        }
        if (msg.type === 'system' && msg.sessionId) claudeSessionId = msg.sessionId;
        if (msg.type === 'result' && msg.sessionId) claudeSessionId = msg.sessionId;
      }

      // Parse subtasks
      const subtasks: Array<{ title: string; description: string; priority: string }> = [];
      for (const line of fullText.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.title) subtasks.push(parsed);
        } catch { /* skip */ }
      }

      // Save subtasks
      const userId = req.user!.id;
      const saved: ReturnType<typeof rowToTask>[] = [];

      await db.transaction(async (trx) => {
        // Delete existing subtasks before inserting new ones
        await trx('tasks').where({ parent_id: task.id, user_id: userId }).delete();

        for (let i = 0; i < subtasks.length; i++) {
          const st = subtasks[i];
          const id = randomUUID();
          await trx('tasks').insert({
            id,
            user_id: userId,
            project_path: task.project_path,
            title: st.title,
            description: st.description || '',
            priority: st.priority || 'medium',
            parent_id: task.id,
            sort_order: i,
          });
        }
      });

      const rows = await db('tasks')
        .where({ parent_id: task.id, user_id: userId })
        .orderBy('sort_order', 'asc')
        .select() as TaskRow[];
      for (const row of rows) saved.push(rowToTask(row));

      clearTimeout(expandTimeout);
      res.write(`event: done\ndata: ${JSON.stringify({ subtasks: saved })}\n\n`);
      res.end();
      cleanupClaudeSession(claudeSessionId, task.project_path);
    } catch (err) {
      clearTimeout(expandTimeout);
      const msg = err instanceof Error ? err.message : 'Task expansion failed';
      res.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
      cleanupClaudeSession(claudeSessionId, task.project_path);
    }
  })();
});

export default router;
