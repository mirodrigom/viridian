import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { useFilesStore } from '@/stores/files';
import { toast } from 'vue-sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreviewFileType = 'markdown' | 'html' | 'mermaid' | 'image' | 'code' | 'pdf' | 'unknown';

export interface PreviewTab {
  id: string;
  path: string;
  name: string;
  content: string;
  fileType: PreviewFileType;
  language: string;
  loading: boolean;
  lastModified: number;
}

// ─── Extension maps ───────────────────────────────────────────────────────────

const markdownExts = new Set(['md', 'mdx', 'markdown']);
const htmlExts = new Set(['html', 'htm']);
const mermaidExts = new Set(['mmd', 'mermaid']);
const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
const pdfExts = new Set(['pdf']);
const codeExts = new Set([
  'ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'rb', 'php', 'swift', 'kt', 'kts', 'sh', 'bash', 'zsh', 'css', 'scss', 'sass', 'less',
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'xml', 'sql', 'graphql', 'gql', 'proto', 'dockerfile', 'makefile',
  'txt', 'log', 'csv', 'env', 'gitignore', 'editorconfig',
  'lua', 'r', 'dart', 'scala', 'clj', 'cljs', 'ex', 'exs', 'erl', 'hrl',
  'hs', 'ml', 'mli', 'fs', 'fsi', 'fsx', 'ps1', 'psm1', 'bat', 'cmd',
  'asm', 'nim', 'zig', 'v', 'svelte', 'astro',
]);

function getExt(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function detectFileType(name: string): PreviewFileType {
  const ext = getExt(name);
  const lowerName = name.toLowerCase();

  if (markdownExts.has(ext)) return 'markdown';
  if (htmlExts.has(ext)) return 'html';
  if (mermaidExts.has(ext)) return 'mermaid';
  if (imageExts.has(ext)) return 'image';
  if (pdfExts.has(ext)) return 'pdf';
  if (codeExts.has(ext)) return 'code';

  // Handle files without extensions
  if (['makefile', 'dockerfile', 'vagrantfile', 'gemfile', 'rakefile'].includes(lowerName)) return 'code';

  return 'code'; // Default to code preview
}

function detectLanguage(name: string): string {
  const ext = getExt(name);
  const languageMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
    h: 'c', hpp: 'cpp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    sh: 'bash', bash: 'bash', zsh: 'bash', css: 'css', scss: 'scss',
    json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    xml: 'xml', html: 'html', htm: 'html', vue: 'xml', svg: 'xml',
    sql: 'sql', md: 'markdown', txt: 'plaintext', log: 'plaintext',
    dockerfile: 'dockerfile', makefile: 'makefile',
    lua: 'lua', r: 'r', dart: 'dart', scala: 'scala',
    hs: 'haskell', diff: 'diff', graphql: 'graphql',
  };
  return languageMap[ext] || 'plaintext';
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePreviewStore = defineStore('preview', () => {
  const tabs = ref<PreviewTab[]>([]);
  const activeTabId = ref<string | null>(null);
  const watchIntervals = new Map<string, ReturnType<typeof setInterval>>();

  // ─── Computed ──────────────────────────────────────────────────────────────
  const activeTab = computed(() =>
    tabs.value.find(t => t.id === activeTabId.value) || null,
  );
  const tabCount = computed(() => tabs.value.length);

  // ─── Actions ──────────────────────────────────────────────────────────────

  function generateTabId(path: string): string {
    return `preview-${path.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
  }

  async function openPreview(filePath: string) {
    // If already open, just switch to it
    const existing = tabs.value.find(t => t.path === filePath);
    if (existing) {
      activeTabId.value = existing.id;
      return;
    }

    const name = filePath.split('/').pop() || filePath;
    const fileType = detectFileType(name);
    const language = detectLanguage(name);
    const id = generateTabId(filePath);

    const tab: PreviewTab = {
      id,
      path: filePath,
      name,
      content: '',
      fileType,
      language,
      loading: true,
      lastModified: Date.now(),
    };

    tabs.value.push(tab);
    activeTabId.value = id;

    // For images and PDFs, we don't need to fetch content — they use URLs
    if (fileType === 'image' || fileType === 'pdf') {
      tab.loading = false;
      startWatching(tab);
      return;
    }

    await loadContent(tab);
    startWatching(tab);
  }

  async function loadContent(tab: PreviewTab) {
    const filesStore = useFilesStore();
    tab.loading = true;
    try {
      const res = await apiFetch(
        `/api/files/content?root=${encodeURIComponent(filesStore.rootPath)}&path=${encodeURIComponent(tab.path)}`,
      );
      if (!res.ok) {
        toast.error(`Failed to load preview: ${tab.name}`);
        return;
      }
      const data = await res.json();
      tab.content = data.content;
      tab.lastModified = Date.now();
    } catch (err) {
      console.error('Preview loadContent error:', err);
      toast.error(`Failed to load preview: ${tab.name}`);
    } finally {
      tab.loading = false;
    }
  }

  async function refreshTab(tabId: string) {
    const tab = tabs.value.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.fileType === 'image' || tab.fileType === 'pdf') {
      // Force re-render by updating lastModified
      tab.lastModified = Date.now();
      return;
    }

    await loadContent(tab);
  }

  function startWatching(tab: PreviewTab) {
    // Poll for file changes every 3 seconds
    if (watchIntervals.has(tab.id)) return;
    const interval = setInterval(async () => {
      const existing = tabs.value.find(t => t.id === tab.id);
      if (!existing) {
        clearInterval(interval);
        watchIntervals.delete(tab.id);
        return;
      }
      // Only reload text-based files; images/PDFs are handled via timestamp on URL
      if (existing.fileType !== 'image' && existing.fileType !== 'pdf') {
        const filesStore = useFilesStore();
        try {
          const res = await apiFetch(
            `/api/files/content?root=${encodeURIComponent(filesStore.rootPath)}&path=${encodeURIComponent(existing.path)}`,
          );
          if (res.ok) {
            const data = await res.json();
            if (data.content !== existing.content) {
              existing.content = data.content;
              existing.lastModified = Date.now();
            }
          }
        } catch {
          // silently ignore polling errors
        }
      }
    }, 3000);
    watchIntervals.set(tab.id, interval);
  }

  function closeTab(tabId: string) {
    const idx = tabs.value.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    // Stop watching
    const interval = watchIntervals.get(tabId);
    if (interval) {
      clearInterval(interval);
      watchIntervals.delete(tabId);
    }

    tabs.value.splice(idx, 1);

    // If the closed tab was active, switch to the nearest tab
    if (activeTabId.value === tabId) {
      const newIdx = Math.min(idx, tabs.value.length - 1);
      activeTabId.value = tabs.value[newIdx]?.id || null;
    }
  }

  function closeAllTabs() {
    for (const [id, interval] of watchIntervals) {
      clearInterval(interval);
      watchIntervals.delete(id);
    }
    tabs.value = [];
    activeTabId.value = null;
  }

  function setActiveTab(tabId: string) {
    activeTabId.value = tabId;
  }

  return {
    // State
    tabs,
    activeTabId,

    // Computed
    activeTab,
    tabCount,

    // Actions
    openPreview,
    refreshTab,
    closeTab,
    closeAllTabs,
    setActiveTab,
  };
});
