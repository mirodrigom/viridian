/**
 * Diagram grouping logic: parent-child nesting, collapse/expand, z-index layers, absolute positioning.
 *
 * All functions operate on the provided nodes ref and call pushSnapshot/markDirty callbacks
 * to integrate with the parent store.
 */
import type { Node } from '@vue-flow/core';
import type { Ref, ComputedRef } from 'vue';
import type { AWSGroupNodeData } from './diagrams';

/** Group type IDs that represent top-level region boundaries and must never be nested inside other groups. */
const REGION_GROUP_TYPE_IDS = new Set(['region']);

/** Returns true if the node is an aws-group of a region type that cannot be a child of another group. */
function isRegionGroup(node: Node): boolean {
  if (node.type !== 'aws-group') return false;
  const data = node.data as AWSGroupNodeData;
  return REGION_GROUP_TYPE_IDS.has(data.groupTypeId);
}

export interface DiagramGroupingDeps {
  nodes: Ref<Node[]>;
  edges: Ref<import('@vue-flow/core').Edge[]>;
  nodeById: ComputedRef<Map<string, Node>>;
  isDirty: Ref<boolean>;
  diagramVersion: Ref<number>;
  dataVersion: Ref<number>;
  selectedNodeId: Ref<string | null>;
  selectedEdgeId: Ref<string | null>;
  pushSnapshot: () => void;
}

// ─── Absolute position helper ──────────────────────────────────────

/** Compute the absolute (world-space) position of a node by walking up the parent chain. */
export function getAbsolutePosition(nodes: Node[], nodeId: string): { x: number; y: number } {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return { x: 0, y: 0 };

  let absX = node.position.x;
  let absY = node.position.y;
  let current = node;
  let depth = 0;
  while (current.parentNode && depth < 10) {
    const parent = nodes.find(n => n.id === current.parentNode);
    if (!parent) break;
    absX += parent.position.x;
    absY += parent.position.y;
    current = parent;
    depth++;
  }
  return { x: absX, y: absY };
}

// ─── Depth helpers ──────────────────────────────────────────────────

/** Compute nesting depth of a node (0 = root, 1 = child, 2 = grandchild, etc.) */
export function getNodeDepth(nodes: Node[], nodeId: string): number {
  let depth = 0;
  let current = nodes.find(n => n.id === nodeId);
  while (current?.parentNode) {
    depth++;
    current = nodes.find(n => n.id === current!.parentNode);
    if (depth > 10) break;
  }
  return depth;
}

/** Minimum z-index for a node based on depth (children always above parents) */
function getDepthBaseZ(nodes: Node[], nodeId: string): number {
  return getNodeDepth(nodes, nodeId) * 10;
}

/** Get sibling nodes (same parent level) */
function getSiblings(nodes: Node[], nodeId: string): Node[] {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return [];
  return nodes.filter(n => n.parentNode === node.parentNode && n.id !== nodeId);
}

// ─── Factory: creates all grouping methods bound to store deps ──────

export function createDiagramGrouping(deps: DiagramGroupingDeps) {
  const { nodes, edges, nodeById, isDirty, dataVersion, pushSnapshot } = deps;

  // ─── Child-parent containment ─────────────────────────────────

  /**
   * Clamp a child node's position so it stays within its parent group's bounds.
   * If the child is larger than the parent, the parent is grown to accommodate.
   */
  function clampChildToParent(childId: string) {
    const child = nodeById.value.get(childId);
    if (!child || !child.parentNode) return;

    const parent = nodeById.value.get(child.parentNode);
    if (!parent) return;

    const parentStyle = parent.style as Record<string, string> | undefined;
    let parentW = parseFloat(parentStyle?.width ?? '400');
    let parentH = parseFloat(parentStyle?.height ?? '300');

    const childStyle = child.style as Record<string, string> | undefined;
    const childW = parseFloat(childStyle?.width ?? (child.type === 'aws-group' ? '200' : '160'));
    const childH = parseFloat(childStyle?.height ?? (child.type === 'aws-group' ? '150' : '80'));

    const padding = 10;
    const headerHeight = 36; // space for group label bar

    // If child does not fit, grow the parent to accommodate before clamping
    const requiredW = child.position.x + childW + padding;
    const requiredH = child.position.y + childH + padding;
    let parentGrew = false;
    if (requiredW > parentW) {
      parentW = requiredW;
      if (!parent.style) parent.style = {};
      (parent.style as Record<string, string>).width = `${parentW}px`;
      parentGrew = true;
    }
    if (requiredH > parentH) {
      parentH = requiredH;
      if (!parent.style) parent.style = {};
      (parent.style as Record<string, string>).height = `${parentH}px`;
      parentGrew = true;
    }
    if (parentGrew) {
      // Also update expandedHeight if parent is a group with collapse data
      const parentData = parent.data as AWSGroupNodeData;
      if (parentData?.nodeType === 'aws-group') {
        parentData.expandedHeight = `${parentH}px`;
      }
    }

    // Clamp position within parent bounds
    child.position = {
      x: Math.max(padding, Math.min(child.position.x, parentW - childW - padding)),
      y: Math.max(headerHeight + padding, Math.min(child.position.y, parentH - childH - padding)),
    };
  }

  // ─── Parent-child nesting ─────────────────────────────────────

  function setNodeParent(childId: string, parentId: string | null) {
    const child = nodeById.value.get(childId);
    if (!child) return;

    if (parentId === null) {
      const absPos = getAbsolutePosition(nodes.value, childId);
      child.position = { ...absPos };
      delete child.parentNode;
      delete child.extent;
    } else {
      const parent = nodeById.value.get(parentId);
      if (!parent) return;
      if (parent.type !== 'aws-group') return;
      if (childId === parentId) return;
      if (child.parentNode === parentId) return;

      // Region groups must never be nested inside other groups
      if (isRegionGroup(child)) return;

      // If the parent is collapsed, expand it first so the child is visible
      const parentData = parent.data as AWSGroupNodeData;
      if (parentData?.collapsed) {
        _expandGroup(parentId);
      }

      const childAbs = getAbsolutePosition(nodes.value, childId);
      const parentAbs = getAbsolutePosition(nodes.value, parentId);

      child.position = {
        x: childAbs.x - parentAbs.x,
        y: childAbs.y - parentAbs.y,
      };
      child.parentNode = parentId;
      child.extent = 'parent';

      const parentZ = (parent as any).zIndex ?? 0;
      const childZ = (child as any).zIndex ?? 0;
      if (childZ <= parentZ) {
        (child as any).zIndex = parentZ + 10;
      }

      // Clamp / grow parent to fit the child
      clampChildToParent(childId);
    }
    isDirty.value = true;
    pushSnapshot();
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

  // ─── Collapse / Expand ────────────────────────────────────────

  /** Collect all descendant node IDs (direct + nested children) for a group. */
  function getAllDescendantIds(groupId: string): string[] {
    const result: string[] = [];
    const queue = [groupId];
    let qi = 0;
    while (qi < queue.length) {
      const current = queue[qi++]!;
      for (const node of nodes.value) {
        if (node.parentNode === current) {
          result.push(node.id);
          if (node.type === 'aws-group') queue.push(node.id);
        }
      }
    }
    return result;
  }

  /** Sync edge hidden state: an edge is hidden if either its source or target node is hidden. */
  function syncEdgeVisibility() {
    const hiddenNodeIds = new Set(nodes.value.filter(n => n.hidden).map(n => n.id));
    for (const edge of edges.value) {
      edge.hidden = hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target);
    }
  }

  /** Internal: expand a group without triggering a snapshot (used inside collapse of nested groups). */
  function _expandGroup(groupId: string) {
    const group = nodeById.value.get(groupId);
    if (!group || group.type !== 'aws-group') return;
    const data = group.data as AWSGroupNodeData;
    if (!data.collapsed) return;

    // Expand direct children. For nested sub-groups, only show them if they weren't
    // independently collapsed — they stay collapsed but become visible themselves.
    const directChildren = getGroupChildren(groupId);
    for (const child of directChildren) {
      child.hidden = false;
      // If this child is itself a collapsed group, keep its descendants hidden
      if (child.type === 'aws-group') {
        const childData = child.data as AWSGroupNodeData;
        if (childData.collapsed) {
          const subDescendants = getAllDescendantIds(child.id);
          for (const descId of subDescendants) {
            const desc = nodeById.value.get(descId);
            if (desc) desc.hidden = true;
          }
        }
      }
    }

    data.collapsed = false;
    if (group.style) {
      (group.style as Record<string, string>).height = data.expandedHeight || '300px';
    }
  }

  function toggleGroupCollapse(groupId: string) {
    const group = nodeById.value.get(groupId);
    if (!group || group.type !== 'aws-group') return;
    const data = group.data as AWSGroupNodeData;

    if (!data.collapsed) {
      // Collapse: save height, then hide ALL descendants
      const style = group.style as Record<string, string> | undefined;
      data.expandedHeight = style?.height || '300px';
      data.childPositions = {};

      const directChildren = getGroupChildren(groupId);
      for (const child of directChildren) {
        data.childPositions[child.id] = { ...child.position };
      }

      const allDescendants = getAllDescendantIds(groupId);
      for (const descId of allDescendants) {
        const desc = nodeById.value.get(descId);
        if (desc) desc.hidden = true;
      }

      data.collapsed = true;
      if (!group.style) group.style = {};
      (group.style as Record<string, string>).height = '48px';
    } else {
      _expandGroup(groupId);
    }

    syncEdgeVisibility();
    isDirty.value = true;
    dataVersion.value++;
    pushSnapshot();
  }

  function collapseAllGroups() {
    // Collapse root groups first (shallowest), then nested — avoids double-processing
    const groups = nodes.value
      .filter(n => n.type === 'aws-group')
      .sort((a, b) => getNodeDepth(nodes.value, a.id) - getNodeDepth(nodes.value, b.id));

    for (const node of groups) {
      const data = node.data as AWSGroupNodeData;
      if (!data.collapsed) {
        const style = node.style as Record<string, string> | undefined;
        data.expandedHeight = style?.height || '300px';
        data.childPositions = {};
        const directChildren = getGroupChildren(node.id);
        for (const child of directChildren) {
          data.childPositions[child.id] = { ...child.position };
        }
        const allDescendants = getAllDescendantIds(node.id);
        for (const descId of allDescendants) {
          const desc = nodeById.value.get(descId);
          if (desc) desc.hidden = true;
        }
        data.collapsed = true;
        if (!node.style) node.style = {};
        (node.style as Record<string, string>).height = '48px';
      }
    }
    syncEdgeVisibility();
    isDirty.value = true;
    dataVersion.value++;
    pushSnapshot();
  }

  function expandAllGroups() {
    // Expand from outermost (shallowest) inward so parents expand before their children
    const groups = nodes.value
      .filter(n => n.type === 'aws-group')
      .sort((a, b) => getNodeDepth(nodes.value, a.id) - getNodeDepth(nodes.value, b.id));

    for (const node of groups) {
      const data = node.data as AWSGroupNodeData;
      if (data.collapsed) {
        data.collapsed = false;
        if (node.style) {
          (node.style as Record<string, string>).height = data.expandedHeight || '300px';
        }
        // Unhide direct children (descendants will be handled by their own group's expand)
        const directChildren = getGroupChildren(node.id);
        for (const child of directChildren) {
          child.hidden = false;
        }
      }
    }
    syncEdgeVisibility();
    isDirty.value = true;
    dataVersion.value++;
    pushSnapshot();
  }

  // ─── Z-Index layers ───────────────────────────────────────────

  function bringToFront(nodeId: string) {
    const node = nodeById.value.get(nodeId);
    if (!node) return;
    const siblings = getSiblings(nodes.value, nodeId);
    const baseZ = getDepthBaseZ(nodes.value, nodeId);
    const maxZ = Math.max(baseZ, ...siblings.map(n => (n as any).zIndex ?? 0));
    (node as any).zIndex = maxZ + 1;
    isDirty.value = true;
    pushSnapshot();
  }

  function sendToBack(nodeId: string) {
    const node = nodeById.value.get(nodeId);
    if (!node) return;
    const siblings = getSiblings(nodes.value, nodeId);
    const baseZ = getDepthBaseZ(nodes.value, nodeId);
    const minZ = Math.min(baseZ, ...siblings.map(n => (n as any).zIndex ?? 0));
    (node as any).zIndex = Math.max(baseZ, minZ - 1);
    isDirty.value = true;
    pushSnapshot();
  }

  function bringForward(nodeId: string) {
    const node = nodeById.value.get(nodeId);
    if (!node) return;
    const baseZ = getDepthBaseZ(nodes.value, nodeId);
    const currentZ = (node as any).zIndex ?? baseZ;
    (node as any).zIndex = Math.max(baseZ, currentZ + 1);
    isDirty.value = true;
    pushSnapshot();
  }

  function sendBackward(nodeId: string) {
    const node = nodeById.value.get(nodeId);
    if (!node) return;
    const baseZ = getDepthBaseZ(nodes.value, nodeId);
    const currentZ = (node as any).zIndex ?? baseZ;
    (node as any).zIndex = Math.max(baseZ, currentZ - 1);
    isDirty.value = true;
    pushSnapshot();
  }

  function getNodeZIndex(nodeId: string): number {
    const node = nodeById.value.get(nodeId);
    if (!node) return 0;
    return (node as any).zIndex ?? 0;
  }

  function findGroupAtPosition(position: { x: number; y: number }, excludeId?: string): string | null {
    // If the node being placed is a region group, it must never be nested
    if (excludeId) {
      const excludeNode = nodeById.value.get(excludeId);
      if (excludeNode && isRegionGroup(excludeNode)) return null;
    }

    let bestId: string | null = null;
    let bestDepth = -1;

    for (const node of nodes.value) {
      if (node.type !== 'aws-group') continue;
      if (node.id === excludeId) continue;

      const abs = getAbsolutePosition(nodes.value, node.id);
      const style = node.style as Record<string, string> | undefined;
      const w = parseFloat(style?.width || '400');
      const h = parseFloat(style?.height || '300');

      if (
        position.x >= abs.x &&
        position.x <= abs.x + w &&
        position.y >= abs.y &&
        position.y <= abs.y + h
      ) {
        const depth = getNodeDepth(nodes.value, node.id);
        if (depth > bestDepth) {
          bestDepth = depth;
          bestId = node.id;
        }
      }
    }
    return bestId;
  }

  return {
    setNodeParent,
    ungroupChildren,
    getGroupChildren,
    clampChildToParent,
    toggleGroupCollapse,
    collapseAllGroups,
    expandAllGroups,
    bringToFront,
    sendToBack,
    bringForward,
    sendBackward,
    getNodeZIndex,
    findGroupAtPosition,
    syncEdgeVisibility,
  };
}
