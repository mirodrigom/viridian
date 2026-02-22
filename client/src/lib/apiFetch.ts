import { useAuthStore } from '@/stores/auth';
import router from '@/router';
import { toast } from 'vue-sonner';

/**
 * Authenticated fetch wrapper.
 * - Automatically adds Authorization header from auth store
 * - On 401 response, clears auth state and redirects to login
 * - Accepts same arguments as native fetch (url can be string or URL)
 */
export async function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const auth = useAuthStore();

  const headers = new Headers(init?.headers);
  if (auth.token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${auth.token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    auth.logout();
    toast.error('Session expired — please log in again');
    router.push({ name: 'login' });
  }

  return res;
}
