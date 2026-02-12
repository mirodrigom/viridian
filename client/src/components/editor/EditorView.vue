<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue';
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
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { showMinimap } from '@replit/codemirror-minimap';

const files = useFilesStore();
const settings = useSettingsStore();
const editorContainer = ref<HTMLElement | null>(null);
let editorView: EditorView | null = null;

const activeFileData = computed(() =>
  files.openFiles.find(f => f.path === files.activeFile)
);

/** Light theme that uses the app's CSS variables for consistent look */
const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--muted)',
    color: 'var(--foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--accent)',
    outline: '1px solid var(--border)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--primary)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted-foreground)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
  },
  '.cm-tooltip .cm-tooltip-arrow::before': {
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
  },
}, { dark: false });

/** Dark theme using CSS variables for consistent look */
const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#528bff',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#3E4451',
  },
  '.cm-selectionMatch': {
    backgroundColor: '#3E4451',
  },
  '.cm-panels': {
    backgroundColor: 'var(--muted)',
    color: 'var(--foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: '#72a1ff59',
    outline: '1px solid #457dff',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#6199ff2f',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted-foreground)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
  },
}, { dark: true });

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
    editorView = null;
  }
  if (!editorContainer.value) return;

  const extensions = [
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    keymap.of([...defaultKeymap, indentWithTab]),
    getLanguageExtension(language),
    settings.darkMode ? darkTheme : lightTheme,
    settings.darkMode
      ? syntaxHighlighting(oneDarkHighlightStyle, { fallback: true })
      : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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

// Recreate editor when file changes — use nextTick to ensure DOM is ready
watch(activeFileData, async (file) => {
  if (file) {
    await nextTick();
    createEditor(file.content, file.language);
  }
}, { immediate: true });

// Recreate editor when settings change (including dark mode)
watch(
  () => [settings.editorFontSize, settings.editorTabSize, settings.editorWordWrap, settings.editorShowLineNumbers, settings.editorMinimap, settings.darkMode],
  async () => {
    if (activeFileData.value) {
      const content = editorView?.state.doc.toString() || activeFileData.value.content;
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

onMounted(() => {
  // If we have an active file but the editor wasn't created yet (container wasn't ready), create it now
  if (activeFileData.value && !editorView) {
    createEditor(activeFileData.value.content, activeFileData.value.language);
  }

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
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="!activeFileData" class="flex h-full items-center justify-center text-muted-foreground">
      <p class="text-sm">Open a file from the explorer to start editing</p>
    </div>
    <template v-else>
      <div ref="editorContainer" class="flex-1 overflow-hidden" />
    </template>
  </div>
</template>
