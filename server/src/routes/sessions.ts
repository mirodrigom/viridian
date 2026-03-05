import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { readdirSync, statSync, existsSync, unlinkSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';
import { getHomeDir, cwdToHash } from '../utils/platform.js';
import { createInterface } from 'readline';
import { decodeUnicodeEscapes } from '../services/claude-sdk.js';
import { getDb } from '../db/database.js';
import { getStreamingClaudeSessionIds } from '../services/claude.js';
import { isGraphRunnerSession } from '../services/graph-runner.js';
import { isInternalSession } from './git.js';
import { randomUUID } from 'crypto';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

interface SessionInfo {
  id: string;
  title: string;
  projectPath: string;
  projectDir: string;
  messageCount: number;
  lastActive: number;
  isStreaming?: boolean;
  provider?: string;
}

const CLAUDE_DIR = join(getHomeDir(), '.claude', 'projects');

/**
 * Scan a single JSONL file and extract session metadata.
 * Reads line-by-line (streaming) so large files don't blow memory.
 */
async function extractSessionMeta(jsonlPath: string): Promise<{
  title: string;
  messageCount: number;
  cwd: string;
  lastTimestamp: string;
} | null> {
  return new Promise((resolve) => {
    let title = '';
    let messageCount = 0;
    let cwd = '';
    let lastTimestamp = '';

    const rl = createInterface({
      input: createReadStream(jsonlPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line);

        // Extract cwd from any entry that has it
        if (entry.cwd && !cwd) {
          cwd = entry.cwd;
        }

        // Track timestamps
        if (entry.timestamp) {
          lastTimestamp = entry.timestamp;
        }

        // Count user and assistant messages
        if (entry.type === 'user' || entry.type === 'assistant') {
          messageCount++;
        }

        // Use summary entries for title if available
        if (entry.type === 'summary' && entry.summary && !title) {
          const summary = entry.summary as string;
          if (!summary.startsWith('{ "')) {
            title = summary.slice(0, 80);
          }
        }

        // Extract first user message as fallback title
        if (!title && entry.type === 'user' && entry.message?.content) {
          const content = entry.message.content;
          let raw = '';
          if (typeof content === 'string') {
            raw = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                raw = block.text as string;
                break;
              }
            }
          }
          if (raw) {
            // Strip common prompt prefixes/instructions that don't make good titles
            // e.g. "ultrathink before responding. Actual question here"
            const prefixPattern = /^(ultrathink|think harder|think step by step|think carefully|think deeply|think more|before responding)[.,!?\s]*/gi;
            let cleaned = raw;
            // Apply repeatedly to strip chained prefixes
            let prev = '';
            while (cleaned !== prev) {
              prev = cleaned;
              cleaned = cleaned.replace(prefixPattern, '');
            }
            cleaned = cleaned.trim();
            title = (cleaned || raw).slice(0, 80);
          }
        }
      } catch {
        // skip non-JSON lines
      }
    });

    rl.on('close', () => {
      if (messageCount === 0) {
        resolve(null);
        return;
      }
      resolve({ title: title || 'Untitled session', messageCount, cwd, lastTimestamp });
    });

    rl.on('error', () => resolve(null));
  });
}

/**
 * GET /api/sessions?project=<path>
 *
 * Lists Claude Code sessions from ~/.claude/projects/ JSONL history.
 * If project is provided, filters to only that project's encoded directory.
 * Otherwise returns sessions from all projects.
 */
router.get('/', async (req, res) => {
  try {
    const projectFilter = req.query.project as string | undefined;

    if (!existsSync(CLAUDE_DIR)) {
      res.json({ sessions: [] });
      return;
    }

    const db = getDb();

    // List all project directories
    let projectDirs: string[];
    try {
      projectDirs = readdirSync(CLAUDE_DIR).filter(name => {
        try {
          return statSync(join(CLAUDE_DIR, name)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      res.json({ sessions: [] });
      return;
    }

    // If project filter, find dirs that match exactly
    if (projectFilter) {
      const encoded = cwdToHash(projectFilter);
      projectDirs = projectDirs.filter(d => d === encoded);
    }

    const sessions: SessionInfo[] = [];
    const getCached = db.prepare(
      'SELECT * FROM session_cache WHERE project_dir = ? AND id = ?',
    );
    // ON CONFLICT preserves the `provider` column set during streaming
    const upsertCache = db.prepare(`
      INSERT INTO session_cache (id, project_dir, title, project_path, message_count, last_active, file_mtime)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_dir, id) DO UPDATE SET
        title = excluded.title,
        project_path = excluded.project_path,
        message_count = excluded.message_count,
        last_active = excluded.last_active,
        file_mtime = excluded.file_mtime
    `);

    for (const dir of projectDirs) {
      const dirPath = join(CLAUDE_DIR, dir);
      let files: string[];
      try {
        files = readdirSync(dirPath).filter(f =>
          f.endsWith('.jsonl') && !f.startsWith('agent-')
        );
      } catch {
        continue;
      }

      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');

        // Skip sessions created by graph runner executions
        if (isGraphRunnerSession(sessionId)) continue;

        // Skip sessions created by internal utility queries (commit message generation, etc.)
        if (isInternalSession(sessionId)) continue;

        const filePath = join(dirPath, file);

        let mtimeMs: number;
        try {
          const stat = statSync(filePath);
          mtimeMs = stat.mtimeMs;
        } catch {
          continue;
        }

        // Check cache
        const cached = getCached.get(dir, sessionId) as {
          title: string; project_path: string; message_count: number;
          last_active: number; file_mtime: number; provider?: string;
          is_internal?: number;
        } | undefined;

        // Skip sessions marked as internal in the DB (persisted across restarts)
        if (cached?.is_internal) continue;

        if (cached && cached.file_mtime === Math.floor(mtimeMs)) {
          sessions.push({
            id: sessionId,
            title: cached.title,
            projectPath: cached.project_path,
            projectDir: dir,
            messageCount: cached.message_count,
            lastActive: cached.last_active,
            provider: cached.provider || 'claude',
          });
          continue;
        }

        // Cache miss — parse the file
        const meta = await extractSessionMeta(filePath);
        if (!meta) continue;

        const projectPath = meta.cwd || ('/' + dir.replace(/^-/, '').replace(/-/g, '/'));

        // Update cache
        upsertCache.run(sessionId, dir, meta.title, projectPath, meta.messageCount, mtimeMs, Math.floor(mtimeMs));

        sessions.push({
          id: sessionId,
          title: meta.title,
          projectPath,
          projectDir: dir,
          messageCount: meta.messageCount,
          lastActive: mtimeMs,
        });
      }
    }

    // Tag sessions that are currently streaming on the server
    const streamingIds = getStreamingClaudeSessionIds();
    for (const s of sessions) {
      if (streamingIds.has(s.id)) {
        s.isStreaming = true;
      }
    }

    // Sort by most recent first
    sessions.sort((a, b) => b.lastActive - a.lastActive);

    res.set('Cache-Control', 'no-cache');
    res.json({ sessions });
  } catch (err) {
    console.error('[sessions] Error:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/**
 * GET /api/sessions/:id/messages?projectDir=<encoded-dir>
 *
 * Reads a session JSONL file and returns user/assistant messages.
 */
router.get('/:id/messages', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const projectDir = req.query.projectDir as string | undefined;

    if (!projectDir) {
      res.status(400).json({ error: 'projectDir query param required' });
      return;
    }

    // Sanitize: only allow alphanumeric, hyphens, underscores in dir/id
    if (!/^[\w-]+$/.test(projectDir) || !/^[\w-]+$/.test(sessionId)) {
      res.status(400).json({ error: 'Invalid projectDir or session id' });
      return;
    }

    const filePath = join(CLAUDE_DIR, projectDir, `${sessionId}.jsonl`);

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Pagination params
    const rawLimit = parseInt(req.query.limit as string);
    const limit = Math.min(Number.isNaN(rawLimit) ? 50 : rawLimit, 200);
    const rawBefore = parseInt(req.query.before as string);
    const before = req.query.before !== undefined && !Number.isNaN(rawBefore)
      ? rawBefore
      : undefined;
    const rawAfter = parseInt(req.query.after as string);
    const after = req.query.after !== undefined && !Number.isNaN(rawAfter)
      ? rawAfter
      : undefined;

    interface ParsedMessage {
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: number;
      thinking?: string;
      images?: { name: string; dataUrl: string }[];
      toolUse?: {
        tool: string;
        input: Record<string, unknown>;
        requestId: string;
        status: 'approved';
      };
      isContextSummary?: boolean;
    }

    const allMessages: ParsedMessage[] = [];

    // Track the latest usage data from assistant entries
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let lastCacheCreation = 0;
    let lastCacheRead = 0;

    await new Promise<void>((resolve) => {
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const entry = JSON.parse(line);

          if (entry.type === 'user' && entry.message?.content) {
            let content = '';
            let images: { name: string; dataUrl: string }[] | undefined;

            if (typeof entry.message.content === 'string') {
              content = entry.message.content;
            } else if (Array.isArray(entry.message.content)) {
              content = entry.message.content
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text)
                .join('\n');

              // Extract image blocks (base64-encoded images from Claude Code)
              const imageBlocks = entry.message.content.filter(
                (b: { type: string }) => b.type === 'image'
              );
              if (imageBlocks.length > 0) {
                images = imageBlocks.map((b: { source?: { media_type?: string; data?: string } }, i: number) => ({
                  name: `image-${i + 1}`,
                  dataUrl: `data:${b.source?.media_type || 'image/png'};base64,${b.source?.data || ''}`,
                }));
              }
            }

            if (content || images?.length) {
              // Detect context window resize summary messages
              const isContextSummary = content.startsWith('This session is being continued from a previous conversation');
              allMessages.push({
                id: entry.uuid || `user-${allMessages.length}`,
                role: isContextSummary ? 'system' : 'user',
                content: content || '(image)',
                timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
                images: isContextSummary ? undefined : images,
                isContextSummary: isContextSummary || undefined,
              });
            }
          }

          if (entry.type === 'assistant' && entry.message?.content) {
            // Extract usage from assistant entries (latest values = current context window)
            const usage = entry.message?.usage;
            if (usage) {
              if (usage.input_tokens) lastInputTokens = usage.input_tokens;
              if (usage.output_tokens) lastOutputTokens = usage.output_tokens;
              if (usage.cache_creation_input_tokens) lastCacheCreation = usage.cache_creation_input_tokens;
              if (usage.cache_read_input_tokens) lastCacheRead = usage.cache_read_input_tokens;
            }

            const contentBlocks = entry.message.content;
            const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

            if (Array.isArray(contentBlocks)) {
              // Extract thinking text (always shown with the first assistant text)
              const thinkingText = decodeUnicodeEscapes(
                contentBlocks
                  .filter((b: { type: string }) => b.type === 'thinking')
                  .map((b: { thinking: string }) => b.thinking)
                  .join('\n'),
              );

              // Emit blocks in order: preserves the natural flow where tools
              // appear between text segments (e.g. text → tool → tool → text)
              let pendingText = '';
              let thinkingUsed = false;

              for (const block of contentBlocks) {
                if (block.type === 'text' && block.text) {
                  pendingText += (pendingText ? '\n' : '') + decodeUnicodeEscapes(block.text);
                } else if (block.type === 'tool_use') {
                  // Flush any pending text before the tool
                  if (pendingText) {
                    allMessages.push({
                      id: entry.uuid || `asst-${allMessages.length}`,
                      role: 'assistant',
                      content: pendingText,
                      timestamp: ts,
                      thinking: !thinkingUsed ? (thinkingText || undefined) : undefined,
                    });
                    pendingText = '';
                    thinkingUsed = true;
                  } else if (!thinkingUsed && thinkingText) {
                    // No text before first tool — emit empty assistant msg with thinking
                    allMessages.push({
                      id: entry.uuid || `asst-${allMessages.length}`,
                      role: 'assistant',
                      content: '',
                      timestamp: ts,
                      thinking: thinkingText,
                    });
                    thinkingUsed = true;
                  }
                  allMessages.push({
                    id: block.id || `tool-${allMessages.length}`,
                    role: 'system',
                    content: `Tool request: ${block.name}`,
                    timestamp: ts,
                    toolUse: {
                      tool: block.name,
                      input: block.input || {},
                      requestId: block.id || `tool-${allMessages.length}`,
                      status: 'approved',
                    },
                  });
                }
              }

              // Flush remaining text
              if (pendingText) {
                allMessages.push({
                  id: `asst-${allMessages.length}`,
                  role: 'assistant',
                  content: pendingText,
                  timestamp: ts,
                  thinking: !thinkingUsed ? (thinkingText || undefined) : undefined,
                });
              }
            } else if (typeof contentBlocks === 'string' && contentBlocks) {
              allMessages.push({
                id: entry.uuid || `asst-${allMessages.length}`,
                role: 'assistant',
                content: decodeUnicodeEscapes(contentBlocks),
                timestamp: ts,
              });
            }
          }
        } catch {
          // skip non-JSON lines
        }
      });

      rl.on('close', resolve);
      rl.on('error', () => resolve());
    });

    const total = allMessages.length;

    // Context window usage: input_tokens from the last assistant response is the
    // best proxy for how much of the 200k context is used.
    // Total effective input = input_tokens + cache_creation + cache_read
    const contextTokens = lastInputTokens + lastCacheCreation + lastCacheRead;
    const usageData = {
      inputTokens: contextTokens,
      outputTokens: lastOutputTokens,
    };

    // Delta mode: return messages after a given index
    if (after !== undefined) {
      const startIdx = Math.max(0, after);
      const deltaMessages = allMessages.slice(startIdx);
      res.json({
        messages: deltaMessages,
        total,
        hasMore: false,
        oldestIndex: startIdx,
        usage: usageData,
      });
      return;
    }

    // Pagination mode
    let endIndex: number;
    let startIndex: number;

    if (before !== undefined) {
      // Load older messages: return `limit` messages ending before `before`
      endIndex = Math.min(before, total);
      startIndex = Math.max(0, endIndex - limit);
    } else {
      // Initial load: return the last `limit` messages
      endIndex = total;
      startIndex = Math.max(0, total - limit);
    }

    const messages = allMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    // Check if this session is currently streaming on the server
    const streamingIds = getStreamingClaudeSessionIds();
    const isStreaming = streamingIds.has(sessionId);

    // Look up provider from cache so clients can display per-session provider logo
    const db2 = getDb();
    const cachedProvider = db2.prepare(
      'SELECT provider FROM session_cache WHERE id = ?',
    ).get(sessionId) as { provider?: string } | undefined;
    const sessionProvider = cachedProvider?.provider || 'claude';

    res.json({ messages, total, hasMore, oldestIndex: startIndex, usage: usageData, isStreaming, sessionProvider });
  } catch (err) {
    console.error('[sessions] Error loading messages:', err);
    res.status(500).json({ error: 'Failed to load session messages' });
  }
});

/**
 * DELETE /api/sessions/:id?projectDir=<encoded-dir>
 *
 * Deletes a session JSONL file.
 */
router.delete('/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const projectDir = req.query.projectDir as string | undefined;

    if (!projectDir) {
      res.status(400).json({ error: 'projectDir query param required' });
      return;
    }

    if (!/^[\w-]+$/.test(projectDir) || !/^[\w-]+$/.test(sessionId)) {
      res.status(400).json({ error: 'Invalid projectDir or session id' });
      return;
    }

    const filePath = join(CLAUDE_DIR, projectDir, `${sessionId}.jsonl`);

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    unlinkSync(filePath);
    // Clean up cache
    try { getDb().prepare('DELETE FROM session_cache WHERE project_dir = ? AND id = ?').run(projectDir, sessionId); } catch (err) { console.warn('[sessions] Cache cleanup failed:', err); }
    res.json({ success: true });
  } catch (err) {
    console.error('[sessions] Error deleting session:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

/**
 * DELETE /api/sessions/project/:dir
 *
 * Deletes all sessions in a project directory.
 */
router.delete('/project/:dir', async (req, res) => {
  try {
    const projectDir = req.params.dir;

    if (!/^[\w-]+$/.test(projectDir)) {
      res.status(400).json({ error: 'Invalid projectDir' });
      return;
    }

    const dirPath = join(CLAUDE_DIR, projectDir);

    if (!existsSync(dirPath)) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Delete all JSONL files in the directory
    const files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      unlinkSync(join(dirPath, file));
    }

    // Clean up cache for this project
    try { getDb().prepare('DELETE FROM session_cache WHERE project_dir = ?').run(projectDir); } catch (err) { console.warn('[sessions] Cache cleanup failed:', err); }

    // Remove the directory if empty
    try {
      const remaining = readdirSync(dirPath);
      if (remaining.length === 0) {
        rmSync(dirPath, { recursive: true });
      }
    } catch (err) { console.warn('[sessions] Dir cleanup failed:', err); }

    console.log(`[sessions] Deleted project ${projectDir} (${files.length} sessions)`);
    res.json({ success: true, deleted: files.length });
  } catch (err) {
    console.error('[sessions] Error deleting project:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/**
 * POST /api/sessions/:id/fork
 *
 * Creates a copy of an existing session up to (not including) the message with
 * forkBeforeUuid. If omitted, copies the entire session.
 *
 * Body: { projectDir: string, forkBeforeUuid?: string }
 * Returns: { newSessionId: string }
 */
router.post('/:id/fork', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { projectDir, forkBeforeUuid } = req.body as { projectDir?: string; forkBeforeUuid?: string };

    if (!projectDir) {
      res.status(400).json({ error: 'projectDir required' });
      return;
    }

    if (!/^[\w-]+$/.test(projectDir) || !/^[\w-]+$/.test(sessionId)) {
      res.status(400).json({ error: 'Invalid projectDir or session id' });
      return;
    }

    const srcPath = join(CLAUDE_DIR, projectDir, `${sessionId}.jsonl`);
    if (!existsSync(srcPath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Read all lines
    const rawLines = readFileSync(srcPath, 'utf-8').split('\n').filter(l => l.trim());

    let cutoffIdx = rawLines.length; // default: copy entire file
    if (forkBeforeUuid) {
      for (let i = 0; i < rawLines.length; i++) {
        try {
          const entry = JSON.parse(rawLines[i]!);
          if (entry.uuid === forkBeforeUuid) {
            cutoffIdx = i;
            break;
          }
        } catch { /* skip malformed lines */ }
      }
    }

    const linesToCopy = rawLines.slice(0, cutoffIdx);

    // Write new JSONL
    const newSessionId = randomUUID();
    const destDir = join(CLAUDE_DIR, projectDir);
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, `${newSessionId}.jsonl`);
    writeFileSync(destPath, linesToCopy.join('\n') + (linesToCopy.length ? '\n' : ''), 'utf-8');

    // Seed cache entry with "Fork: " prefix
    const db = getDb();
    const srcCache = db.prepare('SELECT * FROM session_cache WHERE project_dir = ? AND id = ?')
      .get(projectDir, sessionId) as { title?: string; project_path?: string; provider?: string } | undefined;

    db.prepare(`
      INSERT OR REPLACE INTO session_cache (project_dir, id, title, project_path, message_count, last_active, file_mtime, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectDir,
      newSessionId,
      `Fork: ${srcCache?.title || sessionId.slice(0, 8)}`,
      srcCache?.project_path || '',
      linesToCopy.length,
      Date.now(),
      statSync(destPath).mtimeMs,
      srcCache?.provider || 'claude',
    );

    console.log(`[sessions] Forked ${sessionId} → ${newSessionId} (${linesToCopy.length} lines, cutoff ${forkBeforeUuid || 'end'})`);
    res.json({ newSessionId, projectDir });
  } catch (err) {
    console.error('[sessions] Fork error:', err);
    res.status(500).json({ error: 'Failed to fork session' });
  }
});

export default router;
