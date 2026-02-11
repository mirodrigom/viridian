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
import { authMiddleware } from './middleware/auth.js';
import { setupChatWs } from './ws/chat.js';
import { setupShellWs } from './ws/shell.js';
import { setupSessionsWs } from './ws/sessions.js';

const app: Express = express();
const server = createServer(app);

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/files', filesRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/keys', apikeysRoutes);
app.use('/api/agent', agentRoutes);

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
setupSessionsWs(server);

server.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});

export { server, app };
