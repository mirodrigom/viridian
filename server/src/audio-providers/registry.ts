/**
 * Audio Provider Registry — singleton that manages all registered STT providers.
 *
 * Providers register themselves by calling registerAudioProvider() at import time.
 */

import type { IAudioProvider, AudioProviderId, AudioProviderInfoDTO } from './types.js';

const providers = new Map<AudioProviderId, IAudioProvider>();

export function registerAudioProvider(provider: IAudioProvider): void {
  providers.set(provider.info.id, provider);
}

export function getAudioProvider(id: AudioProviderId): IAudioProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Audio provider "${id}" is not registered. Available: [${[...providers.keys()].join(', ')}]`);
  }
  return provider;
}

export function getAllAudioProviders(): IAudioProvider[] {
  return [...providers.values()];
}

export function getConfiguredAudioProviders(): IAudioProvider[] {
  return [...providers.values()].filter(p => {
    try { return p.isConfigured().configured; } catch { return false; }
  });
}

export function getDefaultAudioProvider(): IAudioProvider {
  // Prefer first configured non-browser provider, fall back to browser
  const configured = getConfiguredAudioProviders();
  const nonBrowser = configured.find(p => p.info.id !== 'audio-browser');
  if (nonBrowser) return nonBrowser;

  const browser = providers.get('audio-browser');
  if (browser) return browser;

  throw new Error('No audio providers registered.');
}

/** Serialize all audio providers to DTOs for the REST API. */
export function getAudioProviderDTOs(): AudioProviderInfoDTO[] {
  return [...providers.values()].map(p => ({
    id: p.info.id,
    name: p.info.name,
    icon: p.info.icon,
    description: p.info.description,
    website: p.info.website,
    pricing: p.info.pricing,
    models: p.models,
    capabilities: p.capabilities,
    configured: (() => { try { return p.isConfigured().configured; } catch { return false; } })(),
    envVarName: p.info.envVarName,
  }));
}
