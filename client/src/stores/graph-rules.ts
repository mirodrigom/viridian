/**
 * Graph rule container logic: builds rule-children maps and applies visual grouping
 * via Vue Flow parentNode.
 */
import type { Node, Edge } from '@vue-flow/core';
import type { Ref } from 'vue';
import type { NodeData, GraphNodeType, GraphEdgeData, RuleNodeData } from '@/types/graph';

export interface GraphRulesDeps {
  nodes: Ref<Node[]>;
  edges: Ref<Edge[]>;
  isDirty: Ref<boolean>;
}

/** Build map of ruleId -> childIds from rule-constraint edges */
export function getRuleChildrenMap(edges: Edge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const edgeData = edge.data as GraphEdgeData;
    if (edgeData?.edgeType === 'rule-constraint') {
      // edge.source = agent/subagent/expert, edge.target = rule
      const ruleId = edge.target;
      const childId = edge.source;
      if (!map.has(ruleId)) map.set(ruleId, []);
      map.get(ruleId)!.push(childId);
    }
  }
  return map;
}

/** Apply visual grouping: rule containers wrap their child nodes using Vue Flow parentNode */
export function applyRuleContainers(deps: GraphRulesDeps) {
  const { nodes, edges, isDirty } = deps;

  const HEADER_HEIGHT = 48;
  const PADDING = 24;
  const CHILD_WIDTH = 260;
  const CHILD_HEIGHT = 160;
  const CHILD_GAP_H = 20;
  const LAYER_GAP = 30;

  const LAYER_ORDER: GraphNodeType[] = ['agent', 'subagent', 'expert'];

  const ruleChildren = getRuleChildrenMap(edges.value);

  // First: clear container state for all rules
  for (const node of nodes.value) {
    const d = node.data as NodeData;
    if (d.nodeType === 'rule') {
      (d as RuleNodeData).isContainer = false;
    }
  }

  // Clear parentNode from all nodes (fresh calculation)
  for (const node of nodes.value) {
    if (node.parentNode) {
      const parent = nodes.value.find(n => n.id === node.parentNode);
      if (parent) {
        node.position = {
          x: node.position.x + parent.position.x,
          y: node.position.y + parent.position.y,
        };
      }
      delete node.parentNode;
      delete node.extent;
    }
    delete node.style;
  }

  // Apply container grouping
  for (const [ruleId, childIds] of ruleChildren) {
    if (childIds.length === 0) continue;
    const ruleNode = nodes.value.find(n => n.id === ruleId);
    if (!ruleNode) continue;

    (ruleNode.data as RuleNodeData).isContainer = true;

    // Group children by type into layers
    const childNodes = childIds
      .map(id => nodes.value.find(n => n.id === id))
      .filter((n): n is Node => n != null);

    const layerMap = new Map<GraphNodeType, Node[]>();
    for (const child of childNodes) {
      const nt = (child.data as NodeData).nodeType;
      if (!layerMap.has(nt)) layerMap.set(nt, []);
      layerMap.get(nt)!.push(child);
    }

    // Build ordered layers (agent -> subagent -> expert, then any others)
    const orderedLayers: Node[][] = [];
    for (const lt of LAYER_ORDER) {
      const layerNodes = layerMap.get(lt);
      if (layerNodes && layerNodes.length > 0) {
        orderedLayers.push(layerNodes);
        layerMap.delete(lt);
      }
    }
    for (const remaining of layerMap.values()) {
      if (remaining.length > 0) orderedLayers.push(remaining);
    }

    // Calculate container dimensions
    let maxLayerWidth = 0;
    for (const layer of orderedLayers) {
      const layerWidth = layer.length * CHILD_WIDTH + (layer.length - 1) * CHILD_GAP_H;
      if (layerWidth > maxLayerWidth) maxLayerWidth = layerWidth;
    }
    const containerWidth = PADDING * 2 + maxLayerWidth;
    const containerHeight = HEADER_HEIGHT + PADDING * 2 +
      orderedLayers.length * CHILD_HEIGHT +
      (orderedLayers.length - 1) * LAYER_GAP;

    ruleNode.style = { width: `${containerWidth}px`, height: `${containerHeight}px` };

    // Position children layer by layer, centered horizontally
    let currentY = HEADER_HEIGHT + PADDING;
    for (const layer of orderedLayers) {
      const layerWidth = layer.length * CHILD_WIDTH + (layer.length - 1) * CHILD_GAP_H;
      let startX = PADDING + (maxLayerWidth - layerWidth) / 2;

      for (const child of layer) {
        child.parentNode = ruleId;
        child.extent = 'parent';
        child.position = { x: startX, y: currentY };
        startX += CHILD_WIDTH + CHILD_GAP_H;
      }
      currentY += CHILD_HEIGHT + LAYER_GAP;
    }
  }

  isDirty.value = true;
}
