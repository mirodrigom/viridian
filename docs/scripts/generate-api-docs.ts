/**
 * generate-api-docs.ts
 *
 * Auto-generates API reference documentation by parsing the Viridian
 * server route files, WebSocket handlers, and client TypeScript types.
 *
 * Usage:
 *   npx tsx docs/scripts/generate-api-docs.ts
 *
 * Outputs:
 *   docs/reference/api-endpoints.md
 *   docs/reference/websocket-events.md
 *   docs/reference/typescript-types.md
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ──────────────────────────────────────────────────────────────

// Resolve SCRIPT_DIR to the directory containing this script file.
// tsx provides __dirname; native ESM needs import.meta.url.
const SCRIPT_DIR: string =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const SERVER_SRC = path.join(PROJECT_ROOT, 'server/src');
const CLIENT_SRC = path.join(PROJECT_ROOT, 'client/src');
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../reference');

// ─── Helpers ────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    console.warn(`  [skip] Could not read: ${filePath}`);
    return null;
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function escapeMarkdownCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ─── 1. Parse REST Endpoints ────────────────────────────────────────────

interface EndpointInfo {
  method: string;
  path: string;
  description: string;
  auth: string;
}

/**
 * Build the mapping from route filename (without extension) to its mount
 * prefix by parsing server/src/index.ts.
 *
 * Looks for patterns like:
 *   app.use('/api/sessions', sessionsRoutes);
 */
function buildMountMap(): Record<string, string> {
  const indexPath = path.join(SERVER_SRC, 'index.ts');
  const src = readFileSafe(indexPath);
  if (!src) return {};

  const map: Record<string, string> = {};

  // Match:  app.use('/api/something', somethingRoutes);
  const useRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(src)) !== null) {
    const mountPath = m[1]!;
    const importName = m[2]!;
    // Derive the route filename from the import name:
    // e.g. "graphRunsRoutes" -> "graph-runs", "sessionsRoutes" -> "sessions"
    const fileBase = importName
      .replace(/Routes$/, '')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
    map[fileBase] = mountPath;
  }

  // Also capture inline routes defined directly in index.ts
  // e.g. app.get('/api/health', ...)
  const inlineRe = /app\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g;
  const inlineEndpoints: EndpointInfo[] = [];
  while ((m = inlineRe.exec(src)) !== null) {
    inlineEndpoints.push({
      method: m[1]!.toUpperCase(),
      path: m[2]!,
      description: '',
      auth: 'None',
    });
  }

  // Stash inline endpoints on a special key
  (map as any).__inlineEndpoints = inlineEndpoints;

  return map;
}

/**
 * Generate a human-readable fallback description from the HTTP method and
 * route path when no comment was found in the source.
 */
function generateFallbackDescription(method: string, routePath: string): string {
  // Remove leading slash and parameter placeholders for label
  const clean = routePath.replace(/^\//, '').replace(/:[^/]+/g, '').replace(/\/$/, '');
  const segments = clean.split('/').filter(Boolean);
  const resource = segments.map((s) => s.replace(/-/g, ' ')).join(' ');

  switch (method) {
    case 'GET':
      if (routePath === '/') return `List all`;
      if (routePath.includes(':')) return `Get ${resource || 'resource'} by ID`;
      return `Get ${resource || 'resource'}`;
    case 'POST':
      return `Create or trigger ${resource || 'resource'}`;
    case 'PUT':
      return `Update ${resource || 'resource'}`;
    case 'DELETE':
      return `Delete ${resource || 'resource'}`;
    default:
      return '';
  }
}

/**
 * Parse a single route file for router.get/post/put/delete patterns.
 * Extracts:
 *   - HTTP method
 *   - Route path (first argument)
 *   - Description from JSDoc comment or inline comment above the route
 */
function parseRouteFile(filePath: string, mountPrefix: string): EndpointInfo[] {
  const src = readFileSafe(filePath);
  if (!src) return [];

  const lines = src.split('\n');
  const endpoints: EndpointInfo[] = [];

  // Determine auth: look for authMiddleware or agentAuth
  let auth = 'JWT (Bearer token)';
  if (src.includes('agentAuth')) {
    auth = 'JWT or API Key (Bearer ck_...)';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Match: router.get('/path', ...) or router.post('/path', ...)
    const routeMatch = line.match(
      /router\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/,
    );
    if (!routeMatch) continue;

    const method = routeMatch[1]!.toUpperCase();
    const routePath = routeMatch[2]!;
    const fullPath = mountPrefix + (routePath === '/' ? '' : routePath);

    // Look backwards for a description comment
    let description = '';

    // Strategy 1: JSDoc block immediately before this line (or before the handler)
    // Scan upward for /** ... */ blocks
    for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
      const prevLine = lines[j]!.trim();

      // Skip empty lines
      if (prevLine === '') continue;

      // Found end of JSDoc?
      if (prevLine === '*/') {
        // Scan upward for the content and opening /**
        for (let k = j - 1; k >= Math.max(0, j - 20); k--) {
          const docLine = lines[k]!.trim();
          if (docLine.startsWith('/**')) {
            // We have the full block from k to j
            const block = lines
              .slice(k, j + 1)
              .map((l) => l.trim().replace(/^\/?\*+\/?/, '').trim())
              .filter((l) => l.length > 0)
              .join(' ');
            description = block;
            break;
          }
          if (docLine.startsWith('* ')) {
            // Already accumulating
            continue;
          }
        }
        break;
      }

      // Strategy 2: Single-line comment like // GET /:id - description
      if (prevLine.startsWith('//')) {
        description = prevLine
          .replace(/^\/\/\s*/, '')
          .replace(/^(GET|POST|PUT|DELETE)\s+\S+\s*[-—]\s*/i, '')
          .trim();
        break;
      }

      // Strategy 3: section comment like // ─── Profiles ───
      if (prevLine.startsWith('//') && prevLine.includes('───')) {
        description = prevLine.replace(/^\/\/\s*/, '').replace(/─/g, '').trim();
        break;
      }

      // If we hit code (not a comment), stop looking
      if (!prevLine.startsWith('*') && !prevLine.startsWith('//')) {
        break;
      }
    }

    // Clean up JSDoc path annotations from description
    description = description
      .replace(/^(GET|POST|PUT|DELETE)\s+\/\S+\s*/i, '')
      .replace(/^\s*[-—]+\s*/, '')
      .trim();

    // Remove section separator artifacts like "─── Profiles ───..."
    if (/^─/.test(description) || /───/.test(description)) {
      description = description.replace(/─/g, '').trim();
    }

    // Truncate overly long descriptions
    if (description.length > 200) {
      description = description.slice(0, 197) + '...';
    }

    // If no description found, generate a fallback from the route path and method
    if (!description) {
      description = generateFallbackDescription(method, routePath);
    }

    endpoints.push({ method, path: fullPath, description, auth });
  }

  return endpoints;
}

function generateApiEndpointsMd(): string {
  const mountMap = buildMountMap();
  const inlineEndpoints: EndpointInfo[] =
    (mountMap as any).__inlineEndpoints || [];

  // Route files to parse
  const routeFiles = [
    'sessions',
    'git',
    'files',
    'agent',
    'apikeys',
    'tasks',
    'graphs',
    'graph-runs',
    'autopilot',
  ];

  const sections: { name: string; prefix: string; endpoints: EndpointInfo[] }[] = [];

  // Inline routes from index.ts
  if (inlineEndpoints.length > 0) {
    sections.push({
      name: 'Core',
      prefix: '',
      endpoints: inlineEndpoints.map((e) => ({
        ...e,
        description: describeInlineRoute(e.path),
      })),
    });
  }

  for (const file of routeFiles) {
    const filePath = path.join(SERVER_SRC, 'routes', `${file}.ts`);
    // Map "apikeys" -> mount lookup key "apikeys" or try the kebab version
    const lookupKey = file;
    const prefix = mountMap[lookupKey] || mountMap[file.replace(/-/g, '')] || `/api/${file}`;

    const endpoints = parseRouteFile(filePath, prefix);
    if (endpoints.length > 0) {
      const sectionName = file
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      sections.push({ name: sectionName, prefix, endpoints });
    }
  }

  // Build markdown
  let md = `<!-- Auto-generated by scripts/generate-api-docs.ts -- DO NOT EDIT MANUALLY -->
# REST API Endpoints

> Generated: ${timestamp()}

All endpoints require authentication unless noted otherwise. Send a JWT token
or API key in the \`Authorization: Bearer <token>\` header.

---

`;

  for (const section of sections) {
    md += `## ${section.name}\n\n`;
    if (section.prefix) {
      md += `Base path: \`${section.prefix}\`\n\n`;
    }
    md += '| Method | Path | Description | Auth |\n';
    md += '|--------|------|-------------|------|\n';
    for (const ep of section.endpoints) {
      md += `| \`${ep.method}\` | \`${escapeMarkdownCell(ep.path)}\` | ${escapeMarkdownCell(ep.description)} | ${escapeMarkdownCell(ep.auth)} |\n`;
    }
    md += '\n';
  }

  return md;
}

/** Provide descriptions for the few inline routes in index.ts. */
function describeInlineRoute(routePath: string): string {
  const descriptions: Record<string, string> = {
    '/api/health': 'Health check — returns `{ status: "ok", timestamp }}`',
    '/api/version': 'Returns the application version from package.json',
    '/api/me': 'Returns the authenticated user info',
  };
  return descriptions[routePath] || '';
}

// ─── 2. Parse WebSocket Events ──────────────────────────────────────────

interface WsEventInfo {
  eventType: string;
  direction: 'client -> server' | 'server -> client';
  description: string;
}

interface WsEndpointInfo {
  path: string;
  description: string;
  events: WsEventInfo[];
}

/**
 * Parse WS handler files for message types (switch cases, if conditions).
 * Parse client type files for typed interfaces with `type:` literal fields.
 */
function parseWsHandlerFile(filePath: string): WsEventInfo[] {
  const src = readFileSafe(filePath);
  if (!src) return [];

  const events: WsEventInfo[] = [];
  const seen = new Set<string>();

  // Pattern 1: switch case — case 'event_name':
  const caseRe = /case\s+['"](\w+)['"]\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(src)) !== null) {
    const eventType = m[1]!;
    if (!seen.has(`c2s:${eventType}`)) {
      seen.add(`c2s:${eventType}`);
      events.push({
        eventType,
        direction: 'client -> server',
        description: '',
      });
    }
  }

  // Pattern 2: if (data.type === 'event_name') or msg.type === 'event_name'
  const ifRe = /(?:data|msg)\.type\s*===?\s*['"](\w+)['"]/g;
  while ((m = ifRe.exec(src)) !== null) {
    const eventType = m[1]!;
    if (!seen.has(`c2s:${eventType}`)) {
      seen.add(`c2s:${eventType}`);
      events.push({
        eventType,
        direction: 'client -> server',
        description: '',
      });
    }
  }

  // Pattern 3: Server -> Client events forwarded via safeSend
  //   safeSend(ws, { type: 'event_name', ... })
  const safeSendRe = /safeSend\(\s*ws\s*,\s*\{\s*type:\s*['"](\w+)['"]/g;
  while ((m = safeSendRe.exec(src)) !== null) {
    const eventType = m[1]!;
    if (!seen.has(`s2c:${eventType}`)) {
      seen.add(`s2c:${eventType}`);
      events.push({
        eventType,
        direction: 'server -> client',
        description: '',
      });
    }
  }

  // Pattern 4: Event names wired in arrays like: ['run_started', 'node_delta', ...]
  const arrayItemRe = /['"](\w+)['"]\s*[,\]]/g;
  // Only apply inside wireAutopilotEvents / wireRunEvents style blocks
  const wireBlockRe = /const\s+events\s*=\s*\[([\s\S]*?)\]/g;
  let wireMatch: RegExpExecArray | null;
  while ((wireMatch = wireBlockRe.exec(src)) !== null) {
    const block = wireMatch[1]!;
    const itemRe = /['"](\w+)['"]/g;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRe.exec(block)) !== null) {
      const eventType = itemMatch[1]!;
      if (!seen.has(`s2c:${eventType}`)) {
        seen.add(`s2c:${eventType}`);
        events.push({
          eventType,
          direction: 'server -> client',
          description: '',
        });
      }
    }
  }

  // Pattern 5: on('event_name', ...) followed by safeSend
  const onHandlerRe = /on\(\s*['"](\w+)['"]/g;
  while ((m = onHandlerRe.exec(src)) !== null) {
    const eventType = m[1]!;
    // Skip WS lifecycle events that aren't part of the application protocol
    if (['connection', 'close', 'pong', 'ready', 'error', 'message'].includes(eventType)) continue;
    // Check if this is followed by a safeSend (server -> client forwarding)
    const nextChunk = src.slice(m.index, m.index + 300);
    if (nextChunk.includes('safeSend')) {
      if (!seen.has(`s2c:${eventType}`)) {
        seen.add(`s2c:${eventType}`);
        events.push({
          eventType,
          direction: 'server -> client',
          description: '',
        });
      }
    }
  }

  // Pattern 6: JSON.stringify({ type: 'event_name', ... }) — direct sends not via safeSend
  const jsonStringifyRe = /JSON\.stringify\(\s*\{\s*(?:\n\s*)?type:\s*['"](\w+)['"]/g;
  while ((m = jsonStringifyRe.exec(src)) !== null) {
    const eventType = m[1]!;
    if (!seen.has(`s2c:${eventType}`)) {
      seen.add(`s2c:${eventType}`);
      events.push({
        eventType,
        direction: 'server -> client',
        description: '',
      });
    }
  }

  return events;
}

/**
 * Parse client type files for WS protocol interfaces.
 * Looks for interfaces with a `type:` field containing a string literal.
 */
function parseWsTypesFromClientFile(filePath: string): WsEventInfo[] {
  const src = readFileSafe(filePath);
  if (!src) return [];

  const events: WsEventInfo[] = [];
  const seen = new Set<string>();

  // Match interface blocks that have a `type:` field with a literal
  const interfaceRe =
    /export\s+interface\s+(\w+)\s*\{([^}]*)\}/gs;
  let m: RegExpExecArray | null;

  while ((m = interfaceRe.exec(src)) !== null) {
    const interfaceName = m[1]!;
    const body = m[2]!;

    // Look for type: 'literal' or type: 'a' | 'b'
    const typeFieldRe = /type:\s*(['"][^'"]+['"](?:\s*\|\s*['"][^'"]+['"])*)/;
    const typeMatch = body.match(typeFieldRe);
    if (!typeMatch) continue;

    // Extract all literal values
    const literals = typeMatch[1]!.match(/['"]([^'"]+)['"]/g);
    if (!literals) continue;

    // Determine direction from interface name convention
    const isClient =
      interfaceName.startsWith('Ws') &&
      (interfaceName.includes('Client') ||
        interfaceName.includes('StartRun') ||
        interfaceName.includes('StartAdhoc') ||
        interfaceName.includes('PauseRun') ||
        interfaceName.includes('ResumeRun') ||
        interfaceName.includes('AbortRun') ||
        interfaceName.includes('GetRunState') ||
        interfaceName.includes('ResumeFailedRun') ||
        interfaceName.includes('RunGraph'));

    // Check if it appears in a Client or Server union type
    const isInClientUnion = src.includes(`WsClientMessage`) &&
      new RegExp(`WsClientMessage[^;]*${interfaceName}`).test(src);
    const isInServerUnion = src.includes(`WsServerMessage`) &&
      new RegExp(`WsServerMessage[^;]*${interfaceName}`).test(src);
    // Also check autopilot-specific unions
    const isInApClientUnion = src.includes(`WsAutopilotClientMessage`) &&
      new RegExp(`WsAutopilotClientMessage[^;]*${interfaceName}`).test(src);
    const isInApServerUnion = src.includes(`WsAutopilotServerMessage`) &&
      new RegExp(`WsAutopilotServerMessage[^;]*${interfaceName}`).test(src);

    let direction: 'client -> server' | 'server -> client' = 'server -> client';
    if (isClient || isInClientUnion || isInApClientUnion) {
      direction = 'client -> server';
    } else if (isInServerUnion || isInApServerUnion) {
      direction = 'server -> client';
    }

    for (const literal of literals) {
      const eventType = literal.replace(/['"]/g, '');
      const key = `${direction === 'client -> server' ? 'c2s' : 's2c'}:${eventType}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push({
          eventType,
          direction,
          description: `Interface: \`${interfaceName}\``,
        });
      }
    }
  }

  return events;
}

function generateWebSocketEventsMd(): string {
  const wsEndpoints: WsEndpointInfo[] = [
    {
      path: '/ws/chat',
      description:
        'Real-time chat with Claude. Streams assistant responses, thinking, tool calls, and permission requests.',
      events: [],
    },
    {
      path: '/ws/shell',
      description:
        'Terminal PTY session. Streams shell output and accepts keyboard input.',
      events: [],
    },
    {
      path: '/ws/sessions',
      description:
        'File watcher for Claude session JSONL files. Broadcasts updates when sessions change on disk.',
      events: [],
    },
    {
      path: '/ws/graph-runner',
      description:
        'Multi-agent graph execution. Streams node execution progress, delegation, and results.',
      events: [],
    },
    {
      path: '/ws/autopilot',
      description:
        'Dual-Claude autopilot. Streams cycle progress, agent responses, commits, and run lifecycle events.',
      events: [],
    },
  ];

  // Parse WS handler files
  const wsFiles: Record<string, string> = {
    '/ws/chat': 'ws/chat.ts',
    '/ws/shell': 'ws/shell.ts',
    '/ws/sessions': 'ws/sessions.ts',
    '/ws/graph-runner': 'ws/graph-runner.ts',
    '/ws/autopilot': 'ws/autopilot.ts',
  };

  for (const ep of wsEndpoints) {
    const handlerFile = wsFiles[ep.path];
    if (handlerFile) {
      const handlerEvents = parseWsHandlerFile(
        path.join(SERVER_SRC, handlerFile),
      );
      ep.events.push(...handlerEvents);
    }
  }

  // Parse client type files for typed WS protocols
  const clientTypeFiles: Record<string, string> = {
    '/ws/graph-runner': 'types/graph-runner.ts',
    '/ws/autopilot': 'types/autopilot.ts',
  };

  for (const [wsPath, typeFile] of Object.entries(clientTypeFiles)) {
    const typeEvents = parseWsTypesFromClientFile(
      path.join(CLIENT_SRC, typeFile),
    );
    const ep = wsEndpoints.find((e) => e.path === wsPath);
    if (ep) {
      // Merge: prefer type-file descriptions over handler-file ones
      for (const te of typeEvents) {
        const existing = ep.events.find(
          (e) => e.eventType === te.eventType && e.direction === te.direction,
        );
        if (existing) {
          if (te.description && !existing.description) {
            existing.description = te.description;
          } else if (te.description) {
            existing.description += ` / ${te.description}`;
          }
        } else {
          ep.events.push(te);
        }
      }
    }
  }

  // Build markdown
  let md = `<!-- Auto-generated by scripts/generate-api-docs.ts -- DO NOT EDIT MANUALLY -->
# WebSocket Events

> Generated: ${timestamp()}

All WebSocket connections require a \`?token=<jwt>\` query parameter for
authentication. Connections without a valid token are immediately destroyed.

---

`;

  for (const ep of wsEndpoints) {
    md += `## \`${ep.path}\`\n\n`;
    md += `${ep.description}\n\n`;

    // Split events by direction
    const clientToServer = ep.events
      .filter((e) => e.direction === 'client -> server')
      .sort((a, b) => a.eventType.localeCompare(b.eventType));
    const serverToClient = ep.events
      .filter((e) => e.direction === 'server -> client')
      .sort((a, b) => a.eventType.localeCompare(b.eventType));

    if (clientToServer.length > 0) {
      md += '### Client -> Server\n\n';
      md += '| Event Type | Description |\n';
      md += '|------------|-------------|\n';
      for (const e of clientToServer) {
        md += `| \`${e.eventType}\` | ${escapeMarkdownCell(e.description)} |\n`;
      }
      md += '\n';
    }

    if (serverToClient.length > 0) {
      md += '### Server -> Client\n\n';
      md += '| Event Type | Description |\n';
      md += '|------------|-------------|\n';
      for (const e of serverToClient) {
        md += `| \`${e.eventType}\` | ${escapeMarkdownCell(e.description)} |\n`;
      }
      md += '\n';
    }

    if (clientToServer.length === 0 && serverToClient.length === 0) {
      md += '_No typed events extracted._\n\n';
    }
  }

  return md;
}

// ─── 3. Parse TypeScript Types ──────────────────────────────────────────

interface TypeFieldInfo {
  name: string;
  type: string;
  optional: boolean;
}

interface TypeDefinition {
  kind: 'interface' | 'type';
  name: string;
  exported: boolean;
  fields: TypeFieldInfo[];
  rawType?: string; // for type aliases
  sourceFile: string;
}

function parseTypesFromFile(filePath: string): TypeDefinition[] {
  const src = readFileSafe(filePath);
  if (!src) return [];

  const relPath = path.relative(PROJECT_ROOT, filePath);
  const types: TypeDefinition[] = [];

  // Parse exported interfaces
  // Use a more careful extraction that handles nested braces
  const interfaceStartRe = /export\s+interface\s+(\w+)(?:\s+extends\s+[\w,\s<>]+)?\s*\{/g;
  let m: RegExpExecArray | null;

  while ((m = interfaceStartRe.exec(src)) !== null) {
    const name = m[1]!;
    const startBrace = m.index + m[0].length - 1;

    // Find matching closing brace
    let depth = 1;
    let pos = startBrace + 1;
    while (pos < src.length && depth > 0) {
      if (src[pos] === '{') depth++;
      if (src[pos] === '}') depth--;
      pos++;
    }

    const body = src.slice(startBrace + 1, pos - 1);
    const fields = parseInterfaceFields(body);

    types.push({
      kind: 'interface',
      name,
      exported: true,
      fields,
      sourceFile: relPath,
    });
  }

  // Parse exported type aliases
  const typeAliasRe = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g;
  while ((m = typeAliasRe.exec(src)) !== null) {
    const name = m[1]!;
    const rawType = m[2]!.trim();

    types.push({
      kind: 'type',
      name,
      exported: true,
      fields: [],
      rawType,
      sourceFile: relPath,
    });
  }

  // Parse exported const objects (like EDGE_STYLES, NODE_CONFIG, CONNECTION_RULES)
  // We skip these as they are runtime values, not types

  return types;
}

function parseInterfaceFields(body: string): TypeFieldInfo[] {
  const fields: TypeFieldInfo[] = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments, empty lines, nested object type lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Match field: name?: type; or name: type;
    // Handle multi-word types like Record<string, unknown> and union types
    const fieldRe = /^(\w+)(\?)?\s*:\s*(.+?);\s*(?:\/\/.*)?$/;
    const match = trimmed.match(fieldRe);
    if (match) {
      fields.push({
        name: match[1]!,
        type: match[3]!.trim(),
        optional: match[2] === '?',
      });
    }
  }

  return fields;
}

function generateTypeScriptTypesMd(): string {
  const typeFiles = [
    path.join(CLIENT_SRC, 'types/graph.ts'),
    path.join(CLIENT_SRC, 'types/graph-runner.ts'),
    path.join(CLIENT_SRC, 'types/autopilot.ts'),
  ];

  const allTypes: TypeDefinition[] = [];

  for (const filePath of typeFiles) {
    const types = parseTypesFromFile(filePath);
    allTypes.push(...types);
  }

  // Group by source file
  const byFile = new Map<string, TypeDefinition[]>();
  for (const t of allTypes) {
    const existing = byFile.get(t.sourceFile) || [];
    existing.push(t);
    byFile.set(t.sourceFile, existing);
  }

  let md = `<!-- Auto-generated by scripts/generate-api-docs.ts -- DO NOT EDIT MANUALLY -->
# TypeScript Types

> Generated: ${timestamp()}

Exported types and interfaces from the client type definition files.

---

`;

  for (const [file, types] of byFile) {
    const fileName = path.basename(file, '.ts');
    const sectionName = fileName
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    md += `## ${sectionName}\n\n`;
    md += `Source: \`${file}\`\n\n`;

    // Separate type aliases and interfaces
    const typeAliases = types.filter((t) => t.kind === 'type');
    const interfaces = types.filter((t) => t.kind === 'interface');

    // Type aliases
    if (typeAliases.length > 0) {
      md += '### Type Aliases\n\n';
      for (const t of typeAliases) {
        const rawFormatted = formatTypeAlias(t.rawType || '');
        md += `#### \`${t.name}\`\n\n`;
        md += '```typescript\n';
        md += `type ${t.name} = ${rawFormatted};\n`;
        md += '```\n\n';
      }
    }

    // Interfaces
    if (interfaces.length > 0) {
      md += '### Interfaces\n\n';
      for (const t of interfaces) {
        md += `#### \`${t.name}\`\n\n`;
        if (t.fields.length > 0) {
          md += '| Field | Type | Required |\n';
          md += '|-------|------|----------|\n';
          for (const f of t.fields) {
            md += `| \`${f.name}\` | \`${escapeMarkdownCell(f.type)}\` | ${f.optional ? 'No' : 'Yes'} |\n`;
          }
          md += '\n';
        } else {
          md += '_No simple fields extracted (may contain nested/complex types)._\n\n';
        }
      }
    }
  }

  return md;
}

/** Format a type alias value for readability (break union types onto multiple lines). */
function formatTypeAlias(raw: string): string {
  // If it's a short union, keep it on one line
  if (raw.length < 80) return raw;

  // Break long union types onto separate lines
  if (raw.includes('|')) {
    const parts = raw.split('|').map((p) => p.trim()).filter((p) => p.length > 0);
    return '\n  | ' + parts.join('\n  | ');
  }

  return raw;
}

// ─── Main ───────────────────────────────────────────────────────────────

function main() {
  console.log('Generating API documentation...\n');

  ensureDir(OUTPUT_DIR);

  // 1. REST API endpoints
  console.log('[1/3] Parsing REST endpoints...');
  const apiMd = generateApiEndpointsMd();
  const apiPath = path.join(OUTPUT_DIR, 'api-endpoints.md');
  fs.writeFileSync(apiPath, apiMd, 'utf8');
  console.log(`  -> ${path.relative(PROJECT_ROOT, apiPath)}`);

  // 2. WebSocket events
  console.log('[2/3] Parsing WebSocket events...');
  const wsMd = generateWebSocketEventsMd();
  const wsPath = path.join(OUTPUT_DIR, 'websocket-events.md');
  fs.writeFileSync(wsPath, wsMd, 'utf8');
  console.log(`  -> ${path.relative(PROJECT_ROOT, wsPath)}`);

  // 3. TypeScript types
  console.log('[3/3] Parsing TypeScript types...');
  const typesMd = generateTypeScriptTypesMd();
  const typesPath = path.join(OUTPUT_DIR, 'typescript-types.md');
  fs.writeFileSync(typesPath, typesMd, 'utf8');
  console.log(`  -> ${path.relative(PROJECT_ROOT, typesPath)}`);

  console.log('\nDone! Generated 3 files in docs/reference/');
}

main();
