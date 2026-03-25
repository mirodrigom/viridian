/**
 * Parser for draw.io / diagrams.net XML files (.drawio, .xml).
 *
 * Structure: <mxfile> → <diagram> → <mxGraphModel> → <root> → <mxCell> elements.
 * Each mxCell is a vertex (shape), edge (connection), or structural element (root/layer).
 *
 * AWS shapes use styles like:
 *   shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;...
 *   shape=mxgraph.aws4.lambda_function;...
 *   shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc;...
 */
import type { SerializedDiagramNode, SerializedDiagramEdge, DiagramEdgeData } from '@/stores/diagrams';
import type { ImportResult, ImportWarning } from './types';
import { DRAWIO_SERVICE_MAP, DRAWIO_GROUP_MAP } from './service-maps';
import { getServiceById, AWS_GROUP_TYPES } from '@/data/aws-services';

// ─── Style parsing ──────────────────────────────────────────────────────────

function parseStyle(style: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!style) return result;
  for (const part of style.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq >= 0) {
      result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    } else {
      // Bare token like "rounded" or "group" — treat as flag
      result[trimmed] = '1';
    }
  }
  return result;
}

// ─── AWS shape identification ───────────────────────────────────────────────

/**
 * Extract the AWS service key from a draw.io style object.
 * Returns the mxgraph.aws4.* suffix or null.
 */
function extractAWSServiceKey(style: Record<string, string>): string | null {
  // Pattern 1: shape=mxgraph.aws4.resourceIcon + resIcon=mxgraph.aws4.<name>
  const resIcon = style.resIcon || style.prIcon;
  if (resIcon) {
    const match = resIcon.match(/mxgraph\.aws[34]\.(.+)/);
    if (match) return (match[1] ?? '').toLowerCase();
  }

  // Pattern 2: shape=mxgraph.aws4.<name> (direct reference)
  const shape = style.shape;
  if (shape) {
    const match = shape.match(/mxgraph\.aws[34]\.(.+)/);
    if (match) {
      const key = (match[1] ?? '').toLowerCase();
      // Skip generic group/resource/product icons — they're handled separately
      if (key === 'resourceicon' || key === 'producticon' || key === 'group') return null;
      return key;
    }
  }

  return null;
}

/**
 * Extract the AWS group type from a draw.io style object.
 * Returns Viridian groupTypeId or null.
 */
function extractAWSGroupType(style: Record<string, string>): string | null {
  // AWS groups use: shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_<type>
  const grIcon = style.grIcon;
  if (grIcon) {
    const match = grIcon.match(/mxgraph\.aws[34]\.group_(.+)/);
    if (match) {
      return DRAWIO_GROUP_MAP[(match[1] ?? '').toLowerCase()] || 'generic';
    }
  }

  // Also check if the shape itself is a group
  const shape = style.shape;
  if (shape) {
    const match = shape.match(/mxgraph\.aws[34]\.group_(.+)/);
    if (match) {
      return DRAWIO_GROUP_MAP[(match[1] ?? '').toLowerCase()] || 'generic';
    }
  }

  return null;
}

// ─── XML parsing helpers ────────────────────────────────────────────────────

function getAttr(el: Element, name: string): string {
  return el.getAttribute(name) || '';
}

function getChildGeometry(cell: Element): { x: number; y: number; width: number; height: number } | null {
  const geo = cell.querySelector('mxGeometry');
  if (!geo) return null;
  return {
    x: parseFloat(getAttr(geo, 'x')) || 0,
    y: parseFloat(getAttr(geo, 'y')) || 0,
    width: parseFloat(getAttr(geo, 'width')) || 0,
    height: parseFloat(getAttr(geo, 'height')) || 0,
  };
}

/** Extract label text from either mxCell value or parent <object>/<UserObject> label. */
function getLabel(cell: Element): string {
  // Check if wrapped in <object> or <UserObject>
  const parent = cell.parentElement;
  if (parent && (parent.tagName === 'object' || parent.tagName === 'UserObject')) {
    return getAttr(parent, 'label') || getAttr(cell, 'value') || '';
  }
  return getAttr(cell, 'value') || '';
}

/** Get the element ID, checking parent <object> wrapper too. */
function getCellId(cell: Element): string {
  const parent = cell.parentElement;
  if (parent && (parent.tagName === 'object' || parent.tagName === 'UserObject')) {
    return getAttr(parent, 'id') || getAttr(cell, 'id');
  }
  return getAttr(cell, 'id');
}

// ─── Decompression ──────────────────────────────────────────────────────────

/**
 * draw.io files may store diagram content as deflate-compressed + base64-encoded text.
 * Try to decompress if it doesn't look like XML.
 */
async function decompressDiagramContent(content: string): Promise<string> {
  const trimmed = content.trim();
  // If it already looks like XML, return as-is
  if (trimmed.startsWith('<')) return trimmed;

  try {
    // Base64 decode
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Inflate (raw deflate, no header)
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();

    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const decoded = new TextDecoder().decode(
      chunks.length === 1 ? chunks[0] : await new Blob(chunks as BlobPart[]).arrayBuffer().then(b => new Uint8Array(b))
    );

    // draw.io also URL-encodes the XML after compression
    try {
      return decodeURIComponent(decoded);
    } catch {
      return decoded;
    }
  } catch {
    // If decompression fails, return original content and let XML parser handle it
    return trimmed;
  }
}

// ─── Main parser ────────────────────────────────────────────────────────────

let nodeCounter = 0;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++nodeCounter}`;
}

export async function parseDrawioXML(xmlText: string): Promise<ImportResult> {
  nodeCounter = 0;
  const warnings: ImportWarning[] = [];
  const nodes: SerializedDiagramNode[] = [];
  const edges: SerializedDiagramEdge[] = [];

  const parser = new DOMParser();
  let doc = parser.parseFromString(xmlText, 'text/xml');

  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    warnings.push({ type: 'parse-error', message: 'Invalid XML: ' + parseError.textContent?.slice(0, 100) });
    return { nodes, edges, warnings, format: 'drawio-xml', stats: { totalShapes: 0, totalConnections: 0, mappedServices: 0, unmappedServices: 0, groups: 0 } };
  }

  // Handle <mxfile> wrapper — take the first <diagram>
  let rootElement: Element | null = null;
  const diagrams = doc.querySelectorAll('diagram');

  if (diagrams.length > 0) {
    const diagramEl = diagrams[0]!;
    const innerXML = diagramEl.textContent || '';

    // Check if content is compressed
    const mxGraphModel = diagramEl.querySelector('mxGraphModel');
    if (mxGraphModel) {
      rootElement = mxGraphModel.querySelector('root');
    } else {
      // Content might be compressed/encoded
      const decompressed = await decompressDiagramContent(innerXML);
      const innerDoc = parser.parseFromString(decompressed, 'text/xml');
      const innerError = innerDoc.querySelector('parsererror');
      if (innerError) {
        warnings.push({ type: 'parse-error', message: 'Failed to decompress diagram content' });
        return { nodes, edges, warnings, format: 'drawio-xml', stats: { totalShapes: 0, totalConnections: 0, mappedServices: 0, unmappedServices: 0, groups: 0 } };
      }
      rootElement = innerDoc.querySelector('mxGraphModel > root') || innerDoc.querySelector('root');
    }
  } else {
    // Maybe the file IS the mxGraphModel directly
    rootElement = doc.querySelector('mxGraphModel > root') || doc.querySelector('root');
  }

  if (!rootElement) {
    warnings.push({ type: 'parse-error', message: 'Could not find <root> element in draw.io XML' });
    return { nodes, edges, warnings, format: 'drawio-xml', stats: { totalShapes: 0, totalConnections: 0, mappedServices: 0, unmappedServices: 0, groups: 0 } };
  }

  // Collect all mxCell elements (including those wrapped in <object>/<UserObject>)
  const allCells: Element[] = [];
  for (const cell of rootElement.querySelectorAll('mxCell')) {
    allCells.push(cell);
  }

  // Map from draw.io cell ID → our node/edge info
  const idMap = new Map<string, string>();
  let mappedServices = 0;
  let unmappedServices = 0;
  let groupCount = 0;

  // First classify all cells
  interface CellInfo {
    cell: Element;
    id: string;
    isVertex: boolean;
    isEdge: boolean;
    isContainer: boolean;
    isGroup: boolean;
    style: Record<string, string>;
    label: string;
    geo: { x: number; y: number; width: number; height: number } | null;
    parentId: string;
    source: string;
    target: string;
  }

  const cellInfos: CellInfo[] = [];
  const structuralIds = new Set(['0', '1']); // Root + default layer

  for (const cell of allCells) {
    const id = getCellId(cell);
    if (!id || structuralIds.has(id)) continue;

    // Additional layers (parent="0") — skip
    if (getAttr(cell, 'parent') === '0' && !getAttr(cell, 'vertex') && !getAttr(cell, 'edge')) continue;

    const style = parseStyle(getAttr(cell, 'style'));
    const isVertex = getAttr(cell, 'vertex') === '1';
    const isEdge = getAttr(cell, 'edge') === '1';
    const isContainer = style.container === '1' || style.swimlane === '1' || style.group === '1';
    const isGroup = isContainer || extractAWSGroupType(style) !== null;

    cellInfos.push({
      cell,
      id,
      isVertex,
      isEdge,
      isContainer: isContainer || isGroup,
      isGroup,
      style,
      label: getLabel(cell).replace(/<[^>]*>/g, ''), // Strip HTML tags
      geo: getChildGeometry(cell),
      parentId: getAttr(cell, 'parent'),
      source: getAttr(cell, 'source'),
      target: getAttr(cell, 'target'),
    });
  }

  // Process vertices first (groups, then services)
  const vertexCells = cellInfos.filter(c => c.isVertex);
  const edgeCells = cellInfos.filter(c => c.isEdge);

  // Sort: groups before services so parent references exist when processing children
  vertexCells.sort((a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    return 0;
  });

  for (const info of vertexCells) {
    const { id, style, label, geo, parentId } = info;

    if (info.isGroup) {
      // ─── Group node ─────────────────────────────────────────────
      const groupTypeId = extractAWSGroupType(style) || 'generic';
      const groupType = AWS_GROUP_TYPES.find(g => g.id === groupTypeId) || AWS_GROUP_TYPES.find(g => g.id === 'generic')!;
      const nodeId = makeId('grp');
      idMap.set(id, nodeId);
      groupCount++;

      const node: SerializedDiagramNode = {
        id: nodeId,
        type: 'aws-group',
        position: { x: geo?.x ?? 0, y: geo?.y ?? 0 },
        data: {
          nodeType: 'aws-group',
          groupTypeId: groupType.id,
          label: groupType.name,
          customLabel: label && label !== groupType.name ? label : '',
          description: groupType.description,
          notes: '',
          groupType,
        },
        style: {
          width: `${geo?.width || 400}px`,
          height: `${geo?.height || 300}px`,
        },
      };

      // Set parent if it's inside another group
      const parentNodeId = idMap.get(parentId);
      if (parentNodeId && parentId !== '1' && parentId !== '0') {
        node.parentNode = parentNodeId;
        node.extent = 'parent';
      }

      nodes.push(node);
    } else {
      // ─── Service node ───────────────────────────────────────────
      const awsKey = extractAWSServiceKey(style);
      const serviceId = awsKey ? DRAWIO_SERVICE_MAP[awsKey] || null : null;
      const service = serviceId ? getServiceById(serviceId) : null;
      const nodeId = makeId('svc');
      idMap.set(id, nodeId);

      const node: SerializedDiagramNode = {
        id: nodeId,
        type: 'aws-service',
        position: { x: geo?.x ?? 0, y: geo?.y ?? 0 },
        data: service
          ? {
              nodeType: 'aws-service',
              serviceId: service.id,
              label: service.name,
              customLabel: label && label !== service.name ? label : '',
              description: service.description,
              notes: '',
              service,
            }
          : {
              nodeType: 'aws-service',
              serviceId: `custom-drawio-${id}`,
              label: label || 'Unknown',
              customLabel: '',
              description: awsKey ? `draw.io shape: mxgraph.aws4.${awsKey}` : 'Imported from draw.io',
              notes: '',
              service: {
                ...(getServiceById('ec2')!),
                id: `custom-drawio-${id}`,
                name: label || 'Unknown',
                shortName: (label || 'Unknown').slice(0, 12),
                color: style.fillColor || '#6B7280',
              },
            },
      };

      if (service) {
        mappedServices++;
      } else {
        unmappedServices++;
        if (awsKey) {
          warnings.push({
            type: 'unmapped-service',
            message: `AWS shape "mxgraph.aws4.${awsKey}" not mapped — imported as custom node "${label || 'Unknown'}"`,
            sourceId: id,
          });
        }
      }

      // Set parent if inside a group
      const parentNodeId = idMap.get(parentId);
      if (parentNodeId && parentId !== '1' && parentId !== '0') {
        node.parentNode = parentNodeId;
        node.extent = 'parent';
      }

      nodes.push(node);
    }
  }

  // ─── Process edges ──────────────────────────────────────────────────────

  for (const info of edgeCells) {
    const { id, source, target, style, label } = info;
    const sourceNodeId = idMap.get(source);
    const targetNodeId = idMap.get(target);

    if (!sourceNodeId || !targetNodeId) {
      if (source && target) {
        warnings.push({
          type: 'missing-connection',
          message: `Edge from ${source} to ${target} — endpoint not found`,
          sourceId: id,
        });
      }
      continue;
    }

    // Map edge style
    const isDashed = style.dashed === '1';
    const lineStyle: 'solid' | 'dashed' | 'dotted' = isDashed ? 'dashed' : 'solid';

    // Map arrow types
    const startArrow = style.startArrow || 'none';
    const endArrow = style.endArrow || 'classic';
    const markerStart = startArrow === 'none' ? 'none' as const : 'arrowclosed' as const;
    const markerEnd = endArrow === 'none' ? 'none' as const : 'arrowclosed' as const;

    // Map edge routing type
    let edgeType: 'default' | 'straight' | 'step' | 'smoothstep' = 'default';
    if (style.edgeStyle?.includes('orthogonal') || style.edgeStyle?.includes('elbow')) {
      edgeType = 'smoothstep';
    } else if (style.edgeStyle?.includes('straight') || style.edgeStyle?.includes('isometric')) {
      edgeType = 'straight';
    }

    const edgeData: DiagramEdgeData = {
      label: label || '',
      style: lineStyle,
      animated: false,
      notes: '',
      edgeType,
      color: style.strokeColor || '',
      markerStart,
      markerEnd,
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
    format: 'drawio-xml',
    stats: {
      totalShapes: vertexCells.length,
      totalConnections: edgeCells.length,
      mappedServices,
      unmappedServices,
      groups: groupCount,
    },
  };
}

/** Quick check if a string looks like a draw.io file. */
export function isDrawioXML(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('<mxfile') || trimmed.startsWith('<mxGraphModel') || trimmed.includes('<mxCell');
}
