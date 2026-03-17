/**
 * OpenAI Codex CLI Provider Adapter.
 *
 * Spawns the `codex` CLI with `codex exec --json` and normalizes
 * Codex JSONL events into SDKMessage events.
 *
 * Codex supports:
 * - JSONL streaming via `--json`
 * - Session resume via `codex exec resume <SESSION_ID>`
 * - Permission control via `--ask-for-approval` and `--sandbox` flags
 * - Image input via `--image`
 *
 * Codex does NOT support:
 * - Extended thinking (reasoning traces exist but different from Claude's)
 * - stdin-based control protocol (permissions are flag-based)
 * - Sub-agents
 * - Plan mode
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
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getHomeDir, findBinary as findBinaryInPath, getCommonBinaryPaths } from '../utils/platform.js';

// ─── Provider metadata ──────────────────────────────────────────────────

const info: ProviderInfo = {
  id: 'codex',
  name: 'Codex',
  icon: 'CodexLogo',
  description: 'OpenAI Codex CLI — agentic coding with GPT models',
  website: 'https://developers.openai.com/codex/cli/',
  binaryName: 'codex',
  envVarForPath: 'CODEX_PATH',
  installCommand: 'npm install -g @openai/codex',
};

const models: ProviderModel[] = [
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Most capable agentic coding model', isDefault: true },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', description: 'Ultra-low-latency (ChatGPT Pro only)' },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'Previous flagship — stable' },
  { id: 'gpt-5.2', label: 'GPT-5.2', description: 'General purpose GPT-5.2' },
  { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', description: 'Previous gen — reliable' },
  { id: 'gpt-5', label: 'GPT-5', description: 'Base GPT-5 model' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: false,
  supportsToolUse: true,
  supportsPermissionModes: true,
  supportsImages: true,
  supportsResume: true,
  supportsStreaming: true,
  supportsControlRequests: false, // Permissions are flag-based, not stdin-based
  supportsSubagents: false,
  supportsPlanMode: false,
  supportedPermissionModes: ['bypassPermissions', 'default'],
  customFeatures: ['sandbox_modes', 'full_auto'],
};

// ─── Binary resolution ──────────────────────────────────────────────────

let resolvedPath: string | null = null;

function findCodexBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.CODEX_PATH && existsSync(process.env.CODEX_PATH)) {
    resolvedPath = process.env.CODEX_PATH;
    return resolvedPath;
  }

  const inPath = findBinaryInPath('codex');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

  // Check common install locations
  const home = getHomeDir();
  const commonPaths = [
    ...getCommonBinaryPaths('codex'),
    join(home, '.npm-global', 'bin', 'codex'),
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) { resolvedPath = p; return resolvedPath; }
  }

  throw new Error(
    'Codex CLI binary not found. Install it with: npm install -g @openai/codex, or set CODEX_PATH env var.',
  );
}

// ─── Permission mode mapping ────────────────────────────────────────────

function getApprovalFlags(permissionMode?: string): string[] {
  switch (permissionMode) {
    case 'bypassPermissions':
      // Full auto: auto-approve + workspace write access
      return ['--full-auto'];
    case 'default':
    default:
      // Default: ask for out-of-scope actions, workspace write
      return ['--ask-for-approval', 'on-request', '--sandbox', 'workspace-write'];
  }
}

// ─── IProvider implementation ───────────────────────────────────────────

const codexProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findCodexBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    return findCodexBinary();
  },

  isConfigured() {
    // Check for API key env vars
    if (process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY) return { configured: true };
    // Check for ~/.codex/ config directory (like Claude checks ~/.claude/)
    const home = getHomeDir();
    if (existsSync(join(home, '.codex'))) return { configured: true };
    return {
      configured: false,
      reason: 'Codex credentials not found. Run `codex` in your terminal to authenticate, or set CODEX_API_KEY.',
    };
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    const codexBin = findCodexBinary();

    // Build args: codex exec --json [flags] "prompt"
    const args = ['exec', '--json'];

    // Permission/sandbox flags
    args.push(...getApprovalFlags(options.permissionMode));

    if (options.model) {
      args.push('--model', options.model);
    }

    // Session resume: codex exec resume <SESSION_ID> --json "prompt"
    if (options.sessionId) {
      args.push('resume', options.sessionId);
    }

    // Image support
    if (options.images && options.images.length > 0) {
      for (const img of options.images) {
        // Codex expects file paths for --image; dataUrl images would need
        // to be written to temp files. For now, skip inline data URLs.
        if (!img.dataUrl.startsWith('data:')) {
          args.push('--image', img.dataUrl);
        }
      }
    }

    // The prompt goes last
    args.push(options.prompt);

    const proc = spawn(codexBin, args, {
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Required for .cmd files on Windows
    });

    // Abort support
    if (options.abortSignal) {
      const onAbort = () => { proc.kill('SIGTERM'); };
      options.abortSignal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => options.abortSignal!.removeEventListener('abort', onAbort));
    }

    // Notify stdin is ready (even though Codex doesn't use stdin control)
    if (options.onStdinReady) {
      options.onStdinReady((data: string) => {
        proc.stdin?.write(data);
      });
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

    let buffer = '';
    let capturedSessionId: string | undefined;
    let stderrBuffer = '';
    let hasEmittedText = false;
    let hasEmittedError = false;

    // Real-time streaming — process each line as it arrives (same pattern as Claude)
    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const msgs = processCodexEvent(event);
          for (const msg of msgs) {
            if (msg.type === 'system' && msg.sessionId) capturedSessionId = msg.sessionId;
            if (msg.type === 'error') {
              // Skip transient reconnection noise; emit real errors immediately
              const errText = msg.error as string;
              if (errText.startsWith('Reconnecting')) continue;
              const clean = errText.includes('401') || errText.includes('Unauthorized')
                ? 'OpenAI 401 Unauthorized — your API key may be invalid. Check your key in Settings → Providers.'
                : errText;
              hasEmittedError = true;
              push({ type: 'error', error: clean });
            } else {
              if (msg.type === 'text_delta') hasEmittedText = true;
              push(msg);
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => { stderrBuffer += chunk.toString(); });

    proc.on('close', (code) => {
      // Flush any remaining buffered line
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          const msgs = processCodexEvent(event);
          for (const msg of msgs) {
            if (msg.type === 'system' && msg.sessionId) capturedSessionId = msg.sessionId;
            if (msg.type === 'error') {
              const errText = msg.error as string;
              if (!errText.startsWith('Reconnecting')) {
                hasEmittedError = true;
                push({ type: 'error', error: errText });
              }
            } else {
              if (msg.type === 'text_delta') hasEmittedText = true;
              push(msg);
            }
          }
        } catch { /* ignore */ }
      }

      // Stderr fallback
      if (stderrBuffer.trim() && !hasEmittedError) {
        const errText = extractCodexError(stderrBuffer);
        if (errText) {
          hasEmittedError = true;
          push({ type: 'error', error: errText });
        }
      }

      if (code && code !== 0 && !hasEmittedText && !hasEmittedError) {
        push({ type: 'error', error: `Codex exited unexpectedly (exit code ${code}).` });
      }

      push({ type: 'result', sessionId: capturedSessionId, exitCode: code });
      finish();
    });

    proc.on('error', (err) => {
      push({ type: 'error', error: `Failed to start Codex: ${err.message}` });
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
    // Codex doesn't support stdin control protocol
    return null;
  },

  getSessionDir(): string | null {
    // Codex stores sessions in ~/.codex/sessions/
    const home = getHomeDir();
    const dir = join(home, '.codex', 'sessions');
    return existsSync(dir) ? dir : null;
  },
};

// ─── Codex JSONL event normalization ────────────────────────────────────

function processCodexEvent(event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];
  const eventType = event.type as string | undefined;

  // thread.started — session initialization
  if (eventType === 'thread.started') {
    const threadId = event.thread_id as string | undefined;
    if (threadId) {
      messages.push({ type: 'system', sessionId: threadId });
    }
    return messages;
  }

  // turn.completed — contains usage info
  if (eventType === 'turn.completed') {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      if (usage.input_tokens) {
        messages.push({ type: 'message_start', inputTokens: usage.input_tokens as number });
      }
      if (usage.output_tokens) {
        messages.push({ type: 'message_delta', outputTokens: usage.output_tokens as number });
      }
    }
    return messages;
  }

  // turn.failed — error during processing
  if (eventType === 'turn.failed') {
    const error = event.error as string | Record<string, unknown> | undefined;
    const errMsg = typeof error === 'string'
      ? error
      : (error as Record<string, unknown>)?.message as string || 'Turn failed';
    messages.push({ type: 'error', error: errMsg });
    return messages;
  }

  // item.completed — the main content events
  if (eventType === 'item.completed') {
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) return messages;

    const itemType = item.type as string;

    // Item-level error (e.g. model metadata warning) — treat as error message
    if (itemType === 'error') {
      const msg = item.message as string | undefined;
      if (msg) messages.push({ type: 'error', error: msg });
      return messages;
    }

    // Agent text message
    if (itemType === 'agent_message') {
      const text = item.text as string | undefined;
      if (text) {
        messages.push({ type: 'text_delta', text });
      }
      return messages;
    }

    // Reasoning trace
    if (itemType === 'reasoning') {
      const text = item.text as string | undefined;
      if (text) {
        // Emit as thinking since it's reasoning content
        messages.push({ type: 'thinking_start' });
        messages.push({ type: 'thinking_delta', text });
        messages.push({ type: 'thinking_end' });
      }
      return messages;
    }

    // Command execution
    if (itemType === 'command_execution') {
      const command = item.command as string | undefined;
      const output = item.output as string | undefined;
      const exitCode = item.exit_code as number | undefined;
      messages.push({
        type: 'tool_use',
        tool: 'Bash',
        requestId: (item.id as string) || uuid(),
        input: {
          command: command || '',
          output: output || '',
          exitCode: exitCode ?? 0,
        },
      });
      return messages;
    }

    // File change
    if (itemType === 'file_change') {
      const filePath = item.file_path as string || item.path as string || '';
      const diff = item.diff as string || item.content as string || '';
      messages.push({
        type: 'tool_use',
        tool: 'Edit',
        requestId: (item.id as string) || uuid(),
        input: {
          file_path: filePath,
          diff,
        },
      });
      return messages;
    }

    // MCP tool call
    if (itemType === 'mcp_tool_call') {
      messages.push({
        type: 'tool_use',
        tool: (item.tool_name as string) || (item.name as string) || 'mcp_tool',
        requestId: (item.id as string) || uuid(),
        input: (item.arguments as Record<string, unknown>) || (item.input as Record<string, unknown>) || {},
      });
      return messages;
    }

    // Web search
    if (itemType === 'web_search') {
      messages.push({
        type: 'tool_use',
        tool: 'WebSearch',
        requestId: (item.id as string) || uuid(),
        input: {
          query: (item.query as string) || '',
          results: item.results || [],
        },
      });
      return messages;
    }

    // Todo list / plan
    if (itemType === 'todo_list') {
      const text = item.text as string || JSON.stringify(item.items || []);
      messages.push({ type: 'text_delta', text: `\n**Plan:**\n${text}\n` });
      return messages;
    }

    // Unknown item type — drop silently (avoid polluting chat with debug JSON)
    return messages;
  }

  // item.started — no action; wait for item.completed
  if (eventType === 'item.started') {
    return messages;
  }

  // turn.started — no action needed
  if (eventType === 'turn.started') {
    return messages;
  }

  // error event (type === 'error' OR event has an error field)
  if (eventType === 'error' || event.error) {
    const errorVal = event.error || event.message;
    let errMsg: string;
    if (typeof errorVal === 'string') {
      errMsg = errorVal;
    } else if (errorVal && typeof errorVal === 'object') {
      const e = errorVal as Record<string, unknown>;
      errMsg = (e.message as string) || JSON.stringify(errorVal);
    } else {
      errMsg = 'Unknown Codex error';
    }
    if (errMsg && errMsg !== '[object Object]') {
      messages.push({ type: 'error', error: errMsg });
    }
    return messages;
  }

  // Unknown event — drop silently
  return messages;
}

/**
 * Extract the most useful error message from Codex CLI stderr output.
 */
function extractCodexError(stderr: string): string | null {
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);

  // 401 / auth errors
  const authLine = lines.find(l => l.includes('401') || l.includes('Unauthorized') || l.includes('authentication'));
  if (authLine) {
    if (authLine.includes('401') || authLine.includes('Unauthorized')) {
      return 'Codex: 401 Unauthorized — check your OPENAI_API_KEY is valid.';
    }
    return authLine.slice(0, 300);
  }

  // First line containing "Error" or "error"
  const errLine = lines.find(l => /error/i.test(l));
  if (errLine) return errLine.slice(0, 300);

  return null;
}

// Auto-register on import
registerProvider(codexProvider);

export default codexProvider;
