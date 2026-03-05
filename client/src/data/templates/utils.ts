import type { SerializedEdge, GraphEdgeData } from '@/types/graph';

/**
 * Helper: create edge with proper handles & data.
 */
export function edge(
  source: string,
  target: string,
  type: GraphEdgeData['edgeType'],
): SerializedEdge {
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    sourceHandle: `${type}-out`,
    targetHandle: `${type}-in`,
    data: {
      edgeType: type,
      label: type.replace(/-/g, ' '),
      animated: type === 'delegation' || type === 'data-flow',
    },
  };
}
