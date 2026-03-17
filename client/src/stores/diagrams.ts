import { defineStore, acceptHMRUpdate } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { Node, Edge, Connection } from '@vue-flow/core';
import { useDebounceFn } from '@vueuse/core';
import { uuid } from '@/lib/utils';
import { getServiceById, type AWSService, type AWSGroupType, AWS_GROUP_TYPES } from '@/data/aws-services';
import { useUndoRedo } from '@/composables/useUndoRedo';
import { createDiagramGrouping, getAbsolutePosition, getNodeDepth } from './diagram-grouping';
import { createDiagramPersistence } from './diagram-persistence';

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

export type EdgeLabelSize = 'small' | 'medium' | 'large';
export type DotDirection = 'forward' | 'reverse' | 'none';

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
  labelSize?: EdgeLabelSize;
  dotDirection?: DotDirection;
  flowOrder?: number;
  flowOrderPosition?: 'source' | 'target';
}

export interface SerializedDiagramNode {
  id: string;
  type: DiagramNodeType;
  position: { x: number; y: number };
  data: DiagramNodeData;
  parentNode?: string;
  extent?: string;
  style?: Record<string, string>;
  zIndex?: number;
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
  /** null = live SVG animation, 0-1 = GIF export frame progress */
  const gifExportProgress = ref<number | null>(null);

  // ─── Version counters (for targeted reactivity) ───────────────
  /** Increments on every structural change (add/remove node/edge) */
  const mutationVersion = ref(0);
  /** Increments on data updates (node data, edge data, position) */
  const dataVersion = ref(0);
  /** Increments only when topology changes (nodes/edges added or removed) — used to cache BFS */
  const topologyVersion = ref(0);

  // ─── Map indexes (O(1) lookup by id) ──────────────────────────
  const nodeById = computed(() => new Map(nodes.value.map(n => [n.id, n])));
  const edgeById = computed(() => new Map(edges.value.map(e => [e.id, e])));

  // ─── Undo / Redo ──────────────────────────────────────────────
  const undoRedo = useUndoRedo({
    getSnapshot: () => JSON.stringify({
      nodes: nodes.value.map(n => ({
        id: n.id,
        type: (n.data as DiagramNodeData).nodeType,
        position: n.position,
        data: n.data,
        ...(n.parentNode && { parentNode: n.parentNode }),
        ...(n.extent && { extent: n.extent }),
        ...(n.style && { style: n.style }),
        ...((n as any).zIndex != null && { zIndex: (n as any).zIndex }),
        ...(n.hidden != null && { hidden: n.hidden }),
      })),
      edges: edges.value.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
        data: e.data,
        label: e.label,
        animated: e.animated,
        style: e.style,
        markerEnd: e.markerEnd,
        markerStart: e.markerStart,
      })),
    }),
    restoreSnapshot: (snapJson: string) => {
      const snap = JSON.parse(snapJson);

      // Rehydrate nodes
      nodes.value = snap.nodes.map((n: any) => {
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
          type: n.type === 'aws-service' ? 'aws-service' : 'aws-group',
          position: n.position,
          data,
          ...(n.parentNode && { parentNode: n.parentNode }),
          ...(n.extent && { extent: n.extent }),
          ...(n.style && { style: n.style }),
          ...(n.zIndex != null && { zIndex: n.zIndex }),
          ...(n.hidden != null && { hidden: n.hidden }),
        };
      });

      // Restore edges with full VueFlow properties
      edges.value = snap.edges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
        data: e.data,
        label: e.label,
        animated: e.animated,
        style: e.style,
        markerEnd: e.markerEnd,
        markerStart: e.markerStart,
      }));

      selectedNodeId.value = null;
      selectedEdgeId.value = null;
      isDirty.value = true;
      diagramVersion.value++;
      mutationVersion.value++;
      topologyVersion.value++;
      dataVersion.value++;
    },
  });

  const { canUndo, canRedo, undo, redo, clearHistory } = undoRedo;

  /** Push a snapshot, but skip if currently restoring (undo/redo in progress). */
  function pushSnapshot() {
    if (undoRedo.isRestoring()) return;
    undoRedo.pushSnapshot();
  }

  /** Debounced version of pushSnapshot for continuous operations (typing, dragging). */
  const pushSnapshotDebounced = useDebounceFn(() => {
    pushSnapshot();
  }, 300);

  // ─── Computed ───────────────────────────────────────────────────
  const selectedNode = computed(() =>
    selectedNodeId.value ? nodeById.value.get(selectedNodeId.value) || null : null,
  );

  const selectedEdge = computed(() =>
    selectedEdgeId.value ? edgeById.value.get(selectedEdgeId.value) || null : null,
  );

  const nodeCount = computed(() => nodes.value.length);
  const edgeCount = computed(() => edges.value.length);

  // ─── Flow animation cascade ────────────────────────────────────────
  /** Stagger delay (seconds) between topological levels for cascade animation */
  const flowStagger = ref(0.4);

  /** Auto-computed topological level per edge based on graph structure (BFS from source nodes).
   *  Only recomputes when topologyVersion changes (nodes/edges added or removed). */
  const _edgeFlowLevelsCache = ref<Map<string, number>>(new Map());
  const _maxFlowLevelCache = ref(0);

  function _recomputeFlowLevels() {
    const result = new Map<string, number>();
    const edgeList = edges.value;
    const nodeList = nodes.value;
    if (edgeList.length === 0) {
      _edgeFlowLevelsCache.value = result;
      _maxFlowLevelCache.value = 0;
      return;
    }

    const nodeIds = new Set(nodeList.map(n => n.id));
    const incoming = new Map<string, number>();
    for (const id of nodeIds) incoming.set(id, 0);
    for (const edge of edgeList) {
      if (nodeIds.has(edge.target)) {
        incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
      }
    }

    const nodeLevel = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, count] of incoming) {
      if (count === 0) {
        queue.push(id);
        nodeLevel.set(id, 0);
      }
    }
    if (queue.length === 0) {
      for (const id of nodeIds) {
        queue.push(id);
        nodeLevel.set(id, 0);
      }
    }

    let qi = 0;
    while (qi < queue.length) {
      const id = queue[qi++];
      const level = nodeLevel.get(id)!;
      for (const edge of edgeList) {
        if (edge.source === id && !nodeLevel.has(edge.target)) {
          nodeLevel.set(edge.target, level + 1);
          queue.push(edge.target);
        }
      }
    }

    let max = 0;
    for (const edge of edgeList) {
      const level = nodeLevel.get(edge.source) || 0;
      result.set(edge.id, level);
      if (level > max) max = level;
    }

    _edgeFlowLevelsCache.value = result;
    _maxFlowLevelCache.value = max;
  }

  // Recompute only when topology changes
  // (uses { flush: 'sync' } so the cache is ready before any downstream computed reads it)
  watch(() => topologyVersion.value, _recomputeFlowLevels, { immediate: true, flush: 'sync' });

  /** Readonly accessor for edge flow levels (cached behind topologyVersion). */
  const edgeFlowLevels = computed((): Map<string, number> => _edgeFlowLevelsCache.value);

  /** Highest flow level present in the current diagram (0 when no levels). */
  const maxFlowLevel = computed((): number => _maxFlowLevelCache.value);

  // ─── Flow playback ──────────────────────────────────────────────────
  /** null = normal mode (all edges animate). Number = only edges up to this step are shown. */
  const playbackStep = ref<number | null>(null);

  /** Highest flow level present in the current diagram (0 when no levels). Reuses maxFlowLevel. */
  const playbackMaxStep = computed((): number => maxFlowLevel.value);

  function setPlaybackStep(step: number | null) {
    playbackStep.value = step;
  }

  /** Compute the bounding box of all visible nodes (absolute coords) with optional padding. */
  function getContentBounds(padding = 40): { x: number; y: number; width: number; height: number } | null {
    const visible = nodes.value.filter(n => !n.hidden);
    if (visible.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of visible) {
      const { x: absX, y: absY } = getAbsolutePosition(nodes.value, node.id);

      const style = node.style as Record<string, string> | undefined;
      const dims = (node as any).dimensions;
      const w = dims?.width || parseFloat(style?.width || '0') || (node.type === 'aws-group' ? 400 : 160);
      const h = dims?.height || parseFloat(style?.height || '0') || (node.type === 'aws-group' ? 300 : 60);

      if (absX < minX) minX = absX;
      if (absY < minY) minY = absY;
      if (absX + w > maxX) maxX = absX + w;
      if (absY + h > maxY) maxY = absY + h;
    }

    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }

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
    mutationVersion.value++;
    topologyVersion.value++;
    pushSnapshot();
    return id;
  }

  function addCustomServiceNode(
    name: string,
    iconUrl: string,
    position: { x: number; y: number },
    color = '#6B7280',
  ): string {
    const id = uuid();
    const service: AWSService = {
      id: `custom-${id}`,
      name,
      shortName: name,
      category: 'Custom' as any,
      iconPath: '',
      iconUrl,
      description: 'Custom service',
      color,
    };

    const data: AWSServiceNodeData = {
      nodeType: 'aws-service',
      serviceId: service.id,
      label: name,
      customLabel: '',
      description: '',
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
    mutationVersion.value++;
    topologyVersion.value++;
    pushSnapshot();
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
    mutationVersion.value++;
    topologyVersion.value++;
    pushSnapshot();
    return id;
  }

  function removeNode(id: string) {
    // Unparent children first
    const parent = nodeById.value.get(id);
    for (const child of nodes.value) {
      if (child.parentNode === id) {
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

    edges.value = edges.value.filter(e => e.source !== id && e.target !== id);
    nodes.value = nodes.value.filter(n => n.id !== id);

    if (selectedNodeId.value === id) selectedNodeId.value = null;
    isDirty.value = true;
    mutationVersion.value++;
    topologyVersion.value++;
    pushSnapshot();
  }

  function updateNodeData(id: string, updates: Partial<DiagramNodeData>) {
    const node = nodeById.value.get(id);
    if (!node) return;
    node.data = { ...node.data, ...updates } as DiagramNodeData;
    isDirty.value = true;
    dataVersion.value++;
    pushSnapshotDebounced();
  }

  function updateNodePosition(id: string, position: { x: number; y: number }) {
    const node = nodeById.value.get(id);
    if (!node) return;
    node.position = position;
    isDirty.value = true;
    dataVersion.value++;
    pushSnapshotDebounced();
  }

  function selectNode(id: string | null) {
    selectedNodeId.value = id;
    if (id) selectedEdgeId.value = null;
  }

  function selectEdge(id: string | null) {
    selectedEdgeId.value = id;
    if (id) selectedNodeId.value = null;
  }

  // ─── Grouping (delegated) ─────────────────────────────────────
  const grouping = createDiagramGrouping({
    nodes, nodeById, isDirty, diagramVersion, selectedNodeId, selectedEdgeId, pushSnapshot,
  });

  // ─── Multi-select helpers ─────────────────────────────────────

  function removeSelectedNodes(selectedIds: string[]) {
    for (const id of selectedIds) {
      removeNode(id);
    }
  }

  // ─── Edge CRUD ─────────────────────────────────────────────────

  function addEdge(connection: Connection) {
    const exists = edges.value.some(
      e => e.source === connection.source && e.target === connection.target,
    );
    if (exists) return;

    let autoColor = '';
    const sourceNode = nodeById.value.get(connection.source);
    if (sourceNode) {
      const d = sourceNode.data as DiagramNodeData;
      if (d.nodeType === 'aws-service') autoColor = (d as AWSServiceNodeData).service.color;
      else if (d.nodeType === 'aws-group') autoColor = (d as AWSGroupNodeData).groupType.color;
    }

    const edgeData: DiagramEdgeData = {
      label: '',
      style: 'solid',
      animated: true,
      notes: '',
      edgeType: 'default',
      color: autoColor,
      markerStart: 'none',
      markerEnd: 'arrowclosed',
      dotAnimation: true,
      dotCount: 1,
      dotSpeed: 'medium',
      dotColor: '',
      labelSize: 'small',
      dotDirection: 'forward',
    };

    const markerColor = autoColor || undefined;
    edges.value.push({
      id: `e-${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'animated-flow',
      data: edgeData,
      label: '',
      animated: true,
      markerStart: undefined,
      markerEnd: { type: 'arrowclosed' as any, color: markerColor },
      ...(autoColor ? { style: { stroke: autoColor } } : {}),
    });
    isDirty.value = true;
    mutationVersion.value++;
    topologyVersion.value++;
    pushSnapshot();
  }

  function removeEdge(id: string) {
    edges.value = edges.value.filter(e => e.id !== id);
    if (selectedEdgeId.value === id) selectedEdgeId.value = null;
    isDirty.value = true;
    mutationVersion.value++;
    topologyVersion.value++;
    pushSnapshot();
  }

  function updateEdgeData(id: string, updates: Partial<DiagramEdgeData>) {
    const edge = edgeById.value.get(id);
    if (!edge) return;
    edge.data = { ...edge.data, ...updates } as DiagramEdgeData;
    if (updates.label !== undefined) edge.label = updates.label;

    const d = edge.data as DiagramEdgeData;
    if (updates.edgeType !== undefined || updates.dotAnimation !== undefined) {
      if (d.dotAnimation && d.animated) {
        edge.type = 'animated-flow';
      } else {
        edge.type = d.edgeType || 'default';
      }
    }

    if (updates.animated !== undefined) {
      edge.animated = d.animated;
    }

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

    if (updates.color !== undefined) {
      edge.style = d.color ? { stroke: d.color } : undefined;
      if (edge.markerEnd && typeof edge.markerEnd === 'object') {
        (edge.markerEnd as any).color = d.color || undefined;
      }
      if (edge.markerStart && typeof edge.markerStart === 'object') {
        (edge.markerStart as any).color = d.color || undefined;
      }
    }

    if (updates.style !== undefined) {
      const strokeDasharray = d.style === 'dashed' ? '8 4' : d.style === 'dotted' ? '2 4' : undefined;
      edge.style = { ...(edge.style as Record<string, string> || {}), ...(strokeDasharray ? { strokeDasharray } : { strokeDasharray: 'none' }) };
      if (d.color) (edge.style as any).stroke = d.color;
    }

    isDirty.value = true;
    dataVersion.value++;
    pushSnapshotDebounced();
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
    playbackStep.value = null;
    diagramVersion.value++;
    mutationVersion.value++;
    topologyVersion.value++;
    dataVersion.value++;
    clearHistory();
    pushSnapshot(); // initial snapshot so first action is undoable
  }

  // ─── Persistence (delegated) ──────────────────────────────────
  const persistence = createDiagramPersistence({
    nodes, edges, selectedNodeId, selectedEdgeId,
    currentDiagramId, currentDiagramName,
    isDirty, loading, diagramList, diagramVersion, savedViewport,
    clearHistory, pushSnapshot, newDiagram,
  });

  // Capture initial empty state so the very first mutation is undoable
  pushSnapshot();

  return {
    // State
    nodes, edges, selectedNodeId, selectedEdgeId,
    currentDiagramId, currentDiagramName,
    isDirty, loading, diagramList, diagramVersion, savedViewport, gifExportProgress,
    // Version counters
    mutationVersion, dataVersion, topologyVersion,
    // Map indexes
    nodeById, edgeById,
    // Computed
    selectedNode, selectedEdge, nodeCount, edgeCount,
    // Flow cascade
    flowStagger, edgeFlowLevels, maxFlowLevel,
    // Flow playback
    playbackStep, playbackMaxStep, setPlaybackStep,
    // Node CRUD
    addServiceNode, addCustomServiceNode, addGroupNode, removeNode,
    updateNodeData, updateNodePosition, selectNode, selectEdge,
    // Parent-child nesting (from grouping module)
    setNodeParent: grouping.setNodeParent,
    ungroupChildren: grouping.ungroupChildren,
    getGroupChildren: grouping.getGroupChildren,
    findGroupAtPosition: grouping.findGroupAtPosition,
    getAbsolutePosition: (nodeId: string) => getAbsolutePosition(nodes.value, nodeId),
    // Collapse / Expand (from grouping module)
    toggleGroupCollapse: grouping.toggleGroupCollapse,
    collapseAllGroups: grouping.collapseAllGroups,
    expandAllGroups: grouping.expandAllGroups,
    // Content bounds
    getContentBounds,
    // Z-Index layers (from grouping module)
    bringToFront: grouping.bringToFront,
    sendToBack: grouping.sendToBack,
    bringForward: grouping.bringForward,
    sendBackward: grouping.sendBackward,
    getNodeZIndex: grouping.getNodeZIndex,
    getNodeDepth: (nodeId: string) => getNodeDepth(nodes.value, nodeId),
    // Multi-select
    removeSelectedNodes,
    // Edge CRUD
    addEdge, removeEdge, updateEdgeData,
    // Undo / Redo
    canUndo, canRedo, undo, redo, pushSnapshot, clearHistory,
    // Diagram management
    newDiagram,
    serialize: persistence.serialize,
    deserialize: persistence.deserialize,
    // Persistence
    fetchDiagramList: persistence.fetchDiagramList,
    loadDiagram: persistence.loadDiagram,
    saveDiagram: persistence.saveDiagram,
    deleteDiagram: persistence.deleteDiagram,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDiagramsStore, import.meta.hot));
}
