/**
 * Claude Code SDK — typed async generator wrapper around the CLI binary.
 *
 * Provides a clean programmatic API for running Claude conversations
 * without coupling callers to child_process or stream-json parsing details.
 *
 * Usage:
 *   for await (const msg of claudeQuery({ prompt: "hello", cwd: "/project" })) {
 *     if (msg.type === "text_delta") console.log(msg.text);
 *   }
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';

// ─── Message types emitted by the SDK ───────────────────────────────────────

export interface SDKTextDelta {
  type: 'text_delta';
  text: string;
}

export interface SDKThinkingStart {
  type: 'thinking_start';
}

export interface SDKThinkingDelta {
  type: 'thinking_delta';
  text: string;
}

export interface SDKThinkingEnd {
  type: 'thinking_end';
}

export interface SDKToolUse {
  type: 'tool_use';
  tool: string;
  requestId: string;
  input: Record<string, unknown>;
}

export interface SDKToolInputDelta {
  type: 'tool_input_delta';
  requestId: string | null;
  tool: string | null;
  partialJson: string;
  accumulatedJson: string;
}

export interface SDKToolInputComplete {
  type: 'tool_input_complete';
  requestId: string | null;
  tool: string | null;
  input: Record<string, unknown>;
}

export interface SDKError {
  type: 'error';
  error: string;
}

export interface SDKSystem {
  type: 'system';
  sessionId?: string;
}

export interface SDKResult {
  type: 'result';
  sessionId?: string;
  exitCode: number | null;
}

export interface SDKMessageDelta {
  type: 'message_delta';
  outputTokens?: number;
}

export type SDKMessage =
  | SDKTextDelta
  | SDKThinkingStart
  | SDKThinkingDelta
  | SDKThinkingEnd
  | SDKToolUse
  | SDKToolInputDelta
  | SDKToolInputComplete
  | SDKError
  | SDKSystem
  | SDKResult
  | SDKMessageDelta;

// ─── Query options ──────────────────────────────────────────────────────────

export interface QueryOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  maxOutputTokens?: number;
  allowedTools?: string[];
  disallowedTools?: string[];
  images?: { name: string; dataUrl: string }[];
  sessionId?: string;            // Claude session ID for resuming
  abortSignal?: AbortSignal;     // Abort controller signal
}

// ─── Binary resolution ──────────────────────────────────────────────────────

let resolvedPath: string | null = null;

export function findClaudeBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) {
    resolvedPath = process.env.CLAUDE_PATH;
    return resolvedPath;
  }

  try {
    const result = execSync('which claude 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) { resolvedPath = result; return resolvedPath; }
  } catch { /* not in PATH */ }

  const home = process.env.HOME || '/home';
  const searchPaths = [
    join(home, '.var/app/com.visualstudio.code/data/vscode/extensions'),
    join(home, '.vscode/extensions'),
    join(home, '.vscode-server/extensions'),
  ];

  for (const extDir of searchPaths) {
    try {
      if (!existsSync(extDir)) continue;
      const matches = readdirSync(extDir)
        .filter(d => d.startsWith('anthropic.claude-code-'))
        .sort()
        .reverse();
      for (const dir of matches) {
        const binPath = join(extDir, dir, 'resources', 'native-binary', 'claude');
        if (existsSync(binPath)) { resolvedPath = binPath; return resolvedPath; }
      }
    } catch { /* skip */ }
  }

  throw new Error(
    'Claude CLI binary not found. Set CLAUDE_PATH env var, install claude globally, or install the Claude Code VS Code extension.',
  );
}

// ─── Internal block tracking ────────────────────────────────────────────────

interface BlockState {
  currentBlockType: string | null;
  currentToolInputJson: string;
  currentToolId: string | null;
  currentToolName: string | null;
  claudeSessionId?: string;
}

// ─── Core query function — returns AsyncGenerator ───────────────────────────

export async function* claudeQuery(options: QueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
  const claudeBin = findClaudeBinary();

  // Prepare temp image files
  let imageTempDir: string | null = null;
  const imagePaths: string[] = [];
  if (options.images?.length) {
    imageTempDir = mkdtempSync(join(tmpdir(), 'claude-img-'));
    for (const img of options.images) {
      const match = img.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) continue;
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buf = Buffer.from(match[2]!, 'base64');
      const filePath = join(imageTempDir, `${uuid().slice(0, 8)}.${ext}`);
      writeFileSync(filePath, buf);
      imagePaths.push(filePath);
    }
  }

  const args = [
    '-p', options.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  for (const imgPath of imagePaths) {
    args.push('--image', imgPath);
  }

  if (options.sessionId) {
    args.push('--session-id', options.sessionId, '--resume');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.maxOutputTokens && options.maxOutputTokens > 0) {
    args.push('--max-tokens', String(options.maxOutputTokens));
  }

  const permMode = options.permissionMode || 'bypassPermissions';
  args.push('--permission-mode', permMode);

  const DEFAULT_ALLOWED = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch', 'Task'];
  const allowedTools = options.allowedTools?.length ? options.allowedTools : DEFAULT_ALLOWED;
  args.push('--allowedTools', ...allowedTools);

  if (options.disallowedTools?.length) {
    args.push('--disallowedTools', ...options.disallowedTools);
  }

  const proc = spawn(claudeBin, args, {
    cwd: options.cwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdin!.end();

  // Abort support
  if (options.abortSignal) {
    const onAbort = () => { proc.kill('SIGTERM'); };
    options.abortSignal.addEventListener('abort', onAbort, { once: true });
    proc.on('close', () => options.abortSignal!.removeEventListener('abort', onAbort));
  }

  // Create a message queue + promise-based async iteration
  const queue: (SDKMessage | null)[] = [];
  let resolve: (() => void) | null = null;
  let procError: Error | null = null;

  function push(msg: SDKMessage) {
    queue.push(msg);
    if (resolve) { resolve(); resolve = null; }
  }

  function finish() {
    queue.push(null); // sentinel
    if (resolve) { resolve(); resolve = null; }
  }

  function waitForMessage(): Promise<void> {
    if (queue.length > 0) return Promise.resolve();
    return new Promise<void>(r => { resolve = r; });
  }

  // State
  const state: BlockState = {
    currentBlockType: null,
    currentToolInputJson: '',
    currentToolId: null,
    currentToolName: null,
  };

  let buffer = '';

  proc.on('error', (err) => {
    procError = err;
    push({ type: 'error', error: `Failed to start Claude: ${err.message}` });
    finish();
  });

  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const messages = processEvent(state, event);
        for (const msg of messages) push(msg);
      } catch {
        // non-JSON stderr-like line
      }
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (!text) return;
    if (text.includes('Error') || text.includes('error') || text.includes('ENOENT')) {
      push({ type: 'error', error: text });
    }
  });

  proc.on('close', (code) => {
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        const messages = processEvent(state, event);
        for (const msg of messages) push(msg);
      } catch { /* ignore */ }
    }

    // Clean up temp images
    if (imageTempDir) {
      try { rmSync(imageTempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    push({
      type: 'result',
      sessionId: state.claudeSessionId,
      exitCode: code,
    });
    finish();
  });

  // Yield messages from queue
  while (true) {
    await waitForMessage();
    while (queue.length > 0) {
      const msg = queue.shift()!;
      if (msg === null) return; // done
      yield msg;
    }
  }
}

// ─── Event processing (pure functions) ──────────────────────────────────────

function processEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  if (event.type === 'stream_event') {
    const inner = event.event as Record<string, unknown> | undefined;
    if (!inner) return [];
    return processStreamEvent(state, inner);
  }

  if (event.type === 'result') {
    if (event.session_id) state.claudeSessionId = event.session_id as string;
    return [];
  }

  if (event.type === 'system') {
    if (event.session_id) state.claudeSessionId = event.session_id as string;
    return [{ type: 'system', sessionId: event.session_id as string | undefined }];
  }

  if (event.type === 'assistant') {
    return []; // already handled via streaming
  }

  return [];
}

function processStreamEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];

  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (!block) return messages;

    if (block.type === 'thinking') {
      state.currentBlockType = 'thinking';
      messages.push({ type: 'thinking_start' });
    } else if (block.type === 'tool_use') {
      state.currentBlockType = 'tool_use';
      state.currentToolId = (block.id as string) || null;
      state.currentToolName = (block.name as string) || null;
      state.currentToolInputJson = '';
      messages.push({
        type: 'tool_use',
        tool: (block.name as string) || '',
        requestId: (block.id as string) || '',
        input: (block.input as Record<string, unknown>) || {},
      });
    } else if (block.type === 'text') {
      state.currentBlockType = 'text';
    }
    return messages;
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (!delta) return messages;

    if (delta.type === 'thinking_delta' && delta.thinking) {
      messages.push({ type: 'thinking_delta', text: delta.thinking as string });
    } else if (delta.type === 'text_delta' && delta.text) {
      messages.push({ type: 'text_delta', text: delta.text as string });
    } else if (delta.type === 'input_json_delta' && delta.partial_json) {
      state.currentToolInputJson += delta.partial_json as string;
      messages.push({
        type: 'tool_input_delta',
        requestId: state.currentToolId,
        tool: state.currentToolName,
        partialJson: delta.partial_json as string,
        accumulatedJson: state.currentToolInputJson,
      });
    }
    return messages;
  }

  if (event.type === 'content_block_stop') {
    if (state.currentBlockType === 'thinking') {
      messages.push({ type: 'thinking_end' });
    }
    if (state.currentBlockType === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      try {
        if (state.currentToolInputJson) parsedInput = JSON.parse(state.currentToolInputJson);
      } catch { /* leave empty */ }
      messages.push({
        type: 'tool_input_complete',
        requestId: state.currentToolId,
        tool: state.currentToolName,
        input: parsedInput,
      });
      state.currentToolInputJson = '';
    }
    state.currentBlockType = null;
    return messages;
  }

  if (event.type === 'message_delta') {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      messages.push({ type: 'message_delta', outputTokens: usage.output_tokens as number | undefined });
    }
    return messages;
  }

  return messages;
}
