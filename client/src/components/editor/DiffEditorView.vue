<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useFilesStore, type DiffData } from '@/stores/files';
import { useSettingsStore } from '@/stores/settings';
import { MergeView } from '@codemirror/merge';
import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-vue-next';

const files = useFilesStore();
const settings = useSettingsStore();
const container = ref<HTMLElement | null>(null);
let mergeView: MergeView | null = null;

const diffData = computed(() => files.diffData);
const fileName = computed(() => diffData.value?.path.split('/').pop() || '');

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

function createMergeView(data: DiffData) {
  if (mergeView) {
    mergeView.destroy();
    mergeView = null;
  }
  if (!container.value) return;

  const isDark = settings.darkMode;

  const diffTheme = EditorView.theme({
    '&': {
      backgroundColor: 'var(--background)',
      color: 'var(--foreground)',
    },
    '.cm-gutters': {
      backgroundColor: isDark ? 'var(--background)' : 'var(--muted)',
      color: 'var(--muted-foreground)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--accent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--accent)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: isDark ? '#528bff' : 'var(--foreground)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: isDark ? '#3E4451' : 'var(--accent)',
    },
  }, { dark: isDark });

  const sharedExtensions = [
    lineNumbers(),
    bracketMatching(),
    getLanguageExtension(data.language),
    diffTheme,
    isDark
      ? syntaxHighlighting(oneDarkHighlightStyle, { fallback: true })
      : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.readOnly.of(true),
    EditorView.theme({
      '&': { height: '100%', fontSize: `${settings.editorFontSize}px` },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-content': { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
      '.cm-gutters': { fontSize: `${settings.editorFontSize}px` },
    }),
  ];

  mergeView = new MergeView({
    a: { doc: data.original, extensions: sharedExtensions },
    b: { doc: data.modified, extensions: sharedExtensions },
    parent: container.value,
    collapseUnchanged: { margin: 3, minSize: 4 },
  });
}

watch(diffData, (data) => {
  if (data) {
    // Need to wait for DOM
    requestAnimationFrame(() => createMergeView(data));
  } else if (mergeView) {
    mergeView.destroy();
    mergeView = null;
  }
}, { immediate: true });

onUnmounted(() => {
  mergeView?.destroy();
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
    <div ref="container" class="flex-1 overflow-hidden" />
  </div>
</template>
