/**
 * Provider Registry — singleton that manages all registered AI providers.
 *
 * Providers register themselves by calling registerProvider() at import time.
 * Consumers look up providers via getProvider(id) or iterate getAvailableProviders().
 */

import type { IProvider, ProviderId, ProviderInfoDTO } from './types.js';
import { isWindows } from '../utils/platform.js';

const providers = new Map<ProviderId, IProvider>();

export function registerProvider(provider: IProvider): void {
  providers.set(provider.info.id, provider);
}

export function getProvider(id: ProviderId): IProvider {
  const provider = providers.get(id);
  if (!provider) {
    throw new Error(`Provider "${id}" is not registered. Available: [${[...providers.keys()].join(', ')}]`);
  }
  return provider;
}

export function getAllProviders(): IProvider[] {
  return [...providers.values()];
}

export function getAvailableProviders(): IProvider[] {
  return [...providers.values()].filter(p => {
    try {
      return p.isAvailable();
    } catch {
      return false;
    }
  });
}

export function getDefaultProvider(): IProvider {
  // Prefer Claude, fall back to first available
  const claude = providers.get('claude');
  if (claude && claude.isAvailable()) return claude;

  const available = getAvailableProviders();
  if (available.length > 0) return available[0]!;

  // If nothing is available, still return Claude so callers get a clear error
  if (claude) return claude;
  throw new Error('No providers registered.');
}

/** Serialize all providers to DTOs for the REST API. */
export function getProviderDTOs(): ProviderInfoDTO[] {
  return [...providers.values()].map(p => ({
    id: p.info.id,
    name: p.info.name,
    icon: p.info.icon,
    description: p.info.description,
    website: p.info.website,
    models: p.models,
    capabilities: p.capabilities,
    available: (() => { try { return p.isAvailable(); } catch { return false; } })(),
    configured: (() => { try { return p.isConfigured().configured; } catch { return true; } })(),
    installCommand: (isWindows && p.info.windowsInstallCommand) || p.info.installCommand,
  }));
}
