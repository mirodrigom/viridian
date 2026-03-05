// Types
export type { TemplateCategory, GraphTemplate, TemplateCategoryInfo } from './types';

// Utilities
export { edge } from './utils';

// Template categories
import type { TemplateCategoryInfo } from './types';

export const TEMPLATE_CATEGORIES: TemplateCategoryInfo[] = [
  { id: 'development', name: 'Development', description: 'Full-stack teams, API design, migrations, and starter templates', icon: 'Code', color: 'bg-chart-2/15 text-chart-2 border-chart-2/30' },
  { id: 'analysis', name: 'Analysis', description: 'Code review, security audits, and performance optimization', icon: 'Search', color: 'bg-chart-4/15 text-chart-4 border-chart-4/30' },
  { id: 'automation', name: 'Automation', description: 'Documentation generators and workflow automation', icon: 'Cog', color: 'bg-chart-5/15 text-chart-5 border-chart-5/30' },
  { id: 'gaming', name: 'Gaming', description: 'Game development teams, jam starters, and game design', icon: 'Gamepad2', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  { id: '3d-assets', name: '3D Assets', description: '3D modeling, shader writing, and asset pipeline management', icon: 'Box', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  { id: '2d-assets', name: '2D Assets', description: 'Sprite creation, UI design, and vector graphics', icon: 'Palette', color: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
  { id: 'legal', name: 'Legal', description: 'Contract review, compliance checking, and IP analysis', icon: 'Scale', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  { id: 'accounting', name: 'Accounting', description: 'Financial analysis, bookkeeping, and tax compliance', icon: 'Calculator', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { id: 'websites', name: 'Websites', description: 'Landing pages, e-commerce, and web project templates', icon: 'Globe', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  { id: 'aws', name: 'AWS', description: 'AWS infrastructure, serverless, and cloud cost optimization', icon: 'Cloud', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { id: 'azure', name: 'Azure', description: 'Azure DevOps, identity, and monitoring pipelines', icon: 'CloudCog', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
];

// Individual template imports
import { fullStackDevTeam } from './full-stack';
import { codeReviewPipeline } from './code-review';
import { simpleStarter } from './simple-starter';
import { securityAuditTeam } from './security-audit';
import { documentationGenerator } from './documentation-generator';
import { migrationAssistant } from './migration-assistant';
import { performanceOptimization } from './performance-optimization';
import { apiDevelopmentTeam } from './api-development';
import { gameDevTeam } from './game-dev';
import { gameJamStarter } from './game-jam';
import { asset3dPipeline } from './asset-3d-pipeline';
import { asset2dPipeline } from './asset-2d-pipeline';
import { contractReviewTeam } from './contract-review';
import { financialAnalysisTeam } from './financial-analysis';
import { landingPageBuilder } from './landing-page';
import { ecommerceSite } from './ecommerce';
import { awsInfrastructureTeam } from './aws-infrastructure';
import { azureCloudTeam } from './azure-cloud';

import type { GraphTemplate } from './types';

// Re-export individual templates
export {
  fullStackDevTeam,
  codeReviewPipeline,
  simpleStarter,
  securityAuditTeam,
  documentationGenerator,
  migrationAssistant,
  performanceOptimization,
  apiDevelopmentTeam,
  gameDevTeam,
  gameJamStarter,
  asset3dPipeline,
  asset2dPipeline,
  contractReviewTeam,
  financialAnalysisTeam,
  landingPageBuilder,
  ecommerceSite,
  awsInfrastructureTeam,
  azureCloudTeam,
};

// Aggregated templates array (same order as the original file)
export const GRAPH_TEMPLATES: GraphTemplate[] = [
  fullStackDevTeam,
  codeReviewPipeline,
  simpleStarter,
  securityAuditTeam,
  documentationGenerator,
  migrationAssistant,
  performanceOptimization,
  apiDevelopmentTeam,
  gameDevTeam,
  gameJamStarter,
  asset3dPipeline,
  asset2dPipeline,
  contractReviewTeam,
  financialAnalysisTeam,
  landingPageBuilder,
  ecommerceSite,
  awsInfrastructureTeam,
  azureCloudTeam,
];
