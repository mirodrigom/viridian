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
import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';

const DEBUG_LOG = '/tmp/graph-runner-debug.log';
function debugLog(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  console.log(msg);
}

// ─── Message types emitted by the SDK ───────────────────────────────────────

export interface SDKTextDelta {
  type: 'text_delta';
  text: string;
  parentToolUseId?: string | null;
}

export interface SDKThinkingStart {
  type: 'thinking_start';
  parentToolUseId?: string | null;
}

export interface SDKThinkingDelta {
  type: 'thinking_delta';
  text: string;
  parentToolUseId?: string | null;
}

export interface SDKThinkingEnd {
  type: 'thinking_end';
  parentToolUseId?: string | null;
}

export interface SDKToolUse {
  type: 'tool_use';
  tool: string;
  requestId: string;
  input: Record<string, unknown>;
  parentToolUseId?: string | null;
}

export interface SDKToolInputDelta {
  type: 'tool_input_delta';
  requestId: string | null;
  tool: string | null;
  partialJson: string;
  accumulatedJson: string;
  parentToolUseId?: string | null;
}

export interface SDKToolInputComplete {
  type: 'tool_input_complete';
  requestId: string | null;
  tool: string | null;
  input: Record<string, unknown>;
  parentToolUseId?: string | null;
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
  parentToolUseId?: string | null;
}

export interface SDKMessageStart {
  type: 'message_start';
  inputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  parentToolUseId?: string | null;
}

export interface SDKSubagentResult {
  type: 'subagent_result';
  toolUseId: string;
  status: string;
  content: string;
  agentId?: string;
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
  | SDKMessageDelta
  | SDKMessageStart
  | SDKSubagentResult;

// ─── Query options ──────────────────────────────────────────────────────────

export interface QueryOptions {
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  maxOutputTokens?: number;
  tools?: string[];              // Restrict available tools (--tools "Task,TodoWrite")
  allowedTools?: string[];
  disallowedTools?: string[];
  images?: { name: string; dataUrl: string }[];
  sessionId?: string;            // Claude session ID for resuming
  abortSignal?: AbortSignal;     // Abort controller signal
  noTools?: boolean;             // Disable all tools (--tools "")
  disableSlashCommands?: boolean; // Disable built-in skills (--disable-slash-commands)
  systemPrompt?: string;         // Injected system prompt (--system-prompt)
  appendSystemPrompt?: string;   // Appended system prompt (--append-system-prompt)
  agents?: Record<string, {      // Custom sub-agents (--agents)
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    permissionMode?: string;
    maxTurns?: number;
  }>;
}

// ─── Binary resolution ──────────────────────────────────────────────────────

let resolvedPath: string | null = null;

export function findClaudeBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) {
    resolvedPath = process.env.CLAUDE_PATH;
    return resolvedPath;
  }

  // Search for native binary in VS Code extensions first (preferred over npm wrapper)
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

  // Fall back to claude in PATH (may be a native install or npm wrapper)
  try {
    const result = execSync('which claude 2>/dev/null', { encoding: 'utf8' }).trim();
    if (result) { resolvedPath = result; return resolvedPath; }
  } catch { /* not in PATH */ }

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
  currentParentToolUseId: string | null; // tracks which agent (parent/sub) owns current events
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

  // Build prompt — prepend image paths so Claude can read them with its Read tool
  let prompt = options.prompt;
  if (imagePaths.length > 0) {
    const imageRefs = imagePaths.map(p => p).join('\n');
    prompt = `[Attached images — use the Read tool to view them]\n${imageRefs}\n\n${prompt}`;
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }

  if (options.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  if (options.agents && Object.keys(options.agents).length > 0) {
    debugLog(`[ClaudeSDK] Passing --agents with keys: [${Object.keys(options.agents).join(', ')}]`);
    args.push('--agents', JSON.stringify(options.agents));
  }

  if (options.disableSlashCommands) {
    args.push('--disable-slash-commands');
  }

  const permMode = options.permissionMode || 'bypassPermissions';
  args.push('--permission-mode', permMode);

  if (options.noTools) {
    args.push('--tools', '');
  } else if (options.tools?.length) {
    // --tools REPLACES the available tool set (e.g. --tools "Task" means ONLY Task)
    args.push('--tools', options.tools.join(','));
  } else {
    const DEFAULT_ALLOWED = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'WebSearch', 'Task'];
    const allowedTools = options.allowedTools?.length ? options.allowedTools : DEFAULT_ALLOWED;
    args.push('--allowedTools', ...allowedTools);

    if (options.disallowedTools?.length) {
      args.push('--disallowedTools', ...options.disallowedTools);
    }
  }

  // Log FULL CLI args for debugging (mask the prompt to keep it short)
  const debugArgs = args.map((a, i) => args[i - 1] === '-p' ? `"${a.slice(0, 80)}..."` : a);
  debugLog(`[ClaudeSDK] FULL CLI: claude ${debugArgs.join(' ')}`);

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
    currentParentToolUseId: null,
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

// ─── Unicode decode helper ───────────────────────────────────────────────────

/**
 * Decode literal \uXXXX escape sequences in strings.
 * Claude CLI sometimes writes unicode characters as literal backslash-u escapes
 * (e.g. "\\u00ed" instead of "í") which survive JSON.parse as the literal text "\u00ed".
 */
export function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

// ─── Event processing (pure functions) ──────────────────────────────────────

function processEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  // Log every raw event type (except noisy stream_event internals)
  if (event.type !== 'stream_event') {
    debugLog(`[ClaudeSDK] event: type="${event.type}", keys=[${Object.keys(event).join(',')}]${event.parent_tool_use_id ? `, ptui="${event.parent_tool_use_id}"` : ''}`);
  }

  if (event.type === 'stream_event') {
    const inner = event.event as Record<string, unknown> | undefined;
    if (!inner) return [];
    // Track which agent (parent vs sub-agent) owns the current stream events
    const parentToolUseId = (event.parent_tool_use_id as string | null) ?? null;
    state.currentParentToolUseId = parentToolUseId;
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
    const parentToolUseId = (event.parent_tool_use_id as string | null) ?? null;
    // Sub-agent messages come as complete `assistant` messages (not stream_events).
    // Extract tool calls and text from them.
    if (parentToolUseId) {
      const messages: SDKMessage[] = [];
      const message = event.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            messages.push({
              type: 'tool_use',
              tool: (block.name as string) || '',
              requestId: (block.id as string) || '',
              input: (block.input as Record<string, unknown>) || {},
              parentToolUseId,
            });
          } else if (block.type === 'text' && block.text) {
            messages.push({
              type: 'text_delta',
              text: decodeUnicodeEscapes(block.text as string),
              parentToolUseId,
            });
          }
        }
      }
      return messages;
    }
    return []; // root assistant messages already handled via streaming
  }

  // Detect sub-agent completion via user messages (tool_result in message.content)
  if (event.type === 'user') {
    debugLog(`[ClaudeSDK] user event: keys=[${Object.keys(event).join(',')}]`);
    const msg = event.message as Record<string, unknown> | undefined;
    const msgContent = msg?.content as Record<string, unknown>[] | undefined;

    // Strategy 1: Check top-level tool_use_result (some CLI versions)
    const toolUseResult = event.tool_use_result as Record<string, unknown> | undefined;
    if (toolUseResult) {
      debugLog(`[ClaudeSDK] user event has tool_use_result: status="${toolUseResult.status}", keys=[${Object.keys(toolUseResult).join(',')}]`);
    }

    // Strategy 2: Check message.content for tool_result blocks (standard CLI format)
    let toolUseId = '';
    let resultText = '';
    let found = false;

    if (Array.isArray(msgContent)) {
      for (const block of msgContent) {
        if (block.type === 'tool_result') {
          toolUseId = (block.tool_use_id as string) || '';
          // Extract text from content (can be string, array of text blocks, or undefined)
          const blockContent = block.content;
          if (typeof blockContent === 'string') {
            resultText = blockContent;
          } else if (Array.isArray(blockContent)) {
            resultText = (blockContent as Record<string, unknown>[])
              .filter(c => c.type === 'text')
              .map(c => c.text as string)
              .join('\n');
          }
          found = true;
          break;
        }
      }
    }

    // Also try top-level tool_use_result content if message.content didn't have it
    if (!found && toolUseResult && toolUseResult.status === 'completed') {
      const content = toolUseResult.content;
      if (Array.isArray(content)) {
        resultText = (content as Record<string, unknown>[])
          .filter(c => typeof c === 'object' && c !== null && c.type === 'text')
          .map(c => c.text as string)
          .join('\n');
      } else if (typeof content === 'string') {
        resultText = content;
      }
      // Find toolUseId from message content
      if (Array.isArray(msgContent)) {
        const toolResult = msgContent.find((c) => c.type === 'tool_result');
        if (toolResult) toolUseId = (toolResult.tool_use_id as string) || '';
      }
      found = true;
    }

    if (found && toolUseId) {
      debugLog(`[ClaudeSDK] subagent_result detected: toolUseId="${toolUseId}", resultLen=${resultText.length}`);
      return [{
        type: 'subagent_result',
        toolUseId,
        status: 'completed',
        content: resultText,
        agentId: toolUseResult?.agentId as string | undefined,
      }];
    } else if (found) {
      debugLog(`[ClaudeSDK] WARN: user event has tool_result but no tool_use_id!`);
    }
  }

  return [];
}

function processStreamEvent(state: BlockState, event: Record<string, unknown>): SDKMessage[] {
  const messages: SDKMessage[] = [];
  const ptui = state.currentParentToolUseId;

  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (!block) return messages;

    if (block.type === 'thinking') {
      state.currentBlockType = 'thinking';
      messages.push({ type: 'thinking_start', parentToolUseId: ptui });
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
        parentToolUseId: ptui,
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
      messages.push({ type: 'thinking_delta', text: decodeUnicodeEscapes(delta.thinking as string), parentToolUseId: ptui });
    } else if (delta.type === 'text_delta' && delta.text) {
      messages.push({ type: 'text_delta', text: decodeUnicodeEscapes(delta.text as string), parentToolUseId: ptui });
    } else if (delta.type === 'input_json_delta' && delta.partial_json) {
      state.currentToolInputJson += delta.partial_json as string;
      messages.push({
        type: 'tool_input_delta',
        requestId: state.currentToolId,
        tool: state.currentToolName,
        partialJson: delta.partial_json as string,
        accumulatedJson: state.currentToolInputJson,
        parentToolUseId: ptui,
      });
    }
    return messages;
  }

  if (event.type === 'content_block_stop') {
    if (state.currentBlockType === 'thinking') {
      messages.push({ type: 'thinking_end', parentToolUseId: ptui });
    }
    if (state.currentBlockType === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      try {
        if (state.currentToolInputJson) parsedInput = JSON.parse(state.currentToolInputJson);
      } catch (e) {
        debugLog(`[ClaudeSDK] WARN: Failed to parse tool input JSON (tool=${state.currentToolName}, len=${state.currentToolInputJson.length}): ${e}`);
      }
      debugLog(`[ClaudeSDK] tool_input_complete: tool="${state.currentToolName}", requestId="${state.currentToolId}", inputKeys=[${Object.keys(parsedInput).join(',')}], ptui=${ptui}`);
      messages.push({
        type: 'tool_input_complete',
        requestId: state.currentToolId,
        tool: state.currentToolName,
        input: parsedInput,
        parentToolUseId: ptui,
      });
      state.currentToolInputJson = '';
    }
    state.currentBlockType = null;
    return messages;
  }

  if (event.type === 'message_start') {
    const message = event.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage) {
      messages.push({
        type: 'message_start',
        inputTokens: usage.input_tokens as number | undefined,
        cacheCreationInputTokens: usage.cache_creation_input_tokens as number | undefined,
        cacheReadInputTokens: usage.cache_read_input_tokens as number | undefined,
        parentToolUseId: ptui,
      });
    }
    return messages;
  }

  if (event.type === 'message_delta') {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      messages.push({ type: 'message_delta', outputTokens: usage.output_tokens as number | undefined, parentToolUseId: ptui });
    }
    return messages;
  }

  return messages;
}
