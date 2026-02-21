/**
 * Gemini CLI Provider Adapter.
 *
 * Spawns the `gemini` CLI with `--output-format json` and normalizes
 * Gemini's JSON output into SDKMessage events.
 *
 * Gemini CLI does not support:
 * - Extended thinking (no thinking protocol)
 * - Control requests / permission protocol (always auto-approve)
 * - Session resume (no --resume flag)
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

// ─── Provider metadata ──────────────────────────────────────────────────

const info: ProviderInfo = {
  id: 'gemini',
  name: 'Gemini',
  icon: 'GeminiLogo',
  description: 'Google Gemini CLI — fast, generous free tier, MCP support',
  website: 'https://ai.google.dev',
  binaryName: 'gemini',
  envVarForPath: 'GEMINI_PATH',
  installCommand: 'npm install -g @google/gemini-cli',
};

const models: ProviderModel[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable — deep reasoning and coding', isDefault: true },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient for everyday tasks' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Previous gen — stable and reliable' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: false,
  supportsToolUse: true,          // Via MCP
  supportsPermissionModes: false, // No permission protocol
  supportsImages: true,
  supportsResume: false,          // No --resume
  supportsStreaming: true,
  supportsControlRequests: false, // No stdin control protocol
  supportsSubagents: false,
  supportsPlanMode: false,
  supportedPermissionModes: ['bypassPermissions'], // Only auto mode
  customFeatures: ['mcp', 'gemini_memory'],
};

// ─── Binary resolution ──────────────────────────────────────────────────

let resolvedPath: string | null = null;

function findGeminiBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.GEMINI_PATH && existsSync(process.env.GEMINI_PATH)) {
    resolvedPath = process.env.GEMINI_PATH;
    return resolvedPath;
  }

  try {
    const result = execSync('which gemini 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) { resolvedPath = result; return resolvedPath; }
  } catch { /* not in PATH */ }

  // Check common npm global locations
  const home = process.env.HOME || '/home';
  const npmPaths = [
    join(home, '.local', 'bin', 'gemini'),
    join(home, '.npm-global', 'bin', 'gemini'),
    '/usr/local/bin/gemini',
  ];
  for (const p of npmPaths) {
    if (existsSync(p)) { resolvedPath = p; return resolvedPath; }
  }

  throw new Error(
    'Gemini CLI binary not found. Install it with: npm install -g @anthropic-ai/gemini-cli, or set GEMINI_PATH env var.',
  );
}

// ─── IProvider implementation ───────────────────────────────────────────

const geminiProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findGeminiBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    return findGeminiBinary();
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    const geminiBin = findGeminiBinary();

    // Build args for non-interactive programmatic mode
    const args = [
      '-p', options.prompt,
      '--output-format', 'json',
    ];

    if (options.model) {
      args.push('--model', options.model);
    }

    const proc = spawn(geminiBin, args, {
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

    // Emit system event (no session ID for Gemini)
    yield { type: 'system' };

    // Process stdout — Gemini outputs JSON
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
          const messages = processGeminiEvent(event);
          for (const msg of messages) {
            if (msg.type === 'text_delta') hasEmittedText = true;
            push(msg);
          }
        } catch {
          // Non-JSON line — treat as plain text output
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
          const messages = processGeminiEvent(event);
          for (const msg of messages) push(msg);
        } catch {
          if (buffer.trim()) {
            push({ type: 'text_delta', text: buffer.trim() });
          }
        }
      }

      if (code && code !== 0 && !hasEmittedText) {
        push({ type: 'error', error: `Gemini exited unexpectedly (exit code ${code}).` });
      }

      push({ type: 'result', exitCode: code });
      finish();
    });

    proc.on('error', (err) => {
      push({ type: 'error', error: `Failed to start Gemini: ${err.message}` });
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
    // Gemini doesn't support control requests
    return null;
  },

  getSessionDir(): null {
    // Gemini CLI doesn't have a persistent session directory like Claude
    return null;
  },
};

// ─── Gemini event normalization ─────────────────────────────────────────

function processGeminiEvent(event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];

  // Gemini JSON output varies by version. Handle common patterns:

  // Pattern 1: { response: "text" } or { text: "text" }
  if (typeof event.response === 'string') {
    messages.push({ type: 'text_delta', text: event.response as string });
    return messages;
  }
  if (typeof event.text === 'string') {
    messages.push({ type: 'text_delta', text: event.text as string });
    return messages;
  }

  // Pattern 2: { type: "text", content: "..." }
  if (event.type === 'text' && typeof event.content === 'string') {
    messages.push({ type: 'text_delta', text: event.content as string });
    return messages;
  }

  // Pattern 3: { type: "tool_call", name: "...", arguments: {...} }
  if (event.type === 'tool_call' || event.type === 'function_call') {
    messages.push({
      type: 'tool_use',
      tool: (event.name as string) || (event.function as string) || 'unknown',
      requestId: uuid(),
      input: (event.arguments as Record<string, unknown>) || (event.args as Record<string, unknown>) || {},
    });
    return messages;
  }

  // Pattern 4: { candidates: [{ content: { parts: [...] } }] } (Gemini API format)
  if (Array.isArray(event.candidates)) {
    for (const candidate of event.candidates as Record<string, unknown>[]) {
      const content = candidate.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Record<string, unknown>[] | undefined;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part.text === 'string') {
            messages.push({ type: 'text_delta', text: part.text as string });
          }
          if (part.functionCall) {
            const fc = part.functionCall as Record<string, unknown>;
            messages.push({
              type: 'tool_use',
              tool: (fc.name as string) || 'unknown',
              requestId: uuid(),
              input: (fc.args as Record<string, unknown>) || {},
            });
          }
        }
      }
    }
    // Extract usage if present
    const usageMetadata = event.usageMetadata as Record<string, unknown> | undefined;
    if (usageMetadata) {
      if (usageMetadata.promptTokenCount) {
        messages.push({
          type: 'message_start',
          inputTokens: usageMetadata.promptTokenCount as number,
        });
      }
      if (usageMetadata.candidatesTokenCount) {
        messages.push({
          type: 'message_delta',
          outputTokens: usageMetadata.candidatesTokenCount as number,
        });
      }
    }
    return messages;
  }

  // Pattern 5: { error: "..." }
  if (event.error) {
    const errMsg = typeof event.error === 'string'
      ? event.error
      : (event.error as Record<string, unknown>).message as string || JSON.stringify(event.error);
    messages.push({ type: 'error', error: errMsg });
    return messages;
  }

  // Unknown format — emit as text for debugging
  const raw = JSON.stringify(event);
  if (raw.length > 2 && raw !== '{}') {
    messages.push({ type: 'text_delta', text: raw });
  }

  return messages;
}

// Auto-register on import
registerProvider(geminiProvider);

export default geminiProvider;
