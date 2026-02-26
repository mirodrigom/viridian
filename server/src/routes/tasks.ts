import { Router } from 'express';
import { randomUUID } from 'crypto';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { getDb } from '../db/database.js';
import { claudeQuery } from '../services/claude-sdk.js';
import { getHomeDir, cwdToHash } from '../utils/platform.js';

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

/** Delete the JSONL session file that Claude CLI creates, so it doesn't appear in the chat sidebar. */
function cleanupClaudeSession(sessionId: string | undefined, projectPath: string) {
  if (!sessionId) return;
  try {
    const encodedCwd = cwdToHash(projectPath);
    const jsonlPath = join(getHomeDir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
    unlinkSync(jsonlPath);
  } catch { /* ignore if file doesn't exist */ }
  try {
    const db = getDb();
    const encodedCwd = cwdToHash(projectPath);
    db.prepare('DELETE FROM session_cache WHERE project_dir = ? AND id = ?').run(encodedCwd, sessionId);
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
router.get('/', (req: AuthRequest, res) => {
  const { project, status, priority, parentId } = req.query;
  if (!project || typeof project !== 'string') {
    res.status(400).json({ error: 'project query param required' });
    return;
  }

  const db = getDb();
  let sql = 'SELECT * FROM tasks WHERE user_id = ? AND project_path = ?';
  const params: unknown[] = [req.user!.id, project];

  if (status && typeof status === 'string') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (priority && typeof priority === 'string') {
    sql += ' AND priority = ?';
    params.push(priority);
  }
  if (parentId === 'null') {
    sql += ' AND parent_id IS NULL';
  } else if (parentId && typeof parentId === 'string') {
    sql += ' AND parent_id = ?';
    params.push(parentId);
  }

  sql += ' ORDER BY sort_order ASC, created_at ASC';

  const rows = db.prepare(sql).all(...params) as TaskRow[];
  res.json({ tasks: rows.map(rowToTask) });
});

// GET /:id — get single task
router.get('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as TaskRow | undefined;
  if (!row) { res.status(404).json({ error: 'Task not found' }); return; }

  // Include subtasks
  const subtasks = db.prepare('SELECT * FROM tasks WHERE parent_id = ? AND user_id = ? ORDER BY sort_order ASC').all(row.id, req.user!.id) as TaskRow[];
  res.json({ task: rowToTask(row), subtasks: subtasks.map(rowToTask) });
});

// POST / — create task
router.post('/', (req: AuthRequest, res) => {
  const { title, description, details, project, priority, parentId, dependencyIds } = req.body;
  if (!title || !project) {
    res.status(400).json({ error: 'title and project are required' });
    return;
  }

  const db = getDb();
  const id = randomUUID();
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM tasks WHERE user_id = ? AND project_path = ? AND parent_id IS ?',
  ).get(req.user!.id, project, parentId || null) as { next: number };

  db.prepare(`
    INSERT INTO tasks (id, user_id, project_path, title, description, details, priority, parent_id, dependency_ids, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user!.id, project, title, description || '', details || '', priority || 'medium', parentId || null, JSON.stringify(dependencyIds || []), maxOrder.next);

  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow;
  res.status(201).json(rowToTask(row));
});

// PUT /:id — update task
router.put('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as TaskRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }

  const { title, description, details, status, priority, parentId, dependencyIds, sortOrder } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (details !== undefined) { updates.push('details = ?'); params.push(details); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
  if (parentId !== undefined) { updates.push('parent_id = ?'); params.push(parentId || null); }
  if (dependencyIds !== undefined) { updates.push('dependency_ids = ?'); params.push(JSON.stringify(dependencyIds)); }
  if (sortOrder !== undefined) { updates.push('sort_order = ?'); params.push(sortOrder); }

  if (updates.length === 0) { res.json({ task: rowToTask(existing), parentUpdate: null }); return; }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(req.params.id, req.user!.id);

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as TaskRow;

  // Auto-sync parent status when a subtask's status changes
  let parentUpdate: ReturnType<typeof rowToTask> | null = null;
  if (status !== undefined && row.parent_id) {
    const siblings = db.prepare(
      'SELECT status FROM tasks WHERE parent_id = ? AND user_id = ?',
    ).all(row.parent_id, req.user!.id) as { status: string }[];

    const allDone = siblings.every(s => s.status === 'done');
    const allTodo = siblings.every(s => s.status === 'todo');
    const newParentStatus = allDone ? 'done' : allTodo ? 'todo' : 'in_progress';

    const parent = db.prepare(
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
    ).get(row.parent_id, req.user!.id) as TaskRow | undefined;

    if (parent && parent.status !== newParentStatus) {
      db.prepare(
        'UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(newParentStatus, parent.id);

      const updatedParent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parent.id) as TaskRow;
      parentUpdate = rowToTask(updatedParent);
    }
  }

  res.json({ task: rowToTask(row), parentUpdate });
});

// DELETE /:id — delete task (cascades to subtasks)
router.delete('/:id', (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id);
  if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }

  db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  // Also delete subtasks
  db.prepare('DELETE FROM tasks WHERE parent_id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

// POST /reorder — reorder tasks
router.post('/reorder', (req: AuthRequest, res) => {
  const { taskIds } = req.body;
  if (!Array.isArray(taskIds) || !taskIds.every((id: unknown) => typeof id === 'string')) {
    res.status(400).json({ error: 'taskIds must be an array of strings' });
    return;
  }
  const db = getDb();
  const stmt = db.prepare('UPDATE tasks SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    taskIds.forEach((id: string, index: number) => {
      stmt.run(index, id, req.user!.id);
    });
  });
  tx();
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
function saveTasksToDb(fullText: string, prdSnippet: string, userId: number, project: string): ReturnType<typeof rowToTask>[] {
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

  const db = getDb();
  const allIds: string[] = [];
  const titleToId = new Map<string, string>();

  const insertParentStmt = db.prepare(`
    INSERT INTO tasks (id, user_id, project_path, title, description, priority, prd_source, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSubStmt = db.prepare(`
    INSERT INTO tasks (id, user_id, project_path, title, description, priority, parent_id, prd_source, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDeps = db.prepare('UPDATE tasks SET dependency_ids = ? WHERE id = ?');

  const tx = db.transaction(() => {
    parsedTasks.forEach((t, i) => {
      const id = randomUUID();
      titleToId.set(t.title, id);
      allIds.push(id);
      insertParentStmt.run(id, userId, project, t.title, t.description || '', t.priority || 'medium', prdSnippet, i);
    });
    for (const t of parsedTasks) {
      const parentId = titleToId.get(t.title);
      if (!parentId || !t.subtasks) continue;
      t.subtasks.forEach((st, j) => {
        const subId = randomUUID();
        allIds.push(subId);
        insertSubStmt.run(subId, userId, project, st.title, st.description || '', st.priority || 'medium', parentId, prdSnippet, j);
      });
    }
    for (const t of parsedTasks) {
      const id = titleToId.get(t.title);
      if (!id) continue;
      const depIds = (t.dependencyTitles || []).map((title: string) => titleToId.get(title)).filter(Boolean);
      if (depIds.length > 0) updateDeps.run(JSON.stringify(depIds), id);
    }
  });
  tx();

  const placeholders = allIds.map(() => '?').join(',');
  const allRows = db.prepare(
    `SELECT * FROM tasks WHERE id IN (${placeholders}) ORDER BY parent_id IS NOT NULL, sort_order ASC`,
  ).all(...allIds) as TaskRow[];
  return allRows.map(rowToTask);
}

const JSON_OUTPUT_PROMPT = `Now output the complete task list as JSON. For each parent task (epic/feature), output a JSON object on its own line:
- title: short epic title (imperative form)
- description: 1-2 sentence summary
- priority: "high", "medium", or "low"
- dependencyTitles: array of other parent task titles this depends on (empty array if none)
- subtasks: array of 2-5 objects each with: title, description, priority

Each parent task MUST have subtasks. Output ONLY JSON objects, one per line. No markdown, no explanations, no code fences.`;

// POST /parse-prd — use Claude to break a PRD into tasks (SSE stream)
router.post('/parse-prd', (req: AuthRequest, res) => {
  const { prd, project } = req.body;
  if (!prd || !project) {
    res.status(400).json({ error: 'prd and project are required' });
    return;
  }

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
      for await (const msg of claudeQuery({
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

      const savedTasks = saveTasksToDb(fullText, prd.substring(0, 500), req.user!.id, project);

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
router.post('/prd-chat', (req: AuthRequest, res) => {
  const { message, project, sessionId, prd } = req.body;
  if (!message || !project) {
    res.status(400).json({ error: 'message and project are required' });
    return;
  }

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
      for await (const msg of claudeQuery({
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
router.post('/prd-finalize', (req: AuthRequest, res) => {
  const { project, sessionId, prd } = req.body;
  if (!project || !sessionId) {
    res.status(400).json({ error: 'project and sessionId are required' });
    return;
  }

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
      for await (const msg of claudeQuery({
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

      const savedTasks = saveTasksToDb(fullText, (prd || '').substring(0, 500), req.user!.id, project);

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

// POST /:id/expand — use Claude to break a task into subtasks (SSE stream)
router.post('/:id/expand', (req: AuthRequest, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as TaskRow | undefined;
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

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
      for await (const msg of claudeQuery({
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

      // Delete existing subtasks before inserting new ones
      db.prepare('DELETE FROM tasks WHERE parent_id = ? AND user_id = ?').run(task.id, userId);

      const insertStmt = db.prepare(`
        INSERT INTO tasks (id, user_id, project_path, title, description, priority, parent_id, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        subtasks.forEach((st, i) => {
          const id = randomUUID();
          insertStmt.run(id, userId, task.project_path, st.title, st.description || '', st.priority || 'medium', task.id, i);
        });
      });
      tx();

      const rows = db.prepare('SELECT * FROM tasks WHERE parent_id = ? AND user_id = ? ORDER BY sort_order ASC')
        .all(task.id, userId) as TaskRow[];
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
