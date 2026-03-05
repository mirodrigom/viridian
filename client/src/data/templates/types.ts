import type { SerializedNode, SerializedEdge } from '@/types/graph';

export type TemplateCategory = 'development' | 'analysis' | 'automation' | 'gaming' | '3d-assets' | '2d-assets' | 'legal' | 'accounting' | 'websites' | 'aws' | 'azure';

export interface GraphTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

export interface TemplateCategoryInfo {
  id: TemplateCategory;
  name: string;
  description: string;
  icon: string;
  color: string;
}
