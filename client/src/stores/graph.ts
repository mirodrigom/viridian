import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Node, Edge, Connection } from '@vue-flow/core';
import type {
  GraphConfig, GraphNodeType, NodeData, GraphEdgeData,
  EdgeType, SubagentNodeData, ExpertNodeData, SkillNodeData, RuleNodeData,
} from '@/types/graph';
import { CONNECTION_RULES } from '@/types/graph';
import { DEFAULT_AGENT_METADATA, validateDelegationRouting } from '@/types/agent-metadata';
import type { AgentMetadata } from '@/types/agent-metadata';
import type { GraphTemplate } from '@/data/graphTemplates';
import { apiFetch } from '@/lib/apiFetch';
import { uuid } from '@/lib/utils';
import { getRuleChildrenMap, applyRuleContainers } from './graph-rules';
import { autoLayout as runAutoLayout } from './graph-layout';
import { createGraphPersistence } from './graph-persistence';

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
  const generatingPrompt = ref(false);
  const graphVersion = ref(0);
  const savedViewport = ref<{ x: number; y: number; zoom: number } | null>(null);

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
    const id = uuid();
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
    const removedNode = nodes.value.find(n => n.id === id);
    if (removedNode) {
      const d = removedNode.data as NodeData;
      if (d.nodeType === 'rule' && (d as RuleNodeData).isContainer) {
        for (const child of nodes.value) {
          if (child.parentNode === id) {
            child.position = {
              x: child.position.x + removedNode.position.x,
              y: child.position.y + removedNode.position.y,
            };
            delete child.parentNode;
            delete child.extent;
          }
        }
      }
    }
    nodes.value = nodes.value.filter(n => n.id !== id);
    edges.value = edges.value.filter(e => e.source !== id && e.target !== id);
    if (selectedNodeId.value === id) selectedNodeId.value = null;
    isDirty.value = true;
  }

  function updateNodeData(id: string, updates: Partial<NodeData>) {
    const node = nodes.value.find(n => n.id === id);
    if (node) {
      const { nodeType: _, ...safeUpdates } = updates as Record<string, unknown>;
      node.data = { ...node.data, ...safeUpdates };

      if ('systemPrompt' in safeUpdates && !generatingPrompt.value) {
        const prompt = safeUpdates.systemPrompt as string;
        node.data = {
          ...node.data,
          description: prompt?.trim() ? summarizePrompt(prompt.trim()) : '',
        };
      }

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
    const matchingRule = rules.find(rule => rule.targets.includes(targetType));
    if (!matchingRule) return false;

    if (wouldCreateCycle(connection.source, connection.target)) return false;

    if (matchingRule.edgeType === 'delegation') {
      const sourceData = sourceNode.data as NodeData;
      const targetData = targetNode.data as NodeData;
      const result = validateDelegationRouting(
        sourceData.metadata as AgentMetadata | undefined,
        sourceData.label,
        targetData.metadata as AgentMetadata | undefined,
        targetData.label,
      );
      if (!result.valid) return false;
    }

    return true;
  }

  function wouldCreateCycle(source: string, target: string): boolean {
    const visited = new Set<string>();
    const queue = [target];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === source) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const edge of edges.value) {
        if (edge.source === current) {
          queue.push(edge.target);
        }
      }
    }
    return false;
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
    savedViewport.value = null;
    isDirty.value = false;
    graphVersion.value++;
  }

  // ─── Load template ────────────────────────────────────────────────

  function loadTemplate(template: GraphTemplate) {
    const idMap = new Map<string, string>();
    for (const n of template.nodes) {
      idMap.set(n.id, uuid());
    }

    nodes.value = template.nodes.map(n => ({
      id: idMap.get(n.id)!,
      type: n.type,
      position: { ...n.position },
      data: { ...n.data },
    }));

    edges.value = template.edges.map(e => ({
      id: `e-${idMap.get(e.source)!}-${idMap.get(e.target)!}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'custom' as const,
      data: { ...e.data },
    }));

    selectedNodeId.value = null;
    currentGraphId.value = null;
    currentGraphName.value = template.name;
    savedViewport.value = null;
    isDirty.value = true;
    graphVersion.value++;
  }

  // ─── Import project assets ─────────────────────────────────────────

  function importNodes(
    items: Array<{ type: GraphNodeType; position: { x: number; y: number }; data: Record<string, unknown> }>,
  ) {
    for (const item of items) {
      const id = uuid();
      const defaults = createDefaultNodeData(item.type);
      nodes.value.push({
        id,
        type: item.type,
        position: item.position,
        data: { ...defaults, ...item.data },
      });
    }
    isDirty.value = true;
    selectedNodeId.value = null;
    graphVersion.value++;
  }

  // ─── Rules (delegated) ────────────────────────────────────────────

  function _getRuleChildrenMap() {
    return getRuleChildrenMap(edges.value);
  }

  function _applyRuleContainers() {
    applyRuleContainers({ nodes, edges, isDirty });
  }

  // ─── Auto-layout (delegated) ──────────────────────────────────────

  function autoLayout() {
    runAutoLayout({
      nodes, edges, isDirty, graphVersion,
      applyRuleContainers: _applyRuleContainers,
      getRuleChildrenMap: _getRuleChildrenMap,
    });
  }

  // ─── Persistence (delegated) ──────────────────────────────────────

  const persistence = createGraphPersistence({
    nodes, edges, selectedNodeId,
    currentGraphId, currentGraphName,
    isDirty, loading, graphList, graphVersion, savedViewport,
    newGraph, summarizePrompt,
  });

  // ─── AI prompt generation ──────────────────────────────────────────

  function getNodeConnections(nodeId: string) {
    const parents = edges.value
      .filter(e => e.target === nodeId)
      .map(e => {
        const n = nodes.value.find(n => n.id === e.source);
        if (!n) return null;
        const d = n.data as NodeData;
        return { label: d.label, nodeType: d.nodeType, description: d.description };
      })
      .filter(Boolean);

    const children = edges.value
      .filter(e => e.source === nodeId)
      .map(e => {
        const n = nodes.value.find(n => n.id === e.target);
        if (!n) return null;
        const d = n.data as NodeData;
        const ed = e.data as GraphEdgeData;
        return { label: d.label, nodeType: d.nodeType, description: d.description, edgeType: ed?.edgeType || 'unknown' };
      })
      .filter(Boolean);

    return { parents, children };
  }

  function summarizePrompt(prompt: string): string {
    const firstSentence = prompt.match(/^[^.!?\n]+[.!?]/)?.[0] || '';
    if (firstSentence && firstSentence.length <= 200) return firstSentence.trim();
    return prompt.slice(0, 200).trim() + '...';
  }

  async function generatePrompt(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (!node) return;
    const data = node.data as NodeData;

    const promptField =
      data.nodeType === 'skill' ? 'promptTemplate' :
      data.nodeType === 'rule' ? 'ruleText' :
      'systemPrompt';

    const existingPrompt = (data as unknown as Record<string, unknown>)[promptField] as string || '';

    generatingPrompt.value = true;
    updateNodeData(nodeId, { [promptField]: '' } as Partial<NodeData>);

    try {
      const connections = getNodeConnections(nodeId);
      const payload: Record<string, unknown> = {
        nodeType: data.nodeType,
        label: data.label,
        description: data.description,
        connections,
        existingPrompt: existingPrompt || undefined,
      };

      if (data.nodeType === 'agent' || data.nodeType === 'subagent' || data.nodeType === 'expert') {
        payload.model = (data as { model: string }).model;
      }
      if (data.nodeType === 'agent' || data.nodeType === 'subagent') {
        payload.permissionMode = (data as { permissionMode: string }).permissionMode;
      }
      if (data.nodeType === 'subagent') {
        payload.taskDescription = (data as SubagentNodeData).taskDescription;
      }
      if (data.nodeType === 'expert') {
        payload.specialty = (data as ExpertNodeData).specialty;
      }
      if (data.nodeType === 'skill') {
        payload.command = (data as SkillNodeData).command;
      }
      if (data.nodeType === 'rule') {
        payload.ruleType = (data as RuleNodeData).ruleType;
        payload.scope = (data as RuleNodeData).scope;
      }

      const res = await apiFetch('/api/graphs/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Prompt generation failed:', err.error);
        updateNodeData(nodeId, { [promptField]: existingPrompt } as Partial<NodeData>);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        updateNodeData(nodeId, { [promptField]: existingPrompt } as Partial<NodeData>);
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

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
              const d = JSON.parse(line.slice(6));
              if (eventType === 'delta' && d.text) {
                accumulated += d.text;
                updateNodeData(nodeId, { [promptField]: accumulated } as Partial<NodeData>);
              } else if (eventType === 'error') {
                console.error('Prompt generation error:', d.error);
                updateNodeData(nodeId, { [promptField]: existingPrompt } as Partial<NodeData>);
                return;
              }
            } catch { /* skip non-JSON */ }
            eventType = '';
          }
        }
      }

      if (!accumulated.trim()) {
        updateNodeData(nodeId, { [promptField]: existingPrompt } as Partial<NodeData>);
      } else {
        updateNodeData(nodeId, { [promptField]: accumulated.trim() } as Partial<NodeData>);
        if (promptField === 'systemPrompt') {
          updateNodeData(nodeId, { description: summarizePrompt(accumulated.trim()) } as Partial<NodeData>);
        }
      }
    } catch (err) {
      console.error('Prompt generation failed:', err);
      updateNodeData(nodeId, { [promptField]: existingPrompt } as Partial<NodeData>);
    } finally {
      generatingPrompt.value = false;
    }
  }

  return {
    nodes, edges, selectedNodeId, currentGraphId, currentGraphName,
    isDirty, loading, graphList, generatingPrompt, graphVersion, savedViewport,
    selectedNode, nodeCount, edgeCount, nodesByType,
    addNode, removeNode, updateNodeData, updateNodePosition, selectNode,
    canConnect, getEdgeType, addEdge, removeEdge,
    fetchGraphList: persistence.fetchGraphList,
    loadGraph: persistence.loadGraph,
    saveGraph: persistence.saveGraph,
    deleteGraph: persistence.deleteGraph,
    newGraph, loadTemplate, importNodes, autoLayout,
    applyRuleContainers: _applyRuleContainers,
    serialize: persistence.serialize,
    deserialize: persistence.deserialize,
    generatePrompt,
  };
});

// ─── Default data factory ──────────────────────────────────────────────

function createDefaultNodeData(type: GraphNodeType): NodeData {
  switch (type) {
    case 'agent':
      return {
        nodeType: 'agent', label: 'Agent', description: '',
        model: 'claude-opus-4-6', systemPrompt: '',
        permissionMode: 'bypassPermissions', maxTokens: 200000,
        allowedTools: [], disallowedTools: [],
        metadata: { ...DEFAULT_AGENT_METADATA },
      };
    case 'subagent':
      return {
        nodeType: 'subagent', label: 'Subagent', description: '',
        model: 'claude-sonnet-4-6', systemPrompt: '',
        permissionMode: 'bypassPermissions', taskDescription: '',
        metadata: { ...DEFAULT_AGENT_METADATA },
      };
    case 'expert':
      return {
        nodeType: 'expert', label: 'Expert', description: '',
        model: 'claude-opus-4-6', systemPrompt: '',
        specialty: '',
        metadata: { ...DEFAULT_AGENT_METADATA },
      };
    case 'skill':
      return {
        nodeType: 'skill', label: 'Skill', description: '',
        command: '', promptTemplate: '', allowedTools: [],
      };
    case 'mcp':
      return {
        nodeType: 'mcp', label: 'MCP Server', description: '',
        serverType: 'stdio', command: '', args: [],
        tools: [],
      };
    case 'rule':
      return {
        nodeType: 'rule', label: 'Rule', description: '',
        ruleType: 'guideline', ruleText: '', scope: 'project',
      };
  }
}
