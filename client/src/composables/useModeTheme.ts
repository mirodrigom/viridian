import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';

export function useModeTheme() {
  const settings = useSettingsStore();
  const chat = useChatStore();

  const modeClass = computed(() => {
    // Claude-triggered plan mode takes highest priority
    if (chat.inPlanMode) return 'chat-mode-plan';
    // User-selected plan permission mode
    if (settings.permissionMode === 'plan') return 'chat-mode-plan';
    // Full auto
    if (settings.permissionMode === 'bypassPermissions') return 'chat-mode-fullauto';
    // Default and acceptEdits stay green
    return '';
  });

  return { modeClass };
}
