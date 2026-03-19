import { Router } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createSession, getSession, sendMessage, abortSession, removeSession, type SendMessageOptions } from '../services/claude.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { getHomeDir } from '../utils/platform.js';
import { verifyToken } from '../services/auth.js';
import { db } from '../db/database.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('agent');
const router: ReturnType<typeof Router> = Router();

/**
 * Headless Agent API
 *
 * Authenticate via:
 *   - Bearer <jwt-token>    (same as web UI)
 *   - Bearer ck_<api-key>   (API key from /api/keys)
 *
 * Endpoints:
 *   POST /api/agent/run            — one-shot: send prompt, stream response via SSE
 *   POST /api/agent/sessions       — create a reusable session
 *   POST /api/agent/sessions/:id   — send message to existing session (SSE stream)
 *   GET  /api/agent/sessions/:id   — get session info
 *   DELETE /api/agent/sessions/:id — abort and delete session
 */

// Auth middleware that accepts both JWT and API keys
function agentAuth(req: AuthRequest, res: any, next: any) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = header.slice(7);

  // API key auth (ck_ prefix)
  if (token.startsWith('ck_')) {
    const hash = createHash('sha256').update(token).digest('hex');
    db('api_keys')
      .join('users', 'api_keys.user_id', 'users.id')
      .where('api_keys.key_hash', hash)
      .where('api_keys.revoked', 0)
      .select('api_keys.id', 'api_keys.user_id', 'users.username')
      .first()
      .then(async (key: { id: number; user_id: number; username: string } | undefined) => {
        if (!key) {
          res.status(401).json({ error: 'Invalid or revoked API key' });
          return;
        }

        // Update last_used_at
        await db('api_keys').where({ id: key.id }).update({ last_used_at: db.fn.now() });

        req.user = { id: key.user_id, username: key.username };
        next();
      })
      .catch(() => {
        res.status(500).json({ error: 'Authentication error' });
      });
    return;
  }

  // JWT auth (fallback)
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.use(agentAuth as any);

// POST /run — one-shot execution with SSE streaming
router.post('/run', validate({
  body: z.object({
    prompt: z.string().min(1),
    cwd: z.string().optional(),
    model: z.string().optional(),
    permissionMode: z.string().optional(),
    maxOutputTokens: z.number().optional(),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
  }),
}), (req, res) => {
  const { prompt, cwd, model, permissionMode, maxOutputTokens, allowedTools, disallowedTools } = req.body;

  const projectDir = cwd || getHomeDir();
  const session = createSession(projectDir);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Session-Id': session.id,
  });

  const emitter = session.emitter;
  const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
  let fullText = '';
  let thinkingText = '';

  function addHandler(event: string, handler: (...args: unknown[]) => void) {
    emitter.on(event, handler);
    listeners.push({ event, handler });
  }

  function cleanupListeners() {
    for (const { event, handler } of listeners) {
      emitter.removeListener(event, handler);
    }
    listeners.length = 0;
  }

  addHandler('stream_start', () => {
    res.write(`event: start\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);
  });

  addHandler('stream_delta', (d: unknown) => {
    fullText += (d as { text: string }).text;
    res.write(`event: delta\ndata: ${JSON.stringify({ text: (d as { text: string }).text })}\n\n`);
  });

  addHandler('thinking_start', () => {
    res.write(`event: thinking_start\ndata: {}\n\n`);
  });

  addHandler('thinking_delta', (d: unknown) => {
    thinkingText += (d as { text: string }).text;
    res.write(`event: thinking_delta\ndata: ${JSON.stringify({ text: (d as { text: string }).text })}\n\n`);
  });

  addHandler('thinking_end', () => {
    res.write(`event: thinking_end\ndata: ${JSON.stringify({ thinking: thinkingText })}\n\n`);
  });

  addHandler('tool_use', (d: unknown) => {
    res.write(`event: tool_use\ndata: ${JSON.stringify(d)}\n\n`);
  });

  addHandler('tool_input_complete', (d: unknown) => {
    res.write(`event: tool_result\ndata: ${JSON.stringify(d)}\n\n`);
  });

  addHandler('error', (d: unknown) => {
    res.write(`event: error\ndata: ${JSON.stringify(d)}\n\n`);
  });

  addHandler('stream_end', (d: unknown) => {
    const data = d as { sessionId: string; claudeSessionId?: string; exitCode?: number };
    res.write(`event: done\ndata: ${JSON.stringify({
      sessionId: data.sessionId,
      claudeSessionId: data.claudeSessionId,
      exitCode: data.exitCode,
      text: fullText,
      thinking: thinkingText || undefined,
    })}\n\n`);
    cleanupListeners();
    res.end();
    removeSession(session.id);
  });

  // Handle client disconnect
  res.on('close', () => {
    cleanupListeners();
    abortSession(session.id);
    removeSession(session.id);
  });

  const options: SendMessageOptions = {};
  if (model) options.model = model;
  if (permissionMode) options.permissionMode = permissionMode;
  if (maxOutputTokens && typeof maxOutputTokens === 'number') options.maxOutputTokens = maxOutputTokens;
  if (allowedTools && Array.isArray(allowedTools)) options.allowedTools = allowedTools.filter((t: unknown): t is string => typeof t === 'string');
  if (disallowedTools && Array.isArray(disallowedTools)) options.disallowedTools = disallowedTools.filter((t: unknown): t is string => typeof t === 'string');

  sendMessage(session.id, prompt, options);
});

// POST /sessions — create a persistent session
router.post('/sessions', (req, res) => {
  const { cwd } = req.body;
  const projectDir = cwd || getHomeDir();
  const session = createSession(projectDir);
  res.status(201).json({ sessionId: session.id, cwd: projectDir });
});

// POST /sessions/:id — send message to existing session (SSE stream)
router.post('/sessions/:id', validate({
  body: z.object({
    prompt: z.string().min(1),
    model: z.string().optional(),
    permissionMode: z.string().optional(),
    maxOutputTokens: z.number().optional(),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
  }),
}), (req, res) => {
  const { id } = req.params;
  const { prompt, model, permissionMode, maxOutputTokens, allowedTools, disallowedTools } = req.body;

  const session = getSession(id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const emitter = session.emitter;
  const listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  function addHandler(event: string, handler: (...args: unknown[]) => void) {
    emitter.on(event, handler);
    listeners.push({ event, handler });
  }

  function cleanupListeners() {
    for (const { event, handler } of listeners) {
      emitter.removeListener(event, handler);
    }
    listeners.length = 0;
  }

  let fullText = '';

  addHandler('stream_start', () => {
    res.write(`event: start\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);
  });

  addHandler('stream_delta', (d: unknown) => {
    fullText += (d as { text: string }).text;
    res.write(`event: delta\ndata: ${JSON.stringify({ text: (d as { text: string }).text })}\n\n`);
  });

  addHandler('thinking_start', () => {
    res.write(`event: thinking_start\ndata: {}\n\n`);
  });

  addHandler('thinking_delta', (d: unknown) => {
    res.write(`event: thinking_delta\ndata: ${JSON.stringify({ text: (d as { text: string }).text })}\n\n`);
  });

  addHandler('thinking_end', () => {
    res.write(`event: thinking_end\ndata: {}\n\n`);
  });

  addHandler('tool_use', (d: unknown) => {
    res.write(`event: tool_use\ndata: ${JSON.stringify(d)}\n\n`);
  });

  addHandler('tool_input_complete', (d: unknown) => {
    res.write(`event: tool_result\ndata: ${JSON.stringify(d)}\n\n`);
  });

  addHandler('error', (d: unknown) => {
    res.write(`event: error\ndata: ${JSON.stringify(d)}\n\n`);
  });

  addHandler('stream_end', (d: unknown) => {
    const data = d as { sessionId: string; claudeSessionId?: string; exitCode?: number };
    res.write(`event: done\ndata: ${JSON.stringify({
      sessionId: data.sessionId,
      claudeSessionId: data.claudeSessionId,
      exitCode: data.exitCode,
      text: fullText,
    })}\n\n`);
    cleanupListeners();
    res.end();
  });

  res.on('close', () => {
    cleanupListeners();
    abortSession(session.id);
  });

  const options: SendMessageOptions = {};
  if (model) options.model = model;
  if (permissionMode) options.permissionMode = permissionMode;
  if (maxOutputTokens && typeof maxOutputTokens === 'number') options.maxOutputTokens = maxOutputTokens;
  if (allowedTools && Array.isArray(allowedTools)) options.allowedTools = allowedTools.filter((t: unknown): t is string => typeof t === 'string');
  if (disallowedTools && Array.isArray(disallowedTools)) options.disallowedTools = disallowedTools.filter((t: unknown): t is string => typeof t === 'string');

  sendMessage(session.id, prompt, options);
});

// GET /sessions/:id — get session info
router.get('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    sessionId: session.id,
    claudeSessionId: session.claudeSessionId || null,
    cwd: session.cwd,
    isRunning: !!session.process || !!(session as any).abortController,
  });
});

// DELETE /sessions/:id — abort and remove session
router.delete('/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  removeSession(session.id);
  res.json({ ok: true });
});

export default router;
