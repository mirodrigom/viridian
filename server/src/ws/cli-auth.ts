import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { verifyToken } from '../services/auth.js';
import { findClaudeBinary } from '../services/claude-binary.js';
import { getHomeDir } from '../utils/platform.js';
import { findBinary } from '../utils/platform.js';
import { createLogger } from '../logger.js';
import { writeFileSync, unlinkSync, watch, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const log = createLogger('cli-auth');

const FLOW_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

// Supported providers and how to resolve their binary
type SupportedProvider = 'claude' | 'codex';

function resolveBinary(provider: SupportedProvider): string {
  switch (provider) {
    case 'claude':
      return findClaudeBinary();
    case 'codex': {
      const bin = findBinary('codex');
      if (!bin) throw new Error('Codex CLI binary not found. Install it first.');
      return bin;
    }
    default: {
      const _: never = provider;
      throw new Error(`Unsupported provider: ${_}`);
    }
  }
}

// Success indicators in PTY output
const SUCCESS_RE = /logged in|successfully|authenticated|complete|saved|token.*set/i;

// Strip ANSI for basic plaintext extraction (only used for success/paste detection, not URL)
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g;

interface AuthSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pty: any;
  timeout: ReturnType<typeof setTimeout>;
  urlSent: boolean;
  codeSent: boolean;
  done: boolean;
  urlFile: string;       // temp file where the BROWSER script writes the URL
  browserScript: string; // temp script used as BROWSER env
  urlWatcher: ReturnType<typeof setInterval> | null;
  autoEnterTimer: ReturnType<typeof setInterval> | null;
  callbackPort: number | null; // port from redirect_uri for internal callback forwarding
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendStatus(ws: WebSocket, message: string) {
  log.info({ message }, 'cli-auth status');
  safeSend(ws, { type: 'status', message });
}

function cleanupFiles(session: AuthSession) {
  if (session.urlWatcher) {
    clearInterval(session.urlWatcher);
    session.urlWatcher = null;
  }
  if (session.autoEnterTimer) {
    clearInterval(session.autoEnterTimer);
    session.autoEnterTimer = null;
  }
  try { unlinkSync(session.urlFile); } catch { /* ok */ }
  try { unlinkSync(session.browserScript); } catch { /* ok */ }
}

function killSession(session: AuthSession) {
  clearTimeout(session.timeout);
  session.done = true;
  cleanupFiles(session);
  try {
    session.pty.kill();
    setTimeout(() => {
      try { session.pty.kill('SIGKILL'); } catch { /* already dead */ }
    }, 2000);
  } catch {
    // PTY may already be dead
  }
}

// Track the single active auth session so we kill it before starting a new one
let activeSession: AuthSession | null = null;

export function setupCliAuthWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/cli-auth') return;

    const token = url.searchParams.get('token');
    if (!token) {
      socket.destroy();
      return;
    }

    try {
      verifyToken(token);
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: import('http').IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const providerParam = url.searchParams.get('provider') || 'claude';

    const SUPPORTED: SupportedProvider[] = ['claude', 'codex'];
    if (!SUPPORTED.includes(providerParam as SupportedProvider)) {
      safeSend(ws, { type: 'error', message: `Unsupported provider: ${providerParam}` });
      ws.close();
      return;
    }
    const provider = providerParam as SupportedProvider;

    // Kill any previous auth session before starting a new one
    if (activeSession) {
      log.info('Killing previous auth session before starting new one');
      killSession(activeSession);
      activeSession = null;
    }

    let binaryPath: string;
    try {
      binaryPath = resolveBinary(provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ provider, err }, 'Could not resolve CLI binary');
      safeSend(ws, { type: 'error', message });
      ws.close();
      return;
    }

    log.info({ provider, binaryPath }, 'Starting CLI auth session');
    sendStatus(ws, `Launching ${provider} CLI for authentication…`);

    let nodePty: typeof import('node-pty');
    try {
      nodePty = await import('node-pty');
    } catch {
      safeSend(ws, { type: 'error', message: 'node-pty is not available on this server' });
      ws.close();
      return;
    }

    // ── Create a BROWSER capture script ─────────────────────────────────────
    // Instead of parsing Ink's complex TUI output, we intercept the browser-open
    // call. When the CLI tries to open a URL, it runs this script, which writes
    // the URL to a temp file that we poll.
    const id = randomBytes(4).toString('hex');
    const authDir = join(tmpdir(), 'viridian-auth');
    try { mkdirSync(authDir, { recursive: true }); } catch { /* exists */ }
    const urlFile = join(authDir, `url-${id}`);
    const browserScript = join(authDir, `browser-${id}.sh`);

    writeFileSync(browserScript, `#!/bin/sh\necho "$1" > "${urlFile}"\n`, { mode: 0o755 });
    log.info({ browserScript, urlFile }, 'Created BROWSER capture script');

    // ── Spawn the CLI ───────────────────────────────────────────────────────
    // Use explicit auth subcommand — bare `claude` enters interactive mode
    // without triggering OAuth.
    const args = provider === 'claude' ? ['auth', 'login'] : ['login'];

    let ptyProcess: import('node-pty').IPty;
    try {
      ptyProcess = nodePty.spawn(binaryPath, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: getHomeDir(),
        env: {
          ...process.env,
          // Redirect browser-open to our capture script
          BROWSER: browserScript,
          DISPLAY: '',
          PAGER: 'cat',
          GIT_PAGER: 'cat',
          TERM: 'xterm-256color',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Failed to spawn CLI PTY');
      safeSend(ws, { type: 'error', message: `Failed to spawn CLI: ${message}` });
      try { unlinkSync(browserScript); } catch { /* ok */ }
      ws.close();
      return;
    }

    const session: AuthSession = {
      pty: ptyProcess,
      timeout: setTimeout(() => {
        if (session.done) return;
        log.warn({ provider }, 'CLI auth timed out');
        safeSend(ws, { type: 'error', message: 'Authentication timed out. Please try again.' });
        killSession(session);
        ws.close();
      }, FLOW_TIMEOUT_MS),
      urlSent: false,
      codeSent: false,
      done: false,
      urlFile,
      browserScript,
      urlWatcher: null,
      autoEnterTimer: null,
      callbackPort: null,
    };
    activeSession = session;

    // ── Poll for the URL file (written by the BROWSER script) ───────────────
    session.urlWatcher = setInterval(() => {
      if (session.done || session.urlSent) return;
      try {
        if (existsSync(urlFile)) {
          const capturedUrl = readFileSync(urlFile, 'utf-8').trim();
          if (capturedUrl && capturedUrl.startsWith('http')) {
            session.urlSent = true;
            if (session.urlWatcher) {
              clearInterval(session.urlWatcher);
              session.urlWatcher = null;
            }
            // Extract callback port from redirect_uri so we can forward it internally
            try {
              const oauthUrl = new URL(capturedUrl);
              const redirectUri = oauthUrl.searchParams.get('redirect_uri');
              if (redirectUri) {
                const rUrl = new URL(redirectUri);
                session.callbackPort = parseInt(rUrl.port, 10) || null;
                log.info({ provider, callbackPort: session.callbackPort }, 'Parsed callback port from redirect_uri');
              }
            } catch { /* ignore parse errors */ }
            log.info({ provider, capturedUrl }, 'Auth URL captured via BROWSER script');
            sendStatus(ws, 'Opening authentication page…');
            safeSend(ws, { type: 'url', url: capturedUrl });
          }
        }
      } catch (err) {
        log.debug({ err }, 'URL file not ready yet');
      }
    }, 300); // check every 300ms

    // ── PTY output handler (for auto-navigation & success detection) ────────
    let rawBuffer = '';
    let lastDataTime = 0;
    let enterCount = 0;
    const MAX_AUTO_ENTER = 8;

    // Press Enter when PTY output settles (no new data for 2s).
    // This navigates welcome screens and prompts that don't match specific regexes.
    session.autoEnterTimer = setInterval(() => {
      if (session.done || session.urlSent || enterCount >= MAX_AUTO_ENTER) return;
      const now = Date.now();
      if (lastDataTime > 0 && (now - lastDataTime) > 2000) {
        enterCount++;
        lastDataTime = 0;
        log.info({ provider, enterCount }, 'Auto-Enter after output settled');
        sendStatus(ws, 'Navigating CLI setup…');
        try { ptyProcess.write('\r'); } catch { /* */ }
        rawBuffer = '';
      }
    }, 1000);

    ptyProcess.onData((raw: string) => {
      if (session.done) return;

      lastDataTime = Date.now();
      rawBuffer += raw;
      if (rawBuffer.length > 16384) {
        rawBuffer = rawBuffer.slice(-16384);
      }

      const stripped = rawBuffer.replace(ANSI_RE, '');
      const tail = stripped.slice(-500);

      log.debug({ provider, tail: tail.slice(-300) }, 'PTY output');

      // Immediate auto-navigate for clear prompts
      if (!session.urlSent && enterCount < MAX_AUTO_ENTER) {
        if (/press enter|do you accept|agree to the terms|\(y\/n\)|\[Y\/n\]|accept the terms/i.test(tail)) {
          enterCount++;
          lastDataTime = 0;
          log.info({ provider, enterCount }, 'Auto-navigating prompt (Enter)');
          sendStatus(ws, 'Navigating CLI setup…');
          try { ptyProcess.write('\r'); } catch { /* */ }
          rawBuffer = '';
          return;
        }
      }

      // Success detection after code/token was submitted
      if (session.codeSent && !session.done && SUCCESS_RE.test(tail)) {
        session.done = true;
        log.info({ provider }, 'Auth success detected');
        safeSend(ws, { type: 'complete' });
        killSession(session);
        ws.close();
      }
    });

    // ── PTY exit handler ────────────────────────────────────────────────────
    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      if (session.done) return;

      clearTimeout(session.timeout);
      cleanupFiles(session);

      if (exitCode === 0) {
        session.done = true;
        log.info({ provider }, 'CLI exited cleanly — auth complete');
        safeSend(ws, { type: 'complete' });
      } else {
        log.warn({ provider, exitCode }, 'CLI exited with non-zero code');
        safeSend(ws, { type: 'error', message: `CLI exited with code ${exitCode}` });
      }

      ws.close();
    });

    // ── Incoming messages from client ───────────────────────────────────────
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; code?: string; callbackUrl?: string };

        // The user pastes the failed callback URL from their browser.
        // We forward it as an HTTP request to the CLI's local callback server.
        if (msg.type === 'code' && (msg.callbackUrl || msg.code)) {
          if (session.codeSent) return;
          session.codeSent = true;

          // Extract the full callback URL — either directly or from the code field
          let callbackUrl = msg.callbackUrl || msg.code || '';

          // If user pasted just a code (not a URL), try to build the callback URL
          if (!callbackUrl.startsWith('http')) {
            if (session.callbackPort) {
              callbackUrl = `http://localhost:${session.callbackPort}/callback?code=${encodeURIComponent(callbackUrl)}`;
            } else {
              // Fallback: write directly to PTY
              log.info({ provider }, 'No callback port — writing code to PTY');
              sendStatus(ws, 'Submitting code…');
              try { ptyProcess.write(callbackUrl + '\r'); } catch { /* */ }
              return;
            }
          }

          // Forward the callback request to the CLI's local server (inside this machine)
          // Replace the host with localhost since the CLI server runs locally
          try {
            const cbUrl = new URL(callbackUrl);
            const localUrl = `http://localhost:${session.callbackPort || cbUrl.port}${cbUrl.pathname}${cbUrl.search}`;

            log.info({ provider, localUrl }, 'Forwarding OAuth callback to CLI');
            sendStatus(ws, 'Completing authentication…');

            fetch(localUrl)
              .then((resp) => {
                log.info({ provider, status: resp.status }, 'Callback forwarded');
                if (resp.ok && !session.done) {
                  // Give the CLI a few seconds to exit cleanly on its own,
                  // then force-complete if it hasn't (e.g. Codex stays in TUI mode).
                  setTimeout(() => {
                    if (!session.done) {
                      session.done = true;
                      log.info({ provider }, 'Auth complete (callback 200, forced after timeout)');
                      safeSend(ws, { type: 'complete' });
                      killSession(session);
                      ws.close();
                    }
                  }, 5000);
                }
              })
              .catch((err) => {
                log.error({ provider, err }, 'Failed to forward callback');
                safeSend(ws, { type: 'error', message: 'Failed to complete authentication. Please try again.' });
              });
          } catch (err) {
            log.error({ provider, err }, 'Invalid callback URL');
            safeSend(ws, { type: 'error', message: 'Invalid callback URL' });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // ── Cleanup on WS close ─────────────────────────────────────────────────
    ws.on('close', () => {
      if (!session.done) {
        log.info({ provider }, 'WS closed before auth completed — killing PTY');
      }
      killSession(session);
      if (activeSession === session) activeSession = null;
    });
  });

  return wss;
}
