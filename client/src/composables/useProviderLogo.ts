/**
 * Maps provider icon names to Vue components.
 * Used by MessageBubble, MessageList, and other UI that shows provider logos.
 */

import { computed, type Component } from 'vue';
import { useProviderStore } from '@/stores/provider';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import GeminiLogo from '@/components/icons/GeminiLogo.vue';
import CodexLogo from '@/components/icons/CodexLogo.vue';
import AiderLogo from '@/components/icons/AiderLogo.vue';
import ClineLogo from '@/components/icons/ClineLogo.vue';
import KiroLogo from '@/components/icons/KiroLogo.vue';
import QwenLogo from '@/components/icons/QwenLogo.vue';
import OpenCodeLogo from '@/components/icons/OpenCodeLogo.vue';

const logoMap: Record<string, Component> = {
  ClaudeLogo,
  GeminiLogo,
  CodexLogo,
  AiderLogo,
  ClineLogo,
  KiroLogo,
  QwenLogo,
  OpenCodeLogo,
};

export function useProviderLogo() {
  const providerStore = useProviderStore();

  const activeLogo = computed<Component>(() =>
    logoMap[providerStore.activeProvider.icon] || ClaudeLogo
  );

  const activeName = computed(() => providerStore.activeProviderName);

  function getLogoComponent(iconName: string): Component {
    return logoMap[iconName] || ClaudeLogo;
  }

  /** Look up logo component by provider ID (e.g. 'claude', 'gemini'). */
  function getLogoForProviderId(providerId: string | undefined): Component {
    if (!providerId) return activeLogo.value;
    const p = providerStore.providers.find(p => p.id === providerId);
    if (p) return logoMap[p.icon] || ClaudeLogo;
    return ClaudeLogo;
  }

  /** Look up provider display name by provider ID. */
  function getNameForProviderId(providerId: string | undefined): string {
    if (!providerId) return activeName.value;
    const p = providerStore.providers.find(p => p.id === providerId);
    return p?.name ?? activeName.value;
  }

  return { activeLogo, activeName, getLogoComponent, getLogoForProviderId, getNameForProviderId, logoMap };
}
