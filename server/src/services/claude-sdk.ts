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
import { join, resolve as resolvePath } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import { getHomeDir, findBinary as findBinaryInPath, isWindows, cwdToHash } from '../utils/platform.js';

const DEBUG_LOG = join(tmpdir(), 'graph-runner-debug.log');
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

export interface SDKControlRequest {
  type: 'control_request';
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
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
  | SDKSubagentResult
  | SDKControlRequest;

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
  onStdinReady?: (write: (data: string) => void) => void; // Callback to receive stdin writer for bidirectional communication
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
    // resolvePath normalises forward slashes to backslashes on Windows,
    // which is required for cmd.exe to execute .cmd wrappers.
    resolvedPath = resolvePath(process.env.CLAUDE_PATH);
    return resolvedPath;
  }

  // Search for native binary in VS Code extensions first (preferred over npm wrapper)
  const home = getHomeDir();
  const searchPaths = isWindows
    ? [
        join(home, '.vscode', 'extensions'),
        join(home, '.vscode-server', 'extensions'),
      ]
    : [
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
        const binName = isWindows ? 'claude.exe' : 'claude';
        const binPath = join(extDir, dir, 'resources', 'native-binary', binName);
        if (existsSync(binPath)) { resolvedPath = binPath; return resolvedPath; }
      }
    } catch { /* skip */ }
  }

  // Fall back to claude in PATH (may be a native install or npm wrapper)
  const inPath = findBinaryInPath('claude');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

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
  emittedToolUseIds: Set<string>; // deduplicate tool_use events (--include-partial-messages can re-emit)
  hasEmittedText: boolean; // track whether any text was emitted (for empty-response error detection)
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

  // When using --input-format stream-json, do NOT use -p flag
  // The prompt must be sent via stdin as a JSON message instead
  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (options.sessionId) {
    // Verify the JSONL file exists before using --resume.
    // If the file is missing (e.g. session from another project dir, or a failed
    // session that never wrote its JSONL), Claude exits with code 1 immediately.
    // In that case, start a fresh session instead.
    const home = getHomeDir();
    const cwdHash = cwdToHash(options.cwd);
    const sessionFile = join(home, '.claude', 'projects', cwdHash, `${options.sessionId}.jsonl`);
    if (existsSync(sessionFile)) {
      args.push('--resume', options.sessionId);
    } else {
      debugLog(`[ClaudeSDK] Session ${options.sessionId} not found at ${sessionFile} — starting fresh`);
    }
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
    const agentsJson = JSON.stringify(options.agents);
    debugLog(`[ClaudeSDK] Passing --agents with keys: [${Object.keys(options.agents).join(', ')}], JSON length: ${agentsJson.length}`);
    args.push('--agents', agentsJson);
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

  // Strip env vars that Claude CLI uses to detect nested sessions.
  // When our server runs inside a Claude Code session (e.g. VSCode extension),
  // the parent sets these — passing them through causes:
  //   "Claude Code cannot be launched inside another Claude Code session"
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_AGENT_SDK_VERSION;
  delete cleanEnv.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING;

  // On Windows, .cmd wrappers must run through cmd.exe (shell: true).
  // The binary path must be quoted so cmd.exe handles spaces correctly.
  const useShell = isWindows && claudeBin.endsWith('.cmd');
  const spawnBin = useShell ? `"${claudeBin}"` : claudeBin;

  const proc = spawn(spawnBin, args, {
    cwd: options.cwd,
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(useShell ? { shell: true } : {}),
  });

  // Keep stdin open for bidirectional communication (control_request/control_response)
  // Send initial prompt via stdin (required when using --input-format stream-json)
  if (options.onStdinReady) {
    options.onStdinReady((data: string) => {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write(data + '\n');
      }
    });
  }

  // Send the initial user message via stdin
  const userMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: prompt,
    },
  };
  proc.stdin!.write(JSON.stringify(userMessage) + '\n');

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
    emittedToolUseIds: new Set(),
    hasEmittedText: false,
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

        // Close stdin when CLI signals it's done (allows process to exit)
        if (event.type === 'result' && proc.stdin && !proc.stdin.destroyed) {
          debugLog('[ClaudeSDK] Received result event, closing stdin to allow process exit');
          proc.stdin.end();
        }

        const messages = processEvent(state, event);
        for (const msg of messages) push(msg);
      } catch {
        // non-JSON stderr-like line
      }
    }
  });

  let stderrAccumulated = '';
  let hasEmittedStderrError = false;

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrAccumulated += text;
    const trimmed = stripAnsi(text).trim();
    if (!trimmed) return;
    // Emit rate-limit signals immediately so the client can show the proper UI
    if (/rate.?limit|hit.?(?:your|the)?.?limit|you.?ve hit|usage.?limit|quota|too many requests|429|overloaded/i.test(trimmed)) {
      hasEmittedStderrError = true;
      push({ type: 'error', error: trimmed });
    }
  });

  proc.on('close', (code) => {
    // Close stdin if still open
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.end();
    }

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

    // If CLI exited with error code and no text was produced, emit a fallback error
    // so the frontend doesn't show an empty message bubble
    if (code && code !== 0 && !state.hasEmittedText && !hasEmittedStderrError) {
      // Use accumulated stderr as the error message if available — it has the actual reason.
      // Deliberately avoid "usage limit" language here so we don't trigger the rate limit
      // detector with a false positive (exit code 1 has many causes beyond rate limits).
      const stderrMsg = stderrAccumulated.trim()
        ? extractClaudeError(stderrAccumulated)
        : null;
      const fallback = stderrMsg || `Claude exited unexpectedly (exit code ${code}). Check your network connection or try again.`;
      push({ type: 'error', error: fallback });
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

// ─── Error extraction helper ─────────────────────────────────────────────────

// ─── ANSI escape code stripping ─────────────────────────────────────────────

/** Strip ANSI escape sequences (colors, cursor, etc.) from a string. */
function stripAnsi(text: string): string {
  // Matches: ESC[ ... final byte | ESC (non-[ sequences) | operating system commands
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b[^[[]|\x1b\].*?(?:\x07|\x1b\\)/g, '');
}

/**
 * Extract the most useful error line from Claude CLI's stderr output.
 * Prefers lines that mention specific error conditions; falls back to the last non-empty line.
 */
function extractClaudeError(stderr: string): string | null {
  const clean = stripAnsi(stderr);
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  // Prefer lines with specific error keywords
  const errorLine = lines.findLast(l =>
    /error|failed|unauthorized|forbidden|timeout|ENOENT|ECONNREFUSED/i.test(l),
  );
  return errorLine || lines[lines.length - 1] || null;
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

  if (event.type === 'control_request') {
    const request = event.request as Record<string, unknown> | undefined;
    if (request?.subtype === 'can_use_tool') {
      debugLog(`[ClaudeSDK] control_request: tool="${request.tool_name}", request_id="${event.request_id}"`);
      return [{
        type: 'control_request',
        requestId: event.request_id as string,
        toolName: request.tool_name as string,
        toolInput: (request.input as Record<string, unknown>) || {},
        toolUseId: request.tool_use_id as string | undefined,
      }];
    }
    return [];
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
    // Log registered agents for debugging --agents flag
    if (event.agents) {
      debugLog(`[ClaudeSDK] Registered agents: [${(event.agents as string[]).join(', ')}]`);
    }
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
            const toolId = (block.id as string) || '';
            // Deduplicate: --include-partial-messages can re-emit assistant messages
            if (toolId && state.emittedToolUseIds.has(toolId)) continue;
            if (toolId) state.emittedToolUseIds.add(toolId);
            messages.push({
              type: 'tool_use',
              tool: (block.name as string) || '',
              requestId: toolId,
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
      const toolId = (block.id as string) || '';
      state.currentBlockType = 'tool_use';
      state.currentToolId = toolId || null;
      state.currentToolName = (block.name as string) || null;
      state.currentToolInputJson = '';
      // Deduplicate: --include-partial-messages can re-emit the same tool_use block
      if (toolId && state.emittedToolUseIds.has(toolId)) {
        return messages; // already emitted this tool_use
      }
      if (toolId) state.emittedToolUseIds.add(toolId);
      messages.push({
        type: 'tool_use',
        tool: (block.name as string) || '',
        requestId: toolId,
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
      state.hasEmittedText = true;
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
