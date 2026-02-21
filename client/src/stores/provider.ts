import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from './auth';
import { useSettingsStore } from './settings';
import { toast } from 'vue-sonner';
import type { ProviderId, ProviderInfo, ProviderModel, ProviderCapabilities } from '@/types/provider';

const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  supportsThinking: true,
  supportsToolUse: true,
  supportsPermissionModes: true,
  supportsImages: true,
  supportsResume: true,
  supportsStreaming: true,
  supportsControlRequests: true,
  supportsSubagents: true,
  supportsPlanMode: true,
  supportedPermissionModes: ['bypassPermissions', 'acceptEdits', 'plan', 'default'],
  customFeatures: [],
};

const FALLBACK_CLAUDE: ProviderInfo = {
  id: 'claude',
  name: 'Claude',
  icon: 'ClaudeLogo',
  description: 'Anthropic Claude Code',
  website: 'https://claude.ai',
  models: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast and capable', isDefault: true },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most powerful' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest' },
  ],
  capabilities: DEFAULT_CAPABILITIES,
  available: true,
  installCommand: 'npm install -g @anthropic-ai/claude-code',
};

export const useProviderStore = defineStore('provider', () => {
  const auth = useAuthStore();

  // State
  const providers = ref<ProviderInfo[]>([FALLBACK_CLAUDE]);
  const defaultProvider = ref<ProviderId>(
    (localStorage.getItem('defaultProvider') as ProviderId) || 'claude'
  );
  /** Per-session override. null = use default. */
  const sessionProvider = ref<ProviderId | null>(null);
  const loaded = ref(false);

  // Getters
  const activeProviderId = computed<ProviderId>(() =>
    sessionProvider.value || defaultProvider.value
  );

  const activeProvider = computed<ProviderInfo>(() =>
    providers.value.find(p => p.id === activeProviderId.value)
      || providers.value.find(p => p.id === defaultProvider.value)
      || FALLBACK_CLAUDE
  );

  const activeModels = computed<ProviderModel[]>(() =>
    activeProvider.value.models
  );

  const activeCapabilities = computed<ProviderCapabilities>(() =>
    activeProvider.value.capabilities
  );

  const availableProviders = computed<ProviderInfo[]>(() =>
    providers.value.filter(p => p.available)
  );

  const activeProviderName = computed(() => activeProvider.value.name);

  const defaultModel = computed(() =>
    activeModels.value.find(m => m.isDefault)?.id
      || activeModels.value[0]?.id
      || 'claude-sonnet-4-6'
  );

  // Actions
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchProviders(retryCount = 0) {
    try {
      const res = await fetch('/api/providers', {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        // Server returned error — retry up to 3 times with backoff
        if (retryCount < 3) {
          retryTimer = setTimeout(() => fetchProviders(retryCount + 1), 2000 * (retryCount + 1));
        }
        return;
      }
      const data: ProviderInfo[] = await res.json();
      if (data.length > 0) {
        providers.value = data;
      }
      loaded.value = true;

      // If stored default is no longer available, fall back
      if (!data.find(p => p.id === defaultProvider.value)) {
        const firstAvailable = data.find(p => p.available);
        if (firstAvailable) {
          defaultProvider.value = firstAvailable.id;
          localStorage.setItem('defaultProvider', firstAvailable.id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      // Network error — retry up to 3 times with backoff
      if (retryCount < 3) {
        retryTimer = setTimeout(() => fetchProviders(retryCount + 1), 2000 * (retryCount + 1));
      }
    }
  }

  function setDefaultProvider(id: ProviderId) {
    const prev = defaultProvider.value;
    if (prev === id) return;

    const provider = providers.value.find(p => p.id === id);
    if (!provider) return;

    defaultProvider.value = id;
    localStorage.setItem('defaultProvider', id);

    // Reset model to new provider's default if current model isn't valid
    const settings = useSettingsStore();
    const validModels = provider.models.map(m => m.id);
    if (!validModels.includes(settings.model)) {
      const newDefault = provider.models.find(m => m.isDefault)?.id || provider.models[0]?.id;
      if (newDefault) {
        settings.model = newDefault;
        settings.save();
      }
    }

    toast.info(`Default provider changed to ${provider.name}. New sessions will use ${provider.name}.`);
  }

  function setSessionProvider(id: ProviderId | null) {
    sessionProvider.value = id;
  }

  function clearSessionProvider() {
    sessionProvider.value = null;
  }

  /** Check if a model ID is valid for the given provider. */
  function isValidModel(modelId: string, providerId?: ProviderId): boolean {
    const pid = providerId || activeProviderId.value;
    const provider = providers.value.find(p => p.id === pid);
    return provider?.models.some(m => m.id === modelId) ?? false;
  }

  return {
    providers,
    defaultProvider,
    sessionProvider,
    loaded,
    activeProviderId,
    activeProvider,
    activeModels,
    activeCapabilities,
    availableProviders,
    activeProviderName,
    defaultModel,
    fetchProviders,
    setDefaultProvider,
    setSessionProvider,
    clearSessionProvider,
    isValidModel,
  };
});
