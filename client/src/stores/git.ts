import { defineStore } from 'pinia';
import { ref } from 'vue';
import { toast } from 'vue-sonner';
import { useAuthStore } from './auth';
import { useChatStore } from './chat';
import { useFilesStore } from './files';

interface GitFileStatus {
  path: string;
  index: string;
  working_dir: string;
}

interface CommitLogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

interface BranchInfo {
  name: string;
  current: boolean;
}

export const useGitStore = defineStore('git', () => {
  const branch = ref('');
  const staged = ref<GitFileStatus[]>([]);
  const modified = ref<GitFileStatus[]>([]);
  const untracked = ref<string[]>([]);
  const diff = ref('');
  const loading = ref(false);
  const commitMessage = ref('');
  const log = ref<CommitLogEntry[]>([]);
  const branches = ref<BranchInfo[]>([]);
  const selectedFile = ref<string | null>(null);
  const showStagedDiff = ref(false);
  const remoteLoading = ref(false);
  const generatingMessage = ref(false);
  const operationLoading = ref(false);
  const selectedFiles = ref<Set<string>>(new Set());

  function authHeaders() {
    const auth = useAuthStore();
    return { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
  }

  function cwd() {
    return useChatStore().projectPath || '';
  }

  async function fetchStatus() {
    if (!cwd()) return;
    loading.value = true;
    try {
      const res = await fetch(`/api/git/status?cwd=${encodeURIComponent(cwd())}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        toast.error('Failed to fetch git status');
        return;
      }
      const data = await res.json();
      branch.value = data.current || '';
      staged.value = (data.files || [])
        .filter((f: GitFileStatus) => f.index && f.index !== ' ' && f.index !== '?')
        .map((f: GitFileStatus) => ({ path: f.path, index: f.index, working_dir: f.working_dir }));
      modified.value = data.modified?.map((p: string) => ({ path: p, index: ' ', working_dir: 'M' })) || [];
      untracked.value = data.not_added || [];
    } catch {
      toast.error('Failed to fetch git status');
    } finally {
      loading.value = false;
    }
  }

  async function fetchDiff(isStagedDiff = false) {
    if (!cwd()) return;
    showStagedDiff.value = isStagedDiff;
    selectedFile.value = null;
    try {
      const res = await fetch(`/api/git/diff?cwd=${encodeURIComponent(cwd())}&staged=${isStagedDiff}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('HTTP error');
      const data = await res.json();
      diff.value = data.diff || '';
    } catch {
      toast.error('Failed to fetch diff');
    }
  }

  async function fetchFileDiff(filePath: string) {
    if (!cwd()) return;
    selectedFile.value = filePath;
    try {
      const res = await fetch(
        `/api/git/file-diff?cwd=${encodeURIComponent(cwd())}&file=${encodeURIComponent(filePath)}&staged=${showStagedDiff.value}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error('HTTP error');
      const data = await res.json();
      diff.value = data.diff || '';
    } catch {
      toast.error('Failed to fetch file diff');
    }
  }

  async function stageFiles(files: string[]) {
    if (!cwd()) return;
    operationLoading.value = true;
    try {
      const res = await fetch('/api/git/stage', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), files }),
      });
      if (!res.ok) throw new Error('HTTP error');
      await fetchStatus();
    } catch {
      toast.error('Failed to stage files');
    } finally {
      operationLoading.value = false;
    }
  }

  async function unstageFiles(files: string[]) {
    if (!cwd()) return;
    operationLoading.value = true;
    try {
      const res = await fetch('/api/git/unstage', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), files }),
      });
      if (!res.ok) throw new Error('HTTP error');
      await fetchStatus();
    } catch {
      toast.error('Failed to unstage files');
    } finally {
      operationLoading.value = false;
    }
  }

  async function doCommit() {
    if (!cwd() || !commitMessage.value.trim()) return;
    operationLoading.value = true;
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), message: commitMessage.value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Commit failed');
      }
      commitMessage.value = '';
      await fetchStatus();
      diff.value = '';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to commit');
    } finally {
      operationLoading.value = false;
    }
  }

  async function discardFile(filePath: string) {
    if (!cwd()) return;
    operationLoading.value = true;
    try {
      const res = await fetch('/api/git/discard', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), file: filePath }),
      });
      if (!res.ok) throw new Error('HTTP error');
      await fetchStatus();
    } catch {
      toast.error('Failed to discard changes');
    } finally {
      operationLoading.value = false;
    }
  }

  async function fetchLog() {
    if (!cwd()) return;
    try {
      const res = await fetch(`/api/git/log?cwd=${encodeURIComponent(cwd())}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('HTTP error');
      const data = await res.json();
      log.value = data.all || [];
    } catch {
      toast.error('Failed to fetch log');
    }
  }

  async function fetchBranches() {
    if (!cwd()) return;
    try {
      const res = await fetch(`/api/git/branches?cwd=${encodeURIComponent(cwd())}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('HTTP error');
      const data = await res.json();
      branches.value = Object.values(data.branches || {})
        .filter((b: unknown) => {
          const branch = b as { name: string };
          return !branch.name.startsWith('remotes/');
        })
        .map((b: unknown) => {
          const branch = b as { name: string; current: boolean };
          return { name: branch.name, current: branch.current };
        });
    } catch {
      toast.error('Failed to fetch branches');
    }
  }

  async function checkoutBranch(branchName: string) {
    if (!cwd()) return;
    operationLoading.value = true;
    try {
      await fetch('/api/git/checkout', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), branch: branchName }),
      });
      await fetchStatus();
      await fetchBranches();
    } catch {
      toast.error('Failed to checkout branch');
    } finally {
      operationLoading.value = false;
    }
  }

  async function createBranch(branchName: string) {
    if (!cwd()) return;
    operationLoading.value = true;
    try {
      await fetch('/api/git/create-branch', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), branch: branchName }),
      });
      await fetchStatus();
      await fetchBranches();
    } catch {
      toast.error('Failed to create branch');
    } finally {
      operationLoading.value = false;
    }
  }

  async function deleteBranch(branchName: string, force = false) {
    if (!cwd()) return;
    operationLoading.value = true;
    try {
      const res = await fetch('/api/git/branch', {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd(), branch: branchName, force }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to delete branch');
      }
      await fetchBranches();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete branch';
      toast.error(message);
      throw err;
    } finally {
      operationLoading.value = false;
    }
  }

  async function doPull() {
    if (!cwd()) return;
    remoteLoading.value = true;
    try {
      const res = await fetch('/api/git/pull', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Pull failed');
      }
      await fetchStatus();
      await fetchLog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Pull failed');
    } finally {
      remoteLoading.value = false;
    }
  }

  async function doPush() {
    if (!cwd()) return;
    remoteLoading.value = true;
    try {
      const res = await fetch('/api/git/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Push failed');
      }
      await fetchStatus();
      await fetchLog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed');
    } finally {
      remoteLoading.value = false;
    }
  }

  async function doFetch() {
    if (!cwd()) return;
    remoteLoading.value = true;
    try {
      await fetch('/api/git/fetch', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd() }),
      });
    } catch {
      toast.error('Fetch failed');
    } finally {
      remoteLoading.value = false;
    }
  }

  async function generateCommitMessage() {
    if (!cwd()) return;
    generatingMessage.value = true;
    commitMessage.value = '';
    try {
      const res = await fetch('/api/git/generate-commit-message', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cwd: cwd() }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.error) console.error('Commit message generation failed:', data.error);
        return;
      }

      // Consume SSE stream
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'delta' && data.text) {
                commitMessage.value += data.text;
              }
            } catch { /* skip non-JSON */ }
            eventType = '';
          }
        }
      }

      // Trim any leading/trailing whitespace from the final message
      commitMessage.value = commitMessage.value.trim();
    } finally {
      generatingMessage.value = false;
    }
  }

  async function showCommit(hash: string) {
    if (!cwd()) return;
    try {
      const res = await fetch(
        `/api/git/show?cwd=${encodeURIComponent(cwd())}&hash=${encodeURIComponent(hash)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error('HTTP error');
      const data = await res.json();
      diff.value = data.show || '';
      selectedFile.value = null;
    } catch {
      toast.error('Failed to show commit');
    }
  }

  function toggleFileSelection(path: string) {
    if (selectedFiles.value.has(path)) {
      selectedFiles.value.delete(path);
    } else {
      selectedFiles.value.add(path);
    }
    // Force reactivity on Set
    selectedFiles.value = new Set(selectedFiles.value);
  }

  function selectAllModified() {
    const all = [...modified.value.map(f => f.path), ...untracked.value];
    selectedFiles.value = new Set(all);
  }

  function clearSelection() {
    selectedFiles.value = new Set();
  }

  async function stageSelected() {
    const files = Array.from(selectedFiles.value);
    if (!files.length) return;
    await stageFiles(files);
    clearSelection();
  }

  async function openDiffInEditor(filePath: string) {
    if (!cwd()) return;
    const res = await window.fetch(
      `/api/git/file-versions?cwd=${encodeURIComponent(cwd())}&file=${encodeURIComponent(filePath)}&staged=${showStagedDiff.value}`,
      { headers: authHeaders() },
    );
    if (!res.ok) return;
    const data = await res.json();
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', html: 'html', vue: 'vue', svelte: 'svelte',
      css: 'css', scss: 'scss', json: 'json', md: 'markdown',
    };
    const filesStore = useFilesStore();
    filesStore.openDiff({
      path: filePath,
      original: data.original || '',
      modified: data.modified || '',
      language: langMap[ext] || '',
    });
  }

  async function openFileInEditor(filePath: string) {
    const filesStore = useFilesStore();
    // Set rootPath if not already set
    if (!filesStore.rootPath && cwd()) {
      filesStore.rootPath = cwd();
    }
    filesStore.closeDiff(); // Close diff view if open
    await filesStore.openFile(filePath);
  }

  return {
    branch, staged, modified, untracked, diff, loading, commitMessage,
    log, branches, selectedFile, showStagedDiff, remoteLoading, generatingMessage,
    operationLoading, selectedFiles,
    fetchStatus, fetchDiff, fetchFileDiff, stageFiles, unstageFiles, doCommit,
    discardFile, fetchLog, fetchBranches, checkoutBranch, createBranch,
    deleteBranch, doPull, doPush, doFetch, generateCommitMessage, showCommit,
    toggleFileSelection, selectAllModified, clearSelection, stageSelected,
    openDiffInEditor, openFileInEditor,
  };
});
