/**
 * Parser for Lucidchart CSV exports.
 *
 * Lucid's "Export > CSV of Shape Data" produces a CSV with these standard columns:
 *   Id, Name, Shape Library, Page ID, Contained By, Group,
 *   Line Source, Line Destination, Source Arrow, Destination Arrow,
 *   Text Area 1, Text Area 2, Text Area 3, ...custom data columns
 *
 * Shapes: rows where Name ≠ "Line" / "Document" / "Page"
 * Lines:  rows where Name = "Line"
 *
 * NOTE: Lucid CSV does NOT include position/size data.
 * Imported diagrams should be auto-laid out after import.
 */
import type { SerializedDiagramNode, SerializedDiagramEdge, DiagramEdgeData } from '@/stores/diagrams';
import type { ImportResult, ImportWarning } from './types';
import { LUCID_SERVICE_MAP, LUCID_GROUP_MAP, fuzzyMatchService } from './service-maps';
import { getServiceById, AWS_GROUP_TYPES } from '@/data/aws-services';

// ─── CSV parsing ────────────────────────────────────────────────────────────

/** Parse a CSV string into rows of string arrays, handling quoted fields. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field);
        field = '';
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        i++;
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);

  return rows;
}

// ─── Lucid row interface ────────────────────────────────────────────────────

interface LucidRow {
  id: string;
  name: string;
  shapeLibrary: string;
  pageId: string;
  containedBy: string;
  group: string;
  lineSource: string;
  lineDestination: string;
  sourceArrow: string;
  destinationArrow: string;
  textArea1: string;
  textArea2: string;
  textArea3: string;
}

function buildRow(values: string[], headers: string[]): LucidRow {
  const get = (key: string) => {
    const idx = headers.indexOf(key);
    return idx >= 0 && idx < values.length ? values[idx].trim() : '';
  };
  return {
    id: get('Id'),
    name: get('Name'),
    shapeLibrary: get('Shape Library'),
    pageId: get('Page ID'),
    containedBy: get('Contained By'),
    group: get('Group'),
    lineSource: get('Line Source'),
    lineDestination: get('Line Destination'),
    sourceArrow: get('Source Arrow'),
    destinationArrow: get('Destination Arrow'),
    textArea1: get('Text Area 1'),
    textArea2: get('Text Area 2'),
    textArea3: get('Text Area 3'),
  };
}

// ─── Main parser ────────────────────────────────────────────────────────────

let nodeCounter = 0;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nodeCounter}`;
}

export function parseLucidCSV(csvText: string): ImportResult {
  nodeCounter = 0;
  const warnings: ImportWarning[] = [];
  const nodes: SerializedDiagramNode[] = [];
  const edges: SerializedDiagramEdge[] = [];

  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    warnings.push({ type: 'parse-error', message: 'CSV file appears empty or has no data rows' });
    return { nodes, edges, warnings, format: 'lucidchart-csv', stats: { totalShapes: 0, totalConnections: 0, mappedServices: 0, unmappedServices: 0, groups: 0 } };
  }

  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1).map(r => buildRow(r, headers));

  // Separate lines from shapes, skip Document/Page meta rows and Lucid group anchor shapes
  const shapes: LucidRow[] = [];
  const lines: LucidRow[] = [];

  // Lucid creates "Group N" placeholder shapes as anchors for grouped objects.
  // These carry no useful data and should be skipped entirely.
  const isLucidGroupAnchor = (name: string) => /^group\s+\d+$/i.test(name.trim());

  // Pure annotation/diagram shapes that have no AWS equivalent.
  // Import silently (no warning) as custom nodes.
  const SILENT_CUSTOM_SHAPES = new Set([
    'block', 'minimalTextBlock', 'dividedBlock', 'dividerblock',
    'process', 'decision', 'terminator', 'rectangle', 'rectangle container',
    'circle', 'ellipse', 'diamond',
    'minimaltext', 'minimaltextblock', 'textblock', 'text',
    'message', 'annotation',
    'user icon', 'user image', 'user', 'actor',
  ].map(s => s.toLowerCase()));

  for (const row of dataRows) {
    const nameLower = row.name.toLowerCase();
    if (nameLower === 'document' || nameLower === 'page' || !row.id) continue;
    if (isLucidGroupAnchor(row.name)) continue; // skip Lucid group anchors
    if (nameLower === 'line') {
      lines.push(row);
    } else {
      shapes.push(row);
    }
  }

  // Map from Lucid ID → Viridian node ID
  const idMap = new Map<string, string>();
  let mappedServices = 0;
  let unmappedServices = 0;
  let groupCount = 0;

  const isAWSLibrary = (lib: string) => lib.toLowerCase().includes('aws');

  // ─── Process shapes ─────────────────────────────────────────────────────

  // First pass: identify groups (containers)
  const containerIds = new Set<string>();
  for (const shape of shapes) {
    if (shape.containedBy) containerIds.add(shape.containedBy);
  }

  // Also check if shape name matches a known group type
  for (const shape of shapes) {
    const nameLower = shape.name.toLowerCase();
    if (LUCID_GROUP_MAP[nameLower]) {
      containerIds.add(shape.id);
    }
  }

  // Second pass: create nodes
  for (const shape of shapes) {
    const isContainer = containerIds.has(shape.id);
    const nameLower = shape.name.toLowerCase();
    const label = shape.textArea1 || shape.name;

    if (isContainer) {
      // Try to map to a known AWS group type
      const groupTypeId = LUCID_GROUP_MAP[nameLower]
        || (isAWSLibrary(shape.shapeLibrary) ? fuzzyMatchService(shape.name, LUCID_GROUP_MAP) : null)
        || 'generic';

      const groupType = AWS_GROUP_TYPES.find(g => g.id === groupTypeId) || AWS_GROUP_TYPES.find(g => g.id === 'generic')!;
      const nodeId = makeId('grp');
      idMap.set(shape.id, nodeId);
      groupCount++;

      nodes.push({
        id: nodeId,
        type: 'aws-group',
        position: { x: 0, y: 0 }, // Will be auto-laid out
        data: {
          nodeType: 'aws-group',
          groupTypeId: groupType.id,
          label: groupType.name,
          customLabel: label !== shape.name ? label : '',
          description: groupType.description,
          notes: shape.textArea2 || '',
          groupType,
        },
        style: { width: '400px', height: '300px' },
      });
    } else {
      // Try to map to a known AWS service
      let serviceId: string | null = null;

      if (isAWSLibrary(shape.shapeLibrary)) {
        serviceId = fuzzyMatchService(shape.name, LUCID_SERVICE_MAP);
      } else {
        // Try direct name match even without AWS library
        serviceId = LUCID_SERVICE_MAP[nameLower] || null;
      }

      const service = serviceId ? getServiceById(serviceId) : null;
      const nodeId = makeId('svc');
      idMap.set(shape.id, nodeId);

      if (service) {
        mappedServices++;
        nodes.push({
          id: nodeId,
          type: 'aws-service',
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'aws-service',
            serviceId: service.id,
            label: service.name,
            customLabel: label !== service.name && label !== shape.name ? label : '',
            description: service.description,
            notes: shape.textArea2 || '',
            service,
          },
        });
      } else {
        unmappedServices++;
        // Create as custom service node with a placeholder
        const fallbackService = getServiceById('ec2')!; // Use EC2 as visual fallback
        // Only warn for shapes that might be AWS services the user expects to map.
        // Suppress warnings for known annotation / UI shapes with no AWS equivalent.
        if (!SILENT_CUSTOM_SHAPES.has(nameLower)) {
          warnings.push({
            type: 'unmapped-service',
            message: `Unknown shape "${shape.name}" (library: ${shape.shapeLibrary || 'Standard'}) — imported as custom node`,
            sourceId: shape.id,
          });
        }
        nodes.push({
          id: nodeId,
          type: 'aws-service',
          position: { x: 0, y: 0 },
          data: {
            nodeType: 'aws-service',
            serviceId: `custom-lucid-${shape.id}`,
            label: label,
            customLabel: '',
            description: `Imported from Lucidchart: ${shape.name}`,
            notes: shape.textArea2 || '',
            service: {
              ...fallbackService,
              id: `custom-lucid-${shape.id}`,
              name: label,
              shortName: label.slice(0, 12),
              color: '#6B7280',
            },
          },
        });
      }
    }
  }

  // ─── Set parent-child relationships ─────────────────────────────────────

  for (const shape of shapes) {
    if (!shape.containedBy) continue;
    const nodeId = idMap.get(shape.id);
    const parentId = idMap.get(shape.containedBy);
    if (nodeId && parentId) {
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        node.parentNode = parentId;
        node.extent = 'parent';
      }
    }
  }

  // ─── Process lines (edges) ──────────────────────────────────────────────

  for (const line of lines) {
    const sourceNodeId = idMap.get(line.lineSource);
    const targetNodeId = idMap.get(line.lineDestination);

    if (!sourceNodeId || !targetNodeId) {
      if (line.lineSource && line.lineDestination) {
        warnings.push({
          type: 'missing-connection',
          message: `Line from ${line.lineSource} to ${line.lineDestination} — endpoint not found`,
          sourceId: line.id,
        });
      }
      continue;
    }

    const edgeData: DiagramEdgeData = {
      label: line.textArea1 || '',
      style: 'solid',
      animated: false,
      notes: '',
      edgeType: 'default',
      color: '',
      markerStart: line.sourceArrow?.toLowerCase() === 'none' || !line.sourceArrow ? 'none' : 'arrowclosed',
      markerEnd: line.destinationArrow?.toLowerCase() === 'none' ? 'none' : 'arrowclosed',
    };

    edges.push({
      id: makeId('edge'),
      source: sourceNodeId,
      target: targetNodeId,
      data: edgeData,
    });
  }

  return {
    nodes,
    edges,
    warnings,
    format: 'lucidchart-csv',
    stats: {
      totalShapes: shapes.length,
      totalConnections: lines.length,
      mappedServices,
      unmappedServices,
      groups: groupCount,
    },
  };
}

// ─── AI Import helpers ───────────────────────────────────────────────────────

export interface LucidPageInfo {
  id: string;
  name: string;
}

/** Extract the list of pages from a Lucid CSV export. */
export function getLucidPages(csvText: string): LucidPageInfo[] {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1).map(r => buildRow(r, headers));
  return dataRows
    .filter(r => r.name.toLowerCase() === 'page' && r.id)
    .map(r => ({ id: r.id, name: r.textArea1 || `Page ${r.id}` }));
}

// Shape types to skip when summarizing for AI
const SKIP_FOR_AI = new Set([
  'user image', 'user icon', 'user', 'actor',
  'rectangle', 'rectangle container',
  'minimaltextblock', 'minimaltext', 'textblock', 'text',
  'dividedblock', 'dividerblock',
  'annotation',
  'line', 'document', 'page',
]);

/**
 * Build a condensed AI-friendly prompt from a Lucid CSV export.
 * Extracts meaningful AWS services, groups, and connections for the given page.
 * If pageId is omitted, summarizes all pages (capped per page).
 */
export function buildLucidAIPrompt(csvText: string, pageId?: string): string {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return '';

  const headers = rows[0].map(h => h.trim());
  const allRows = rows.slice(1).map(r => buildRow(r, headers));

  const docRow = allRows.find(r => r.name.toLowerCase() === 'document');
  const docTitle = docRow?.textArea1 || 'Architecture Diagram';

  const allPages = allRows
    .filter(r => r.name.toLowerCase() === 'page' && r.id)
    .map(r => ({ id: r.id, name: r.textArea1 || `Page ${r.id}` }));

  const targetPages = pageId
    ? allPages.filter(p => p.id === pageId)
    : allPages;

  if (targetPages.length === 0) return '';

  // id → label map
  const idToLabel = new Map<string, string>();
  for (const row of allRows) {
    if (row.id) idToLabel.set(row.id, row.textArea1 || row.name);
  }

  const pageSections: string[] = [];

  for (const page of targetPages) {
    const pageRows = allRows.filter(r => r.pageId === page.id);

    const meaningful = pageRows.filter(r => {
      if (!r.id) return false;
      const nameLower = r.name.toLowerCase().trim();
      if (SKIP_FOR_AI.has(nameLower)) return false;
      if (/^group\s+\d+$/i.test(nameLower)) return false;
      return true;
    });

    const lines = pageRows.filter(r => r.name.toLowerCase() === 'line');
    if (meaningful.length === 0) continue;

    const shapeDescs: string[] = [];
    for (const shape of meaningful.slice(0, 80)) {
      const label = shape.textArea1 || shape.name;
      let parentLabel = '';
      if (shape.containedBy) {
        const ids = shape.containedBy.split('|');
        const immediateParentId = ids[ids.length - 1];
        parentLabel = idToLabel.get(immediateParentId) || '';
      }
      const parentStr = parentLabel ? ` (in: "${parentLabel}")` : '';
      shapeDescs.push(`  - ${shape.name}: "${label}"${parentStr}`);
    }

    const connDescs: string[] = [];
    for (const line of lines.slice(0, 60)) {
      if (!line.lineSource || !line.lineDestination) continue;
      const srcLabel = idToLabel.get(line.lineSource);
      const tgtLabel = idToLabel.get(line.lineDestination);
      if (!srcLabel || !tgtLabel) continue;
      const connLabel = line.textArea1 ? ` [${line.textArea1}]` : '';
      connDescs.push(`  - "${srcLabel}" → "${tgtLabel}"${connLabel}`);
    }

    const lines2 = [
      `### Page: ${page.name}`,
      `Components (${meaningful.length} total, showing up to 80):`,
      ...shapeDescs,
    ];
    if (connDescs.length > 0) {
      lines2.push('\nConnections:');
      lines2.push(...connDescs);
    }
    pageSections.push(lines2.join('\n'));
  }

  if (pageSections.length === 0) return '';

  return `I'm importing a Lucidchart architecture diagram: "${docTitle}"

${pageSections.join('\n\n')}

Please analyze this architecture and recreate it as a clean, well-organized AWS architecture diagram using diagram commands.

Guidelines:
- Use appropriate AWS service types from the available services
- Organize services within proper group containers (AWS Account, VPC, Security Group, Availability Zone, etc.)
- Include the key connections/data flows between services
- Omit decorative elements (user images, text blocks, dividers)
- If there are "current" and "proposed" sections, focus on the proposed architecture`;
}

/** Quick check if a string looks like a Lucid CSV export. */
export function isLucidCSV(text: string): boolean {
  const firstLine = text.split('\n')[0] || '';
  return firstLine.includes('Id') && firstLine.includes('Name') &&
    (firstLine.includes('Shape Library') || firstLine.includes('Line Source'));
}
