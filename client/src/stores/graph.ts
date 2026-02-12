import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Node, Edge, Connection } from '@vue-flow/core';
import type {
  GraphConfig, GraphNodeType, NodeData, GraphEdgeData,
  EdgeType, SerializedNode, SerializedEdge,
} from '@/types/graph';
import { CONNECTION_RULES } from '@/types/graph';
import { useAuthStore } from './auth';

export const useGraphStore = defineStore('graph', () => {
  // ─── State ──────────────────────────────────────────────────────────
  const nodes = ref<Node[]>([]);
  const edges = ref<Edge[]>([]);
  const selectedNodeId = ref<string | null>(null);
  const currentGraphId = ref<string | null>(null);
  const currentGraphName = ref('Untitled Graph');
  const isDirty = ref(false);
  const loading = ref(false);
  const graphList = ref<{ id: string; name: string; description?: string; updatedAt: string }[]>([]);

  // ─── Computed ───────────────────────────────────────────────────────
  const selectedNode = computed(() =>
    nodes.value.find(n => n.id === selectedNodeId.value) || null,
  );

  const nodeCount = computed(() => nodes.value.length);
  const edgeCount = computed(() => edges.value.length);

  const nodesByType = computed(() => {
    const grouped: Record<GraphNodeType, Node[]> = {
      agent: [], subagent: [], expert: [], skill: [], mcp: [], rule: [],
    };
    for (const n of nodes.value) {
      const type = (n.data as NodeData).nodeType;
      if (grouped[type]) grouped[type].push(n);
    }
    return grouped;
  });

  // ─── Node CRUD ──────────────────────────────────────────────────────

  function addNode(type: GraphNodeType, position: { x: number; y: number }): string {
    const id = crypto.randomUUID();
    const data = createDefaultNodeData(type);
    nodes.value.push({
      id,
      type,
      position,
      data,
    });
    isDirty.value = true;
    selectedNodeId.value = id;
    return id;
  }

  function removeNode(id: string) {
    nodes.value = nodes.value.filter(n => n.id !== id);
    edges.value = edges.value.filter(e => e.source !== id && e.target !== id);
    if (selectedNodeId.value === id) selectedNodeId.value = null;
    isDirty.value = true;
  }

  function updateNodeData(id: string, updates: Partial<NodeData>) {
    const node = nodes.value.find(n => n.id === id);
    if (node) {
      node.data = { ...node.data, ...updates };
      isDirty.value = true;
    }
  }

  function updateNodePosition(id: string, position: { x: number; y: number }) {
    const node = nodes.value.find(n => n.id === id);
    if (node) {
      node.position = position;
      isDirty.value = true;
    }
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id;
  }

  // ─── Connection validation ─────────────────────────────────────────

  function canConnect(connection: Connection): boolean {
    const sourceNode = nodes.value.find(n => n.id === connection.source);
    const targetNode = nodes.value.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;
    if (connection.source === connection.target) return false;

    const sourceType = (sourceNode.data as NodeData).nodeType;
    const targetType = (targetNode.data as NodeData).nodeType;

    const rules = CONNECTION_RULES[sourceType];
    return rules.some(rule => rule.targets.includes(targetType));
  }

  function getEdgeType(sourceType: GraphNodeType, targetType: GraphNodeType): EdgeType | null {
    const rules = CONNECTION_RULES[sourceType];
    const rule = rules.find(r => r.targets.includes(targetType));
    return rule?.edgeType ?? null;
  }

  function addEdge(connection: Connection) {
    if (!canConnect(connection)) return;

    const sourceNode = nodes.value.find(n => n.id === connection.source);
    const targetNode = nodes.value.find(n => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const sourceType = (sourceNode.data as NodeData).nodeType;
    const targetType = (targetNode.data as NodeData).nodeType;

    const edgeType = getEdgeType(sourceType, targetType);
    if (!edgeType) return;

    // Prevent duplicate edges
    const exists = edges.value.some(
      e => e.source === connection.source && e.target === connection.target,
    );
    if (exists) return;

    const edgeData: GraphEdgeData = {
      edgeType,
      label: edgeType.replace(/-/g, ' '),
      animated: edgeType === 'delegation' || edgeType === 'data-flow',
    };

    edges.value.push({
      id: `e-${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'custom',
      data: edgeData,
    });
    isDirty.value = true;
  }

  function removeEdge(id: string) {
    edges.value = edges.value.filter(e => e.id !== id);
    isDirty.value = true;
  }

  // ─── Graph management ─────────────────────────────────────────────

  function newGraph() {
    nodes.value = [];
    edges.value = [];
    selectedNodeId.value = null;
    currentGraphId.value = null;
    currentGraphName.value = 'Untitled Graph';
    isDirty.value = false;
  }

  // ─── Auto-layout ──────────────────────────────────────────────────

  function autoLayout() {
    const layers: GraphNodeType[][] = [
      ['agent'],
      ['subagent'],
      ['expert'],
      ['skill', 'mcp', 'rule'],
    ];

    const HORIZONTAL_GAP = 280;
    const VERTICAL_GAP = 200;
    let y = 50;

    for (const layerTypes of layers) {
      const layerNodes = nodes.value.filter(n =>
        layerTypes.includes((n.data as NodeData).nodeType),
      );
      if (layerNodes.length === 0) continue;

      const totalWidth = layerNodes.length * HORIZONTAL_GAP;
      let x = -(totalWidth / 2) + HORIZONTAL_GAP / 2;

      for (const node of layerNodes) {
        node.position = { x, y };
        x += HORIZONTAL_GAP;
      }
      y += VERTICAL_GAP;
    }
    isDirty.value = true;
  }

  // ─── Serialization ────────────────────────────────────────────────

  function serialize(): { nodes: SerializedNode[]; edges: SerializedEdge[] } {
    return {
      nodes: nodes.value.map(n => ({
        id: n.id,
        type: (n.data as NodeData).nodeType,
        position: n.position,
        data: n.data as NodeData,
      })),
      edges: edges.value.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: e.data as GraphEdgeData,
      })),
    };
  }

  function deserialize(config: GraphConfig) {
    currentGraphId.value = config.id;
    currentGraphName.value = config.name;
    nodes.value = config.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    }));
    edges.value = config.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'custom',
      data: e.data,
    }));
    isDirty.value = false;
  }

  // ─── Persistence ──────────────────────────────────────────────────

  async function fetchGraphList(projectPath: string) {
    const auth = useAuthStore();
    loading.value = true;
    try {
      const res = await fetch(`/api/graphs?project=${encodeURIComponent(projectPath)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch graphs');
      const data = await res.json();
      graphList.value = data.graphs;
    } finally {
      loading.value = false;
    }
  }

  async function loadGraph(id: string) {
    const auth = useAuthStore();
    loading.value = true;
    try {
      const res = await fetch(`/api/graphs/${id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) throw new Error('Failed to load graph');
      const config: GraphConfig = await res.json();
      deserialize(config);
    } finally {
      loading.value = false;
    }
  }

  async function saveGraph(projectPath: string) {
    const auth = useAuthStore();
    const graphData = serialize();
    const method = currentGraphId.value ? 'PUT' : 'POST';
    const url = currentGraphId.value ? `/api/graphs/${currentGraphId.value}` : '/api/graphs';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({
        name: currentGraphName.value,
        project: projectPath,
        graphData,
      }),
    });

    if (!res.ok) throw new Error('Failed to save graph');
    const saved: GraphConfig = await res.json();
    currentGraphId.value = saved.id;
    isDirty.value = false;
    return saved;
  }

  async function deleteGraph(id: string) {
    const auth = useAuthStore();
    const res = await fetch(`/api/graphs/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) throw new Error('Failed to delete graph');
    graphList.value = graphList.value.filter(g => g.id !== id);
    if (currentGraphId.value === id) newGraph();
  }

  return {
    nodes, edges, selectedNodeId, currentGraphId, currentGraphName,
    isDirty, loading, graphList,
    selectedNode, nodeCount, edgeCount, nodesByType,
    addNode, removeNode, updateNodeData, updateNodePosition, selectNode,
    canConnect, getEdgeType, addEdge, removeEdge,
    fetchGraphList, loadGraph, saveGraph, deleteGraph,
    newGraph, autoLayout, serialize, deserialize,
  };
});

// ─── Default data factory ──────────────────────────────────────────────

function createDefaultNodeData(type: GraphNodeType): NodeData {
  switch (type) {
    case 'agent':
      return {
        nodeType: 'agent', label: 'Agent',
        model: 'claude-opus-4-6', systemPrompt: '',
        permissionMode: 'bypassPermissions', maxTokens: 200000,
        allowedTools: [], disallowedTools: [],
      };
    case 'subagent':
      return {
        nodeType: 'subagent', label: 'Subagent',
        model: 'claude-sonnet-4-5-20250929', systemPrompt: '',
        permissionMode: 'bypassPermissions', taskDescription: '',
      };
    case 'expert':
      return {
        nodeType: 'expert', label: 'Expert',
        model: 'claude-opus-4-6', systemPrompt: '',
        specialty: '',
      };
    case 'skill':
      return {
        nodeType: 'skill', label: 'Skill',
        command: '', promptTemplate: '', allowedTools: [],
      };
    case 'mcp':
      return {
        nodeType: 'mcp', label: 'MCP Server',
        serverType: 'stdio', command: '', args: [],
        tools: [],
      };
    case 'rule':
      return {
        nodeType: 'rule', label: 'Rule',
        ruleType: 'guideline', ruleText: '', scope: 'project',
      };
  }
}
