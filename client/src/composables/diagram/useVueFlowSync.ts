import { watch, nextTick } from 'vue';
import type { GraphNode, GraphEdge, ViewportTransform } from '@vue-flow/core';
import type { useDiagramsStore } from '@/stores/diagrams';

interface UseVueFlowSyncOptions {
  diagrams: ReturnType<typeof useDiagramsStore>;
  getNodes: { value: GraphNode[] };
  getEdges: { value: GraphEdge[] };
  getSelectedNodes: { value: GraphNode[] };
  setNodes: (nodes: any[]) => void;
  setEdges: (edges: any[]) => void;
  findNode: (id: string) => GraphNode | undefined;
  findEdge: (id: string) => GraphEdge | undefined;
  removeNodes: (nodes: GraphNode[]) => void;
  removeEdges: (edges: GraphEdge[]) => void;
  fitView: () => void;
  setViewport: (viewport: ViewportTransform) => void;
}

/**
 * Compute nesting depth: 0 for root nodes, 1 for direct children, etc.
 */
function getNodeDepth(nodeId: string, nodes: any[]): number {
  let depth = 0;
  let current = nodes.find((n: any) => n.id === nodeId);
  while (current?.parentNode) {
    depth++;
    current = nodes.find((n: any) => n.id === current!.parentNode);
    if (depth > 10) break; // safety guard against cycles
  }
  return depth;
}

export function useVueFlowSync({
  diagrams,
  getNodes,
  getEdges,
  getSelectedNodes,
  setNodes,
  setEdges,
  findNode,
  findEdge,
  removeNodes,
  removeEdges,
  fitView,
  setViewport,
}: UseVueFlowSyncOptions) {
  // Sync VueFlow when store diagram version changes (full reload)
  watch(
    () => diagrams.diagramVersion,
    async () => {
      // Sort by nesting depth: parents first, deeper children last
      const sorted = [...diagrams.nodes].sort((a, b) => {
        return getNodeDepth(a.id, diagrams.nodes) - getNodeDepth(b.id, diagrams.nodes);
      });

      // Auto-set z-index based on depth so children are always above parents
      for (const node of sorted) {
        const depth = getNodeDepth(node.id, diagrams.nodes);
        if (depth > 0) {
          const currentZ = (node as any).zIndex ?? 0;
          if (currentZ < depth * 10) {
            (node as any).zIndex = depth * 10;
          }
        }
      }
      setNodes(sorted.map(n => ({ ...n })));
      setEdges(diagrams.edges.map(e => ({ ...e })));
      await nextTick();
      setTimeout(() => {
        if (diagrams.savedViewport) {
          setViewport(diagrams.savedViewport);
        } else {
          fitView();
        }
      }, 50);
    },
  );

  // Sync individual node/edge data changes — watch dataVersion counter instead of deep-watching arrays
  watch(
    () => diagrams.dataVersion,
    () => {
      for (const storeNode of diagrams.nodes) {
        const vfNode = findNode(storeNode.id);
        if (vfNode && vfNode.data !== storeNode.data) {
          vfNode.data = storeNode.data;
        }
      }
      for (const storeEdge of diagrams.edges) {
        const vfEdge = findEdge(storeEdge.id);
        if (vfEdge && vfEdge.data !== storeEdge.data) {
          vfEdge.data = storeEdge.data;
        }
      }
    },
  );

  // Sync node/edge removals and zIndex changes — watch mutationVersion counter
  watch(
    () => diagrams.mutationVersion,
    () => {
      // Remove nodes that no longer exist in the store
      const storeNodeIds = new Set(diagrams.nodes.map(n => n.id));
      const nodesToRemove = getNodes.value.filter(n => !storeNodeIds.has(n.id));
      if (nodesToRemove.length) removeNodes(nodesToRemove);

      // Remove edges that no longer exist in the store
      const storeEdgeIds = new Set(diagrams.edges.map(e => e.id));
      const edgesToRemove = getEdges.value.filter(e => !storeEdgeIds.has(e.id));
      if (edgesToRemove.length) removeEdges(edgesToRemove);

      // Sync zIndex changes
      for (const storeNode of diagrams.nodes) {
        const vfNode = findNode(storeNode.id);
        if (vfNode) {
          const storeZ = (storeNode as any).zIndex ?? 0;
          if (vfNode.zIndex !== storeZ) {
            vfNode.zIndex = storeZ;
          }
        }
      }
    },
  );

  // Sync store selection to VueFlow visual selection
  watch(
    () => diagrams.selectedNodeId,
    (newId) => {
      // Skip during multi-select (getSelectedNodes > 1)
      if (getSelectedNodes.value.length > 1) return;
      for (const node of getNodes.value) {
        const shouldBeSelected = newId ? node.id === newId : false;
        if (node.selected !== shouldBeSelected) {
          node.selected = shouldBeSelected;
        }
      }
    },
  );
}
