import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load .env before anything else — tsx watch doesn't forward --env-file to its child process
const __envDir = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(resolve(__envDir, '../../.env')); } catch { /* .env optional */ }

import express, { type Express } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { config } from './config.js';
import { createLogger } from './logger.js';
import authRoutes from './routes/auth.js';
import filesRoutes from './routes/files.js';
import gitRoutes from './routes/git.js';
import sessionsRoutes from './routes/sessions.js';
import mcpRoutes from './routes/mcp.js';
import apikeysRoutes from './routes/apikeys.js';
import agentRoutes from './routes/agent.js';
import tasksRoutes from './routes/tasks.js';
import graphsRoutes from './routes/graphs.js';
import graphRunsRoutes from './routes/graph-runs.js';
import autopilotRoutes from './routes/autopilot.js';
import providersRoutes from './routes/providers.js';
import managementRoutes from './routes/management.js';
import diagramsRoutes from './routes/diagrams.js';
import manualsRoutes from './routes/manuals.js';
import langfuseRoutes from './routes/langfuse.js';
import { authMiddleware } from './middleware/auth.js';
import { setupChatWs } from './ws/chat.js';
import { setupShellWs } from './ws/shell.js';
import { setupSessionsWs } from './ws/sessions.js';
import { setupGraphRunnerWs } from './ws/graph-runner.js';
import { setupAutopilotWs } from './ws/autopilot.js';
import { setupManagementWs } from './ws/management.js';
import { setupTracesWs } from './ws/traces.js';
import { startScheduler, stopScheduler } from './services/autopilot-scheduler.js';
import { cleanupZombieRuns } from './services/autopilot.js';
import { destroyAllTerminals } from './services/terminal.js';
import { loadProviderConfigs } from './db/database.js';

// Load saved provider API keys into process.env before any provider is invoked
loadProviderConfigs();

const app: Express = express();
const server = createServer(app);

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '10mb' }));

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/files', filesRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/keys', apikeysRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/graphs', graphsRoutes);
app.use('/api/graph-runs', graphRunsRoutes);
app.use('/api/autopilot', autopilotRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/management', managementRoutes);
app.use('/api/diagrams', diagramsRoutes);
app.use('/api/manuals', manualsRoutes);
app.use('/api/langfuse', authMiddleware, langfuseRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version endpoint - reads from root package.json
let appVersion = '0.0.0';
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootPkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  appVersion = rootPkg.version || appVersion;
} catch {
  // fallback version
}

app.get('/api/version', (_req, res) => {
  res.json({ version: appVersion });
});

// Server-side GitHub release check – avoids browser console 404 noise
// when the repo is private or has no published releases.
const GITHUB_REPO = 'mirodrigom/viridian';
let cachedLatestRelease: { tag_name?: string; fetchedAt: number } = { fetchedAt: 0 };
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

app.get('/api/version/latest', async (_req, res) => {
  try {
    const now = Date.now();
    if (now - cachedLatestRelease.fetchedAt < RELEASE_CACHE_TTL && cachedLatestRelease.tag_name) {
      return res.json({ tag_name: cachedLatestRelease.tag_name });
    }
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github.v3+json' } },
    );
    if (!ghRes.ok) {
      cachedLatestRelease = { fetchedAt: now };
      return res.json({});
    }
    const data = await ghRes.json() as { tag_name?: string };
    cachedLatestRelease = { tag_name: data.tag_name, fetchedAt: now };
    res.json({ tag_name: data.tag_name });
  } catch {
    res.json({});
  }
});

app.get('/api/me', authMiddleware, (req, res) => {
  const authReq = req as import('./middleware/auth.js').AuthRequest;
  res.json({ user: authReq.user });
});

// WebSocket handlers
setupChatWs(server);
setupShellWs(server);
const sessionsWs = setupSessionsWs(server);
setupGraphRunnerWs(server);
setupAutopilotWs(server);
setupManagementWs(server);
setupTracesWs(server);

const log = createLogger('server');

server.listen(config.port, config.host, () => {
  log.info({ host: config.host, port: config.port }, 'Server started');
  cleanupZombieRuns();
  startScheduler();
});

function shutdown() {
  log.info('Shutting down...');
  stopScheduler();
  sessionsWs.close();
  destroyAllTerminals();
  server.close(() => {
    log.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception');
  shutdown();
});

export { server, app };
