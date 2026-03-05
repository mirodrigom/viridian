/**
 * Graph Resolution — walks the graph to resolve each executable node's connections.
 *
 * Exports: resolveExecutionGraph(), findRootNode(), getEdgeType()
 * Types: GraphNode, GraphEdge, GraphData, ResolvedNode
 */

import { validateDelegationRouting as validateRouting } from '../types/agent-metadata.js';
import type { AgentMetadata } from '../types/agent-metadata.js';
import { debugLog } from './graph-utils.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Resolved node with all connections pre-computed */
export interface ResolvedNode {
  node: GraphNode;
  skills: GraphNode[];
  mcps: GraphNode[];
  rules: GraphNode[];
  delegates: GraphNode[]; // child agents connected via delegation edges
}

// ─── Graph Resolution ───────────────────────────────────────────────────

export function getEdgeType(edge: GraphEdge): string {
  return (edge.data?.edgeType as string) || 'unknown';
}

/**
 * Walk the graph to resolve each executable node's connections.
 * Returns a Map of nodeId -> ResolvedNode.
 */
export function resolveExecutionGraph(graphData: GraphData, options?: { strictRouting?: boolean }): Map<string, ResolvedNode> {
  const nodesById = new Map<string, GraphNode>();
  for (const node of graphData.nodes) {
    nodesById.set(node.id, node);
  }

  const resolved = new Map<string, ResolvedNode>();
  const executableTypes = new Set(['agent', 'subagent', 'expert']);

  for (const node of graphData.nodes) {
    if (!executableTypes.has(node.type)) continue;

    const skills: GraphNode[] = [];
    const mcps: GraphNode[] = [];
    const rules: GraphNode[] = [];
    const delegates: GraphNode[] = [];

    for (const edge of graphData.edges) {
      if (edge.source !== node.id) continue;
      const target = nodesById.get(edge.target);
      if (!target) continue;

      const edgeType = getEdgeType(edge);
      switch (edgeType) {
        case 'delegation':
          delegates.push(target);
          break;
        case 'skill-usage':
          skills.push(target);
          break;
        case 'tool-access':
          mcps.push(target);
          break;
        case 'rule-constraint':
          rules.push(target);
          break;
      }
    }

    // Validate delegation routing constraints
    const nodeLabel = (node.data.label as string) || node.id;
    const nodeMeta = node.data.metadata as AgentMetadata | undefined;
    for (const del of delegates) {
      const delLabel = (del.data.label as string) || del.id;
      const delMeta = del.data.metadata as AgentMetadata | undefined;
      const check = validateRouting(nodeMeta, nodeLabel, delMeta, delLabel);
      if (!check.valid) {
        if (options?.strictRouting) {
          throw new Error(`Routing violation: ${check.reason}`);
        }
        debugLog(`[GraphRunner] ROUTING WARNING: ${check.reason}`);
      }
    }

    resolved.set(node.id, { node, skills, mcps, rules, delegates });
    debugLog(`[GraphRunner] Resolved "${nodeLabel}" (${node.type}): delegates=[${delegates.map(d => d.data.label || d.id).join(', ')}], skills=[${skills.map(s => s.data.label || s.id).join(', ')}], rules=[${rules.map(r => r.data.label || r.id).join(', ')}], mcps=[${mcps.map(m => m.data.label || m.id).join(', ')}]`);
  }

  return resolved;
}

/**
 * Find the root node: an executable node with no incoming delegation edges.
 */
export function findRootNode(graphData: GraphData, resolved: Map<string, ResolvedNode>): GraphNode | null {
  const delegationTargets = new Set<string>();
  for (const edge of graphData.edges) {
    if (getEdgeType(edge) === 'delegation') {
      delegationTargets.add(edge.target);
    }
  }

  const roots: GraphNode[] = [];
  for (const [nodeId, res] of resolved) {
    if (!delegationTargets.has(nodeId)) {
      roots.push(res.node);
    }
  }

  const agentRoot = roots.find(n => n.type === 'agent');
  return agentRoot || roots[0] || null;
}
