import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Node, Edge, Connection } from '@vue-flow/core';
import { apiFetch } from '@/lib/apiFetch';
import { uuid } from '@/lib/utils';
import { getServiceById, type AWSService, type AWSGroupType, AWS_GROUP_TYPES } from '@/data/aws-services';

// ─── Types ────────────────────────────────────────────────────────────

export type DiagramNodeType = 'aws-service' | 'aws-group';

export interface AWSServiceNodeData {
  nodeType: 'aws-service';
  serviceId: string;
  label: string;
  customLabel: string;
  description: string;
  notes: string;
  service: AWSService;
}

export interface AWSGroupNodeData {
  nodeType: 'aws-group';
  groupTypeId: string;
  label: string;
  customLabel: string;
  description: string;
  notes: string;
  groupType: AWSGroupType;
  collapsed?: boolean;
  expandedHeight?: string;
  childPositions?: Record<string, { x: number; y: number }>;
}

export type DiagramNodeData = AWSServiceNodeData | AWSGroupNodeData;

export type EdgeLineType = 'default' | 'straight' | 'step' | 'smoothstep';
export type EdgeLineStyle = 'solid' | 'dashed' | 'dotted';
export type EdgeMarkerType = 'arrow' | 'arrowclosed' | 'none';

export interface DiagramEdgeData {
  label: string;
  style: EdgeLineStyle;
  animated: boolean;
  notes: string;
  edgeType: EdgeLineType;
  color: string;
  markerStart: EdgeMarkerType;
  markerEnd: EdgeMarkerType;
  dotAnimation?: boolean;
  dotCount?: number;
  dotSpeed?: 'slow' | 'medium' | 'fast';
  dotColor?: string;
}

export interface SerializedDiagramNode {
  id: string;
  type: DiagramNodeType;
  position: { x: number; y: number };
  data: DiagramNodeData;
  parentNode?: string;
  extent?: string;
  style?: Record<string, string>;
}

export interface SerializedDiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: DiagramEdgeData;
}

export interface DiagramConfig {
  id: string;
  name: string;
  description?: string;
  nodes: SerializedDiagramNode[];
  edges: SerializedDiagramEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

// ─── Store ────────────────────────────────────────────────────────────

export const useDiagramsStore = defineStore('diagrams', () => {
  // ─── State ──────────────────────────────────────────────────────
  const nodes = ref<Node[]>([]);
  const edges = ref<Edge[]>([]);
  const selectedNodeId = ref<string | null>(null);
  const selectedEdgeId = ref<string | null>(null);
  const currentDiagramId = ref<string | null>(null);
  const currentDiagramName = ref('Untitled Diagram');
  const isDirty = ref(false);
  const loading = ref(false);
  const diagramList = ref<{ id: string; name: string; description?: string; updatedAt: string }[]>([]);
  const diagramVersion = ref(0);
  const savedViewport = ref<{ x: number; y: number; zoom: number } | null>(null);

  // ─── Computed ───────────────────────────────────────────────────
  const selectedNode = computed(() =>
    nodes.value.find(n => n.id === selectedNodeId.value) || null,
  );

  const selectedEdge = computed(() =>
    edges.value.find(e => e.id === selectedEdgeId.value) || null,
  );

  const nodeCount = computed(() => nodes.value.length);
  const edgeCount = computed(() => edges.value.length);

  // ─── Node CRUD ─────────────────────────────────────────────────

  function addServiceNode(serviceId: string, position: { x: number; y: number }): string {
    const service = getServiceById(serviceId);
    if (!service) return '';

    const id = uuid();
    const data: AWSServiceNodeData = {
      nodeType: 'aws-service',
      serviceId,
      label: service.shortName,
      customLabel: '',
      description: service.description,
      notes: '',
      service,
    };

    nodes.value.push({
      id,
      type: 'aws-service',
      position,
      data,
    });

    isDirty.value = true;
    selectedNodeId.value = id;
    return id;
  }

  function addGroupNode(groupTypeId: string, position: { x: number; y: number }): string {
    const groupType = AWS_GROUP_TYPES.find(g => g.id === groupTypeId);
    if (!groupType) return '';

    const id = uuid();
    const data: AWSGroupNodeData = {
      nodeType: 'aws-group',
      groupTypeId,
      label: groupType.name,
      customLabel: '',
      description: groupType.description,
      notes: '',
      groupType,
    };

    nodes.value.push({
      id,
      type: 'aws-group',
      position,
      data,
      style: { width: '400px', height: '300px' },
    });

    isDirty.value = true;
    selectedNodeId.value = id;
    return id;
  }

  function removeNode(id: string) {
    // Unparent children first
    for (const child of nodes.value) {
      if (child.parentNode === id) {
        const parent = nodes.value.find(n => n.id === id);
        if (parent) {
          child.position = {
            x: child.position.x + parent.position.x,
            y: child.position.y + parent.position.y,
          };
        }
        delete child.parentNode;
        delete child.extent;
      }
    }

    // Remove connected edges
    edges.value = edges.value.filter(e => e.source !== id && e.target !== id);
    // Remove node
    nodes.value = nodes.value.filter(n => n.id !== id);

    if (selectedNodeId.value === id) selectedNodeId.value = null;
    isDirty.value = true;
  }

  function updateNodeData(id: string, updates: Partial<DiagramNodeData>) {
    const node = nodes.value.find(n => n.id === id);
    if (!node) return;
    node.data = { ...node.data, ...updates } as DiagramNodeData;
    isDirty.value = true;
  }

  function updateNodePosition(id: string, position: { x: number; y: number }) {
    const node = nodes.value.find(n => n.id === id);
    if (!node) return;
    node.position = position;
    isDirty.value = true;
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id;
    if (id) selectedEdgeId.value = null;
  }

  function selectEdge(id: string | null) {
    selectedEdgeId.value = id;
    if (id) selectedNodeId.value = null;
  }

  // ─── Parent-child nesting ───────────────────────────────────────

  function setNodeParent(childId: string, parentId: string | null) {
    const child = nodes.value.find(n => n.id === childId);
    if (!child) return;

    if (parentId === null) {
      // Unparent: convert relative position to absolute
      const oldParent = nodes.value.find(n => n.id === child.parentNode);
      if (oldParent) {
        child.position = {
          x: child.position.x + oldParent.position.x,
          y: child.position.y + oldParent.position.y,
        };
      }
      delete child.parentNode;
      delete child.extent;
    } else {
      const parent = nodes.value.find(n => n.id === parentId);
      if (!parent) return;
      // Don't nest groups in service nodes
      if (parent.type !== 'aws-group') return;
      // Prevent self-parenting or circular
      if (childId === parentId) return;
      if (child.parentNode === parentId) return;

      // Convert absolute position to relative
      const oldParent = nodes.value.find(n => n.id === child.parentNode);
      const absX = oldParent ? child.position.x + oldParent.position.x : child.position.x;
      const absY = oldParent ? child.position.y + oldParent.position.y : child.position.y;

      child.position = {
        x: absX - parent.position.x,
        y: absY - parent.position.y,
      };
      child.parentNode = parentId;
      child.extent = 'parent';
    }
    isDirty.value = true;
  }

  function ungroupChildren(groupId: string) {
    const children = nodes.value.filter(n => n.parentNode === groupId);
    for (const child of children) {
      setNodeParent(child.id, null);
    }
  }

  function getGroupChildren(groupId: string) {
    return nodes.value.filter(n => n.parentNode === groupId);
  }

  // ─── Collapse / Expand ─────────────────────────────────────────

  function toggleGroupCollapse(groupId: string) {
    const group = nodes.value.find(n => n.id === groupId);
    if (!group || group.type !== 'aws-group') return;
    const data = group.data as AWSGroupNodeData;
    const children = getGroupChildren(groupId);

    if (!data.collapsed) {
      // Collapse: save current height and child positions, then hide children
      const style = group.style as Record<string, string> | undefined;
      data.expandedHeight = style?.height || '300px';
      data.childPositions = {};
      for (const child of children) {
        data.childPositions[child.id] = { ...child.position };
        child.hidden = true;
      }
      data.collapsed = true;
      if (!group.style) group.style = {};
      (group.style as Record<string, string>).height = '48px';
    } else {
      // Expand: restore children visibility and height
      for (const child of children) {
        child.hidden = false;
      }
      data.collapsed = false;
      if (group.style) {
        (group.style as Record<string, string>).height = data.expandedHeight || '300px';
      }
    }
    isDirty.value = true;
  }

  function collapseAllGroups() {
    for (const node of nodes.value) {
      if (node.type === 'aws-group') {
        const data = node.data as AWSGroupNodeData;
        if (!data.collapsed) {
          toggleGroupCollapse(node.id);
        }
      }
    }
  }

  function expandAllGroups() {
    for (const node of nodes.value) {
      if (node.type === 'aws-group') {
        const data = node.data as AWSGroupNodeData;
        if (data.collapsed) {
          toggleGroupCollapse(node.id);
        }
      }
    }
  }

  // ─── Z-Index layers ────────────────────────────────────────────

  function getMaxZIndex(): number {
    let max = 0;
    for (const node of nodes.value) {
      const z = (node as any).zIndex ?? 0;
      if (z > max) max = z;
    }
    return max;
  }

  function getMinZIndex(): number {
    let min = 0;
    for (const node of nodes.value) {
      const z = (node as any).zIndex ?? 0;
      if (z < min) min = z;
    }
    return min;
  }

  function bringToFront(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (!node) return;
    (node as any).zIndex = getMaxZIndex() + 1;
    isDirty.value = true;
  }

  function sendToBack(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (!node) return;
    (node as any).zIndex = getMinZIndex() - 1;
    isDirty.value = true;
  }

  function bringForward(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (!node) return;
    (node as any).zIndex = ((node as any).zIndex ?? 0) + 1;
    isDirty.value = true;
  }

  function sendBackward(nodeId: string) {
    const node = nodes.value.find(n => n.id === nodeId);
    if (!node) return;
    (node as any).zIndex = ((node as any).zIndex ?? 0) - 1;
    isDirty.value = true;
  }

  function getNodeZIndex(nodeId: string): number {
    const node = nodes.value.find(n => n.id === nodeId);
    if (!node) return 0;
    return (node as any).zIndex ?? 0;
  }

  function findGroupAtPosition(position: { x: number; y: number }, excludeId?: string): string | null {
    // Find the topmost group node at the given absolute position
    for (const node of nodes.value) {
      if (node.type !== 'aws-group') continue;
      if (node.id === excludeId) continue;
      const style = node.style as Record<string, string> | undefined;
      const w = parseFloat(style?.width || '400');
      const h = parseFloat(style?.height || '300');
      if (
        position.x >= node.position.x &&
        position.x <= node.position.x + w &&
        position.y >= node.position.y &&
        position.y <= node.position.y + h
      ) {
        return node.id;
      }
    }
    return null;
  }

  // ─── Multi-select helpers ─────────────────────────────────────

  function removeSelectedNodes(selectedIds: string[]) {
    for (const id of selectedIds) {
      removeNode(id);
    }
  }

  // ─── Edge CRUD ─────────────────────────────────────────────────

  function addEdge(connection: Connection) {
    // Prevent duplicates
    const exists = edges.value.some(
      e => e.source === connection.source && e.target === connection.target,
    );
    if (exists) return;

    const edgeData: DiagramEdgeData = {
      label: '',
      style: 'solid',
      animated: false,
      notes: '',
      edgeType: 'default',
      color: '',
      markerStart: 'none',
      markerEnd: 'arrowclosed',
      dotAnimation: false,
      dotCount: 1,
      dotSpeed: 'medium',
      dotColor: '',
    };

    edges.value.push({
      id: `e-${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'default',
      data: edgeData,
      label: '',
    });
    isDirty.value = true;
  }

  function removeEdge(id: string) {
    edges.value = edges.value.filter(e => e.id !== id);
    if (selectedEdgeId.value === id) selectedEdgeId.value = null;
    isDirty.value = true;
  }

  function updateEdgeData(id: string, updates: Partial<DiagramEdgeData>) {
    const edge = edges.value.find(e => e.id === id);
    if (!edge) return;
    edge.data = { ...edge.data, ...updates } as DiagramEdgeData;
    if (updates.label !== undefined) edge.label = updates.label;

    // Sync edge type to VueFlow
    const d = edge.data as DiagramEdgeData;
    if (updates.edgeType !== undefined || updates.dotAnimation !== undefined) {
      if (d.dotAnimation && d.animated) {
        edge.type = 'animated-flow';
      } else {
        edge.type = d.edgeType || 'default';
      }
    }

    // Sync animated flag
    if (updates.animated !== undefined) {
      edge.animated = d.animated;
    }

    // Sync markers
    if (updates.markerEnd !== undefined) {
      if (d.markerEnd === 'none') {
        edge.markerEnd = undefined;
      } else {
        edge.markerEnd = { type: d.markerEnd === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined };
      }
    }
    if (updates.markerStart !== undefined) {
      if (d.markerStart === 'none') {
        edge.markerStart = undefined;
      } else {
        edge.markerStart = { type: d.markerStart === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined };
      }
    }

    // Sync color as inline style
    if (updates.color !== undefined) {
      edge.style = d.color ? { stroke: d.color } : undefined;
      // Also update marker colors
      if (edge.markerEnd && typeof edge.markerEnd === 'object') {
        (edge.markerEnd as any).color = d.color || undefined;
      }
      if (edge.markerStart && typeof edge.markerStart === 'object') {
        (edge.markerStart as any).color = d.color || undefined;
      }
    }

    // Sync line style via class
    if (updates.style !== undefined) {
      const strokeDasharray = d.style === 'dashed' ? '8 4' : d.style === 'dotted' ? '2 4' : undefined;
      edge.style = { ...(edge.style as Record<string, string> || {}), ...(strokeDasharray ? { strokeDasharray } : { strokeDasharray: 'none' }) };
      if (d.color) (edge.style as any).stroke = d.color;
    }

    isDirty.value = true;
  }

  // ─── Diagram management ────────────────────────────────────────

  function newDiagram() {
    nodes.value = [];
    edges.value = [];
    selectedNodeId.value = null;
    selectedEdgeId.value = null;
    currentDiagramId.value = null;
    currentDiagramName.value = 'Untitled Diagram';
    savedViewport.value = null;
    isDirty.value = false;
    diagramVersion.value++;
  }

  // ─── Serialization ─────────────────────────────────────────────

  function serialize(viewport?: { x: number; y: number; zoom: number }) {
    return {
      nodes: nodes.value.map(n => {
        // Capture resize dimensions from VueFlow's internal state
        const style = { ...(n.style as Record<string, string> || {}) };
        const dims = (n as any).dimensions;
        if (dims?.width && !style.width) style.width = `${dims.width}px`;
        if (dims?.height && !style.height) style.height = `${dims.height}px`;
        // Also check direct width/height properties set by NodeResizer
        if ((n as any).width && !style.width) style.width = `${(n as any).width}px`;
        if ((n as any).height && !style.height) style.height = `${(n as any).height}px`;

        return {
          id: n.id,
          type: (n.data as DiagramNodeData).nodeType,
          position: n.position,
          data: n.data as DiagramNodeData,
          ...(n.parentNode && { parentNode: n.parentNode }),
          ...(n.extent && { extent: n.extent as string }),
          ...(Object.keys(style).length > 0 && { style }),
        };
      }),
      edges: edges.value.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: (e.data || { label: '', style: 'solid', animated: false, notes: '' }) as DiagramEdgeData,
      })),
      ...(viewport && { viewport }),
    };
  }

  function deserialize(config: DiagramConfig) {
    currentDiagramId.value = config.id;
    currentDiagramName.value = config.name;
    savedViewport.value = config.viewport ?? null;

    nodes.value = config.nodes.map(n => {
      // Rehydrate service/group references
      const data = { ...n.data };
      if (data.nodeType === 'aws-service') {
        const svc = getServiceById((data as AWSServiceNodeData).serviceId);
        if (svc) (data as AWSServiceNodeData).service = svc;
      } else if (data.nodeType === 'aws-group') {
        const gt = AWS_GROUP_TYPES.find(g => g.id === (data as AWSGroupNodeData).groupTypeId);
        if (gt) (data as AWSGroupNodeData).groupType = gt;
      }

      return {
        id: n.id,
        type: n.data.nodeType,
        position: n.position,
        data,
        ...(n.parentNode && { parentNode: n.parentNode }),
        ...(n.extent && { extent: n.extent }),
        ...(n.style && { style: n.style }),
      };
    });

    edges.value = config.edges.map(e => {
      const d: DiagramEdgeData = {
        label: '',
        style: 'solid',
        animated: false,
        notes: '',
        edgeType: 'default',
        color: '',
        markerStart: 'none',
        markerEnd: 'arrowclosed',
        dotAnimation: false,
        dotCount: 1,
        dotSpeed: 'medium',
        dotColor: '',
        ...e.data,
      };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: (d.dotAnimation && d.animated) ? 'animated-flow' : (d.edgeType || 'default'),
        data: d,
        label: d.label || '',
        animated: d.animated,
        ...(d.color ? { style: { stroke: d.color } } : {}),
        ...(d.markerEnd !== 'none' ? { markerEnd: { type: d.markerEnd === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined } } : {}),
        ...(d.markerStart !== 'none' ? { markerStart: { type: d.markerStart === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined } } : {}),
      };
    });

    isDirty.value = false;
    diagramVersion.value++;
  }

  // ─── Persistence ───────────────────────────────────────────────

  async function fetchDiagramList(projectPath: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/diagrams?project=${encodeURIComponent(projectPath)}`);
      if (!res.ok) throw new Error('Failed to fetch diagrams');
      const data = await res.json();
      diagramList.value = data.diagrams;
    } finally {
      loading.value = false;
    }
  }

  async function loadDiagram(id: string) {
    loading.value = true;
    try {
      const res = await apiFetch(`/api/diagrams/${id}`);
      if (!res.ok) throw new Error('Failed to load diagram');
      const config: DiagramConfig = await res.json();
      deserialize(config);
    } finally {
      loading.value = false;
    }
  }

  async function saveDiagram(projectPath: string, viewport?: { x: number; y: number; zoom: number }) {
    const diagramData = serialize(viewport);
    const method = currentDiagramId.value ? 'PUT' : 'POST';
    const url = currentDiagramId.value ? `/api/diagrams/${currentDiagramId.value}` : '/api/diagrams';

    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: currentDiagramName.value,
        project: projectPath,
        diagramData,
      }),
    });

    if (!res.ok) throw new Error('Failed to save diagram');
    const saved: DiagramConfig = await res.json();
    currentDiagramId.value = saved.id;
    isDirty.value = false;
    return saved;
  }

  async function deleteDiagram(id: string) {
    const res = await apiFetch(`/api/diagrams/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete diagram');
    diagramList.value = diagramList.value.filter(d => d.id !== id);
    if (currentDiagramId.value === id) newDiagram();
  }

  return {
    // State
    nodes, edges, selectedNodeId, selectedEdgeId,
    currentDiagramId, currentDiagramName,
    isDirty, loading, diagramList, diagramVersion, savedViewport,
    // Computed
    selectedNode, selectedEdge, nodeCount, edgeCount,
    // Node CRUD
    addServiceNode, addGroupNode, removeNode,
    updateNodeData, updateNodePosition, selectNode, selectEdge,
    // Parent-child nesting
    setNodeParent, ungroupChildren, getGroupChildren, findGroupAtPosition,
    // Collapse / Expand
    toggleGroupCollapse, collapseAllGroups, expandAllGroups,
    // Z-Index layers
    bringToFront, sendToBack, bringForward, sendBackward, getNodeZIndex,
    // Multi-select
    removeSelectedNodes,
    // Edge CRUD
    addEdge, removeEdge, updateEdgeData,
    // Diagram management
    newDiagram, serialize, deserialize,
    // Persistence
    fetchDiagramList, loadDiagram, saveDiagram, deleteDiagram,
  };
});
