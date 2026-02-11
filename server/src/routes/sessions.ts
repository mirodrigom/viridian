import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { readdirSync, statSync, existsSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

interface SessionInfo {
  id: string;
  title: string;
  projectPath: string;
  projectDir: string;
  messageCount: number;
  lastActive: number;
}

const CLAUDE_DIR = join(process.env.HOME || '/home', '.claude', 'projects');

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
          if (typeof content === 'string') {
            title = content.slice(0, 80);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                title = (block.text as string).slice(0, 80);
                break;
              }
            }
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

    console.log(`[sessions] Listing sessions. CLAUDE_DIR=${CLAUDE_DIR}, projectFilter=${projectFilter || '(all)'}`);

    if (!existsSync(CLAUDE_DIR)) {
      console.log(`[sessions] CLAUDE_DIR does not exist`);
      res.json({ sessions: [] });
      return;
    }

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
    } catch (err) {
      console.error(`[sessions] Cannot read CLAUDE_DIR:`, err);
      res.json({ sessions: [] });
      return;
    }

    console.log(`[sessions] Found ${projectDirs.length} project dirs: ${projectDirs.join(', ')}`);

    // If project filter, find dirs that match exactly or are a parent path.
    // e.g. projectFilter="/home/rodrigom/Documents/self-agent/claude-code-web"
    //   should match dir "-home-rodrigom-Documents-self-agent" (parent)
    if (projectFilter) {
      const encoded = projectFilter.replace(/\//g, '-');
      console.log(`[sessions] Filtering for encoded path: ${encoded}`);
      projectDirs = projectDirs.filter(d => d === encoded || encoded.startsWith(d + '-'));
      console.log(`[sessions] Matched ${projectDirs.length} dirs: ${projectDirs.join(', ')}`);
    }

    const sessions: SessionInfo[] = [];

    for (const dir of projectDirs) {
      const dirPath = join(CLAUDE_DIR, dir);
      let files: string[];
      try {
        files = readdirSync(dirPath).filter(f =>
          f.endsWith('.jsonl') && !f.startsWith('agent-')
        );
      } catch (err) {
        console.log(`[sessions] Cannot read dir ${dir}:`, err);
        continue;
      }

      console.log(`[sessions] Dir ${dir}: found ${files.length} JSONL files`);

      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        const filePath = join(dirPath, file);

        let lastActive: number;
        try {
          const stat = statSync(filePath);
          lastActive = stat.mtimeMs;
        } catch {
          continue;
        }

        const meta = await extractSessionMeta(filePath);
        if (!meta) {
          console.log(`[sessions] Skipped ${file}: no messages`);
          continue;
        }

        sessions.push({
          id: sessionId,
          title: meta.title,
          projectPath: meta.cwd || ('/' + dir.replace(/^-/, '').replace(/-/g, '/')),
          projectDir: dir,
          messageCount: meta.messageCount,
          lastActive,
        });
      }
    }

    // Sort by most recent first
    sessions.sort((a, b) => b.lastActive - a.lastActive);

    console.log(`[sessions] Returning ${sessions.length} sessions`);
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

    interface ParsedMessage {
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: number;
      thinking?: string;
      toolUse?: {
        tool: string;
        input: Record<string, unknown>;
        requestId: string;
        status: 'approved';
      };
    }

    const messages: ParsedMessage[] = [];

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
            const content = typeof entry.message.content === 'string'
              ? entry.message.content
              : Array.isArray(entry.message.content)
                ? entry.message.content
                    .filter((b: { type: string }) => b.type === 'text')
                    .map((b: { text: string }) => b.text)
                    .join('\n')
                : '';
            if (content) {
              messages.push({
                id: entry.uuid || `user-${messages.length}`,
                role: 'user',
                content,
                timestamp: entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now(),
              });
            }
          }

          if (entry.type === 'assistant' && entry.message?.content) {
            const contentBlocks = entry.message.content;
            const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

            if (Array.isArray(contentBlocks)) {
              // Extract thinking text
              const thinkingText = contentBlocks
                .filter((b: { type: string }) => b.type === 'thinking')
                .map((b: { thinking: string }) => b.thinking)
                .join('\n');

              // Extract text content
              const textContent = contentBlocks
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text)
                .join('\n');

              // Emit assistant message with thinking
              if (textContent || thinkingText) {
                messages.push({
                  id: entry.uuid || `asst-${messages.length}`,
                  role: 'assistant',
                  content: textContent,
                  timestamp: ts,
                  thinking: thinkingText || undefined,
                });
              }

              // Emit tool use messages
              for (const block of contentBlocks) {
                if (block.type === 'tool_use') {
                  messages.push({
                    id: block.id || `tool-${messages.length}`,
                    role: 'system',
                    content: `Tool request: ${block.name}`,
                    timestamp: ts,
                    toolUse: {
                      tool: block.name,
                      input: block.input || {},
                      requestId: block.id || `tool-${messages.length}`,
                      status: 'approved',
                    },
                  });
                }
              }
            } else if (typeof contentBlocks === 'string' && contentBlocks) {
              messages.push({
                id: entry.uuid || `asst-${messages.length}`,
                role: 'assistant',
                content: contentBlocks,
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

    res.json({ messages });
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
    console.log(`[sessions] Deleted session ${sessionId} from ${projectDir}`);
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

    // Remove the directory if empty
    try {
      const remaining = readdirSync(dirPath);
      if (remaining.length === 0) {
        rmSync(dirPath, { recursive: true });
      }
    } catch { /* ignore cleanup errors */ }

    console.log(`[sessions] Deleted project ${projectDir} (${files.length} sessions)`);
    res.json({ success: true, deleted: files.length });
  } catch (err) {
    console.error('[sessions] Error deleting project:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

export default router;
