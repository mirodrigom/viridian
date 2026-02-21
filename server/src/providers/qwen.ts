/**
 * Qwen Code CLI Provider Adapter (Alibaba).
 *
 * Spawns `qwen -p "prompt" --output-format stream-json` and normalizes
 * the streaming JSON events into SDKMessage events.
 *
 * Qwen Code is based on the Gemini CLI codebase and supports:
 * - Headless mode via `-p "prompt"`
 * - JSON streaming via `--output-format stream-json`
 * - Session continue via `--continue`
 * - Model selection via `--model`
 * - SubAgents and Skills
 * - Native 256K context (extensible to 1M tokens)
 *
 * Qwen Code does NOT support:
 * - stdin-based control protocol
 * - Image input as CLI flag
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
  id: 'qwen',
  name: 'Qwen Code',
  icon: 'QwenLogo',
  description: 'Alibaba Qwen Code — open-source agentic coding with Qwen3-Coder',
  website: 'https://github.com/QwenLM/qwen-code',
  binaryName: 'qwen',
  envVarForPath: 'QWEN_PATH',
  installCommand: 'npm install -g @qwen-code/qwen-code',
};

const models: ProviderModel[] = [
  { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', description: 'Most capable — deep reasoning and agentic coding', isDefault: true },
  { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus', description: 'Latest generation — balanced speed and capability' },
  { id: 'qwen3-coder', label: 'Qwen3 Coder', description: 'Optimized for coding tasks' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: false,
  supportsToolUse: true,           // Built-in tools (file ops, shell, etc.)
  supportsPermissionModes: false,  // No granular permission flags
  supportsImages: false,           // No --image CLI flag
  supportsResume: true,            // --continue flag
  supportsStreaming: true,
  supportsControlRequests: false,  // No stdin control protocol
  supportsSubagents: true,         // SubAgents built-in
  supportsPlanMode: false,
  supportedPermissionModes: ['bypassPermissions'], // --yolo for auto-approve
  customFeatures: ['skills', 'subagents', '256k_context', 'multi_model'],
};

// ─── Binary resolution ──────────────────────────────────────────────────

let resolvedPath: string | null = null;

function findQwenBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.QWEN_PATH && existsSync(process.env.QWEN_PATH)) {
    resolvedPath = process.env.QWEN_PATH;
    return resolvedPath;
  }

  try {
    const result = execSync('which qwen 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) { resolvedPath = result; return resolvedPath; }
  } catch { /* not in PATH */ }

  // Check common install locations
  const home = process.env.HOME || '/home';
  const commonPaths = [
    join(home, '.local', 'bin', 'qwen'),
    join(home, '.npm-global', 'bin', 'qwen'),
    '/usr/local/bin/qwen',
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) { resolvedPath = p; return resolvedPath; }
  }

  throw new Error(
    'Qwen Code binary not found. Install it with: npm install -g @qwen-code/qwen-code, or set QWEN_PATH env var.',
  );
}

// ─── IProvider implementation ───────────────────────────────────────────

const qwenProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findQwenBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    return findQwenBinary();
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    const qwenBin = findQwenBinary();

    // Build args: qwen -p "prompt" --output-format stream-json [flags]
    const args = [
      '-p', options.prompt,
      '--output-format', 'stream-json',
    ];

    if (options.model) {
      args.push('--model', options.model);
    }

    // Session resume
    if (options.sessionId) {
      args.push('--continue');
    }

    const proc = spawn(qwenBin, args, {
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
          const messages = processQwenEvent(event);
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
          const messages = processQwenEvent(event);
          for (const msg of messages) push(msg);
        } catch {
          if (buffer.trim()) {
            push({ type: 'text_delta', text: buffer.trim() });
          }
        }
      }

      if (code && code !== 0 && !hasEmittedText) {
        push({ type: 'error', error: `Qwen Code exited unexpectedly (exit code ${code}).` });
      }

      push({ type: 'result', exitCode: code });
      finish();
    });

    proc.on('error', (err) => {
      push({ type: 'error', error: `Failed to start Qwen Code: ${err.message}` });
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
    const home = process.env.HOME || '/home';
    const dir = join(home, '.qwen', 'sessions');
    return existsSync(dir) ? dir : null;
  },
};

// ─── Qwen stream-json event normalization ───────────────────────────────
// Qwen Code is based on Gemini CLI, so the JSON format is similar.
// Known patterns: { response: "text" }, { text: "text" },
// { type: "text", content: "..." }, { type: "tool_call", ... },
// { candidates: [...] }, { error: "..." }

function processQwenEvent(event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];

  // Pattern 1: { response: "text" } or { text: "text" }
  if (typeof event.response === 'string') {
    messages.push({ type: 'text_delta', text: event.response as string });
    return messages;
  }
  if (typeof event.text === 'string' && !event.type) {
    messages.push({ type: 'text_delta', text: event.text as string });
    return messages;
  }

  // Pattern 2: { type: "text", content: "..." }
  if (event.type === 'text' && typeof event.content === 'string') {
    messages.push({ type: 'text_delta', text: event.content as string });
    return messages;
  }

  // Pattern 3: { type: "tool_call" | "function_call" }
  if (event.type === 'tool_call' || event.type === 'function_call') {
    messages.push({
      type: 'tool_use',
      tool: (event.name as string) || (event.function as string) || 'unknown',
      requestId: uuid(),
      input: (event.arguments as Record<string, unknown>) || (event.args as Record<string, unknown>) || {},
    });
    return messages;
  }

  // Pattern 4: { type: "tool_result" }
  if (event.type === 'tool_result') {
    const text = (event.output as string) || (event.result as string) || JSON.stringify(event);
    messages.push({ type: 'text_delta', text: `\n${text}\n` });
    return messages;
  }

  // Pattern 5: Gemini-style candidates array
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
    // Usage metadata
    const usageMetadata = event.usageMetadata as Record<string, unknown> | undefined;
    if (usageMetadata) {
      if (usageMetadata.promptTokenCount) {
        messages.push({ type: 'message_start', inputTokens: usageMetadata.promptTokenCount as number });
      }
      if (usageMetadata.candidatesTokenCount) {
        messages.push({ type: 'message_delta', outputTokens: usageMetadata.candidatesTokenCount as number });
      }
    }
    return messages;
  }

  // Pattern 6: Error
  if (event.error) {
    const errMsg = typeof event.error === 'string'
      ? event.error
      : (event.error as Record<string, unknown>).message as string || JSON.stringify(event.error);
    messages.push({ type: 'error', error: errMsg });
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
registerProvider(qwenProvider);

export default qwenProvider;
