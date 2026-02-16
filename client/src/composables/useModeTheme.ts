import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';

export function useModeTheme() {
  const settings = useSettingsStore();
  const chat = useChatStore();

  const modeClassMap: Record<string, string> = {
    plan: 'chat-mode-plan',
    bypassPermissions: 'chat-mode-fullauto',
    acceptEdits: 'chat-mode-acceptEdits',
    default: 'chat-mode-default',
  };

  const modeClass = computed(() => {
    // Claude-triggered plan mode takes highest priority
    if (chat.inPlanMode) return 'chat-mode-plan';
    return modeClassMap[settings.permissionMode] || '';
  });

  return { modeClass };
}
