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
  configured: true,
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

  /** Model IDs that failed their last connection test, keyed by provider ID. */
  const failedModels = ref<Record<string, string[]>>(
    JSON.parse(localStorage.getItem('failedModels') || '{}') as Record<string, string[]>,
  );

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

  /** Set of model IDs that failed their last test for the currently active provider. */
  const activeFailedModelIds = computed<Set<string>>(() =>
    new Set(failedModels.value[activeProviderId.value] ?? []),
  );

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

    // Reset model to a working model for the new provider
    const settings = useSettingsStore();
    const failed = new Set(failedModels.value[id] ?? []);
    const validModels = provider.models.map(m => m.id);
    const currentIsValid = validModels.includes(settings.model) && !failed.has(settings.model);
    if (!currentIsValid) {
      // Prefer the provider's default model if it works, otherwise first non-failed model
      const newDefault =
        provider.models.find(m => m.isDefault && !failed.has(m.id))?.id ||
        provider.models.find(m => !failed.has(m.id))?.id ||
        provider.models[0]?.id;
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

  /** Record which model IDs failed for a provider. Pass [] to clear. */
  function setFailedModels(providerId: string, modelIds: string[]) {
    const updated = { ...failedModels.value };
    if (modelIds.length > 0) {
      updated[providerId] = modelIds;
    } else {
      delete updated[providerId];
    }
    failedModels.value = updated;
    localStorage.setItem('failedModels', JSON.stringify(updated));
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
    activeFailedModelIds,
    defaultModel,
    failedModels,
    fetchProviders,
    setDefaultProvider,
    setSessionProvider,
    clearSessionProvider,
    setFailedModels,
    isValidModel,
  };
});
