/**
 * Exporter for draw.io / diagrams.net XML files (.drawio).
 *
 * Produces a valid <mxfile> document from a Viridian serialized diagram.
 * The output is the reverse of drawio-parser.ts: Viridian node/edge data
 * is mapped back to mxgraph.aws4.* shapes and group styles.
 */

import type { SerializedDiagramNode, SerializedDiagramEdge, AWSServiceNodeData, AWSGroupNodeData } from '@/stores/diagrams';
import { DRAWIO_SERVICE_MAP, DRAWIO_GROUP_MAP } from '@/lib/import/service-maps';
import { getServiceById } from '@/data/aws-services';

// ─── Reverse maps ─────────────────────────────────────────────────────────────

/**
 * Curated map of Viridian serviceId → known-good draw.io stencil shape key.
 * These are the exact mxgraph.aws4.* shape names that render correctly as
 * direct shape= values in draw.io. Verified against draw.io's AWS4 stencil library.
 */
const PREFERRED_DRAWIO_SHAPES: Record<string, string> = {
  // Compute
  'ec2': 'ec2',
  'lambda': 'lambda_function',
  'lightsail': 'lightsail',
  'elastic-beanstalk': 'elastic_beanstalk',
  // Containers
  'ecs': 'ecs',
  'eks': 'eks',
  'fargate': 'fargate',
  // Storage
  's3': 's3',
  'ebs': 'elastic_block_store',
  'efs': 'elastic_file_system',
  'glacier': 's3_glacier',
  // Database
  'rds': 'rds',
  'dynamodb': 'dynamodb',
  'aurora': 'aurora',
  'elasticache': 'elasticache',
  'redshift': 'redshift',
  'documentdb': 'documentdb_with_mongodb_compatibility',
  // Networking
  'vpc': 'vpc',
  'cloudfront': 'cloudfront',
  'route53': 'route_53',
  'elb': 'elastic_load_balancing',
  'api-gateway': 'api_gateway',
  'direct-connect': 'direct_connect',
  'transit-gateway': 'transit_gateway',
  // Security
  'iam': 'identity_and_access_management',
  'cognito': 'cognito',
  'waf': 'waf',
  'kms': 'key_management_service',
  'secrets-manager': 'secrets_manager',
  // AI/ML
  'sagemaker': 'sagemaker',
  'bedrock': 'bedrock',
  'rekognition': 'rekognition',
  // Analytics
  'kinesis': 'kinesis',
  'athena': 'athena',
  'glue': 'glue',
  'opensearch': 'opensearch_service',
  // Management
  'cloudwatch': 'cloudwatch',
  'cloudformation': 'cloudformation',
  'cloudtrail': 'cloudtrail',
  'systems-manager': 'systems_manager',
  // Integration
  'sqs': 'sqs',
  'sns': 'sns',
  'step-functions': 'step_functions',
  'eventbridge': 'eventbridge',
  'mq': 'mq',
  // Developer Tools
  'codepipeline': 'codepipeline',
  'codecommit': 'codecommit',
  'codebuild': 'codebuild',
  'cdk': 'cloud_development_kit',
};

/**
 * Viridian serviceId → mxgraph.aws4 shape key.
 * Uses the curated PREFERRED_DRAWIO_SHAPES map first, then falls back to
 * the shortest key from DRAWIO_SERVICE_MAP.
 */
const SERVICE_TO_DRAWIO: Record<string, string> = (() => {
  // Start with auto-generated reverse map (shortest key wins)
  const result: Record<string, string> = {};
  for (const [drawioKey, serviceId] of Object.entries(DRAWIO_SERVICE_MAP)) {
    if (!(serviceId in result)) {
      result[serviceId] = drawioKey;
    } else {
      const existing = result[serviceId]!;
      if (drawioKey.length < existing.length) {
        result[serviceId] = drawioKey;
      }
    }
  }
  // Override with curated shapes that are verified to work in draw.io
  Object.assign(result, PREFERRED_DRAWIO_SHAPES);
  return result;
})();

/**
 * Viridian groupTypeId → mxgraph.aws4 group icon suffix.
 * Built by inverting DRAWIO_GROUP_MAP.
 */
const GROUP_TO_DRAWIO: Record<string, string> = (() => {
  const result: Record<string, string> = {};
  for (const [drawioSuffix, groupTypeId] of Object.entries(DRAWIO_GROUP_MAP)) {
    if (!(groupTypeId in result)) {
      result[groupTypeId] = drawioSuffix;
    }
  }
  return result;
})();

// ─── AWS category → draw.io fill color ────────────────────────────────────────
// These match the official AWS Architecture Icon color palette used in draw.io stencils.

const CATEGORY_FILL_COLORS: Record<string, string> = {
  Compute: '#ED7100',
  Storage: '#3F8624',
  Database: '#C925D1',
  Networking: '#8C4FFF',
  Security: '#DD344C',
  'AI/ML': '#01A88D',
  Analytics: '#8C4FFF',
  Management: '#E7157B',
  Integration: '#E7157B',
  'Developer Tools': '#C925D1',
  Containers: '#ED7100',
};

// ─── Style builders ───────────────────────────────────────────────────────────

/**
 * Build the mxCell style string for a service node.
 * Uses shape=mxgraph.aws4.<key> directly (the actual stencil shape), with
 * proper AWS category fill colors and label positioning below the icon.
 */
function buildServiceStyle(serviceId: string): string {
  const drawioKey = SERVICE_TO_DRAWIO[serviceId];

  if (drawioKey) {
    // Look up the service to get its category color
    const service = getServiceById(serviceId);
    const fillColor = service
      ? (CATEGORY_FILL_COLORS[service.category] || '#FF9900')
      : '#FF9900';

    return [
      'outlineConnect=0',
      'fontColor=#232F3E',
      'gradientColor=none',
      `fillColor=${fillColor}`,
      'strokeColor=none',
      'dashed=0',
      'verticalLabelPosition=bottom',
      'verticalAlign=top',
      'align=center',
      'html=1',
      'fontSize=12',
      'fontStyle=0',
      'aspect=fixed',
      'pointerEvents=1',
      `shape=mxgraph.aws4.${drawioKey}`,
    ].join(';') + ';';
  }

  // Custom / unmapped service — use a simple rounded rectangle
  return [
    'rounded=1',
    'whiteSpace=wrap',
    'html=1',
    'fillColor=#f5f5f5',
    'strokeColor=#666666',
    'fontColor=#333333',
    'fontSize=11',
  ].join(';') + ';';
}

/**
 * Build the mxCell style string for a group node.
 * Uses the official draw.io AWS group stencil format with proper colors,
 * dashed borders, and spacingLeft for the group icon.
 */
function buildGroupStyle(groupTypeId: string): string {
  const drawioSuffix = GROUP_TO_DRAWIO[groupTypeId];

  // Official draw.io AWS group styles: stroke color, font color, and whether dashed
  const groupStyles: Record<string, { stroke: string; font: string; dashed: boolean }> = {
    'account':          { stroke: '#232F3E', font: '#232F3E', dashed: false },
    'region':           { stroke: '#00A4A6', font: '#147EBA', dashed: true },
    'vpc':              { stroke: '#8CC04F', font: '#AAB7B8', dashed: false },
    'availability-zone':{ stroke: '#007CBC', font: '#007CBC', dashed: true },
    'subnet-public':    { stroke: '#8CC04F', font: '#AAB7B8', dashed: false },
    'subnet-private':   { stroke: '#8C4FFF', font: '#AAB7B8', dashed: false },
    'security-group':   { stroke: '#DD344C', font: '#DD344C', dashed: true },
    'auto-scaling':     { stroke: '#ED7100', font: '#ED7100', dashed: true },
    'generic':          { stroke: '#5A6C86', font: '#5A6C86', dashed: true },
  };

  const style = groupStyles[groupTypeId] || groupStyles['generic']!;

  if (drawioSuffix) {
    return [
      'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]]',
      'outlineConnect=0',
      'gradientColor=none',
      'html=1',
      'whiteSpace=wrap',
      'fontSize=12',
      'fontStyle=1',
      'container=1',
      'pointerEvents=0',
      'collapsible=0',
      'recursiveResize=0',
      'shape=mxgraph.aws4.group',
      `grIcon=mxgraph.aws4.group_${drawioSuffix}`,
      `strokeColor=${style.stroke}`,
      'fillColor=none',
      'verticalAlign=top',
      'align=left',
      'spacingLeft=30',
      `fontColor=${style.font}`,
      `dashed=${style.dashed ? '1' : '0'}`,
    ].join(';') + ';';
  }

  // Generic container (no specific AWS group icon)
  return [
    'points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]]',
    'outlineConnect=0',
    'gradientColor=none',
    'html=1',
    'whiteSpace=wrap',
    'fontSize=12',
    'fontStyle=1',
    'container=1',
    'pointerEvents=0',
    'collapsible=0',
    'recursiveResize=0',
    'rounded=1',
    'fillColor=none',
    `strokeColor=${style.stroke}`,
    `fontColor=${style.font}`,
    'verticalAlign=top',
    'align=left',
    'spacingLeft=10',
    `dashed=${style.dashed ? '1' : '0'}`,
  ].join(';') + ';';
}

/**
 * Build the mxCell style string for an edge.
 */
function buildEdgeStyle(
  edgeType: string,
  lineStyle: string,
  markerStart: string,
  markerEnd: string,
  color: string,
): string {
  const parts: string[] = [];

  // Routing
  if (edgeType === 'smoothstep' || edgeType === 'step') {
    parts.push('edgeStyle=orthogonalEdgeStyle');
  } else if (edgeType === 'straight') {
    parts.push('edgeStyle=none');
  } else {
    parts.push('edgeStyle=orthogonalEdgeStyle');
    parts.push('curved=1');
  }

  // Line style
  if (lineStyle === 'dashed') parts.push('dashed=1', 'dashPattern=8 4');
  else if (lineStyle === 'dotted') parts.push('dashed=1', 'dashPattern=2 4');

  // Arrows
  parts.push(`startArrow=${markerStart === 'none' ? 'none' : 'classic'}`);
  parts.push(`endArrow=${markerEnd === 'none' ? 'none' : 'classic'}`);
  if (markerStart !== 'none') parts.push('startFill=1');
  if (markerEnd !== 'none') parts.push('endFill=1');

  // Colour
  if (color) {
    parts.push(`strokeColor=${color}`);
    parts.push(`fontColor=${color}`);
  }

  parts.push('html=1', 'exitX=0.5', 'exitY=1', 'exitDx=0', 'exitDy=0', 'entryX=0.5', 'entryY=0', 'entryDx=0', 'entryDy=0');

  return parts.join(';') + ';';
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function attrs(obj: Record<string, string | number | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
    .join(' ');
}

// ─── Main exporter ────────────────────────────────────────────────────────────

export interface DrawioExportOptions {
  diagramName?: string;
}

/**
 * Convert serialized Viridian diagram data into a draw.io XML string.
 *
 * Parent-child nesting is preserved by using draw.io's `parent` attribute.
 * Nodes without a Viridian `parentNode` use parent="1" (the default layer).
 */
export function exportToDrawio(
  nodes: SerializedDiagramNode[],
  edges: SerializedDiagramEdge[],
  options: DrawioExportOptions = {},
): string {
  const diagramName = escapeXml(options.diagramName || 'Page-1');
  const cells: string[] = [];

  // Standard structural cells
  cells.push(`    <mxCell id="0"/>`);
  cells.push(`    <mxCell id="1" parent="0"/>`);

  // Build a lookup: Viridian node id → draw.io cell id (we reuse Viridian IDs, they're already unique)
  // Also track which nodes are groups so we can set parent correctly.
  const groupIds = new Set(nodes.filter(n => n.type === 'aws-group').map(n => n.id));

  // Sort nodes: groups before services so parent references exist when draw.io renders
  const sortedNodes = [...nodes].sort((a, b) => {
    const aIsGroup = groupIds.has(a.id) ? 0 : 1;
    const bIsGroup = groupIds.has(b.id) ? 0 : 1;
    return aIsGroup - bIsGroup;
  });

  for (const node of sortedNodes) {
    const parentId = node.parentNode && groupIds.has(node.parentNode)
      ? node.parentNode
      : '1';

    // Resolve dimensions from style (e.g. "400px" → 400)
    const styleW = node.style?.width ? parseFloat(node.style.width) : undefined;
    const styleH = node.style?.height ? parseFloat(node.style.height) : undefined;

    if (node.type === 'aws-group') {
      const data = node.data as AWSGroupNodeData;
      const label = data.customLabel || data.label || '';
      const style = buildGroupStyle(data.groupTypeId);
      const width = styleW || 400;
      const height = styleH || 300;

      cells.push(
        `    <mxCell id="${escapeXml(node.id)}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="${escapeXml(parentId)}">\n` +
        `      <mxGeometry x="${node.position.x}" y="${node.position.y}" width="${width}" height="${height}" as="geometry"/>\n` +
        `    </mxCell>`,
      );
    } else {
      // aws-service
      const data = node.data as AWSServiceNodeData;
      const label = data.customLabel || data.label || '';
      const style = buildServiceStyle(data.serviceId);
      const width = styleW || 60;
      const height = styleH || 60;

      cells.push(
        `    <mxCell id="${escapeXml(node.id)}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="${escapeXml(parentId)}">\n` +
        `      <mxGeometry x="${node.position.x}" y="${node.position.y}" width="${width}" height="${height}" as="geometry"/>\n` +
        `    </mxCell>`,
      );
    }
  }

  // Edges
  for (const edge of edges) {
    const data = edge.data;
    const style = buildEdgeStyle(
      data.edgeType,
      data.style,
      data.markerStart,
      data.markerEnd,
      data.color,
    );
    const label = data.label || '';

    const edgeAttrs = attrs({
      id: edge.id,
      value: label,
      style,
      edge: '1',
      source: edge.source,
      target: edge.target,
      parent: '1',
    });

    cells.push(
      `    <mxCell ${edgeAttrs}>\n` +
      `      <mxGeometry relative="1" as="geometry"/>\n` +
      `    </mxCell>`,
    );
  }

  const cellsXml = cells.join('\n');

  return [
    `<mxfile host="Viridian" modified="${new Date().toISOString()}" version="21.0.0">`,
    `  <diagram name="${diagramName}">`,
    `    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">`,
    `      <root>`,
    cellsXml,
    `      </root>`,
    `    </mxGraphModel>`,
    `  </diagram>`,
    `</mxfile>`,
  ].join('\n');
}
