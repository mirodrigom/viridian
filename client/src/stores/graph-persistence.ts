/**
 * Graph persistence: serialization, deserialization, and CRUD operations against the API.
 */
import type { Node, Edge } from '@vue-flow/core';
import type { Ref } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import type {
  GraphConfig, NodeData, GraphEdgeData,
  SerializedNode, SerializedEdge,
} from '@/types/graph';

export interface GraphPersistenceDeps {
  nodes: Ref<Node[]>;
  edges: Ref<Edge[]>;
  selectedNodeId: Ref<string | null>;
  currentGraphId: Ref<string | null>;
  currentGraphName: Ref<string>;
  isDirty: Ref<boolean>;
  loading: Ref<boolean>;
  graphList: Ref<{ id: string; name: string; description?: string; updatedAt: string }[]>;
  graphVersion: Ref<number>;
  savedViewport: Ref<{ x: number; y: number; zoom: number } | null>;
  newGraph: () => void;
  summarizePrompt: (prompt: string) => string;
}

// ─── Serialization ─────────────────────────────────────────────────

export function serializeGraph(
  nodes: Node[],
  edges: Edge[],
  viewport?: { x: number; y: number; zoom: number },
): { nodes: SerializedNode[]; edges: SerializedEdge[]; viewport?: { x: number; y: number; zoom: number } } {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      type: (n.data as NodeData).nodeType,
      position: n.position,
      data: n.data as NodeData,
      ...(n.parentNode && { parentNode: n.parentNode }),
      ...(n.extent && { extent: n.extent as string }),
      ...(n.style && { style: n.style as Record<string, string> }),
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      data: e.data as GraphEdgeData,
    })),
    ...(viewport && { viewport }),
  };
}

export function deserializeGraph(config: GraphConfig, deps: GraphPersistenceDeps) {
  deps.currentGraphId.value = config.id;
  deps.currentGraphName.value = config.name;
  deps.savedViewport.value = config.viewport ?? null;

  deps.nodes.value = config.nodes.map(n => ({
    id: n.id,
    type: n.data.nodeType ?? n.type, // data.nodeType is the source of truth
    position: n.position,
    data: n.data,
    ...(n.parentNode && { parentNode: n.parentNode }),
    ...(n.extent && { extent: n.extent }),
    ...(n.style && { style: n.style }),
  }));

  deps.edges.value = config.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'custom',
    data: e.data,
  }));

  // Backfill description for nodes that have a systemPrompt but empty description (legacy data)
  for (const n of deps.nodes.value) {
    const d = n.data as NodeData;
    if (!d.description && 'systemPrompt' in d) {
      const prompt = (d as { systemPrompt: string }).systemPrompt;
      if (prompt?.trim()) {
        n.data = { ...d, description: deps.summarizePrompt(prompt.trim()) };
      }
    }
  }

  deps.isDirty.value = false;
  deps.graphVersion.value++;
}

// ─── CRUD operations ───────────────────────────────────────────────

export function createGraphPersistence(deps: GraphPersistenceDeps) {
  function serialize(viewport?: { x: number; y: number; zoom: number }) {
    return serializeGraph(deps.nodes.value, deps.edges.value, viewport);
  }

  function deserialize(config: GraphConfig) {
    return deserializeGraph(config, deps);
  }

  async function fetchGraphList(projectPath: string) {
    deps.loading.value = true;
    try {
      const res = await apiFetch(`/api/graphs?project=${encodeURIComponent(projectPath)}`);
      if (!res.ok) throw new Error('Failed to fetch graphs');
      const data = await res.json();
      deps.graphList.value = data.graphs;
    } finally {
      deps.loading.value = false;
    }
  }

  async function loadGraph(id: string) {
    deps.loading.value = true;
    try {
      const res = await apiFetch(`/api/graphs/${id}`);
      if (!res.ok) throw new Error('Failed to load graph');
      const config: GraphConfig = await res.json();
      deserialize(config);
    } finally {
      deps.loading.value = false;
    }
  }

  async function saveGraph(projectPath: string, viewport?: { x: number; y: number; zoom: number }) {
    const graphData = serialize(viewport);
    const method = deps.currentGraphId.value ? 'PUT' : 'POST';
    const url = deps.currentGraphId.value ? `/api/graphs/${deps.currentGraphId.value}` : '/api/graphs';

    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deps.currentGraphName.value,
        project: projectPath,
        graphData,
      }),
    });

    if (!res.ok) throw new Error('Failed to save graph');
    const saved: GraphConfig = await res.json();
    deps.currentGraphId.value = saved.id;
    deps.isDirty.value = false;
    return saved;
  }

  async function deleteGraph(id: string) {
    const res = await apiFetch(`/api/graphs/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete graph');
    deps.graphList.value = deps.graphList.value.filter(g => g.id !== id);
    if (deps.currentGraphId.value === id) deps.newGraph();
  }

  return {
    serialize,
    deserialize,
    fetchGraphList,
    loadGraph,
    saveGraph,
    deleteGraph,
  };
}
