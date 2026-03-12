import { useAuthStore } from '@/stores/auth';
import router from '@/router';
import { toast } from 'vue-sonner';
import { resolveApiUrl } from '@/lib/serverUrl';

/**
 * Decode a JWT payload without verification (client-side expiry check only).
 * Returns null if the token is malformed.
 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch {
    return null;
  }
}

/** Check whether a JWT token is expired (with 30s grace window). */
function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false; // no exp claim — assume valid
  return Date.now() >= payload.exp * 1000 - 30_000;
}

function expireSession(auth: ReturnType<typeof useAuthStore>, message: string) {
  auth.logout();
  toast.error(message);
  router.push({ name: 'login' });
}

/**
 * Authenticated fetch wrapper.
 * - Automatically adds Authorization header from auth store
 * - Checks token expiry client-side before making the request
 * - On 401 response, clears auth state and redirects to login
 * - On proxy errors (server unreachable), redirects to login
 * - Accepts same arguments as native fetch (url can be string or URL)
 */
export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const auth = useAuthStore();

  // Client-side expiry check — avoid unnecessary requests with a dead token
  if (auth.token && isTokenExpired(auth.token)) {
    expireSession(auth, 'Session expired — please log in again');
    return new Response(JSON.stringify({ error: 'Token expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers = new Headers(init?.headers);
  if (auth.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${auth.token}`);
  }

  // Resolve relative API paths to absolute URLs when running natively
  const resolvedInput = typeof input === 'string' ? resolveApiUrl(input) : input;

  const res = await fetch(resolvedInput, { ...init, headers });

  if (res.status === 401) {
    expireSession(auth, 'Session expired — please log in again');
  }

  return res;
}
