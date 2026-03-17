/**
 * Layout algorithm for AI-generated diagram commands.
 * Assigns positions to nodes based on their group hierarchy
 * and connection topology.
 */

import type { DiagramCommand } from './useDiagramAI';

interface LayoutNode {
  refId: string;
  parentRef?: string;
  isGroup: boolean;
  children: string[]; // refIds of children
  row: number;
  col: number;
}

interface PositionResult {
  refId: string;
  position: { x: number; y: number };
  size?: { width: number; height: number };
}

// Layout constants
const GROUP_PADDING = 60;
const GROUP_HEADER = 40;
const SERVICE_WIDTH = 160;
const SERVICE_HEIGHT = 60;
const SERVICE_GAP_X = 280;
const SERVICE_GAP_Y = 160;
const GROUP_GAP_X = 80;
const GROUP_GAP_Y = 60;
const ITEM_GAP = 80;
const TOP_LEVEL_START_X = 100;
const TOP_LEVEL_START_Y = 100;

/**
 * Calculate positions for all nodes from a list of diagram commands.
 * Returns a map of refId -> { position, size? }
 */
export function calculateLayout(commands: DiagramCommand[]): Map<string, PositionResult> {
  const results = new Map<string, PositionResult>();

  // Extract node info from commands
  const nodes = new Map<string, LayoutNode>();
  const parentMap = new Map<string, string>(); // childRef -> parentRef
  const edgeSources = new Map<string, string[]>(); // sourceRef -> targetRefs

  for (const cmd of commands) {
    if (cmd.action === 'addGroup') {
      const refId = cmd.params.refId as string;
      nodes.set(refId, { refId, isGroup: true, children: [], row: 0, col: 0 });
    } else if (cmd.action === 'addService') {
      const refId = cmd.params.refId as string;
      nodes.set(refId, { refId, isGroup: false, children: [], row: 0, col: 0 });
    } else if (cmd.action === 'setParent') {
      const childRef = cmd.params.childRef as string;
      const parentRef = cmd.params.parentRef as string;
      parentMap.set(childRef, parentRef);
      const parent = nodes.get(parentRef);
      if (parent) parent.children.push(childRef);
    } else if (cmd.action === 'addEdge') {
      const src = cmd.params.sourceRef as string;
      const tgt = cmd.params.targetRef as string;
      if (!edgeSources.has(src)) edgeSources.set(src, []);
      edgeSources.get(src)!.push(tgt);
    }
  }

  // Find top-level nodes (no parent)
  const topLevel: string[] = [];
  for (const [refId] of nodes) {
    if (!parentMap.has(refId)) {
      topLevel.push(refId);
    }
  }

  // Use topological ordering based on edges for top-level flow direction
  const topLevelOrdered = topologicalSort(topLevel, edgeSources, parentMap);

  // Position top-level nodes in a horizontal flow
  let cursorX = TOP_LEVEL_START_X;
  for (const refId of topLevelOrdered) {
    const node = nodes.get(refId);
    if (!node) continue;

    if (node.isGroup) {
      const groupSize = layoutGroup(refId, nodes, parentMap, edgeSources, results, { x: cursorX, y: TOP_LEVEL_START_Y });
      cursorX += groupSize.width + GROUP_GAP_X;
    } else {
      results.set(refId, {
        refId,
        position: { x: cursorX, y: TOP_LEVEL_START_Y + 100 }, // offset a bit down for standalone services
      });
      cursorX += SERVICE_WIDTH + GROUP_GAP_X;
    }
  }

  return results;
}

/**
 * Layout a group and all its children recursively.
 * Returns the computed size of the group.
 *
 * When the group has BOTH child groups and child services, all children are
 * placed in a single unified horizontal row (topologically sorted by edges).
 * When the group has ONLY services (no child groups), services are laid out in
 * a grid.
 */
function layoutGroup(
  groupRef: string,
  nodes: Map<string, LayoutNode>,
  parentMap: Map<string, string>,
  edgeSources: Map<string, string[]>,
  results: Map<string, PositionResult>,
  origin: { x: number; y: number },
): { width: number; height: number } {
  const node = nodes.get(groupRef);
  if (!node) return { width: 400, height: 300 };

  const childGroups = node.children.filter(c => nodes.get(c)?.isGroup);
  const childServices = node.children.filter(c => !nodes.get(c)?.isGroup);

  const innerYStart = GROUP_HEADER + GROUP_PADDING;

  if (childGroups.length > 0) {
    // ── Unified horizontal row: all children (groups + services) side by side ──
    const allChildren = [...node.children];
    const sortedChildren = topoSortDirectChildren(allChildren, edgeSources, parentMap);

    let cursorX = GROUP_PADDING;
    let maxChildHeight = 0;

    for (const childRef of sortedChildren) {
      const childNode = nodes.get(childRef);
      if (!childNode) continue;

      if (childNode.isGroup) {
        const childSize = layoutGroup(childRef, nodes, parentMap, edgeSources, results, {
          x: cursorX,
          y: innerYStart,
        });
        cursorX += childSize.width + ITEM_GAP;
        maxChildHeight = Math.max(maxChildHeight, childSize.height);
      } else {
        // Service: center vertically relative to tallest group (set later via adjustment)
        results.set(childRef, {
          refId: childRef,
          position: { x: cursorX, y: innerYStart },
        });
        cursorX += SERVICE_WIDTH + ITEM_GAP;
        maxChildHeight = Math.max(maxChildHeight, SERVICE_HEIGHT);
      }
    }

    const contentWidth = Math.max(cursorX - ITEM_GAP + GROUP_PADDING, 400);
    const contentHeight = Math.max(innerYStart + maxChildHeight + GROUP_PADDING, 300);

    results.set(groupRef, {
      refId: groupRef,
      position: origin,
      size: { width: contentWidth, height: contentHeight },
    });

    return { width: contentWidth, height: contentHeight };
  }

  // ── Services-only grid layout ──────────────────────────────────────────────
  const cols = Math.max(2, Math.ceil(Math.sqrt(childServices.length)));
  let maxServiceRowHeight = 0;
  let serviceMaxX = 0;

  childServices.forEach((svcRef, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = GROUP_PADDING + col * SERVICE_GAP_X;
    const y = innerYStart + row * SERVICE_GAP_Y;

    results.set(svcRef, {
      refId: svcRef,
      position: { x, y },
    });

    serviceMaxX = Math.max(serviceMaxX, x + SERVICE_WIDTH);
    maxServiceRowHeight = Math.max(maxServiceRowHeight, y + SERVICE_HEIGHT - innerYStart);
  });

  const contentWidth = Math.max(serviceMaxX + GROUP_PADDING, 400);
  const contentHeight = Math.max(innerYStart + maxServiceRowHeight + GROUP_PADDING, 300);

  results.set(groupRef, {
    refId: groupRef,
    position: origin,
    size: { width: contentWidth, height: contentHeight },
  });

  return { width: contentWidth, height: contentHeight };
}

/**
 * Topologically sort a set of direct children using edges between them.
 * For each edge (src → tgt), finds which direct child "owns" src (by walking
 * up parentMap until hitting a direct child) and which owns tgt.  If they
 * differ, adds a dependency srcChild → tgtChild.  Uses Kahn's BFS; disconnected
 * nodes are appended at the end.
 */
function topoSortDirectChildren(
  childRefs: string[],
  edgeSources: Map<string, string[]>,
  parentMap: Map<string, string>,
): string[] {
  const childSet = new Set(childRefs);

  /** Walk up parentMap until we find a node that is a direct child, or null. */
  function owningChild(ref: string): string | null {
    let current = ref;
    while (current) {
      if (childSet.has(current)) return current;
      const parent = parentMap.get(current);
      if (!parent) return null;
      current = parent;
    }
    return null;
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const ref of childRefs) {
    inDegree.set(ref, 0);
    adjacency.set(ref, new Set());
  }

  for (const [src, targets] of edgeSources) {
    const srcChild = owningChild(src);
    for (const tgt of targets) {
      const tgtChild = owningChild(tgt);
      if (srcChild && tgtChild && srcChild !== tgtChild) {
        if (!adjacency.get(srcChild)?.has(tgtChild)) {
          adjacency.get(srcChild)?.add(tgtChild);
          inDegree.set(tgtChild, (inDegree.get(tgtChild) || 0) + 1);
        }
      }
    }
  }

  // BFS / Kahn's algorithm
  const queue: string[] = [];
  for (const [ref, deg] of inDegree) {
    if (deg === 0) queue.push(ref);
  }

  const sorted: string[] = [];
  let qi = 0;
  while (qi < queue.length) {
    const ref = queue[qi++];
    sorted.push(ref);
    for (const neighbor of adjacency.get(ref) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Append any disconnected or cycle nodes
  for (const ref of childRefs) {
    if (!sorted.includes(ref)) sorted.push(ref);
  }

  return sorted;
}

/**
 * Simple topological sort for top-level nodes based on edge connectivity.
 * Nodes that are edge sources come before their targets.
 */
function topologicalSort(
  nodeRefs: string[],
  edgeSources: Map<string, string[]>,
  parentMap: Map<string, string>,
): string[] {
  // Resolve ref to its top-level ancestor
  function topLevelOf(ref: string): string {
    let current = ref;
    while (parentMap.has(current)) {
      current = parentMap.get(current)!;
    }
    return current;
  }

  const refSet = new Set(nodeRefs);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  for (const ref of nodeRefs) {
    inDegree.set(ref, 0);
    adjacency.set(ref, new Set());
  }

  // Build adjacency from edges (mapped to top-level)
  for (const [src, targets] of edgeSources) {
    const srcTop = topLevelOf(src);
    for (const tgt of targets) {
      const tgtTop = topLevelOf(tgt);
      if (srcTop !== tgtTop && refSet.has(srcTop) && refSet.has(tgtTop)) {
        if (!adjacency.get(srcTop)?.has(tgtTop)) {
          adjacency.get(srcTop)?.add(tgtTop);
          inDegree.set(tgtTop, (inDegree.get(tgtTop) || 0) + 1);
        }
      }
    }
  }

  // BFS
  const queue: string[] = [];
  for (const [ref, deg] of inDegree) {
    if (deg === 0) queue.push(ref);
  }

  const sorted: string[] = [];
  let qi = 0;
  while (qi < queue.length) {
    const ref = queue[qi++];
    sorted.push(ref);
    for (const neighbor of adjacency.get(ref) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Add any nodes not reached (cycles or disconnected)
  for (const ref of nodeRefs) {
    if (!sorted.includes(ref)) sorted.push(ref);
  }

  return sorted;
}
