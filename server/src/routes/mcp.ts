import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';

const log = createLogger('mcp');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware as any);

const CLAUDE_DIR = join(homedir(), '.claude');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');

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

// GET /api/mcp/servers — list all MCP servers
router.get('/servers', (_req, res) => {
  const settings = readSettings();
  const servers: Record<string, McpServer> = settings.mcpServers || {};
  res.json({ servers });
});

// POST /api/mcp/servers — add or update a server
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

// DELETE /api/mcp/servers/:name — remove a server
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

export default router;
