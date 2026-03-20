import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page, CDPSession } from 'puppeteer';
import { verifyToken } from '../services/auth.js';
import { createLogger } from '../logger.js';

puppeteer.use(StealthPlugin());

const log = createLogger('auth-browser-ws');

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const VIEWPORT = { width: 1024, height: 768 };
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
// Claude CLI uses platform.claude.com/oauth/code/callback — the page shows a code the user must copy
const CODE_CALLBACK_RE = /^https?:\/\/platform\.claude\.com\/oauth\/code\/callback/;

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
    // Return the ORIGINAL string, not url.href — href decodes %2F in query params
    // which breaks nested URLs like redirect_uri=https%3A%2F%2F...
    return raw;
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
        headless: false, // Real Chrome + Xvfb — invisible to bot detection
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          `--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`,
          '--disable-infobars',
          '--force-device-scale-factor=1', // Prevent HiDPI scaling on Xvfb
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        defaultViewport: null, // Let --window-size control the viewport
      });

      // Use the default page created by the browser (avoids blank tab)
      const pages = await browser.pages();
      page = pages[0] || await browser.newPage();
      // Explicitly set the viewport to our target size
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

    // Handle popups (Google OAuth opens in a popup) — switch screencast to it
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        try {
          const newPage = await target.page();
          if (newPage && newPage !== page) {
            log.info('Popup detected, switching screencast');
            await cdp.send('Page.stopScreencast').catch(() => {});

            session.page = newPage;
            const popupCdp = await newPage.createCDPSession();

            session.cdp = popupCdp;
            cdp = popupCdp;
            page = newPage;
            startScreencast();
            watchNavigation();

            // When popup closes, wait for Chrome to settle then switch back
            newPage.once('close', async () => {
              log.info('Popup closed, waiting for Chrome to settle');
              // Retry with backoff — Chrome destroys/recreates targets during OAuth completion
              for (let attempt = 1; attempt <= 5; attempt++) {
                await new Promise(r => setTimeout(r, attempt * 1000)); // 1s, 2s, 3s, 4s, 5s
                try {
                  const allPages = await browser.pages();
                  const activePage = allPages.find(p => p !== newPage) || allPages[0];
                  if (activePage) {
                    session.page = activePage;
                    session.cdp = await activePage.createCDPSession();
                    cdp = session.cdp;
                    page = activePage;
                    startScreencast();
                    watchNavigation();
                    log.info({ url: activePage.url(), attempt }, 'Switched to active page');
                    return;
                  }
                } catch (err) {
                  log.warn({ err: (err as Error).message, attempt }, 'Retry switch to main page');
                }
              }
              log.error('All retries exhausted — could not switch back to main page');
            });
          }
        } catch (err) {
          log.error({ err }, 'Error handling popup');
        }
      }
    });

    // Stream frames to client
    function startScreencast() {
      cdp.on('Page.screencastFrame', (params) => {
        // Send actual page dimensions so the client can map click coordinates correctly
        const meta = params.metadata || {};
        safeSend(ws, {
          type: 'frame',
          data: params.data,
          sessionId: params.sessionId,
          pageWidth: meta.deviceWidth,
          pageHeight: meta.deviceHeight,
        });
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

    // Watch for auth completion — localhost callback or code display page
    function watchNavigation() {
      page.on('framenavigated', async (frame) => {
        // Ignore sub-frame navigations (iframes from Google OAuth, Cloudflare, etc.)
        if (frame !== page.mainFrame()) return;

        const frameUrl = frame.url();
        log.info({ url: frameUrl }, 'Main frame navigated');
        safeSend(ws, { type: 'navigated', url: frameUrl });

        if (LOCALHOST_RE.test(frameUrl)) {
          log.info({ userId: user.id, callbackUrl: frameUrl }, 'Localhost callback detected');
          safeSend(ws, { type: 'auth_complete', url: frameUrl });
          setTimeout(async () => {
            await cleanup(session);
            ws.close();
          }, 5000);
        } else if (CODE_CALLBACK_RE.test(frameUrl)) {
          // Claude CLI code-based OAuth: the page shows a code the user must copy-paste
          log.info({ userId: user.id, url: frameUrl }, 'Code callback page detected');
          // Wait for the page to render the code
          await new Promise(r => setTimeout(r, 2000));
          try {
            // Try to extract the code from the page
            const code = await page.evaluate(() => {
              // Look for the code in common patterns
              const codeEl = document.querySelector('code, pre, [data-testid="code"], .code');
              if (codeEl?.textContent) return codeEl.textContent.trim();
              // Try to find it in any element that looks like a code
              const allText = document.body.innerText;
              const codeMatch = allText.match(/[A-Za-z0-9_-]{20,}/);
              return codeMatch ? codeMatch[0] : null;
            });
            if (code) {
              log.info({ userId: user.id, codeLength: code.length }, 'Extracted auth code from page');
              safeSend(ws, { type: 'auth_code', code });
            }
          } catch (err) {
            log.error({ err }, 'Failed to extract code from callback page');
          }
          // Don't auto-close — let the user see the page and copy the code if extraction failed
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
