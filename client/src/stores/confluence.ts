import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { toast } from 'vue-sonner';

// ─── Types ────────────────────────────────────────────────────────────

export interface ConfluencePageSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  inputText: string;
  markdown: string;
  confluenceOutput: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
}

export const useConfluenceStore = defineStore('confluence', () => {
  // ─── State ───────────────────────────────────────────────────────────
  const pageList = ref<ConfluencePageSummary[]>([]);
  const currentPage = ref<ConfluencePage | null>(null);
  const loading = ref(false);

  // ─── Computed ────────────────────────────────────────────────────────
  const pageCount = computed(() => pageList.value.length);

  // ─── Actions ─────────────────────────────────────────────────────────
  async function fetchPageList(projectPath: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/confluence/pages?project=${encodeURIComponent(projectPath)}`);
      if (res.ok) {
        const data = await res.json();
        pageList.value = data.pages || [];
      }
    } catch (err) {
      console.error('Failed to fetch confluence pages:', err);
    } finally {
      loading.value = false;
    }
  }

  async function loadPage(id: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/confluence/pages/${id}`);
      if (res.ok) {
        currentPage.value = await res.json();
      } else {
        toast.error('Failed to load confluence page');
      }
    } catch (err) {
      console.error('Failed to load confluence page:', err);
      toast.error('Failed to load confluence page');
    } finally {
      loading.value = false;
    }
  }

  async function createPage(projectPath: string, data: {
    title: string;
    inputText?: string;
    markdown?: string;
    confluenceOutput?: string;
  }): Promise<ConfluencePage | null> {
    try {
      const res = await apiFetch('/api/confluence/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectPath, ...data }),
      });
      if (res.ok) {
        const page = await res.json();
        currentPage.value = page;
        await fetchPageList(projectPath);
        return page;
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to create page');
        return null;
      }
    } catch (err) {
      console.error('Failed to create confluence page:', err);
      toast.error('Failed to create page');
      return null;
    }
  }

  async function updatePage(id: string, updates: Partial<ConfluencePage>) {
    try {
      const res = await apiFetch(`/api/confluence/pages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const page = await res.json();
        currentPage.value = page;
        const idx = pageList.value.findIndex(p => p.id === id);
        if (idx >= 0) {
          pageList.value[idx] = { id: page.id, title: page.title, updatedAt: page.updatedAt };
        }
        return page;
      }
    } catch (err) {
      console.error('Failed to update confluence page:', err);
      toast.error('Failed to update page');
    }
    return null;
  }

  async function deletePage(id: string, projectPath: string) {
    try {
      const res = await apiFetch(`/api/confluence/pages/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (currentPage.value?.id === id) {
          currentPage.value = null;
        }
        await fetchPageList(projectPath);
        toast.success('Page deleted');
      }
    } catch (err) {
      console.error('Failed to delete confluence page:', err);
      toast.error('Failed to delete page');
    }
  }

  function clearPage() {
    currentPage.value = null;
  }

  return {
    // State
    pageList,
    currentPage,
    loading,

    // Computed
    pageCount,

    // Actions
    fetchPageList,
    loadPage,
    createPage,
    updatePage,
    deletePage,
    clearPage,
  };
});
