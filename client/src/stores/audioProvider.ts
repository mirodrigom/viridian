import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';
import type { AudioProviderId, AudioProviderInfo, TranscribeResult } from '@/types/audio-provider';

const STORAGE_KEY = 'viridian-audio-provider';
const LANGUAGE_KEY = 'viridian-audio-language';

export const useAudioProviderStore = defineStore('audioProvider', () => {
  const providers = ref<AudioProviderInfo[]>([]);
  const activeProviderId = ref<AudioProviderId>(
    (localStorage.getItem(STORAGE_KEY) as AudioProviderId) || 'audio-browser',
  );
  const language = ref<string>(localStorage.getItem(LANGUAGE_KEY) || 'auto');
  const isTranscribing = ref(false);

  const activeProvider = computed(() =>
    providers.value.find(p => p.id === activeProviderId.value)
      || providers.value.find(p => p.id === 'audio-browser')
      || null,
  );

  const configuredProviders = computed(() =>
    providers.value.filter(p => p.configured),
  );

  const isBrowserProvider = computed(() =>
    activeProviderId.value === 'audio-browser',
  );

  async function fetchProviders() {
    try {
      const res = await apiFetch('/api/audio/providers');
      if (res.ok) {
        providers.value = await res.json();
      }
    } catch {
      // Silently fail — providers list will be empty
    }
  }

  function setProvider(id: AudioProviderId) {
    activeProviderId.value = id;
    localStorage.setItem(STORAGE_KEY, id);
  }

  function setLanguage(lang: string) {
    language.value = lang;
    localStorage.setItem(LANGUAGE_KEY, lang);
  }

  async function configure(providerId: AudioProviderId, apiKey: string): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/audio/providers/${providerId}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (res.ok) {
        await fetchProviders(); // Refresh configured status
        return true;
      }
      const data = await res.json();
      toast.error(data.error || 'Configuration failed');
      return false;
    } catch {
      toast.error('Failed to save API key');
      return false;
    }
  }

  async function testProvider(providerId: AudioProviderId): Promise<{ success: boolean; message: string }> {
    try {
      const res = await apiFetch(`/api/audio/providers/${providerId}/test`, { method: 'POST' });
      return await res.json();
    } catch {
      return { success: false, message: 'Connection failed' };
    }
  }

  async function removeConfig(providerId: AudioProviderId): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/audio/providers/${providerId}/config`, { method: 'DELETE' });
      if (res.ok) {
        await fetchProviders();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe audio via the selected server-side provider.
   * Do NOT call this for the browser provider — handle that client-side.
   */
  async function transcribe(audioBlob: Blob): Promise<TranscribeResult | null> {
    if (isBrowserProvider.value) {
      throw new Error('Browser provider should be handled client-side');
    }

    isTranscribing.value = true;
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();

      const headers: Record<string, string> = {
        'Content-Type': audioBlob.type || 'audio/webm',
        'X-Audio-Provider': activeProviderId.value,
      };
      if (language.value && language.value !== 'auto') {
        headers['X-Audio-Language'] = language.value;
      }

      // Select default model for active provider
      const provider = activeProvider.value;
      if (provider) {
        const defaultModel = provider.models.find(m => m.isDefault) || provider.models[0];
        if (defaultModel) {
          headers['X-Audio-Model'] = defaultModel.id;
        }
      }

      const res = await apiFetch('/api/audio/transcribe', {
        method: 'POST',
        headers,
        body: arrayBuffer,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Transcription failed' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      return await res.json() as TranscribeResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      toast.error(msg);
      return null;
    } finally {
      isTranscribing.value = false;
    }
  }

  return {
    providers,
    activeProviderId,
    activeProvider,
    configuredProviders,
    isBrowserProvider,
    language,
    isTranscribing,
    fetchProviders,
    setProvider,
    setLanguage,
    configure,
    testProvider,
    removeConfig,
    transcribe,
  };
});
