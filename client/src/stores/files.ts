import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  modified: boolean;
}

export interface DiffData {
  path: string;
  original: string;
  modified: string;
  language: string;
}

export const useFilesStore = defineStore('files', () => {
  const tree = ref<FileNode[]>([]);
  const rootPath = ref('');
  const openFiles = ref<OpenFile[]>([]);
  const activeFile = ref<string | null>(null);
  const loading = ref(false);
  const diffData = ref<DiffData | null>(null);

  async function fetchTree(path?: string) {
    const auth = useAuthStore();
    loading.value = true;
    try {
      const url = path ? `/api/files/tree?path=${encodeURIComponent(path)}` : '/api/files/tree';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const data = await res.json();
      tree.value = data.tree;
      rootPath.value = data.rootPath;
    } finally {
      loading.value = false;
    }
  }

  async function openFile(filePath: string) {
    // Already open?
    const existing = openFiles.value.find(f => f.path === filePath);
    if (existing) {
      activeFile.value = filePath;
      return;
    }

    const auth = useAuthStore();
    const res = await fetch(
      `/api/files/content?root=${encodeURIComponent(rootPath.value)}&path=${encodeURIComponent(filePath)}`,
      { headers: { Authorization: `Bearer ${auth.token}` } },
    );
    const data = await res.json();
    openFiles.value.push({
      path: filePath,
      name: filePath.split('/').pop() || filePath,
      content: data.content,
      language: data.language,
      modified: false,
    });
    activeFile.value = filePath;
  }

  async function saveFile(filePath: string) {
    const file = openFiles.value.find(f => f.path === filePath);
    if (!file) return;

    const auth = useAuthStore();
    await fetch('/api/files/content', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        root: rootPath.value,
        path: filePath,
        content: file.content,
      }),
    });
    file.modified = false;
  }

  function closeFile(filePath: string) {
    const idx = openFiles.value.findIndex(f => f.path === filePath);
    if (idx === -1) return;
    openFiles.value.splice(idx, 1);
    if (activeFile.value === filePath) {
      activeFile.value = openFiles.value[Math.min(idx, openFiles.value.length - 1)]?.path || null;
    }
  }

  function updateFileContent(filePath: string, content: string) {
    const file = openFiles.value.find(f => f.path === filePath);
    if (file) {
      file.content = content;
      file.modified = true;
    }
  }

  function openDiff(data: DiffData) {
    diffData.value = data;
  }

  function closeDiff() {
    diffData.value = null;
  }

  return {
    tree, rootPath, openFiles, activeFile, loading, diffData,
    fetchTree, openFile, saveFile, closeFile, updateFileContent, openDiff, closeDiff,
  };
});
