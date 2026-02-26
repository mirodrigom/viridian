/**
 * Aider CLI Provider Adapter.
 *
 * Spawns `aider --message "prompt"` in non-interactive mode and streams
 * stdout as SDKMessage events. Aider outputs plain text (no JSON mode),
 * so we parse its text output and detect file-edit patterns.
 *
 * Aider supports:
 * - Non-interactive mode via `--message`
 * - Model selection via `--model`
 * - Auto-accept via `--yes-always`
 * - File editing (search/replace blocks shown in output)
 * - Session history via `--restore-chat-history` + `--chat-history-file`
 *
 * Aider does NOT support:
 * - JSON output mode (plain text only)
 * - Extended thinking
 * - stdin-based control protocol
 * - Image input
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
import { getProviderConfig } from '../db/database.js';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getHomeDir, findBinary as findBinaryInPath, getCommonBinaryPaths } from '../utils/platform.js';

// ─── Provider metadata ──────────────────────────────────────────────────

const info: ProviderInfo = {
  id: 'aider',
  name: 'Aider',
  icon: 'AiderLogo',
  description: 'AI pair programming in your terminal — supports many LLMs',
  website: 'https://aider.chat',
  binaryName: 'aider',
  envVarForPath: 'AIDER_PATH',
  installCommand: 'pip install -q uv && uv python install 3.12 && uv venv ~/.aider-venv --python 3.12 && uv pip install --python ~/.aider-venv/bin/python aider-chat && mkdir -p ~/.local/bin && ln -sf ~/.aider-venv/bin/aider ~/.local/bin/aider',
};

const models: ProviderModel[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Best balance of speed and capability (via Aider)', isDefault: true },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most capable model (via Aider)' },
  { id: 'gpt-5.3', label: 'GPT-5.3', description: 'OpenAI latest flagship' },
  { id: 'gpt-5.2', label: 'GPT-5.2', description: 'OpenAI previous flagship' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google deep reasoning model' },
  { id: 'deepseek-r1', label: 'DeepSeek R1', description: 'Open-source reasoning model' },
];

const capabilities: ProviderCapabilities = {
  supportsThinking: false,
  supportsToolUse: true,         // Aider edits files directly
  supportsPermissionModes: false, // Uses --yes-always, no granular modes
  supportsImages: false,
  supportsResume: true,           // Via --restore-chat-history
  supportsStreaming: true,
  supportsControlRequests: false, // No stdin control protocol
  supportsSubagents: false,
  supportsPlanMode: false,
  supportedPermissionModes: ['bypassPermissions'], // Always auto-approve
  customFeatures: ['multi_model', 'auto_lint', 'auto_test', 'architect_mode'],
};

// ─── Binary resolution ──────────────────────────────────────────────────

let resolvedPath: string | null = null;

function findAiderBinary(): string {
  if (resolvedPath) return resolvedPath;

  if (process.env.AIDER_PATH && existsSync(process.env.AIDER_PATH)) {
    resolvedPath = process.env.AIDER_PATH;
    return resolvedPath;
  }

  const inPath = findBinaryInPath('aider');
  if (inPath) { resolvedPath = inPath; return resolvedPath; }

  // Check common install locations (pip, pipx)
  const home = getHomeDir();
  const commonPaths = [
    ...getCommonBinaryPaths('aider'),
    join(home, '.local', 'pipx', 'venvs', 'aider-chat', 'bin', 'aider'),
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) { resolvedPath = p; return resolvedPath; }
  }

  throw new Error(
    'Aider binary not found. Install it with: pip install aider-chat, or set AIDER_PATH env var.',
  );
}

// ─── Output parsing helpers ─────────────────────────────────────────────

// Aider shows file edits in SEARCH/REPLACE block format:
//   filename
//   <<<<<<< SEARCH
//   old code
//   =======
//   new code
//   >>>>>>> REPLACE
const EDIT_BLOCK_START = /^(.+)\n<<<<<<< SEARCH$/m;
const EDIT_BLOCK_SEPARATOR = '=======';
const EDIT_BLOCK_END = '>>>>>>> REPLACE';

interface ParsedEdit {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

/**
 * Extract SEARCH/REPLACE edit blocks from aider output.
 * Returns the edits found and the remaining text.
 */
function extractEditBlocks(text: string): { edits: ParsedEdit[]; cleanText: string } {
  const edits: ParsedEdit[] = [];
  let cleanText = text;

  // Match complete edit blocks
  const blockRegex = /^(.+)\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE$/gm;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(text)) !== null) {
    edits.push({
      filePath: match[1]!.trim(),
      searchContent: match[2]!,
      replaceContent: match[3]!,
    });
    cleanText = cleanText.replace(match[0], '');
  }

  return { edits, cleanText: cleanText.trim() };
}

// ─── IProvider implementation ───────────────────────────────────────────

let editBlockIdCounter = 0;

const aiderProvider: IProvider = {
  info,
  models,
  capabilities,

  isAvailable(): boolean {
    try {
      findAiderBinary();
      return true;
    } catch {
      return false;
    }
  },

  findBinary(): string {
    return findAiderBinary();
  },

  isConfigured() {
    // Check keys explicitly stored for Aider via our settings flow.
    // Do NOT read shared env vars (GEMINI_API_KEY etc.) because they may have
    // been set by other providers (e.g. Gemini) and would give a false positive.
    const stored = getProviderConfig('aider');
    if (
      stored['ANTHROPIC_API_KEY'] ||
      stored['OPENAI_API_KEY'] ||
      stored['GEMINI_API_KEY'] ||
      stored['DEEPSEEK_API_KEY']
    ) return { configured: true };
    // Also accept ~/.aider.conf.yml (user set up Aider outside our app)
    const home = getHomeDir();
    if (
      existsSync(join(home, '.aider.conf.yml')) ||
      existsSync(join(home, '.config', 'aider', 'aider.conf.yml'))
    ) return { configured: true };
    return {
      configured: false,
      reason: 'No API key found. Configure a key via Settings.',
    };
  },

  async *query(options: ProviderQueryOptions): AsyncGenerator<SDKMessage, void, undefined> {
    const aiderBin = findAiderBinary();

    // Build args: aider --message "prompt" [flags]
    const args = [
      '--message', options.prompt,
      '--yes-always',          // Non-interactive: auto-accept all
      '--no-auto-commits',     // We manage git separately
      '--no-pretty',           // Clean output without ANSI codes
      '--no-suggest-shell-commands', // Don't suggest shell commands interactively
    ];

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.noTools) {
      args.push('--no-auto-lint', '--no-auto-test');
    }

    // Session resume: point to a chat history file
    if (options.sessionId) {
      const sessionDir = aiderProvider.getSessionDir();
      if (sessionDir) {
        const historyFile = join(sessionDir, `${options.sessionId}.md`);
        args.push('--restore-chat-history', '--chat-history-file', historyFile);
      }
    }

    const proc = spawn(aiderBin, args, {
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
    let fullOutput = '';
    let hasEmittedText = false;

    proc.stdout!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      buffer += text;
      fullOutput += text;

      // Stream text as it arrives
      // We'll do a final edit-block extraction on process close
      if (text) {
        hasEmittedText = true;
        push({ type: 'text_delta', text });
      }
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      // Aider prints progress/info to stderr; only emit real errors
      if (text && (text.includes('Error') || text.includes('error:') || text.includes('FAILED'))) {
        push({ type: 'error', error: text });
      }
    });

    proc.on('close', (code) => {
      // Extract edit blocks from the full output
      const { edits } = extractEditBlocks(fullOutput);
      for (const edit of edits) {
        push({
          type: 'tool_use',
          tool: 'Edit',
          requestId: `aider-edit-${++editBlockIdCounter}`,
          input: {
            file_path: edit.filePath,
            old_string: edit.searchContent,
            new_string: edit.replaceContent,
          },
        });
      }

      if (code && code !== 0 && !hasEmittedText) {
        push({ type: 'error', error: `Aider exited unexpectedly (exit code ${code}).` });
      }

      push({ type: 'result', exitCode: code });
      finish();
    });

    proc.on('error', (err) => {
      push({ type: 'error', error: `Failed to start Aider: ${err.message}` });
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
    // Aider doesn't support stdin control protocol
    return null;
  },

  getSessionDir(): string | null {
    // Aider stores chat history in .aider.chat.history.md in the project dir,
    // but we create a centralized session dir for our use
    const home = getHomeDir();
    const dir = join(home, '.aider', 'sessions');
    return dir; // Will be created on first use if needed
  },
};

// Auto-register on import
registerProvider(aiderProvider);

export default aiderProvider;
