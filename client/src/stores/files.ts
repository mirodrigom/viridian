import { defineStore } from 'pinia';
import { ref } from 'vue';
import { toast } from 'vue-sonner';
import { apiFetch } from '@/lib/apiFetch';

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
    loading.value = true;
    try {
      const url = path ? `/api/files/tree?path=${encodeURIComponent(path)}` : '/api/files/tree';
      const res = await apiFetch(url);
      if (!res.ok) {
        toast.error('Failed to load file tree');
        return;
      }
      const data = await res.json();
      tree.value = data.tree;
      rootPath.value = data.rootPath;
    } catch (err) {
      toast.error('Failed to load file tree');
      console.error('fetchTree error:', err);
    } finally {
      loading.value = false;
    }
  }

  async function expandFolder(folderPath: string) {

    function findNode(nodes: FileNode[], path: string): (FileNode & { _loaded?: boolean }) | null {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children && node.type === 'directory') {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return null;
    }

    const node = findNode(tree.value, folderPath) as (FileNode & { _loaded?: boolean }) | null;
    if (!node || node.type !== 'directory' || node._loaded) return;

    try {
      const res = await apiFetch(
        `/api/files/tree/children?root=${encodeURIComponent(rootPath.value)}&path=${encodeURIComponent(folderPath)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      node.children = data.children || [];
      node._loaded = true;
    } catch (err) {
      console.error('Failed to expand folder:', err);
    }
  }

  async function openFile(filePath: string) {
    // Already open?
    const existing = openFiles.value.find(f => f.path === filePath);
    if (existing) {
      activeFile.value = filePath;
      return;
    }

    try {
      const res = await apiFetch(
        `/api/files/content?root=${encodeURIComponent(rootPath.value)}&path=${encodeURIComponent(filePath)}`,
      );
      if (!res.ok) {
        toast.error('Failed to open file');
        return;
      }
      const data = await res.json();
      openFiles.value.push({
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        content: data.content,
        language: data.language,
        modified: false,
      });
      activeFile.value = filePath;
    } catch (err) {
      toast.error('Failed to open file');
      console.error('openFile error:', err);
    }
  }

  async function saveFile(filePath: string) {
    const file = openFiles.value.find(f => f.path === filePath);
    if (!file) return;

    try {
      const res = await apiFetch('/api/files/content', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          root: rootPath.value,
          path: filePath,
          content: file.content,
        }),
      });
      if (!res.ok) {
        toast.error('Failed to save file');
        return;
      }
      file.modified = false;
    } catch (err) {
      toast.error('Failed to save file');
      console.error('saveFile error:', err);
    }
  }

  async function createFile(filePath: string) {
    try {
      const res = await apiFetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: rootPath.value, path: filePath }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to create file');
        return false;
      }
      const data = await res.json();
      // Open the newly created file in the editor
      openFiles.value.push({
        path: filePath,
        name: filePath.split('/').pop() || filePath,
        content: '',
        language: data.language || 'plaintext',
        modified: false,
      });
      activeFile.value = filePath;
      // Refresh the file tree so the explorer sidebar shows the new file
      await fetchTree(rootPath.value);
      return true;
    } catch (err) {
      toast.error('Failed to create file');
      console.error('createFile error:', err);
      return false;
    }
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
    fetchTree, expandFolder, openFile, createFile, saveFile, closeFile, updateFileContent, openDiff, closeDiff,
  };
});
