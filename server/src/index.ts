import express, { type Express } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
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
import { authMiddleware } from './middleware/auth.js';
import { setupChatWs } from './ws/chat.js';
import { setupShellWs } from './ws/shell.js';
import { setupSessionsWs } from './ws/sessions.js';
import { setupGraphRunnerWs } from './ws/graph-runner.js';
import { setupAutopilotWs } from './ws/autopilot.js';
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

server.listen(config.port, config.host, () => {
  console.log(`Server running on http://${config.host}:${config.port}`);
  // Clean up any runs left in active states from a previous server instance
  cleanupZombieRuns();
  // Start the autopilot scheduler after server is ready
  startScheduler();
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  stopScheduler();
  sessionsWs.close();
  destroyAllTerminals();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown stalls
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
  shutdown();
});

export { server, app };
