/**
 * Diagram persistence: serialization, deserialization, and CRUD operations against the API.
 */
import type { Node, Edge } from '@vue-flow/core';
import type { Ref } from 'vue';
import { apiFetch } from '@/lib/apiFetch';
import { getServiceById, AWS_GROUP_TYPES } from '@/data/aws-services';
import type {
  DiagramNodeData,
  AWSServiceNodeData,
  AWSGroupNodeData,
  DiagramEdgeData,
  DiagramConfig,
  SerializedDiagramNode,
  SerializedDiagramEdge,
} from './diagrams';

export interface DiagramPersistenceDeps {
  nodes: Ref<Node[]>;
  edges: Ref<Edge[]>;
  selectedNodeId: Ref<string | null>;
  selectedEdgeId: Ref<string | null>;
  currentDiagramId: Ref<string | null>;
  currentDiagramName: Ref<string>;
  isDirty: Ref<boolean>;
  loading: Ref<boolean>;
  diagramList: Ref<{ id: string; name: string; description?: string; updatedAt: string }[]>;
  diagramVersion: Ref<number>;
  savedViewport: Ref<{ x: number; y: number; zoom: number } | null>;
  clearHistory: () => void;
  pushSnapshot: () => void;
  newDiagram: () => void;
}

// ─── Serialization ─────────────────────────────────────────────────

export function serializeDiagram(
  nodes: Node[],
  edges: Edge[],
  viewport?: { x: number; y: number; zoom: number },
): { nodes: SerializedDiagramNode[]; edges: SerializedDiagramEdge[]; viewport?: { x: number; y: number; zoom: number } } {
  return {
    nodes: nodes.map(n => {
      const style = { ...(n.style as Record<string, string> || {}) };
      const dims = (n as any).dimensions;
      if (dims?.width && !style.width) style.width = `${dims.width}px`;
      if (dims?.height && !style.height) style.height = `${dims.height}px`;
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
        ...((n as any).zIndex != null && { zIndex: (n as any).zIndex }),
      };
    }),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      data: (e.data || { label: '', style: 'solid', animated: false, notes: '' }) as DiagramEdgeData,
    })),
    ...(viewport && { viewport }),
  };
}

export function deserializeDiagram(
  config: DiagramConfig,
  deps: DiagramPersistenceDeps,
) {
  deps.currentDiagramId.value = config.id;
  deps.currentDiagramName.value = config.name;
  deps.savedViewport.value = config.viewport ?? null;

  deps.nodes.value = config.nodes.map(n => {
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
      ...(n.extent && { extent: n.extent as 'parent' }),
      ...(n.style && { style: n.style }),
      ...(n.zIndex != null && { zIndex: n.zIndex }),
    };
  });

  // Auto-set z-index based on nesting depth so children render above parents
  for (const node of deps.nodes.value) {
    let depth = 0;
    let current: typeof node | undefined = node;
    while (current?.parentNode) {
      depth++;
      current = deps.nodes.value.find(n => n.id === current!.parentNode);
      if (depth > 10) break;
    }
    if (depth > 0) {
      const currentZ = (node as any).zIndex ?? 0;
      if (currentZ < depth * 10) {
        (node as any).zIndex = depth * 10;
      }
    }
  }

  deps.edges.value = config.edges.map(e => {
    const d: DiagramEdgeData = {
      ...e.data,
      label: e.data?.label ?? '',
      style: e.data?.style ?? 'solid',
      animated: e.data?.animated ?? false,
      notes: e.data?.notes ?? '',
      edgeType: e.data?.edgeType ?? 'default',
      color: e.data?.color ?? '',
      markerStart: e.data?.markerStart ?? 'none',
      markerEnd: e.data?.markerEnd ?? 'arrowclosed',
      dotAnimation: e.data?.dotAnimation ?? false,
      dotCount: e.data?.dotCount ?? 1,
      dotSpeed: e.data?.dotSpeed ?? 'medium',
      dotColor: e.data?.dotColor ?? '',
      labelSize: e.data?.labelSize ?? 'small',
      dotDirection: e.data?.dotDirection ?? 'forward',
      labelOffsetX: e.data?.labelOffsetX ?? 0,
      labelOffsetY: e.data?.labelOffsetY ?? 0,
    };
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      type: (d.dotAnimation && d.animated) ? 'animated-flow' : (d.edgeType || 'default'),
      data: d,
      label: d.label || '',
      animated: d.animated,
      markerStart: d.markerStart !== 'none' ? { type: d.markerStart === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined } : undefined,
      markerEnd: d.markerEnd !== 'none' ? { type: d.markerEnd === 'arrow' ? 'arrow' as any : 'arrowclosed' as any, color: d.color || undefined } : undefined,
      ...(d.color ? { style: { stroke: d.color } } : {}),
    };
  });

  deps.isDirty.value = false;
  deps.diagramVersion.value++;
  deps.clearHistory();
  deps.pushSnapshot(); // initial snapshot so first action is undoable
}

// ─── CRUD operations ───────────────────────────────────────────────

export function createDiagramPersistence(deps: DiagramPersistenceDeps) {
  function serialize(viewport?: { x: number; y: number; zoom: number }) {
    return serializeDiagram(deps.nodes.value, deps.edges.value, viewport);
  }

  function deserialize(config: DiagramConfig) {
    return deserializeDiagram(config, deps);
  }

  async function fetchDiagramList(projectPath: string) {
    deps.loading.value = true;
    try {
      const res = await apiFetch(`/api/diagrams?project=${encodeURIComponent(projectPath)}`);
      if (!res.ok) throw new Error('Failed to fetch diagrams');
      const data = await res.json();
      deps.diagramList.value = data.diagrams;
    } finally {
      deps.loading.value = false;
    }
  }

  async function loadDiagram(id: string) {
    deps.loading.value = true;
    try {
      const res = await apiFetch(`/api/diagrams/${id}`);
      if (!res.ok) throw new Error('Failed to load diagram');
      const config: DiagramConfig = await res.json();
      deserialize(config);
    } finally {
      deps.loading.value = false;
    }
  }

  async function saveDiagram(projectPath: string, viewport?: { x: number; y: number; zoom: number }) {
    const diagramData = serialize(viewport);
    const method = deps.currentDiagramId.value ? 'PUT' : 'POST';
    const url = deps.currentDiagramId.value ? `/api/diagrams/${deps.currentDiagramId.value}` : '/api/diagrams';

    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: deps.currentDiagramName.value,
        project: projectPath,
        diagramData,
      }),
    });

    if (!res.ok) throw new Error('Failed to save diagram');
    const saved: DiagramConfig = await res.json();
    deps.currentDiagramId.value = saved.id;
    deps.isDirty.value = false;
    return saved;
  }

  async function deleteDiagram(id: string) {
    const res = await apiFetch(`/api/diagrams/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete diagram');
    deps.diagramList.value = deps.diagramList.value.filter(d => d.id !== id);
    if (deps.currentDiagramId.value === id) deps.newDiagram();
  }

  async function shareDiagram(diagramId: string): Promise<{ shareToken: string }> {
    const res = await apiFetch(`/api/diagrams/${diagramId}/share`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create share link');
    return res.json();
  }

  async function unshareDiagram(diagramId: string): Promise<void> {
    const res = await apiFetch(`/api/diagrams/${diagramId}/share`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Failed to remove share link');
  }

  async function getShareStatus(diagramId: string): Promise<{ shared: boolean; shareToken?: string }> {
    const res = await apiFetch(`/api/diagrams/${diagramId}/share-status`);
    if (!res.ok) throw new Error('Failed to get share status');
    return res.json();
  }

  return {
    serialize,
    deserialize,
    fetchDiagramList,
    loadDiagram,
    saveDiagram,
    deleteDiagram,
    shareDiagram,
    unshareDiagram,
    getShareStatus,
  };
}
