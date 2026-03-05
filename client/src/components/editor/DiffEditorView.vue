<script setup lang="ts">
import { ref, watch, onUnmounted, computed, nextTick, shallowRef } from 'vue';
import { useFilesStore, type DiffData } from '@/stores/files';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-vue-next';

const files = useFilesStore();
const settings = useSettingsStore();
const container = ref<HTMLElement | null>(null);
const diffEditor = shallowRef<any>(null);
const monacoModule = shallowRef<any>(null);
const isLoading = ref(true);

const diffData = computed(() => files.diffData);
const fileName = computed(() => diffData.value?.path.split('/').pop() || '');

const LANG_MAP: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  html: 'html',
  vue: 'html',
  svelte: 'html',
  astro: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  markdown: 'markdown',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  rust: 'rust',
  go: 'go',
  java: 'java',
  shell: 'shell',
  bash: 'shell',
  dockerfile: 'dockerfile',
};

async function ensureMonaco() {
  if (monacoModule.value) return monacoModule.value;
  const monaco = await import('monaco-editor');
  monacoModule.value = monaco;
  isLoading.value = false;
  return monaco;
}

async function createDiffView(data: DiffData) {
  if (diffEditor.value) {
    diffEditor.value.dispose();
    diffEditor.value = null;
  }
  if (!container.value) return;

  const monaco = await ensureMonaco();
  const lang = LANG_MAP[data.language] || 'plaintext';

  const editor = monaco.editor.createDiffEditor(container.value, {
    theme: settings.darkMode ? 'vs-dark' : 'vs',
    fontSize: settings.editorFontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    readOnly: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    renderSideBySide: true,
    enableSplitViewResizing: true,
    padding: { top: 4 },
    minimap: { enabled: false },
  });

  const originalModel = monaco.editor.createModel(data.original, lang);
  const modifiedModel = monaco.editor.createModel(data.modified, lang);

  editor.setModel({ original: originalModel, modified: modifiedModel });
  diffEditor.value = editor;
}

watch(diffData, (data) => {
  if (data) {
    nextTick(() => createDiffView(data));
  } else if (diffEditor.value) {
    diffEditor.value.dispose();
    diffEditor.value = null;
  }
}, { immediate: true });

watch(
  () => [settings.darkMode, settings.editorFontSize],
  () => {
    if (diffData.value) {
      nextTick(() => createDiffView(diffData.value!));
    }
  },
);

onUnmounted(() => {
  diffEditor.value?.dispose();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Diff header bar -->
    <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <span class="font-mono text-xs font-medium text-foreground">{{ fileName }}</span>
      <span class="text-[10px] text-muted-foreground">Diff View</span>
      <div class="ml-auto flex items-center gap-2">
        <span class="text-[10px] text-red-400">original</span>
        <span class="text-[10px] text-muted-foreground">&rarr;</span>
        <span class="text-[10px] text-green-400">modified</span>
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="files.closeDiff()">
          <X class="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
    <div v-if="isLoading && diffData" class="flex flex-1 items-center justify-center text-muted-foreground">
      <p class="text-sm">Loading diff editor...</p>
    </div>
    <div ref="container" class="flex-1 overflow-hidden" />
  </div>
</template>
