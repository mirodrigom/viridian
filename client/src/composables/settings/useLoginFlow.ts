import { ref } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';
import { useProviderStore } from '@/stores/provider';

export interface LoginFlowDeps {
  getProviderId: () => string | undefined;
  getProviderName: () => string | undefined;
  onAuthenticated: (anySuccess: boolean, failedModelIds: string[]) => void;
}

export function useLoginFlow(deps: LoginFlowDeps) {
  const providerStore = useProviderStore();

  const loginLoading = ref(false);
  const loginUrl = ref<string | null>(null);
  const loginDeviceCode = ref<string | null>(null);
  const loginMessage = ref('');
  const loginDone = ref(false);
  const loginStep = ref<'choose' | 'waiting'>('choose');
  // Pro (Identity Center) fields
  const idcStartUrl = ref('');
  const idcRegion = ref('us-east-1');

  async function startLoginFlow(license: 'free' | 'pro') {
    const providerId = deps.getProviderId();
    const providerName = deps.getProviderName();
    if (!providerId || loginLoading.value) return;

    loginLoading.value = true;
    loginUrl.value = null;
    loginDeviceCode.value = null;
    loginMessage.value = 'Starting login...';
    loginDone.value = false;
    loginStep.value = 'waiting';

    try {
      const body: Record<string, string> = { license };
      if (license === 'pro') {
        if (idcStartUrl.value.trim()) body.identityProvider = idcStartUrl.value.trim();
        if (idcRegion.value.trim()) body.region = idcRegion.value.trim();
      }

      const res = await apiFetch(`/api/providers/${providerId}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        success: boolean;
        output?: string;
        loginUrl?: string;
        deviceCode?: string;
        message?: string;
      };

      if (!data.success && !data.loginUrl) {
        // Login failed (e.g. invalid identity provider URL) — stay on choose step
        loginStep.value = 'choose';
        const rawError = (data.output || data.message || '').trim();
        loginMessage.value = rawError.includes('dispatch failure')
          ? 'Login failed. Check your Identity Center Start URL and region, then try again.'
          : rawError || 'Login failed.';
        toast.error(loginMessage.value);
        return;
      }

      loginUrl.value = data.loginUrl || null;
      loginDeviceCode.value = data.deviceCode || null;
      loginMessage.value = data.message || data.output || '';

      if (data.loginUrl) {
        window.open(data.loginUrl, '_blank');
      }

      if (data.success && !data.loginUrl) {
        loginDone.value = true;
        toast.success(`${providerName} authenticated!`);
        await providerStore.fetchProviders();
        deps.onAuthenticated(true, []);
      }
    } catch (err) {
      loginStep.value = 'choose';
      loginMessage.value = err instanceof Error ? err.message : 'Login failed';
      toast.error(`Failed to start ${providerName} login`);
    } finally {
      loginLoading.value = false;
    }
  }

  async function checkLoginStatus() {
    const providerId = deps.getProviderId();
    const providerName = deps.getProviderName();
    if (!providerId) return;

    loginLoading.value = true;
    loginMessage.value = 'Checking authentication...';

    try {
      await providerStore.fetchProviders();
      const updated = providerStore.providers.find(p => p.id === providerId);
      if (updated?.configured) {
        loginDone.value = true;
        loginMessage.value = 'Authentication successful!';
        toast.success(`${providerName} authenticated!`);
        deps.onAuthenticated(true, []);
      } else {
        loginMessage.value = 'Not authenticated yet. Complete the login in your browser, then click "Check again".';
      }
    } catch {
      loginMessage.value = 'Failed to check status.';
    } finally {
      loginLoading.value = false;
    }
  }

  function resetLoginFlow() {
    loginStep.value = 'choose';
    loginUrl.value = null;
    loginDeviceCode.value = null;
    loginMessage.value = '';
    loginDone.value = false;
  }

  return {
    loginLoading,
    loginUrl,
    loginDeviceCode,
    loginMessage,
    loginDone,
    loginStep,
    idcStartUrl,
    idcRegion,
    startLoginFlow,
    checkLoginStatus,
    resetLoginFlow,
  };
}
