import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import puppeteer from 'puppeteer';
import type { Browser, Page, CDPSession } from 'puppeteer';
import { verifyToken } from '../services/auth.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth-browser-ws');

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const VIEWPORT = { width: 1024, height: 768 };
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

// Private IP ranges — block to prevent SSRF
const PRIVATE_IP_RE = /^https?:\/\/(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0)/;

interface BrowserSession {
  browser: Browser;
  page: Page;
  cdp: CDPSession;
  userId: number;
  timeout: ReturnType<typeof setTimeout>;
}

const sessions = new Map<number, BrowserSession>();

function validateUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (PRIVATE_IP_RE.test(raw)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function cleanup(session: BrowserSession) {
  clearTimeout(session.timeout);
  sessions.delete(session.userId);
  try {
    await session.cdp.send('Page.stopScreencast').catch(() => {});
    await session.browser.close();
  } catch {
    // Browser may already be closed
  }
  log.info({ userId: session.userId }, 'Browser session cleaned up');
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function setupAuthBrowserWs(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws/auth-browser') return;

    const token = url.searchParams.get('token');
    if (!token) {
      socket.destroy();
      return;
    }

    let user: { id: number; username: string };
    try {
      user = verifyToken(token);
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: unknown, user: { id: number; username: string }) => {
    const reqObj = req as import('http').IncomingMessage;
    const url = new URL(reqObj.url || '', `http://${reqObj.headers.host}`);
    const targetUrl = validateUrl(url.searchParams.get('url') || '');

    if (!targetUrl) {
      safeSend(ws, { type: 'error', message: 'Invalid or blocked URL' });
      ws.close();
      return;
    }

    // One session per user
    const existing = sessions.get(user.id);
    if (existing) {
      await cleanup(existing);
    }

    log.info({ userId: user.id, url: targetUrl }, 'Launching auth browser');

    let browser: Browser;
    let page: Page;
    let cdp: CDPSession;

    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      });

      page = await browser.newPage();
      await page.setViewport(VIEWPORT);

      cdp = await page.createCDPSession();
    } catch (err) {
      log.error({ err }, 'Failed to launch browser');
      safeSend(ws, { type: 'error', message: 'Failed to launch browser' });
      ws.close();
      return;
    }

    const session: BrowserSession = {
      browser,
      page,
      cdp,
      userId: user.id,
      timeout: setTimeout(async () => {
        safeSend(ws, { type: 'timeout' });
        await cleanup(session);
        ws.close();
      }, SESSION_TIMEOUT_MS),
    };

    sessions.set(user.id, session);

    // Handle popups — switch screencast to new page
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        try {
          const newPage = await target.page();
          if (newPage && newPage !== page) {
            log.info('Popup detected, switching screencast');
            await cdp.send('Page.stopScreencast').catch(() => {});
            session.page = newPage;
            await newPage.setViewport(VIEWPORT);
            session.cdp = await newPage.createCDPSession();
            cdp = session.cdp;
            page = newPage;
            startScreencast();
            watchNavigation();
          }
        } catch { /* ignore */ }
      }
    });

    // Stream frames to client
    function startScreencast() {
      cdp.on('Page.screencastFrame', (params) => {
        safeSend(ws, { type: 'frame', data: params.data, sessionId: params.sessionId });
        cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
      });

      cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
        everyNthFrame: 2,
      }).catch((err) => {
        log.error({ err }, 'Failed to start screencast');
        safeSend(ws, { type: 'error', message: 'Failed to start screencast' });
      });
    }

    // Watch for localhost callback (auth complete)
    function watchNavigation() {
      page.on('framenavigated', (frame) => {
        const frameUrl = frame.url();
        safeSend(ws, { type: 'navigated', url: frameUrl });

        if (LOCALHOST_RE.test(frameUrl)) {
          log.info({ userId: user.id, callbackUrl: frameUrl }, 'Auth callback detected');
          safeSend(ws, { type: 'auth_complete', url: frameUrl });
          // Give the CLI callback server time to process
          setTimeout(async () => {
            await cleanup(session);
            ws.close();
          }, 2000);
        }
      });
    }

    // Navigate and start
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      startScreencast();
      watchNavigation();
      safeSend(ws, { type: 'browser_ready' });
    } catch (err) {
      log.error({ err }, 'Failed to navigate');
      safeSend(ws, { type: 'error', message: 'Failed to load page' });
      await cleanup(session);
      ws.close();
      return;
    }

    // Handle input from client
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const currentCdp = session.cdp;

        switch (msg.type) {
          case 'click':
            await currentCdp.send('Input.dispatchMouseEvent', {
              type: 'mousePressed', x: clamp(msg.x, 0, VIEWPORT.width), y: clamp(msg.y, 0, VIEWPORT.height),
              button: 'left', clickCount: 1,
            });
            await currentCdp.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased', x: clamp(msg.x, 0, VIEWPORT.width), y: clamp(msg.y, 0, VIEWPORT.height),
              button: 'left', clickCount: 1,
            });
            break;

          case 'mouse_move':
            await currentCdp.send('Input.dispatchMouseEvent', {
              type: 'mouseMoved', x: clamp(msg.x, 0, VIEWPORT.width), y: clamp(msg.y, 0, VIEWPORT.height),
            });
            break;

          case 'mouse_down':
            await currentCdp.send('Input.dispatchMouseEvent', {
              type: 'mousePressed', x: clamp(msg.x, 0, VIEWPORT.width), y: clamp(msg.y, 0, VIEWPORT.height),
              button: msg.button || 'left', clickCount: 1,
            });
            break;

          case 'mouse_up':
            await currentCdp.send('Input.dispatchMouseEvent', {
              type: 'mouseReleased', x: clamp(msg.x, 0, VIEWPORT.width), y: clamp(msg.y, 0, VIEWPORT.height),
              button: msg.button || 'left', clickCount: 1,
            });
            break;

          case 'key_down': {
            const mods = msg.modifiers || {};
            const modifierFlags = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.meta ? 4 : 0) | (mods.shift ? 8 : 0);
            await currentCdp.send('Input.dispatchKeyEvent', {
              type: 'keyDown', key: msg.key, code: msg.code, modifiers: modifierFlags,
              windowsVirtualKeyCode: msg.keyCode || 0,
            });
            // Send char event for text input
            if (msg.key.length === 1) {
              await currentCdp.send('Input.dispatchKeyEvent', {
                type: 'char', text: msg.key, key: msg.key, code: msg.code, modifiers: modifierFlags,
              });
            }
            break;
          }

          case 'key_up': {
            await currentCdp.send('Input.dispatchKeyEvent', {
              type: 'keyUp', key: msg.key, code: msg.code,
            });
            break;
          }

          case 'scroll':
            await currentCdp.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel', x: clamp(msg.x, 0, VIEWPORT.width), y: clamp(msg.y, 0, VIEWPORT.height),
              deltaX: msg.deltaX || 0, deltaY: msg.deltaY || 0,
            });
            break;
        }
      } catch {
        // Ignore invalid messages or CDP errors during cleanup
      }
    });

    ws.on('close', async () => {
      if (sessions.has(user.id)) {
        await cleanup(session);
      }
    });
  });

  return wss;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
