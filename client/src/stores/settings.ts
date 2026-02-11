import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type ClaudeModel = 'claude-sonnet-4-5-20250929' | 'claude-opus-4-6' | 'claude-haiku-4-5-20251001';
export type ThinkingMode = 'standard' | 'think' | 'think_hard' | 'think_harder' | 'ultrathink';

export const MODEL_OPTIONS: { value: ClaudeModel; label: string; description: string }[] = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', description: 'Fast and capable — best balance of speed and quality' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most powerful — deep reasoning and complex tasks' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest — quick tasks with lower cost' },
];

export const PERMISSION_OPTIONS: { value: PermissionMode; label: string; description: string; icon: string }[] = [
  { value: 'bypassPermissions', label: 'Full Auto', description: 'Auto-approve all tools', icon: '⚡' },
  { value: 'acceptEdits', label: 'Accept Edits', description: 'Auto-approve file edits only', icon: '✏️' },
  { value: 'plan', label: 'Plan Mode', description: 'Plan only, no execution', icon: '📋' },
  { value: 'default', label: 'Ask Every Time', description: 'Prompt for each tool use', icon: '🔒' },
];

export const THINKING_OPTIONS: { value: ThinkingMode; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard', description: 'No extended thinking' },
  { value: 'think', label: 'Think', description: 'Light reasoning before responding' },
  { value: 'think_hard', label: 'Think Hard', description: 'Deeper analysis and reasoning' },
  { value: 'think_harder', label: 'Think Harder', description: 'Thorough multi-step reasoning' },
  { value: 'ultrathink', label: 'Ultrathink', description: 'Maximum depth reasoning' },
];

export const COMMON_TOOLS = [
  'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git status:*)',
  'Bash(npm:*)', 'Bash(npx:*)',
  'Write', 'Read', 'Edit', 'Glob', 'Grep', 'MultiEdit', 'Task',
  'TodoWrite', 'TodoRead', 'WebFetch', 'WebSearch',
];

export const COMMON_DISALLOWED = [
  'Bash(rm -rf:*)', 'Bash(sudo:*)', 'Bash(curl|wget:*)',
];

export const useSettingsStore = defineStore('settings', () => {
  const darkMode = ref(true);
  const fontSize = ref(13);
  const permissionMode = ref<PermissionMode>('bypassPermissions');
  const model = ref<ClaudeModel>('claude-opus-4-6');
  const thinkingMode = ref<ThinkingMode>('standard');
  const maxTokens = ref(200000);
  const maxOutputTokens = ref(16384);
  const allowedTools = ref<string[]>([]);
  const disallowedTools = ref<string[]>([]);
  const projectsDir = ref('/home/rodrigom/Documents');
  const editorWordWrap = ref(false);
  const editorTabSize = ref(2);
  const editorFontSize = ref(13);
  const editorShowLineNumbers = ref(true);

  const modelLabel = computed(() =>
    MODEL_OPTIONS.find(m => m.value === model.value)?.label || model.value
  );

  const permissionLabel = computed(() =>
    PERMISSION_OPTIONS.find(p => p.value === permissionMode.value)?.label || permissionMode.value
  );

  const thinkingLabel = computed(() =>
    THINKING_OPTIONS.find(t => t.value === thinkingMode.value)?.label || 'Standard'
  );

  function init() {
    const saved = localStorage.getItem('settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      darkMode.value = parsed.darkMode ?? true;
      fontSize.value = parsed.fontSize ?? 13;
      permissionMode.value = parsed.permissionMode ?? 'bypassPermissions';
      model.value = parsed.model ?? 'claude-opus-4-6';
      thinkingMode.value = parsed.thinkingMode ?? 'standard';
      maxTokens.value = parsed.maxTokens ?? 200000;
      maxOutputTokens.value = parsed.maxOutputTokens ?? 16384;
      allowedTools.value = parsed.allowedTools ?? [];
      disallowedTools.value = parsed.disallowedTools ?? [];
      projectsDir.value = parsed.projectsDir ?? '/home/rodrigom/Documents';
      editorWordWrap.value = parsed.editorWordWrap ?? false;
      editorTabSize.value = parsed.editorTabSize ?? 2;
      editorFontSize.value = parsed.editorFontSize ?? 13;
      editorShowLineNumbers.value = parsed.editorShowLineNumbers ?? true;
    }
    applyDarkMode();
  }

  function save() {
    localStorage.setItem('settings', JSON.stringify({
      darkMode: darkMode.value,
      fontSize: fontSize.value,
      permissionMode: permissionMode.value,
      model: model.value,
      thinkingMode: thinkingMode.value,
      maxTokens: maxTokens.value,
      maxOutputTokens: maxOutputTokens.value,
      allowedTools: allowedTools.value,
      disallowedTools: disallowedTools.value,
      projectsDir: projectsDir.value,
      editorWordWrap: editorWordWrap.value,
      editorTabSize: editorTabSize.value,
      editorFontSize: editorFontSize.value,
      editorShowLineNumbers: editorShowLineNumbers.value,
    }));
    applyDarkMode();
  }

  function applyDarkMode() {
    if (darkMode.value) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  function toggleDarkMode() {
    darkMode.value = !darkMode.value;
    save();
  }

  function addAllowedTool(tool: string) {
    if (!allowedTools.value.includes(tool)) {
      allowedTools.value.push(tool);
      save();
    }
  }

  function removeAllowedTool(tool: string) {
    allowedTools.value = allowedTools.value.filter(t => t !== tool);
    save();
  }

  function addDisallowedTool(tool: string) {
    if (!disallowedTools.value.includes(tool)) {
      disallowedTools.value.push(tool);
      save();
    }
  }

  function removeDisallowedTool(tool: string) {
    disallowedTools.value = disallowedTools.value.filter(t => t !== tool);
    save();
  }

  return {
    darkMode, fontSize, permissionMode, model, thinkingMode, maxTokens, maxOutputTokens,
    allowedTools, disallowedTools, projectsDir,
    editorWordWrap, editorTabSize, editorFontSize, editorShowLineNumbers,
    modelLabel, permissionLabel, thinkingLabel,
    init, save, toggleDarkMode,
    addAllowedTool, removeAllowedTool,
    addDisallowedTool, removeDisallowedTool,
  };
});
