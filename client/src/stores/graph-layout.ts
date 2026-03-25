/**
 * Graph auto-layout algorithm.
 *
 * Positions nodes in horizontal layers by type, with rule containers placed below.
 */
import type { Node, Edge } from '@vue-flow/core';
import type { Ref } from 'vue';
import type { NodeData, GraphNodeType } from '@/types/graph';

export interface GraphLayoutDeps {
  nodes: Ref<Node[]>;
  edges: Ref<Edge[]>;
  isDirty: Ref<boolean>;
  graphVersion: Ref<number>;
  applyRuleContainers: () => void;
  getRuleChildrenMap: () => Map<string, string[]>;
}

/** Average x of all parent nodes (sources of edges targeting this node). Falls back to 0. */
function getParentAverageX(
  nodeId: string,
  edges: Edge[],
  positionedNodes: Map<string, { x: number; y: number }>,
): number {
  const parentEdges = edges.filter(e => e.target === nodeId);
  const parentPositions = parentEdges
    .map(e => positionedNodes.get(e.source))
    .filter((p): p is { x: number; y: number } => p != null);

  if (parentPositions.length === 0) return 0;
  return parentPositions.reduce((sum, p) => sum + p.x, 0) / parentPositions.length;
}

export function autoLayout(deps: GraphLayoutDeps) {
  const { nodes, edges, isDirty, graphVersion, applyRuleContainers, getRuleChildrenMap } = deps;

  const ruleChildren = getRuleChildrenMap();
  // Collect IDs of nodes that will be parented inside rule containers
  const parentedNodeIds = new Set<string>();
  for (const childIds of ruleChildren.values()) {
    for (const id of childIds) parentedNodeIds.add(id);
  }
  // Container rule IDs (rules that have children)
  const containerRuleIds = new Set<string>();
  for (const [ruleId, childIds] of ruleChildren) {
    if (childIds.length > 0) containerRuleIds.add(ruleId);
  }

  // Layers: exclude parented nodes (they go inside containers) and container rules (positioned separately)
  const layers: GraphNodeType[][] = [
    ['agent'],
    ['subagent'],
    ['expert'],
    ['skill', 'mcp', 'rule'],
  ];

  const HORIZONTAL_GAP = 280;
  const VERTICAL_GAP = 200;
  let y = 50;

  // Build a map of positioned nodes for edge-aware child alignment
  const positionedNodes = new Map<string, { x: number; y: number }>();

  for (const layerTypes of layers) {
    const layerNodes = nodes.value.filter(n => {
      const nt = (n.data as NodeData).nodeType;
      if (!layerTypes.includes(nt)) return false;
      if (parentedNodeIds.has(n.id)) return false;
      if (containerRuleIds.has(n.id)) return false;
      return true;
    });
    if (layerNodes.length === 0) continue;

    // Sort children by their parent's x position to cluster related nodes
    if (positionedNodes.size > 0) {
      layerNodes.sort((a, b) => {
        const aParentX = getParentAverageX(a.id, edges.value, positionedNodes);
        const bParentX = getParentAverageX(b.id, edges.value, positionedNodes);
        return aParentX - bParentX;
      });
    }

    const totalWidth = layerNodes.length * HORIZONTAL_GAP;
    let x = -(totalWidth / 2) + HORIZONTAL_GAP / 2;

    for (const node of layerNodes) {
      node.position = { x, y };
      positionedNodes.set(node.id, { x, y });
      x += HORIZONTAL_GAP;
    }
    y += VERTICAL_GAP;
  }

  // Position container rules below everything else, centered
  const containerRules = nodes.value.filter(n => containerRuleIds.has(n.id));
  if (containerRules.length > 0) {
    const CONTAINER_GAP = 40;
    // First pass: apply containers to calculate sizes
    applyRuleContainers();

    let totalContainerWidth = 0;
    for (const cr of containerRules) {
      const w = parseInt((cr.style as Record<string, string> | undefined)?.width || '600');
      totalContainerWidth += w + CONTAINER_GAP;
    }
    totalContainerWidth -= CONTAINER_GAP;

    let cx = -(totalContainerWidth / 2);
    for (const cr of containerRules) {
      const w = parseInt((cr.style as Record<string, string> | undefined)?.width || '600');
      cr.position = { x: cx, y: y + 40 };
      positionedNodes.set(cr.id, cr.position);
      cx += w + CONTAINER_GAP;
    }

    // Re-apply containers now that positions are set
    applyRuleContainers();
  }

  isDirty.value = true;
  graphVersion.value++;
}
