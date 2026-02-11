<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useSettingsStore } from '@/stores/settings';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentUnit } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { showMinimap } from '@replit/codemirror-minimap';

const files = useFilesStore();
const settings = useSettingsStore();
const editorContainer = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

const activeFileData = computed(() =>
  files.openFiles.find(f => f.path === files.activeFile)
);

function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'typescript': return javascript({ typescript: true, jsx: true });
    case 'javascript': return javascript({ jsx: true });
    case 'python': return python();
    case 'html': case 'vue': case 'svelte': case 'astro': return html();
    case 'css': case 'scss': return css();
    case 'json': return json();
    case 'markdown': return markdown();
    default: return [];
  }
}

function createEditor(content: string, language: string) {
  if (editorView) {
    editorView.destroy();
  }
  if (!editorContainer.value) return;

  const extensions = [
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, indentWithTab]),
    getLanguageExtension(language),
    oneDark,
    indentUnit.of(' '.repeat(settings.editorTabSize)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && files.activeFile) {
        files.updateFileContent(files.activeFile, update.state.doc.toString());
      }
    }),
    EditorView.theme({
      '&': { height: '100%', fontSize: `${settings.editorFontSize}px` },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
      '.cm-gutters': { fontSize: `${settings.editorFontSize}px` },
    }),
  ];

  if (settings.editorShowLineNumbers) {
    extensions.unshift(lineNumbers());
  }

  if (settings.editorWordWrap) {
    extensions.push(EditorView.lineWrapping);
  }

  // Minimap
  if (settings.editorMinimap) {
    extensions.push(
      showMinimap.compute(['doc'], () => ({
        create: () => {
          const dom = document.createElement('div');
          return { dom };
        },
        displayText: 'blocks',
        showOverlay: 'always' as const,
      })),
    );
  }

  const state = EditorState.create({ doc: content, extensions });
  editorView = new EditorView({ state, parent: editorContainer.value });
}

// Recreate editor when file changes
watch(activeFileData, (file) => {
  if (file) {
    createEditor(file.content, file.language);
  }
}, { immediate: true });

// Recreate editor when settings change
watch(
  () => [settings.editorFontSize, settings.editorTabSize, settings.editorWordWrap, settings.editorShowLineNumbers, settings.editorMinimap],
  () => {
    if (activeFileData.value) {
      const content = editorView?.state.doc.toString() || activeFileData.value.content;
      createEditor(content, activeFileData.value.language);
    }
  },
);

function handleSave() {
  if (files.activeFile) {
    files.saveFile(files.activeFile);
  }
}

onMounted(() => {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  });
});

onUnmounted(() => {
  editorView?.destroy();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="!activeFileData" class="flex h-full items-center justify-center text-muted-foreground">
      <p class="text-sm">Open a file from the explorer to start editing</p>
    </div>
    <template v-else>
      <div ref="editorContainer" class="flex-1 overflow-hidden" />
    </template>
  </div>
</template>
