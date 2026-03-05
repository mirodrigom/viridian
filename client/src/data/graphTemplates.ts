/**
 * Re-export everything from the split template modules.
 * This file exists for backward compatibility — all template logic
 * now lives in `./templates/`.
 */
export {
  GRAPH_TEMPLATES,
  TEMPLATE_CATEGORIES,
  edge,
} from './templates';

export type {
  GraphTemplate,
  TemplateCategory,
  TemplateCategoryInfo,
} from './templates';
