/**
 * Automatic layout for diagram nodes using dagre.
 *
 * Runs a recursive, per-scope Sugiyama layout:
 *  1. Each group's children are laid out independently first (depth-first).
 *  2. Edges that cross scope boundaries are "projected" to the nearest
 *     ancestor that is a direct child of the current scope, so inter-group
 *     ordering is still driven by actual data-flow connections.
 *  3. Group sizes are expanded to fit their laid-out children.
 *
 * This generic approach minimises edge crossings at every nesting level
 * without knowing anything about the specific diagram domain.
 */

import { Graph } from 'dagre-d3-es/src/graphlib/index.js';
import { layout } from 'dagre-d3-es/src/dagre/index.js';
import type { Node, Edge } from '@vue-flow/core';
import type { useDiagramsStore } from '@/stores/diagrams';

// ─── Layout constants ──────────────────────────────────────────────────────

const SERVICE_W = 200;  // minimum service node width
const SERVICE_H = 80;

/** Horizontal padding inside a group (left & right). */
const PAD_X = 60;
/** Top padding inside a group (header height + breathing room). */
const PAD_TOP = 80;
/** Bottom padding inside a group. */
const PAD_BOT = 50;

/** Minimum gap between sibling nodes in the same rank. */
const NODE_SEP = 70;
/** Minimum gap between consecutive ranks (columns in LR layout). */
const RANK_SEP = 130;

// ─── Types ─────────────────────────────────────────────────────────────────

type Store = ReturnType<typeof useDiagramsStore>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function getDims(node: Node): { w: number; h: number } {
  const style = (node.style as Record<string, string>) || {};
  if ((node.data as any)?.nodeType === 'aws-service') {
    // If the node has been explicitly resized, honour that
    if (style.width) return { w: parseInt(style.width) || SERVICE_W, h: SERVICE_H };
    // Estimate width from label so dagre allocates enough space to avoid overflow
    const label: string = (node.data as any)?.customLabel || (node.data as any)?.label || '';
    // ~7px per char + 80px for icon, padding, and delete button
    const estimated = Math.max(SERVICE_W, label.length * 7 + 80);
    return { w: estimated, h: SERVICE_H };
  }
  return {
    w: parseInt(style.width ?? '0') || 200,
    h: parseInt(style.height ?? '0') || 150,
  };
}

/**
 * Walk the parentNode chain to find the first ancestor that is a direct
 * member of `scopeChildren`. Returns null if no ancestor qualifies.
 */
function findOwnerInScope(
  nodeId: string,
  scopeChildren: Set<string>,
  nodeById: Map<string, Node>,
): string | null {
  let cur = nodeId;
  while (cur) {
    if (scopeChildren.has(cur)) return cur;
    const n = nodeById.get(cur);
    if (!n) return null;
    cur = (n.parentNode as string | undefined) ?? '';
  }
  return null;
}

// ─── Core recursive layout ─────────────────────────────────────────────────

/**
 * Layout the direct children of `scopeId` using dagre (LR direction).
 * Recurses into child groups first so their sizes are correct before being
 * used as dagre node dimensions.
 *
 * @returns The bounding-box size of all laid-out children (without padding).
 */
function layoutScope(
  scopeId: string | null,
  childrenOf: Map<string | null, string[]>,
  nodeById: Map<string, Node>,
  edges: readonly Edge[],
): { w: number; h: number } {
  const children = childrenOf.get(scopeId) ?? [];
  if (children.length === 0) return { w: 0, h: 0 };

  // ── Step 1: recursively layout child groups ────────────────────────────
  for (const childId of children) {
    const child = nodeById.get(childId);
    if (!child || (child.data as any)?.nodeType !== 'aws-group') continue;

    const inner = layoutScope(childId, childrenOf, nodeById, edges);
    if (inner.w > 0) {
      const newW = inner.w + PAD_X * 2;
      const newH = inner.h + PAD_TOP + PAD_BOT;
      child.style = {
        ...(child.style as Record<string, string> || {}),
        width: `${newW}px`,
        height: `${newH}px`,
      };
    }
  }

  // ── Step 2: build dagre graph for this scope ───────────────────────────
  const g = new Graph({ compound: false });
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  const childSet = new Set(children);

  for (const childId of children) {
    const child = nodeById.get(childId);
    if (!child) continue;
    const { w, h } = getDims(child);
    g.setNode(childId, { width: w, height: h, label: childId });
  }

  // Project edges to direct children of this scope
  const addedEdges = new Set<string>();
  for (const edge of edges) {
    const src = findOwnerInScope(edge.source, childSet, nodeById);
    const tgt = findOwnerInScope(edge.target, childSet, nodeById);
    if (src && tgt && src !== tgt) {
      const key = `${src}→${tgt}`;
      if (!addedEdges.has(key)) {
        g.setEdge(src, tgt);
        addedEdges.add(key);
      }
    }
  }

  // ── Step 3: run dagre ──────────────────────────────────────────────────
  try {
    layout(g);
  } catch (err) {
    console.warn('[AutoLayout] dagre layout failed for scope', scopeId, err);
    return { w: 0, h: 0 };
  }

  // ── Step 4: apply positions as relative coords within scope ───────────
  // Dagre returns centre-based coordinates relative to the graph origin.
  // We offset child positions by the group padding so they sit inside.
  const offsetX = scopeId !== null ? PAD_X : 0;
  const offsetY = scopeId !== null ? PAD_TOP : 0;

  let maxX = 0;
  let maxY = 0;

  for (const childId of children) {
    const d = g.node(childId);
    if (!d) continue;
    const node = nodeById.get(childId)!;
    const x = d.x - d.width / 2 + offsetX;
    const y = d.y - d.height / 2 + offsetY;
    node.position = { x, y };

    // Pin service node width to the dagre-allocated size so the rendered node
    // never overflows the parent group boundary.
    if ((node.data as any)?.nodeType === 'aws-service') {
      node.style = {
        ...(node.style as Record<string, string> || {}),
        width: `${d.width}px`,
      };
    }

    // Track content extent (excluding padding) for parent size calculation
    maxX = Math.max(maxX, x - offsetX + d.width);
    maxY = Math.max(maxY, y - offsetY + d.height);
  }

  return { w: maxX, h: maxY };
}

// ─── Edge handle updater ───────────────────────────────────────────────────

/**
 * After positions are updated, recalculate sourceHandle / targetHandle on
 * every edge so arrows exit/enter from the geometrically correct side.
 */
function refreshEdgeHandles(
  edges: Edge[],
  nodeById: Map<string, Node>,
): void {
  // Compute absolute (canvas) position of a node's centre
  function absCentre(nodeId: string): { x: number; y: number } {
    const node = nodeById.get(nodeId);
    if (!node) return { x: 0, y: 0 };
    const { w, h } = getDims(node);
    const pos = { x: node.position.x + w / 2, y: node.position.y + h / 2 };
    let cur = node.parentNode as string | undefined;
    while (cur) {
      const parent = nodeById.get(cur);
      if (!parent) break;
      pos.x += parent.position.x;
      pos.y += parent.position.y;
      cur = parent.parentNode as string | undefined;
    }
    return pos;
  }

  for (const edge of edges) {
    const src = absCentre(edge.source);
    const tgt = absCentre(edge.target);
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      edge.sourceHandle = dx >= 0 ? 'right' : 'left';
      edge.targetHandle = dx >= 0 ? 'left' : 'right';
    } else {
      edge.sourceHandle = dy >= 0 ? 'bottom' : 'top';
      edge.targetHandle = dy >= 0 ? 'top' : 'bottom';
    }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Apply a dagre-based hierarchical layout to all nodes in the diagram store.
 * Mutates node positions and group sizes in-place, then increments
 * `diagramVersion` to trigger a full Vue Flow re-render.
 *
 * Safe to call at any time — works on any diagram regardless of complexity.
 */
export function applyDagreLayout(store: Store, fitViewFn?: () => void): void {
  const nodes = store.nodes as Node[];
  const edges = store.edges as Edge[];

  if (nodes.length === 0) return;

  const nodeById = new Map<string, Node>(nodes.map(n => [n.id, n]));

  // Build children map (null key = root level)
  const childrenOf = new Map<string | null, string[]>();
  childrenOf.set(null, []);
  for (const node of nodes) {
    const parent = (node.parentNode as string | undefined) ?? null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(node.id);
    if (!childrenOf.has(node.id)) childrenOf.set(node.id, []);
  }

  // Run the recursive layout
  layoutScope(null, childrenOf, nodeById, edges);

  // Update edge handles to match new positions
  refreshEdgeHandles(edges as Edge[], nodeById);

  // Bump diagramVersion so useVueFlowSync re-renders the whole canvas
  store.diagramVersion++;

  if (fitViewFn) setTimeout(fitViewFn, 150);
}
