import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { spawn } from 'child_process';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { getDb } from '../db/database.js';

const log = createLogger('mcp');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware as any);

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');

// ─── Types ───────────────────────────────────────────────────────────────────

interface McpServerStdio {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpServerHttp {
  type?: 'sse' | 'http';
  url: string;
  headers?: Record<string, string>;
}

type McpServer = McpServerStdio | McpServerHttp;

interface McpServerRow {
  id: string;
  user_id: number;
  name: string;
  server_type: string;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface McpServerConfig {
  id: string;
  name: string;
  serverType: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    serverType: row.server_type,
    command: row.command,
    args: safeJsonParse<string[]>(row.args, []),
    env: safeJsonParse<Record<string, string>>(row.env, {}),
    url: row.url,
    headers: safeJsonParse<Record<string, string>>(row.headers, {}),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

// ─── Claude settings file helpers (legacy, kept for backward compat) ─────────

function readSettings(): Record<string, any> {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, any>) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

/**
 * Sync enabled MCP servers from our DB to ~/.claude/settings.json
 * so that Claude Code picks them up across all sessions.
 */
function syncToClaudeSettings(userId: number) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM mcp_servers WHERE user_id = ?',
  ).all(userId) as McpServerRow[];

  const settings = readSettings();
  const mcpServers: Record<string, McpServer> = {};

  for (const row of rows) {
    if (row.enabled !== 1) continue;
    if (row.server_type === 'stdio') {
      const server: McpServerStdio = { command: row.command };
      const args = safeJsonParse<string[]>(row.args, []);
      if (args.length > 0) server.args = args;
      const env = safeJsonParse<Record<string, string>>(row.env, {});
      if (Object.keys(env).length > 0) server.env = env;
      mcpServers[row.name] = server;
    } else {
      const server: McpServerHttp = {
        type: row.server_type as 'sse' | 'http',
        url: row.url,
      };
      const headers = safeJsonParse<Record<string, string>>(row.headers, {});
      if (Object.keys(headers).length > 0) server.headers = headers;
      mcpServers[row.name] = server;
    }
  }

  settings.mcpServers = mcpServers;
  writeSettings(settings);
}

// ─── Legacy endpoints (read from settings file directly) ─────────────────────

// GET /api/mcp/servers — list all MCP servers from settings file
router.get('/servers', (_req, res) => {
  const settings = readSettings();
  const servers: Record<string, McpServer> = settings.mcpServers || {};
  res.json({ servers });
});

// POST /api/mcp/servers — add or update a server in settings file
router.post('/servers', validate({
  body: z.object({
    name: z.string().min(1),
    config: z.record(z.unknown()),
  }),
}), (req, res) => {
  const { name, config: serverConfig } = req.body;
  const settings = readSettings();
  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers[name] = serverConfig;
  writeSettings(settings);
  res.json({ ok: true, servers: settings.mcpServers });
});

// DELETE /api/mcp/servers/:name — remove a server from settings file
router.delete('/servers/:name', (req, res) => {
  const { name } = req.params;
  const settings = readSettings();
  if (!settings.mcpServers || !settings.mcpServers[name]) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  delete settings.mcpServers[name];
  writeSettings(settings);
  res.json({ ok: true, servers: settings.mcpServers });
});

// ─── Managed MCP server CRUD (DB-backed) ─────────────────────────────────────

// GET /api/mcp/managed — list all managed MCP servers for the user
router.get('/managed', (req, res) => {
  const user = (req as AuthRequest).user!;
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY created_at ASC',
  ).all(user.id) as McpServerRow[];
  res.json({ servers: rows.map(rowToConfig) });
});

// POST /api/mcp/managed — create a new managed MCP server
router.post('/managed', validate({
  body: z.object({
    name: z.string().min(1).max(100),
    serverType: z.enum(['stdio', 'sse', 'http']),
    command: z.string().optional().default(''),
    args: z.array(z.string()).optional().default([]),
    env: z.record(z.string()).optional().default({}),
    url: z.string().optional().default(''),
    headers: z.record(z.string()).optional().default({}),
    enabled: z.boolean().optional().default(true),
  }),
}), (req, res) => {
  const user = (req as AuthRequest).user!;
  const { name, serverType, command, args, env, url, headers, enabled } = req.body;
  const db = getDb();

  // Check for duplicate name
  const existing = db.prepare(
    'SELECT id FROM mcp_servers WHERE user_id = ? AND name = ?',
  ).get(user.id, name);
  if (existing) {
    res.status(409).json({ error: 'A server with this name already exists' });
    return;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO mcp_servers (id, user_id, name, server_type, command, args, env, url, headers, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, user.id, name, serverType, command, JSON.stringify(args), JSON.stringify(env), url, JSON.stringify(headers), enabled ? 1 : 0);

  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow;
  syncToClaudeSettings(user.id);
  log.info({ userId: user.id, name }, 'MCP server created');
  res.status(201).json({ server: rowToConfig(row) });
});

// PUT /api/mcp/managed/:id — update a managed MCP server
router.put('/managed/:id', validate({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    serverType: z.enum(['stdio', 'sse', 'http']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
}), (req, res) => {
  const user = (req as AuthRequest).user!;
  const { id } = req.params;
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?',
  ).get(id, user.id) as McpServerRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  const updates = req.body;
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (updates.name !== undefined) {
    // Check for duplicate name (excluding current)
    const dup = db.prepare(
      'SELECT id FROM mcp_servers WHERE user_id = ? AND name = ? AND id != ?',
    ).get(user.id, updates.name, id);
    if (dup) {
      res.status(409).json({ error: 'A server with this name already exists' });
      return;
    }
    sets.push('name = ?'); vals.push(updates.name);
  }
  if (updates.serverType !== undefined) { sets.push('server_type = ?'); vals.push(updates.serverType); }
  if (updates.command !== undefined) { sets.push('command = ?'); vals.push(updates.command); }
  if (updates.args !== undefined) { sets.push('args = ?'); vals.push(JSON.stringify(updates.args)); }
  if (updates.env !== undefined) { sets.push('env = ?'); vals.push(JSON.stringify(updates.env)); }
  if (updates.url !== undefined) { sets.push('url = ?'); vals.push(updates.url); }
  if (updates.headers !== undefined) { sets.push('headers = ?'); vals.push(JSON.stringify(updates.headers)); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); vals.push(updates.enabled ? 1 : 0); }

  if (sets.length > 0) {
    sets.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }

  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow;
  syncToClaudeSettings(user.id);
  log.info({ userId: user.id, id, name: row.name }, 'MCP server updated');
  res.json({ server: rowToConfig(row) });
});

// DELETE /api/mcp/managed/:id — delete a managed MCP server
router.delete('/managed/:id', (req, res) => {
  const user = (req as AuthRequest).user!;
  const { id } = req.params;
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?',
  ).get(id, user.id) as McpServerRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  syncToClaudeSettings(user.id);
  log.info({ userId: user.id, id, name: existing.name }, 'MCP server deleted');
  res.json({ ok: true });
});

// PATCH /api/mcp/managed/:id/toggle — toggle enabled/disabled
router.patch('/managed/:id/toggle', (req, res) => {
  const user = (req as AuthRequest).user!;
  const { id } = req.params;
  const db = getDb();

  const existing = db.prepare(
    'SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?',
  ).get(id, user.id) as McpServerRow | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  const newEnabled = existing.enabled === 1 ? 0 : 1;
  db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newEnabled, id);

  const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow;
  syncToClaudeSettings(user.id);
  res.json({ server: rowToConfig(row) });
});

// POST /api/mcp/managed/:id/test — test an MCP server connection
router.post('/managed/:id/test', (req, res) => {
  const user = (req as AuthRequest).user!;
  const { id } = req.params;
  const db = getDb();

  const row = db.prepare(
    'SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?',
  ).get(id, user.id) as McpServerRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  const config = rowToConfig(row);

  if (config.serverType === 'stdio') {
    testStdioServer(config)
      .then(result => res.json(result))
      .catch(err => {
        log.error({ err, id: config.id }, 'MCP test failed');
        res.json({ status: 'error', error: err.message, tools: [] });
      });
  } else {
    testHttpServer(config)
      .then(result => res.json(result))
      .catch(err => {
        log.error({ err, id: config.id }, 'MCP test failed');
        res.json({ status: 'error', error: err.message, tools: [] });
      });
  }
});

// ─── Test helpers ────────────────────────────────────────────────────────────

interface TestResult {
  status: 'connected' | 'error';
  error?: string;
  tools: { name: string; description?: string }[];
}

function testStdioServer(config: McpServerConfig): Promise<TestResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve({ status: 'connected', tools: [], error: undefined });
    }, 8000);

    const envVars = { ...process.env, ...config.env };
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(config.command, config.args, {
        env: envVars,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      clearTimeout(timeout);
      resolve({ status: 'error', error: `Failed to spawn: ${(err as Error).message}`, tools: [] });
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    // Send JSON-RPC initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'viridian-test', version: '1.0.0' },
      },
    });

    child.stdin?.write(initRequest + '\n');

    // After a short delay, send tools/list
    setTimeout(() => {
      const toolsRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      child.stdin?.write(toolsRequest + '\n');
    }, 1000);

    // Wait for responses
    setTimeout(() => {
      clearTimeout(timeout);
      try { child.kill(); } catch { /* ignore */ }

      const tools: { name: string; description?: string }[] = [];
      // Parse JSON-RPC responses from stdout
      const lines = stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result?.tools) {
            for (const tool of msg.result.tools) {
              tools.push({ name: tool.name, description: tool.description });
            }
          }
        } catch { /* skip non-JSON lines */ }
      }

      resolve({ status: 'connected', tools });
    }, 4000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ status: 'error', error: err.message, tools: [] });
    });

    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        resolve({
          status: 'error',
          error: `Process exited with code ${code}${stderr ? ': ' + stderr.slice(0, 500) : ''}`,
          tools: [],
        });
      }
    });
  });
}

async function testHttpServer(config: McpServerConfig): Promise<TestResult> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'viridian-test', version: '1.0.0' },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { status: 'error', error: `HTTP ${response.status}: ${response.statusText}`, tools: [] };
    }

    // Try to get tools list
    const toolsController = new AbortController();
    const toolsTimeoutId = setTimeout(() => toolsController.abort(), 5000);

    try {
      const toolsResponse = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
        signal: toolsController.signal,
      });

      clearTimeout(toolsTimeoutId);

      if (toolsResponse.ok) {
        const data = await toolsResponse.json();
        const tools = (data.result?.tools || []).map((t: any) => ({
          name: t.name,
          description: t.description,
        }));
        return { status: 'connected', tools };
      }
    } catch {
      clearTimeout(toolsTimeoutId);
    }

    return { status: 'connected', tools: [] };
  } catch (err) {
    return { status: 'error', error: (err as Error).message, tools: [] };
  }
}

export default router;
