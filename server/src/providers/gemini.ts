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
  ConfigStatus,
} from './types.js';
import type { SDKMessage } from '../services/claude-sdk.js';
import { registerProvider } from './registry.js';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuid } from 'uuid';
import { getHomeDir, findBinary as findBinaryInPath, getCommonBinaryPaths } from '../utils/platform.js';

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

  const inPath = findBinaryInPath('gemini');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

  // Check common npm global locations
  const home = getHomeDir();
  const npmPaths = [
    ...getCommonBinaryPaths('gemini'),
    join(home, '.npm-global', 'bin', 'gemini'),
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

  isConfigured(): ConfigStatus {
    // 1. GEMINI_API_KEY env var (set manually or via configure endpoint)
    if (process.env.GEMINI_API_KEY) {
      return { configured: true };
    }
    // 2. ~/.gemini/settings.json with a selectedAuthType (OAuth or other)
    const home = getHomeDir();
    const settingsPath = join(home, '.gemini', 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
        if (settings.selectedAuthType) {
          return { configured: true };
        }
      } catch { /* invalid JSON — fall through */ }
    }
    return {
      configured: false,
      reason: 'No Gemini credentials found. Set GEMINI_API_KEY or run the OAuth flow.',
    };
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

    let hasEmittedText = false;
    let hasEmittedError = false;
    // Collect ALL stdout — Gemini CLI outputs a single JSON blob at the end, not NDJSON
    let stdoutBuffer = '';
    let stderrBuffer = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      // Process complete stdout. Gemini CLI outputs either:
      //   A) A single pretty-printed JSON object (multi-line)
      //   B) Multiple NDJSON lines (one JSON per line)
      // Try strategy A (whole blob) first, then fall back to B (line-by-line).
      const raw = stdoutBuffer.trim();
      if (raw) {
        let parsedOk = false;

        // Strategy A: whole blob as one JSON object
        try {
          const event = JSON.parse(raw);
          const messages = processGeminiEvent(event);
          for (const msg of messages) {
            if (msg.type === 'text_delta') hasEmittedText = true;
            if (msg.type === 'error') hasEmittedError = true;
            push(msg);
          }
          parsedOk = true;
        } catch { /* fall through to line-by-line */ }

        // Strategy B: NDJSON (line per event)
        if (!parsedOk) {
          for (const line of raw.split('\n')) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              const messages = processGeminiEvent(event);
              for (const msg of messages) {
                if (msg.type === 'text_delta') hasEmittedText = true;
                if (msg.type === 'error') hasEmittedError = true;
                push(msg);
                parsedOk = true;
              }
            } catch { /* skip non-JSON lines */ }
          }
        }

        // Last resort: emit as plain text
        if (!parsedOk) {
          hasEmittedText = true;
          push({ type: 'text_delta', text: raw });
        }
      }

      // Process accumulated stderr — extract the most useful error line
      if (stderrBuffer.trim()) {
        const errText = extractGeminiError(stderrBuffer);
        if (errText && !hasEmittedError) {
          hasEmittedError = true;
          push({ type: 'error', error: errText });
        }
      }

      if (code && code !== 0 && !hasEmittedText && !hasEmittedError) {
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

  // Pattern 1: { response: "text", stats?: {...}, session_id?: "..." } — Gemini CLI JSON output
  if (typeof event.response === 'string') {
    messages.push({ type: 'text_delta', text: event.response as string });
    // Extract token usage from stats if present
    if (event.stats && typeof event.stats === 'object') {
      const stats = event.stats as Record<string, unknown>;
      const models = stats.models as Record<string, unknown> | undefined;
      if (models) {
        let totalInput = 0;
        let totalOutput = 0;
        for (const modelStats of Object.values(models)) {
          const ms = modelStats as Record<string, unknown>;
          const tokens = ms.tokens as Record<string, unknown> | undefined;
          if (tokens) {
            totalInput += (tokens.input as number) || (tokens.prompt as number) || 0;
            totalOutput += (tokens.candidates as number) || 0;
          }
        }
        if (totalInput) messages.push({ type: 'message_start', inputTokens: totalInput });
        if (totalOutput) messages.push({ type: 'message_delta', outputTokens: totalOutput });
      }
    }
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

  // Pattern 5: { error: "..." } or { session_id: "...", error: {...} }
  if (event.error) {
    let errMsg: string;
    if (typeof event.error === 'string') {
      errMsg = event.error;
    } else {
      const errObj = event.error as Record<string, unknown>;
      const msg = errObj.message as string | undefined;
      // Gemini CLI sometimes serializes errors as "[object Object]" — fall back to type/code
      if (msg && msg !== '[object Object]') {
        errMsg = msg;
      } else if (errObj.type) {
        errMsg = `Gemini error: ${errObj.type}${errObj.code ? ` (code ${errObj.code})` : ''}`;
      } else {
        errMsg = JSON.stringify(event.error);
      }
    }
    // Skip uninformative duplicate errors — the real message comes from stderr
    if (errMsg && errMsg !== '[object Object]') {
      messages.push({ type: 'error', error: errMsg });
    }
    return messages;
  }

  // Unknown format — emit as text for debugging
  const raw = JSON.stringify(event);
  if (raw.length > 2 && raw !== '{}') {
    messages.push({ type: 'text_delta', text: raw });
  }

  return messages;
}

/**
 * Extract the most useful error message from Gemini CLI stderr output.
 * Prioritizes quota/auth errors; falls back to first "Error:" line.
 */
function extractGeminiError(stderr: string): string | null {
  const lines = stderr.split('\n').map(l => l.trim()).filter(Boolean);

  // Prefer known high-signal error patterns
  const knownPatterns = [
    /TerminalQuotaError[:\s]*(.*)/i,
    /quota exceeded[:\s]*(.*)/i,
    /authentication.*failed[:\s]*(.*)/i,
    /unauthorized[:\s]*(.*)/i,
  ];
  for (const pat of knownPatterns) {
    for (const line of lines) {
      const m = line.match(pat);
      if (m) {
        const detail = m[1]?.trim();
        return detail ? `${m[0].split(':')[0]}: ${detail}` : m[0];
      }
    }
  }

  // Fall back: first line containing "Error"
  const errLine = lines.find(l => /error/i.test(l));
  if (errLine) return errLine.slice(0, 300); // cap length

  return null;
}

// Auto-register on import
registerProvider(geminiProvider);

export default geminiProvider;
