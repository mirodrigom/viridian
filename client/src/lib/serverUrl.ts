/**
 * Configurable server URL for native (Capacitor) and web deployments.
 *
 * In the browser served by Vite dev-server or a production reverse-proxy,
 * API calls use relative paths (e.g. `/api/auth/login`) and the proxy
 * forwards them to the backend. No base URL is needed.
 *
 * When running inside a Capacitor native shell (iOS / Android), the app is
 * served from `capacitor://localhost` or `http://localhost` — there is no
 * proxy, so we need an absolute base URL pointing at the host machine.
 *
 * The user sets this once via a "Server URL" field on the login screen.
 * It's persisted in localStorage so subsequent launches remember it.
 */

const STORAGE_KEY = 'viridian_server_url';

/** Returns true when the app is running inside a Capacitor native shell. */
export function isNative(): boolean {
  return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.();
}

/**
 * Get the stored server URL (e.g. `http://192.168.1.50:12000`).
 * Returns an empty string when unset.
 */
export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

/** Persist a server URL. Trims trailing slashes. */
export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ''));
}

/** Clear the stored server URL. */
export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Resolve an API path (e.g. `/api/auth/login`) to a full URL when running
 * natively, or return the path unchanged for browser use (Vite proxy).
 */
export function resolveApiUrl(path: string): string {
  const base = getServerUrl();
  if (base) return `${base}${path}`;
  return path;
}

/**
 * Build a WebSocket URL for the given path (e.g. `/ws/chat`).
 *
 * - Native: derives ws(s) from the stored server URL.
 * - Browser: uses `window.location` (same as before).
 */
export function resolveWsUrl(path: string, token: string): string {
  const base = getServerUrl();

  if (base) {
    // Convert http(s) → ws(s)
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}${path}?token=${token}`;
  }

  // Browser mode — use current origin
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${path}?token=${token}`;
}
