/**
 * Shared types for diagram importers (Lucid CSV, draw.io XML).
 */
import type { SerializedDiagramNode, SerializedDiagramEdge } from '@/stores/diagrams';

export interface ImportWarning {
  type: 'unmapped-service' | 'unmapped-group' | 'missing-connection' | 'parse-error';
  message: string;
  /** Original element ID from the source file */
  sourceId?: string;
}

export interface ImportResult {
  nodes: SerializedDiagramNode[];
  edges: SerializedDiagramEdge[];
  warnings: ImportWarning[];
  /** Source format that was detected */
  format: 'lucidchart-csv' | 'drawio-xml';
  /** Summary stats */
  stats: {
    totalShapes: number;
    totalConnections: number;
    mappedServices: number;
    unmappedServices: number;
    groups: number;
  };
}
