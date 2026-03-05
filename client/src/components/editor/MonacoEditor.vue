<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick, shallowRef } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useSettingsStore } from '@/stores/settings';

const files = useFilesStore();
const settings = useSettingsStore();
const editorContainer = ref<HTMLElement | null>(null);

// Use shallowRef to avoid Vue reactivity on large Monaco objects
const editorInstance = shallowRef<any>(null);
const monacoModule = shallowRef<any>(null);
const isLoading = ref(true);
const loadError = ref<string | null>(null);

const activeFileData = computed(() =>
  files.openFiles.find(f => f.path === files.activeFile)
);

/** Map file language identifiers to Monaco language IDs */
function getMonacoLanguage(lang: string): string {
  const map: Record<string, string> = {
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
    cpp: 'cpp',
    c: 'c',
    shell: 'shell',
    bash: 'shell',
    dockerfile: 'dockerfile',
    toml: 'ini',
  };
  return map[lang] || 'plaintext';
}

/** Load Monaco lazily */
async function loadMonaco() {
  try {
    isLoading.value = true;
    loadError.value = null;

    const monaco = await import('monaco-editor');

    // Configure Monaco environment for Vite — use built-in worker proxy
    self.MonacoEnvironment = {
      getWorker(_workerId: string, label: string) {
        // Use simple wrapper workers that import the actual worker modules
        if (label === 'json') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
            { type: 'module' }
          );
        }
        if (label === 'css' || label === 'scss' || label === 'less') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
            { type: 'module' }
          );
        }
        if (label === 'html' || label === 'handlebars' || label === 'razor') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
            { type: 'module' }
          );
        }
        if (label === 'typescript' || label === 'javascript') {
          return new Worker(
            new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
            { type: 'module' }
          );
        }
        return new Worker(
          new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
          { type: 'module' }
        );
      },
    };

    monacoModule.value = monaco;
    isLoading.value = false;
  } catch (err) {
    loadError.value = `Failed to load Monaco Editor: ${err}`;
    isLoading.value = false;
  }
}

function createEditor(content: string, language: string) {
  const monaco = monacoModule.value;
  if (!monaco || !editorContainer.value) return;

  // Dispose previous instance
  if (editorInstance.value) {
    editorInstance.value.dispose();
    editorInstance.value = null;
  }

  const editor = monaco.editor.create(editorContainer.value, {
    value: content,
    language: getMonacoLanguage(language),
    theme: settings.darkMode ? 'vs-dark' : 'vs',
    fontSize: settings.editorFontSize,
    tabSize: settings.editorTabSize,
    wordWrap: settings.editorWordWrap ? 'on' : 'off',
    lineNumbers: settings.editorShowLineNumbers ? 'on' : 'off',
    minimap: { enabled: settings.editorMinimap },
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 4 },
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
  });

  // Listen for content changes and sync back to the files store
  editor.onDidChangeModelContent(() => {
    if (files.activeFile) {
      files.updateFileContent(files.activeFile, editor.getValue());
    }
  });

  editorInstance.value = editor;
}

// Recreate editor when file changes
watch(activeFileData, async (file) => {
  if (file && monacoModule.value) {
    await nextTick();
    createEditor(file.content, file.language);
  }
}, { immediate: false });

// Recreate editor when settings change
watch(
  () => [settings.editorFontSize, settings.editorTabSize, settings.editorWordWrap, settings.editorShowLineNumbers, settings.editorMinimap, settings.darkMode],
  async () => {
    if (activeFileData.value && monacoModule.value) {
      const content = editorInstance.value?.getValue() || activeFileData.value.content;
      await nextTick();
      createEditor(content, activeFileData.value.language);
    }
  },
);

function handleSave() {
  if (files.activeFile) {
    files.saveFile(files.activeFile);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    handleSave();
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown);
  await loadMonaco();
  if (activeFileData.value) {
    await nextTick();
    createEditor(activeFileData.value.content, activeFileData.value.language);
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (editorInstance.value) {
    editorInstance.value.dispose();
    editorInstance.value = null;
  }
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="isLoading" class="flex h-full items-center justify-center text-muted-foreground">
      <p class="text-sm">Loading Monaco Editor...</p>
    </div>
    <div v-else-if="loadError" class="flex h-full items-center justify-center text-destructive">
      <p class="text-sm">{{ loadError }}</p>
    </div>
    <div v-else-if="!activeFileData" class="flex h-full items-center justify-center text-muted-foreground">
      <p class="text-sm">Open a file from the explorer to start editing</p>
    </div>
    <template v-else>
      <div ref="editorContainer" class="flex-1 overflow-hidden" />
    </template>
  </div>
</template>
