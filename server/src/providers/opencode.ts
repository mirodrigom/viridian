/**
 * OpenCode CLI Provider Adapter.
 *
 * Spawns `opencode run --format json` and normalizes the newline-delimited
 * JSON events into SDKMessage events.
 *
 * OpenCode supports:
 * - Non-interactive mode via `opencode run "prompt"`
 * - JSON event streaming via `--format json`
 * - Session continue via `--continue` / `--session <id>`
 * - Model selection via `--model provider/model`
 * - File attachments via `--file`
 * - Tool management via `--allowedTools` / `--excludedTools`
 * - Attach to running server via `--attach`
 * - 75+ LLM providers
 *
 * OpenCode does NOT support:
 * - stdin-based control protocol
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
import { getProviderConfig } from '../db/database.js';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getHomeDir, findBinary as findBinaryInPath, getCommonBinaryPaths, findBinaryInWSL, isWindows } from '../utils/platform.js';

// ─── Provider metadata ──────────────────────────────────────────────────

const info: ProviderInfo = {
  id: 'opencode',
  name: 'OpenCode',
  icon: 'OpenCodeLogo',
  description: 'Open-source AI coding agent — 75+ LLM providers, LSP integration',
  website: 'https://opencode.ai',
  binaryName: 'opencode',
  envVarForPath: 'OPENCODE_PATH',
  installCommand: 'curl -fsSL https://opencode.ai/install | bash',
  windowsInstallCommand: 'wsl -u root bash -c "apt-get update -qq && apt-get install -y -qq unzip curl" && wsl bash -c "curl -fsSL https://opencode.ai/install | bash"',
};

const models: ProviderModel[] = [
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Anthropic — fast and capable', isDefault: true },
  { id: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Anthropic — most capable' },
  { id: 'openai/gpt-5.3', label: 'GPT-5.3', description: 'OpenAI latest flagship' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google deep reasoning' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', description: 'Open-source reasoning model' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: true,          // message.part type "thinking"
  supportsToolUse: true,           // Built-in tools
  supportsPermissionModes: true,   // --allowedTools / --excludedTools
  supportsImages: false,
  supportsResume: true,            // --continue / --session
  supportsStreaming: true,
  supportsControlRequests: false,
  supportsSubagents: false,
  supportsPlanMode: false,
  supportedPermissionModes: ['bypassPermissions', 'default'],
  customFeatures: ['multi_provider', 'lsp_integration', 'server_mode', 'session_sharing'],
};

// ─── Binary resolution ──────────────────────────────────────────────────

let resolvedPath: string | null = null;
let isWSLBinary = false;

function clearResolvedPath(): void {
  resolvedPath = null;
  isWSLBinary = false;
}

function findOpenCodeBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.OPENCODE_PATH && existsSync(process.env.OPENCODE_PATH)) {
    resolvedPath = process.env.OPENCODE_PATH;
    return resolvedPath;
  }

  const inPath = findBinaryInPath('opencode');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

  const home = getHomeDir();
  const commonPaths = [
    ...getCommonBinaryPaths('opencode'),
    join(home, '.opencode', 'bin', 'opencode'),
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) { resolvedPath = p; return resolvedPath; }
  }

  // On Windows, try WSL as a last resort (OpenCode installer doesn't support MINGW64)
  if (isWindows) {
    const wslPath = findBinaryInWSL('opencode');
    if (wslPath) {
      resolvedPath = wslPath;
      isWSLBinary = true;
      return resolvedPath;
    }
  }

  throw new Error(
    isWindows
      ? 'OpenCode binary not found. On Windows, install via WSL: wsl bash -c "curl -fsSL https://opencode.ai/install | bash", or set OPENCODE_PATH env var.'
      : 'OpenCode binary not found. Install it with: curl -fsSL https://opencode.ai/install | bash, or set OPENCODE_PATH env var.',
  );
}

// ─── IProvider implementation ───────────────────────────────────────────

const openCodeProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findOpenCodeBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    clearResolvedPath();
    return findOpenCodeBinary();
  },

  async isConfigured() {
    // Check keys explicitly stored for OpenCode via our settings flow.
    // Do NOT read shared env vars (GEMINI_API_KEY etc.) because they may have
    // been set by other providers (e.g. Gemini) and would give a false positive.
    const stored = await getProviderConfig('opencode');
    if (stored['ANTHROPIC_API_KEY'] || stored['OPENAI_API_KEY'] || stored['GEMINI_API_KEY']) {
      return { configured: true };
    }
    // OpenCode native config (user set up outside our app)
    const home = getHomeDir();
    if (
      existsSync(join(home, '.config', 'opencode', 'config.json')) ||
      existsSync(join(home, '.opencode', 'config.json'))
    ) return { configured: true };
    return {
      configured: false,
      reason: 'No provider credentials found. Configure a key via Settings.',
    };
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    const opencodeBin = findOpenCodeBinary();

    // Build args: opencode run --format json [flags] "prompt"
    const opencodeArgs = ['run', '--format', 'json'];

    if (options.model) {
      opencodeArgs.push('--model', options.model);
    }

    // Session resume
    if (options.sessionId) {
      opencodeArgs.push('--session', options.sessionId);
    }

    // The prompt goes last
    opencodeArgs.push(options.prompt);

    // If the binary is inside WSL, spawn via `wsl` with the Linux path
    const spawnCmd = isWSLBinary ? 'wsl' : opencodeBin;
    const spawnArgs = isWSLBinary ? [opencodeBin, ...opencodeArgs] : opencodeArgs;

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

    let buffer = '';
    let hasEmittedText = false;

    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const messages = processOpenCodeEvent(event);
          for (const msg of messages) {
            if (msg.type === 'text_delta') hasEmittedText = true;
            push(msg);
          }
        } catch {
          // Non-JSON line — treat as plain text
          if (line.trim()) {
            hasEmittedText = true;
            push({ type: 'text_delta', text: line + '\n' });
          }
        }
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && (text.includes('Error') || text.includes('error'))) {
        push({ type: 'error', error: text });
      }
    });

    proc.on('close', (code) => {
      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          const messages = processOpenCodeEvent(event);
          for (const msg of messages) push(msg);
        } catch {
          if (buffer.trim()) {
            push({ type: 'text_delta', text: buffer.trim() });
          }
        }
      }

      if (code && code !== 0 && !hasEmittedText) {
        push({ type: 'error', error: `OpenCode exited unexpectedly (exit code ${code}).` });
      }

      push({ type: 'result', exitCode: code });
      finish();
    });

    proc.on('error', (err) => {
      push({ type: 'error', error: `Failed to start OpenCode: ${err.message}` });
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
    return null;
  },

  getSessionDir(): string | null {
    const home = getHomeDir();
    const dir = join(home, '.opencode', 'sessions');
    return existsSync(dir) ? dir : null;
  },
};

// ─── OpenCode JSON event normalization ──────────────────────────────────
// OpenCode emits newline-delimited JSON events with --format json.
// Known event types:
//   { type: "message.part.updated", part: { type: "text", text: "..." } }
//   { type: "message.part.updated", part: { type: "thinking", text: "..." } }
//   { type: "message.part.updated", part: { type: "tool-invocation", ... } }
//   { type: "message.completed", ... }
//   { type: "error", ... }

function processOpenCodeEvent(event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];
  const eventType = event.type as string | undefined;

  // message.part.updated — streaming content
  if (eventType === 'message.part.updated') {
    const part = event.part as Record<string, unknown> | undefined;
    if (!part) return messages;

    const partType = part.type as string;

    // Text content
    if (partType === 'text') {
      const text = part.text as string | undefined;
      if (text) {
        messages.push({ type: 'text_delta', text });
      }
      return messages;
    }

    // Thinking/reasoning
    if (partType === 'thinking' || partType === 'reasoning') {
      const text = part.text as string | undefined;
      if (text) {
        messages.push({ type: 'thinking_start' });
        messages.push({ type: 'thinking_delta', text });
        messages.push({ type: 'thinking_end' });
      }
      return messages;
    }

    // Tool invocation
    if (partType === 'tool-invocation' || partType === 'tool_call') {
      messages.push({
        type: 'tool_use',
        tool: (part.toolName as string) || (part.name as string) || 'unknown',
        requestId: (part.id as string) || uuid(),
        input: (part.args as Record<string, unknown>) || (part.input as Record<string, unknown>) || {},
      });
      return messages;
    }

    // Tool result
    if (partType === 'tool-result' || partType === 'tool_result') {
      const text = (part.text as string) || (part.output as string) || JSON.stringify(part.result || part);
      messages.push({ type: 'text_delta', text: `\n${text}\n` });
      return messages;
    }

    return messages;
  }

  // message.completed — session end with optional usage
  if (eventType === 'message.completed') {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      if (usage.inputTokens || usage.promptTokens) {
        messages.push({
          type: 'message_start',
          inputTokens: (usage.inputTokens || usage.promptTokens) as number,
        });
      }
      if (usage.outputTokens || usage.completionTokens) {
        messages.push({
          type: 'message_delta',
          outputTokens: (usage.outputTokens || usage.completionTokens) as number,
        });
      }
    }
    return messages;
  }

  // session.created — capture session ID
  if (eventType === 'session.created' || eventType === 'session.resumed') {
    const sessionId = (event.sessionId as string) || (event.id as string) || undefined;
    if (sessionId) {
      messages.push({ type: 'system', sessionId });
    }
    return messages;
  }

  // Error events
  if (eventType === 'error' || event.error) {
    const error = event.error || event.message || event;
    const errMsg = typeof error === 'string'
      ? error
      : (error as Record<string, unknown>).message as string || JSON.stringify(error);
    messages.push({ type: 'error', error: errMsg });
    return messages;
  }

  // Plain text fallback (for non-JSON lines)
  if (typeof event.text === 'string') {
    messages.push({ type: 'text_delta', text: event.text as string });
    return messages;
  }

  // Unknown — emit as text for debugging
  const raw = JSON.stringify(event);
  if (raw.length > 2 && raw !== '{}') {
    messages.push({ type: 'text_delta', text: raw });
  }

  return messages;
}

// Auto-register on import
registerProvider(openCodeProvider);

export default openCodeProvider;
