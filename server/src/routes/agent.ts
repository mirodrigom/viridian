import { Router } from 'express';
import { createHash } from 'crypto';
import { createSession, getSession, sendMessage, abortSession, removeSession, type SendMessageOptions } from '../services/claude.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { verifyToken } from '../services/auth.js';
import { getDb } from '../db/database.js';

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
    const db = getDb();
    const key = db.prepare(
      'SELECT api_keys.id, api_keys.user_id, users.username FROM api_keys JOIN users ON api_keys.user_id = users.id WHERE api_keys.key_hash = ? AND api_keys.revoked = 0',
    ).get(hash) as { id: number; user_id: number; username: string } | undefined;

    if (!key) {
      res.status(401).json({ error: 'Invalid or revoked API key' });
      return;
    }

    // Update last_used_at
    db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(key.id);

    req.user = { id: key.user_id, username: key.username };
    next();
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
router.post('/run', (req, res) => {
  const { prompt, cwd, model, permissionMode, maxOutputTokens, allowedTools, disallowedTools } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  const projectDir = cwd || process.env.HOME || '/home';
  const session = createSession(projectDir);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Session-Id': session.id,
  });

  const emitter = session.emitter;
  let fullText = '';
  let thinkingText = '';

  emitter.on('stream_start', () => {
    res.write(`event: start\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);
  });

  emitter.on('stream_delta', (d: { text: string }) => {
    fullText += d.text;
    res.write(`event: delta\ndata: ${JSON.stringify({ text: d.text })}\n\n`);
  });

  emitter.on('thinking_start', () => {
    res.write(`event: thinking_start\ndata: {}\n\n`);
  });

  emitter.on('thinking_delta', (d: { text: string }) => {
    thinkingText += d.text;
    res.write(`event: thinking_delta\ndata: ${JSON.stringify({ text: d.text })}\n\n`);
  });

  emitter.on('thinking_end', () => {
    res.write(`event: thinking_end\ndata: ${JSON.stringify({ thinking: thinkingText })}\n\n`);
  });

  emitter.on('tool_use', (d: { tool: string; input: unknown; requestId: string }) => {
    res.write(`event: tool_use\ndata: ${JSON.stringify(d)}\n\n`);
  });

  emitter.on('tool_input_complete', (d: { requestId: string; tool: string; input: unknown }) => {
    res.write(`event: tool_result\ndata: ${JSON.stringify(d)}\n\n`);
  });

  emitter.on('error', (d: { error: string }) => {
    res.write(`event: error\ndata: ${JSON.stringify(d)}\n\n`);
  });

  emitter.on('stream_end', (d: { sessionId: string; claudeSessionId?: string; exitCode?: number }) => {
    res.write(`event: done\ndata: ${JSON.stringify({
      sessionId: d.sessionId,
      claudeSessionId: d.claudeSessionId,
      exitCode: d.exitCode,
      text: fullText,
      thinking: thinkingText || undefined,
    })}\n\n`);
    res.end();
    removeSession(session.id);
  });

  // Handle client disconnect
  res.on('close', () => {
    abortSession(session.id);
    removeSession(session.id);
  });

  const options: SendMessageOptions = {};
  if (model) options.model = model;
  if (permissionMode) options.permissionMode = permissionMode;
  if (maxOutputTokens && typeof maxOutputTokens === 'number') options.maxOutputTokens = maxOutputTokens;
  if (allowedTools && Array.isArray(allowedTools)) options.allowedTools = allowedTools;
  if (disallowedTools && Array.isArray(disallowedTools)) options.disallowedTools = disallowedTools;

  sendMessage(session.id, prompt, options);
});

// POST /sessions — create a persistent session
router.post('/sessions', (req, res) => {
  const { cwd } = req.body;
  const projectDir = cwd || process.env.HOME || '/home';
  const session = createSession(projectDir);
  res.status(201).json({ sessionId: session.id, cwd: projectDir });
});

// POST /sessions/:id — send message to existing session (SSE stream)
router.post('/sessions/:id', (req, res) => {
  const { id } = req.params;
  const { prompt, model, permissionMode, maxOutputTokens, allowedTools, disallowedTools } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

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
  emitter.removeAllListeners();

  let fullText = '';

  emitter.on('stream_start', () => {
    res.write(`event: start\ndata: ${JSON.stringify({ sessionId: session.id })}\n\n`);
  });

  emitter.on('stream_delta', (d: { text: string }) => {
    fullText += d.text;
    res.write(`event: delta\ndata: ${JSON.stringify({ text: d.text })}\n\n`);
  });

  emitter.on('thinking_start', () => {
    res.write(`event: thinking_start\ndata: {}\n\n`);
  });

  emitter.on('thinking_delta', (d: { text: string }) => {
    res.write(`event: thinking_delta\ndata: ${JSON.stringify({ text: d.text })}\n\n`);
  });

  emitter.on('thinking_end', () => {
    res.write(`event: thinking_end\ndata: {}\n\n`);
  });

  emitter.on('tool_use', (d: { tool: string; input: unknown; requestId: string }) => {
    res.write(`event: tool_use\ndata: ${JSON.stringify(d)}\n\n`);
  });

  emitter.on('tool_input_complete', (d: { requestId: string; tool: string; input: unknown }) => {
    res.write(`event: tool_result\ndata: ${JSON.stringify(d)}\n\n`);
  });

  emitter.on('error', (d: { error: string }) => {
    res.write(`event: error\ndata: ${JSON.stringify(d)}\n\n`);
  });

  emitter.on('stream_end', (d: { sessionId: string; claudeSessionId?: string; exitCode?: number }) => {
    res.write(`event: done\ndata: ${JSON.stringify({
      sessionId: d.sessionId,
      claudeSessionId: d.claudeSessionId,
      exitCode: d.exitCode,
      text: fullText,
    })}\n\n`);
    res.end();
  });

  res.on('close', () => {
    abortSession(session.id);
  });

  const options: SendMessageOptions = {};
  if (model) options.model = model;
  if (permissionMode) options.permissionMode = permissionMode;
  if (maxOutputTokens && typeof maxOutputTokens === 'number') options.maxOutputTokens = maxOutputTokens;
  if (allowedTools && Array.isArray(allowedTools)) options.allowedTools = allowedTools;
  if (disallowedTools && Array.isArray(disallowedTools)) options.disallowedTools = disallowedTools;

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
