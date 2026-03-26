<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import DiagramViewer from '@/components/diagram/DiagramViewer.vue';
import { resolveApiUrl } from '@/lib/serverUrl';
import type { SerializedDiagramNode, SerializedDiagramEdge } from '@/stores/diagrams';

const route = useRoute();

const loading = ref(true);
const error = ref<string | null>(null);
const diagramName = ref('');
const diagramDescription = ref('');
const nodes = ref<SerializedDiagramNode[]>([]);
const edges = ref<SerializedDiagramEdge[]>([]);
const viewport = ref<{ x: number; y: number; zoom: number } | null>(null);

onMounted(async () => {
  const shareToken = route.params.shareToken as string;
  if (!shareToken) {
    error.value = 'Invalid share link';
    loading.value = false;
    return;
  }

  try {
    const res = await fetch(resolveApiUrl(`/api/shared/diagrams/${shareToken}`));
    if (!res.ok) {
      if (res.status === 404) {
        error.value = 'Diagram not found or link expired';
      } else {
        error.value = 'Failed to load shared diagram';
      }
      loading.value = false;
      return;
    }

    const data = await res.json();
    diagramName.value = data.name || 'Untitled Diagram';
    diagramDescription.value = data.description || '';
    nodes.value = data.nodes || [];
    edges.value = data.edges || [];
    viewport.value = data.viewport || null;
  } catch {
    error.value = 'Failed to load shared diagram';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="flex h-screen flex-col bg-background text-foreground">
    <!-- Header -->
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <svg class="h-5 w-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <span class="text-sm font-medium text-foreground">{{ diagramName || 'Shared Diagram' }}</span>
      <span v-if="diagramDescription" class="text-xs text-muted-foreground">{{ diagramDescription }}</span>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span class="text-sm text-muted-foreground">Loading diagram...</span>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-center">
        <svg class="h-12 w-12 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4m0 4h.01" />
        </svg>
        <p class="text-sm text-muted-foreground">{{ error }}</p>
      </div>
    </div>

    <!-- Diagram Viewer -->
    <div v-else class="flex-1">
      <DiagramViewer
        :nodes="nodes"
        :edges="edges"
        :viewport="viewport"
      />
    </div>
  </div>
</template>
