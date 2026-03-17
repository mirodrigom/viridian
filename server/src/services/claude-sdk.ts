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

import { spawn } from 'child_process';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';  // used for mkdtempSync
import { v4 as uuid } from 'uuid';
import { getHomeDir, isWindows, cwdToHash } from '../utils/platform.js';

// ─── Sub-module imports ──────────────────────────────────────────────────────

import { findClaudeBinary } from './claude-binary.js';
import { processEvent } from './claude-events.js';
import { stripAnsi, extractClaudeError, debugLog } from './claude-utils.js';

import type { QueryOptions, BlockState, SDKMessage } from './claude-types.js';

// ─── Re-exports (preserve all existing public API) ──────────────────────────

export { findClaudeBinary } from './claude-binary.js';
export { processEvent, processStreamEvent } from './claude-events.js';
export { stripAnsi, extractClaudeError, decodeUnicodeEscapes, debugLog } from './claude-utils.js';
export type {
  SDKTextDelta,
  SDKThinkingStart,
  SDKThinkingDelta,
  SDKThinkingEnd,
  SDKToolUse,
  SDKToolInputDelta,
  SDKToolInputComplete,
  SDKError,
  SDKSystem,
  SDKResult,
  SDKMessageDelta,
  SDKMessageStart,
  SDKSubagentResult,
  SDKControlRequest,
  SDKMessage,
  QueryOptions,
  BlockState,
} from './claude-types.js';

// ─── Core query function — returns AsyncGenerator ───────────────────────────

export async function* claudeQuery(options: QueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
  const claudeBin = findClaudeBinary();

  // Prepare temp files for PDFs (images are sent as vision content blocks instead)
  let imageTempDir: string | null = null;
  const documentPaths: string[] = [];
  // Collect image vision blocks for inline delivery (no temp files needed)
  const imageBlocks: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [];

  if (options.images?.length) {
    for (const img of options.images) {
      // Handle PDF files — still use temp files since PDFs are read via the Read tool
      const pdfMatch = img.dataUrl.match(/^data:application\/pdf;base64,(.+)$/);
      if (pdfMatch) {
        if (!imageTempDir) imageTempDir = mkdtempSync(join(tmpdir(), 'claude-img-'));
        const buf = Buffer.from(pdfMatch[1]!, 'base64');
        const filePath = join(imageTempDir, `${img.name || uuid().slice(0, 8) + '.pdf'}`);
        writeFileSync(filePath, buf);
        documentPaths.push(filePath);
        continue;
      }
      // Handle image files — send as vision content blocks (no temp files, no Read tool needed)
      const match = img.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) continue;
      imageBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1]!, data: match[2]! },
      });
    }
  }

  // Build prompt — prepend document paths so Claude can read PDFs with its Read tool
  let prompt = options.prompt;
  if (documentPaths.length > 0) {
    const docRefs = documentPaths.join('\n');
    prompt = `[Attached PDF documents — use the Read tool to view them]\n${docRefs}\n\n${prompt}`;
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
    // On Windows with shell: true, empty string args get dropped.
    // Wrap in explicit quotes so cmd.exe preserves the empty argument.
    args.push('--tools', isWindows ? '""' : '');
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
  // When there are images, build a content array with vision blocks so Claude can see them
  // without needing the Read tool (which may be disabled in some contexts like diagram AI chat).
  const messageContent = imageBlocks.length > 0
    ? [...imageBlocks, { type: 'text', text: prompt }]
    : prompt;
  const userMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: messageContent,
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
    debugLog(`[ClaudeSDK] spawn error: ${err.message} (bin=${spawnBin}, cwd=${options.cwd})`);
    push({ type: 'error', error: `Failed to start Claude: ${err.message} (bin=${spawnBin}, cwd=${options.cwd})` });
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
