/**
 * Kiro CLI Provider Adapter (AWS / Amazon Bedrock).
 *
 * Spawns `kiro-cli chat --no-interactive` and streams the response
 * as SDKMessage events. Kiro outputs plain text in non-interactive mode.
 *
 * Kiro supports:
 * - Non-interactive mode via `--no-interactive`
 * - Session resume via `--resume`
 * - Trust modes: `--trust-all-tools`, `--trust-tools tool1,tool2`
 * - Subagents (delegate, use_subagent built-in tools)
 * - Thinking (experimental built-in tool)
 * - Built-in tools very similar to Claude Code: read, write, glob, grep, shell, web_search, web_fetch
 *
 * Kiro does NOT support:
 * - JSON output for chat (plain text only)
 * - stdin-based control protocol (trust is flag-based)
 * - Image input as CLI flag (images read via `read` tool)
 * - Model selection via CLI flag (uses `chat.defaultModel` setting)
 */

import type {
  IProvider,
  ProviderInfo,
  ProviderModel,
  ProviderCapabilities,
  ProviderQueryOptions,
} from './types.js';
import type { SDKMessage } from '../services/claude-sdk.js';
import { registerProvider } from './registry.js';
import { spawn, execSync, type SpawnOptionsWithoutStdio } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getHomeDir, findBinary as findBinaryInPath, getCommonBinaryPaths, findBinaryInWSL, isWindows } from '../utils/platform.js';

// ─── Kiro output parser ─────────────────────────────────────────────────
// Kiro CLI outputs plain text with ANSI codes. We parse it into structured
// SDKMessage events so the Viridian UI renders tool use, diffs, etc. properly.

/** Strip all ANSI escape codes from a string. */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\][^\x07]*\x07|\x1B\[[\?]?[0-9;]*[a-zA-Z]|[\x00-\x08\x0B\x0E-\x1F]/g, '');
}

/** Tool use pattern: lines ending with "(using tool: <name>)" */
const TOOL_USE_RE = /\(using tool:\s*(\w+)\)\s*$/;

/** Tool completion: " - Completed in X.Xs" */
const TOOL_COMPLETED_RE = /^\s*-\s*Completed in [\d.]+s\s*$/;

/** Tool success: line with ✓ (checkmark character, may have ANSI around it) */
const TOOL_SUCCESS_RE = /[✓✔]/;

/** Tool failure: line with ✗ or ✘ */
const TOOL_FAILURE_RE = /[✗✘]/;

/** Assistant text: lines starting with "> " (Kiro prefixes assistant output with colored "> ") */
const ASSISTANT_PREFIX_RE = /^>\s?/;

/** Map Kiro tool names → Claude tool names for consistent UI rendering. */
const TOOL_NAME_MAP: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  shell: 'Bash',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  thinking: 'Thinking',
  todo: 'TodoWrite',
};

/**
 * Stateful parser that processes raw Kiro stdout lines and calls push()
 * with the appropriate SDKMessage events.
 */
function createKiroParser(push: (msg: SDKMessage) => void) {
  let inToolBlock = false;
  let currentToolName = '';
  let currentToolId = '';
  let toolOutputLines: string[] = [];
  /** Buffer to accumulate partial lines from chunks that don't end with \n */
  let lineBuffer = '';

  function flushTool() {
    if (!inToolBlock) return;
    inToolBlock = false;
    currentToolName = '';
    currentToolId = '';
    toolOutputLines = [];
  }

  function processLine(rawLine: string) {
    const line = stripAnsi(rawLine).trimEnd();
    if (!line) return;

    // Check for tool invocation header: "Reading file: /path (using tool: read)"
    const toolMatch = line.match(TOOL_USE_RE);
    if (toolMatch) {
      // Flush any previous tool block
      flushTool();

      const rawToolName = toolMatch[1]!;
      const toolName = TOOL_NAME_MAP[rawToolName] || rawToolName;
      currentToolName = toolName;
      currentToolId = uuid();
      inToolBlock = true;
      toolOutputLines = [];

      // Extract the description part before "(using tool: ...)"
      const description = line.replace(TOOL_USE_RE, '').trim();

      // Emit a tool_use event with mapped name for consistent UI rendering
      push({
        type: 'tool_use',
        tool: toolName,
        requestId: currentToolId,
        input: { description },
      });
      return;
    }

    // Inside a tool block — accumulate output
    if (inToolBlock) {
      // Tool completion line — emit result and close tool block
      if (TOOL_COMPLETED_RE.test(line)) {
        flushTool();
        return;
      }

      // Tool success/failure status lines — skip (info already in tool_use)
      if (TOOL_SUCCESS_RE.test(line) || TOOL_FAILURE_RE.test(line)) {
        return;
      }

      // "Purpose: ..." line for shell/write tools — skip
      if (line.startsWith('Purpose:')) return;

      // "Creating: ..." line for write tool — skip
      if (line.startsWith('Creating:')) return;

      // Everything else is tool output — skip it (user sees tool_use in trace)
      return;
    }

    // Assistant text: strip the "> " prefix Kiro uses
    const assistantLine = line.replace(ASSISTANT_PREFIX_RE, '');

    // Only emit non-empty assistant text
    if (assistantLine) {
      push({ type: 'text_delta', text: assistantLine + '\n' });
    }
  }

  return {
    /** Feed a raw chunk from stdout. Handles partial lines across chunks. */
    feed(chunk: string) {
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      // Last element may be incomplete (no trailing \n), keep it in buffer
      lineBuffer = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
      }
    },

    /** Flush any remaining buffered content (call on process close). */
    flush() {
      if (lineBuffer) {
        processLine(lineBuffer);
        lineBuffer = '';
      }
      flushTool();
    },
  };
}

// ─── Provider metadata ──────────────────────────────────────────────────

const info: ProviderInfo = {
  id: 'kiro',
  name: 'Kiro',
  icon: 'KiroLogo',
  description: 'AWS Kiro — agentic AI on Amazon Bedrock with steering and custom agents',
  website: 'https://kiro.dev',
  binaryName: 'kiro-cli',
  envVarForPath: 'KIRO_PATH',
  installCommand: 'curl -fsSL https://cli.kiro.dev/install | bash',
  windowsInstallCommand: 'wsl -u root bash -c "apt-get update -qq && apt-get install -y -qq unzip curl" && wsl bash -c "curl -fsSL https://cli.kiro.dev/install | bash"',
};

const models: ProviderModel[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast and capable (via Bedrock)', isDefault: true },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most capable model (via Bedrock)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fastest, lowest cost (via Bedrock)' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: false,         // Thinking tool exists but output is plain text (no structured events)
  supportsToolUse: true,           // read, write, shell, glob, grep, etc.
  supportsPermissionModes: true,   // --trust-all-tools vs --trust-tools
  supportsImages: false,           // No --image flag; reads images via read tool
  supportsResume: true,            // --resume flag
  supportsStreaming: true,
  supportsControlRequests: false,  // Trust is flag-based, not stdin
  supportsSubagents: true,         // delegate, use_subagent tools
  supportsPlanMode: false,
  supportsModelSelection: false,   // No --model flag; uses chat.defaultModel setting
  supportedPermissionModes: ['bypassPermissions', 'default'],
  customFeatures: ['steering', 'custom_agents', 'knowledge_base', 'mcp', 'tangent_mode'],
};

// ─── Binary resolution ──────────────────────────────────────────────────

let resolvedPath: string | null = null;
/** True when the resolved binary lives inside WSL and must be spawned via `wsl`. */
let isWSLBinary = false;

function clearResolvedPath(): void {
  resolvedPath = null;
  isWSLBinary = false;
}

function findKiroBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.KIRO_PATH && existsSync(process.env.KIRO_PATH)) {
    resolvedPath = process.env.KIRO_PATH;
    return resolvedPath;
  }

  const inPath = findBinaryInPath('kiro-cli');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

  // Check common install locations
  const home = getHomeDir();
  const commonPaths = [
    ...getCommonBinaryPaths('kiro-cli'),
    join(home, '.kiro', 'bin', 'kiro-cli'),
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) { resolvedPath = p; return resolvedPath; }
  }

  // On Windows, try WSL as a last resort (Kiro CLI doesn't have a native Windows installer)
  if (isWindows) {
    const wslPath = findBinaryInWSL('kiro-cli');
    if (wslPath) {
      resolvedPath = wslPath;
      isWSLBinary = true;
      return resolvedPath;
    }
  }

  throw new Error(
    isWindows
      ? 'Kiro CLI binary not found. On Windows, install via WSL: wsl bash -c "curl -fsSL https://cli.kiro.dev/install | bash", or set KIRO_PATH env var.'
      : 'Kiro CLI binary not found. Install it with: curl -fsSL https://cli.kiro.dev/install | bash, or set KIRO_PATH env var.',
  );
}

// ─── Permission mode mapping ────────────────────────────────────────────

function getTrustFlags(permissionMode?: string): string[] {
  switch (permissionMode) {
    case 'bypassPermissions':
      return ['--trust-all-tools'];
    case 'default':
    default:
      // Trust core tools, ask for others
      return ['--trust-tools', 'read,glob,grep,web_search,web_fetch,introspect,thinking,todo'];
  }
}

// ─── IProvider implementation ───────────────────────────────────────────

const kiroProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findKiroBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    clearResolvedPath();
    return findKiroBinary();
  },

  isConfigured() {
    // AWS credentials: env vars
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      return { configured: true };
    }
    const home = getHomeDir();
    // ~/.aws/credentials file (aws configure)
    if (existsSync(join(home, '.aws', 'credentials'))) return { configured: true };
    // Kiro-specific auth token (native)
    if (existsSync(join(home, '.kiro', 'auth.json'))) return { configured: true };

    // If running via WSL, check auth inside WSL
    if (isWSLBinary) {
      try {
        const result = execSync('wsl bash -lc "kiro-cli whoami" 2>/dev/null', { encoding: 'utf8', timeout: 10000 }).trim();
        if (result && !result.includes('not logged in') && !result.includes('error')) {
          return { configured: true };
        }
      } catch { /* not authenticated in WSL */ }
    }

    return {
      configured: false,
      reason: 'Kiro is not authenticated. Click Configure to log in.',
    };
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    const kiroBin = findKiroBinary();

    // Build args: kiro-cli chat --no-interactive [trust flags] "prompt"
    const kiroArgs = ['chat', '--no-interactive'];

    // Trust/permission flags
    kiroArgs.push(...getTrustFlags(options.permissionMode));

    // Session resume
    if (options.sessionId) {
      kiroArgs.push('--resume');
    }

    // The prompt goes last as positional argument
    kiroArgs.push(options.prompt);

    // If the binary is inside WSL, spawn via `wsl` with the Linux path
    const spawnCmd = isWSLBinary ? 'wsl' : kiroBin;
    const spawnArgs = isWSLBinary ? [kiroBin, ...kiroArgs] : kiroArgs;

    const proc = spawn(spawnCmd, spawnArgs, {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Abort support
    if (options.abortSignal) {
      const onAbort = () => { proc.kill('SIGTERM'); };
      options.abortSignal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => options.abortSignal!.removeEventListener('abort', onAbort));
    }

    // Emit system event
    yield { type: 'system' };

    // Async message queue
    const queue: (SDKMessage | null)[] = [];
    let resolve: (() => void) | null = null;

    function push(msg: SDKMessage) {
      queue.push(msg);
      if (resolve) { resolve(); resolve = null; }
    }

    function finish() {
      queue.push(null);
      if (resolve) { resolve(); resolve = null; }
    }

    function waitForMessage(): Promise<void> {
      if (queue.length > 0) return Promise.resolve();
      return new Promise<void>(r => { resolve = r; });
    }

    let hasEmittedText = false;

    // Use the structured parser to split tool-use output from assistant text
    const parser = createKiroParser((msg) => {
      hasEmittedText = true;
      push(msg);
    });

    proc.stdout!.on('data', (chunk: Buffer) => {
      parser.feed(chunk.toString());
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      // Kiro prints progress/info to stderr; only emit real errors
      if (text && (text.includes('Error') || text.includes('error:') || text.includes('FAILED'))) {
        push({ type: 'error', error: text });
      }
    });

    proc.on('close', (code) => {
      // Flush any remaining buffered content before emitting result
      parser.flush();

      if (code && code !== 0 && !hasEmittedText) {
        push({ type: 'error', error: `Kiro exited unexpectedly (exit code ${code}).` });
      }

      push({ type: 'result', exitCode: code });
      finish();
    });

    proc.on('error', (err) => {
      push({ type: 'error', error: `Failed to start Kiro: ${err.message}` });
      finish();
    });

    // Yield messages
    while (true) {
      await waitForMessage();
      while (queue.length > 0) {
        const msg = queue.shift()!;
        if (msg === null) return;
        yield msg;
      }
    }
  },

  buildControlResponse(): null {
    // Kiro doesn't support stdin control protocol
    return null;
  },

  getSessionDir(): string | null {
    // Kiro stores sessions per-directory; check global config dir
    const home = getHomeDir();
    const dir = join(home, '.kiro', 'chat');
    return existsSync(dir) ? dir : null;
  },
};

// Auto-register on import
registerProvider(kiroProvider);

export default kiroProvider;
