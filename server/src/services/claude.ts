import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';

interface ClaudeSession {
  id: string;
  claudeSessionId?: string;
  process: ChildProcess | null;
  cwd: string;
  emitter: EventEmitter;
  currentBlockType: string | null;
  currentToolInputJson: string;
  currentToolId: string | null;
  currentToolName: string | null;
}

const activeSessions = new Map<string, ClaudeSession>();

/** Resolve the claude binary path. Checks (in order):
 *  1. CLAUDE_PATH env var
 *  2. System PATH (which claude)
 *  3. VS Code extension (Flatpak and standard paths)
 */
let resolvedClaudePath: string | null = null;

function findClaudeBinary(): string {
  if (resolvedClaudePath) return resolvedClaudePath;

  // 1. Env var override
  if (process.env.CLAUDE_PATH && existsSync(process.env.CLAUDE_PATH)) {
    resolvedClaudePath = process.env.CLAUDE_PATH;
    console.log(`[claude] Using CLAUDE_PATH: ${resolvedClaudePath}`);
    return resolvedClaudePath;
  }

  // 2. System PATH
  try {
    const whichResult = execSync('which claude 2>/dev/null', { encoding: 'utf8' }).trim();
    if (whichResult) {
      resolvedClaudePath = whichResult;
      console.log(`[claude] Found in PATH: ${resolvedClaudePath}`);
      return resolvedClaudePath;
    }
  } catch {
    // not in PATH
  }

  // 3. VS Code extension (Flatpak and standard paths)
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
        .reverse(); // newest version first
      for (const dir of matches) {
        const binPath = join(extDir, dir, 'resources', 'native-binary', 'claude');
        if (existsSync(binPath)) {
          resolvedClaudePath = binPath;
          console.log(`[claude] Found in VS Code extension: ${resolvedClaudePath}`);
          return resolvedClaudePath;
        }
      }
    } catch {
      // skip
    }
  }

  throw new Error(
    'Claude CLI binary not found. Set CLAUDE_PATH env var, install claude globally, or install the Claude Code VS Code extension.'
  );
}

export function createSession(cwd: string): ClaudeSession {
  const session: ClaudeSession = {
    id: uuid(),
    process: null,
    cwd,
    emitter: new EventEmitter(),
    currentBlockType: null,
    currentToolInputJson: '',
    currentToolId: null,
    currentToolName: null,
  };
  activeSessions.set(session.id, session);
  return session;
}

export function getSession(id: string): ClaudeSession | undefined {
  return activeSessions.get(id);
}

export interface SendMessageOptions {
  model?: string;
  permissionMode?: string;
}

export function sendMessage(sessionId: string, prompt: string, options?: SendMessageOptions) {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error('Session not found');

  let claudeBin: string;
  try {
    claudeBin = findClaudeBinary();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Claude binary not found';
    console.error(`[claude] ${msg}`);
    session.emitter.emit('error', { error: msg });
    session.emitter.emit('stream_end', { sessionId: session.id });
    return;
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  if (session.claudeSessionId) {
    args.push('--session-id', session.claudeSessionId);
    args.push('--resume');
  }

  if (options?.model) {
    args.push('--model', options.model);
  }

  const permMode = options?.permissionMode || 'bypassPermissions';
  args.push('--permission-mode', permMode);

  args.push(
    '--allowedTools',
    'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    'TodoWrite', 'WebFetch', 'WebSearch', 'Task',
  );

  console.log(`[claude] Spawning: ${claudeBin}`);
  console.log(`[claude] Args: ${args.join(' ')}`);
  console.log(`[claude] CWD: ${session.cwd}`);

  const proc = spawn(claudeBin, args, {
    cwd: session.cwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  session.process = proc;
  session.emitter.emit('stream_start');

  // Close stdin so the CLI doesn't wait for input
  proc.stdin!.end();

  proc.on('error', (err) => {
    console.error(`[claude] Spawn error: ${err.message}`);
    session.emitter.emit('error', { error: `Failed to start Claude: ${err.message}` });
    session.emitter.emit('stream_end', { sessionId: session.id });
  });

  let buffer = '';

  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        processEvent(session, event);
      } catch {
        console.log(`[claude] stdout (non-JSON): ${line.substring(0, 200)}`);
      }
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (!text) return;
    console.log(`[claude] stderr: ${text.substring(0, 500)}`);
    if (text.includes('Error') || text.includes('error') || text.includes('ENOENT')) {
      session.emitter.emit('error', { error: text });
    }
  });

  proc.on('close', (code) => {
    console.log(`[claude] Process exited with code ${code}`);
    session.process = null;
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        processEvent(session, event);
      } catch {
        // ignore
      }
    }
    session.emitter.emit('stream_end', {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      exitCode: code,
    });
  });
}

function processEvent(session: ClaudeSession, event: Record<string, unknown>) {
  // Unwrap stream_event wrapper from --include-partial-messages
  if (event.type === 'stream_event') {
    const inner = event.event as Record<string, unknown> | undefined;
    if (!inner) return;
    processStreamEvent(session, inner);
    return;
  }

  // result: final response with session_id
  if (event.type === 'result') {
    if (event.session_id) {
      session.claudeSessionId = event.session_id as string;
    }
    // Don't emit result.result as delta - we already got it via streaming
    return;
  }

  // system init event
  if (event.type === 'system') {
    if (event.session_id) {
      session.claudeSessionId = event.session_id as string;
    }
    return;
  }

  // Full assistant message (comes after all stream_events)
  if (event.type === 'assistant') {
    // Already handled via streaming deltas, skip to avoid duplicate
    return;
  }
}

function processStreamEvent(session: ClaudeSession, event: Record<string, unknown>) {
  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (!block) return;

    if (block.type === 'thinking') {
      session.currentBlockType = 'thinking';
      session.emitter.emit('thinking_start', {});
      return;
    }

    if (block.type === 'tool_use') {
      session.currentBlockType = 'tool_use';
      session.currentToolId = (block.id as string) || null;
      session.currentToolName = (block.name as string) || null;
      session.currentToolInputJson = '';
      session.emitter.emit('tool_use', {
        tool: block.name,
        input: block.input || {},
        requestId: block.id,
      });
      return;
    }

    if (block.type === 'text') {
      session.currentBlockType = 'text';
      return;
    }
    return;
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (!delta) return;

    if (delta.type === 'thinking_delta' && delta.thinking) {
      session.emitter.emit('thinking_delta', { text: delta.thinking as string });
      return;
    }

    if (delta.type === 'text_delta' && delta.text) {
      session.emitter.emit('stream_delta', { text: delta.text as string });
      return;
    }

    if (delta.type === 'input_json_delta' && delta.partial_json) {
      session.currentToolInputJson += delta.partial_json as string;
      session.emitter.emit('tool_input_delta', {
        requestId: session.currentToolId,
        tool: session.currentToolName,
        partialJson: delta.partial_json as string,
        accumulatedJson: session.currentToolInputJson,
      });
      return;
    }
    return;
  }

  if (event.type === 'content_block_stop') {
    if (session.currentBlockType === 'thinking') {
      session.emitter.emit('thinking_end', {});
    }
    if (session.currentBlockType === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      try {
        if (session.currentToolInputJson) {
          parsedInput = JSON.parse(session.currentToolInputJson);
        }
      } catch { /* leave empty */ }
      session.emitter.emit('tool_input_complete', {
        requestId: session.currentToolId,
        tool: session.currentToolName,
        input: parsedInput,
      });
      session.currentToolInputJson = '';
    }
    session.currentBlockType = null;
    return;
  }

  if (event.type === 'message_delta') {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      session.emitter.emit('message_delta', {
        outputTokens: usage.output_tokens,
      });
    }
    return;
  }
}

export function abortSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session?.process) {
    session.process.kill('SIGTERM');
    session.process = null;
  }
}

export function removeSession(sessionId: string) {
  abortSession(sessionId);
  activeSessions.delete(sessionId);
}
