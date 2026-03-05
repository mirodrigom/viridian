import { ref, computed, watch, type Ref } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore, PERMISSION_OPTIONS, THINKING_OPTIONS, type PermissionMode, type ThinkingMode } from '@/stores/settings';
import { useProviderStore } from '@/stores/provider';
import { uuid } from '@/lib/utils';

export interface SlashCommand {
  name: string;
  description: string;
  action: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function useSlashCommands(
  input: Ref<string>,
  closeTemplateMenu: () => void,
) {
  const chat = useChatStore();
  const settings = useSettingsStore();
  const providerStore = useProviderStore();

  const selectedCommandIndex = ref(0);

  const slashCommands: SlashCommand[] = [
    { name: '/clear', description: 'Clear current conversation', action: () => { chat.clearMessages(); input.value = ''; } },
    { name: '/model', description: 'Switch to next model', action: () => {
      const models = providerStore.activeModels.map(m => m.id);
      const idx = models.indexOf(settings.model);
      settings.model = models[(idx + 1) % models.length]!;
      settings.save();
      chat.addMessage({ id: uuid(), role: 'system', content: `Model switched to ${settings.modelLabel}`, timestamp: Date.now() });
      input.value = '';
    }},
    { name: '/think', description: 'Toggle thinking mode (Standard/Think/Think Hard)', action: () => {
      const modes = THINKING_OPTIONS.map(t => t.value);
      const idx = modes.indexOf(settings.thinkingMode);
      settings.thinkingMode = modes[(idx + 1) % modes.length] as ThinkingMode;
      settings.save();
      chat.addMessage({ id: uuid(), role: 'system', content: `Thinking mode: ${settings.thinkingLabel}`, timestamp: Date.now() });
      input.value = '';
    }},
    { name: '/permission', description: 'Toggle permission mode', action: () => {
      const modes = PERMISSION_OPTIONS.map(p => p.value);
      const idx = modes.indexOf(settings.permissionMode);
      settings.permissionMode = modes[(idx + 1) % modes.length] as PermissionMode;
      settings.save();
      chat.addMessage({ id: uuid(), role: 'system', content: `Permission mode: ${settings.permissionLabel}`, timestamp: Date.now() });
      input.value = '';
    }},
    { name: '/status', description: 'Show current session info', action: () => {
      const lines = [
        `Model: ${settings.modelLabel}`,
        `Thinking: ${settings.thinkingLabel}`,
        `Permission: ${settings.permissionLabel}`,
        `Messages: ${chat.messages.length}`,
        `Context: ${chat.contextPercent}%`,
        chat.usage.totalCost > 0 ? `Cost: $${chat.usage.totalCost.toFixed(4)}` : '',
      ].filter(Boolean);
      chat.addMessage({ id: uuid(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
      input.value = '';
    }},
    { name: '/cost', description: 'Show token usage and cost', action: () => {
      const lines = [
        `Input tokens: ${formatTokens(chat.usage.inputTokens)}`,
        `Output tokens: ${formatTokens(chat.usage.outputTokens)}`,
        `Context: ${chat.contextPercent}% used`,
        `Total cost: $${chat.usage.totalCost.toFixed(4)}`,
      ];
      chat.addMessage({ id: uuid(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
      input.value = '';
    }},
    { name: '/help', description: 'Show available commands', action: () => {
      const lines = slashCommands.map(c => `${c.name} — ${c.description}`);
      chat.addMessage({ id: uuid(), role: 'system', content: lines.join('\n'), timestamp: Date.now() });
      input.value = '';
    }},
  ];

  const showCommandMenu = computed(() => {
    return input.value.startsWith('/') && !input.value.includes(' ');
  });

  const filteredCommands = computed(() => {
    if (!showCommandMenu.value) return [];
    const q = input.value.toLowerCase();
    return slashCommands.filter(c => c.name.startsWith(q));
  });

  watch(showCommandMenu, (show) => {
    if (show) {
      selectedCommandIndex.value = 0;
      // Close template menu when command menu opens
      closeTemplateMenu();
    }
  });

  return {
    selectedCommandIndex,
    slashCommands,
    showCommandMenu,
    filteredCommands,
  };
}
