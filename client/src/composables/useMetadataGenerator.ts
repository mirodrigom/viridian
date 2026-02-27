/**
 * Composable for auto-generating agent metadata via LLM.
 * Used during graph import when nodes lack metadata.
 */

import { ref } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import type { AgentMetadata } from '@/types/agent-metadata';

export interface GeneratedMetadata {
  nodeId: string;
  metadata: AgentMetadata;
}

export function useMetadataGenerator() {
  const generating = ref(false);
  const error = ref<string | null>(null);

  async function generateForGraph(
    graphData: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
    projectPath?: string,
  ): Promise<GeneratedMetadata[]> {
    generating.value = true;
    error.value = null;

    try {
      const res = await apiFetch('/api/graphs/generate-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphData, projectPath }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, string>).error || `HTTP ${res.status}`);
      }

      const data = await res.json() as { results: GeneratedMetadata[] };
      return data.results;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error';
      return [];
    } finally {
      generating.value = false;
    }
  }

  return { generating, error, generateForGraph };
}
