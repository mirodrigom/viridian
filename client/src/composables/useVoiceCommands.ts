/**
 * Voice command registry for detecting spoken commands during audio recording.
 *
 * Commands are matched against the transcript text. Each command specifies
 * trigger phrases and where they should appear (end of transcript vs anywhere).
 *
 * Categories:
 * - 'recording': commands that control the recording overlay (send, cancel, redo, stop)
 * - 'navigation': commands that navigate to different views
 * - 'theme': commands that change the UI theme
 * - 'chat': commands that manage chat sessions
 * - 'git': commands that perform git operations (may require confirmation)
 */

export type VoiceCommandCategory = 'recording' | 'navigation' | 'theme' | 'chat' | 'git';

export interface VoiceCommand {
  id: string;
  /** Trigger phrases (lowercased) */
  triggers: string[];
  /** 'end' = only match at end of transcript, 'anywhere' = match anywhere */
  matchPosition: 'end' | 'anywhere';
  description: string;
  /** Command category — determines how it's handled */
  category: VoiceCommandCategory;
  /** Whether the command needs user confirmation before executing */
  requiresConfirmation?: boolean;
}

export type ParseResult =
  | { matched: true; command: VoiceCommand; textBeforeCommand: string }
  | { matched: false }

const commands: VoiceCommand[] = [
  // ─── Recording commands ──────────────────────────────────────────────
  {
    id: 'send',
    triggers: ['send it', 'send message', 'send please', 'send'],
    matchPosition: 'end',
    description: 'Stop recording and send the message',
    category: 'recording',
  },
  {
    id: 'cancel',
    triggers: ['never mind', 'forget it', 'cancel recording', 'cancel'],
    matchPosition: 'end',
    description: 'Cancel recording and close overlay',
    category: 'recording',
  },
  {
    id: 'redo',
    triggers: ['start over', 'redo', 'try again'],
    matchPosition: 'end',
    description: 'Discard and restart recording',
    category: 'recording',
  },
  {
    id: 'stop',
    triggers: ['stop recording', 'stop'],
    matchPosition: 'end',
    description: 'Stop recording (place text in input without sending)',
    category: 'recording',
  },

  // ─── Navigation commands ─────────────────────────────────────────────
  {
    id: 'nav-chat',
    triggers: ['go to chat', 'open chat', 'show chat'],
    matchPosition: 'anywhere',
    description: 'Navigate to the chat view',
    category: 'navigation',
  },
  {
    id: 'nav-editor',
    triggers: ['go to editor', 'open editor', 'show editor'],
    matchPosition: 'anywhere',
    description: 'Navigate to the code editor',
    category: 'navigation',
  },
  {
    id: 'nav-git',
    triggers: ['go to git', 'open git', 'show git'],
    matchPosition: 'anywhere',
    description: 'Navigate to the git view',
    category: 'navigation',
  },
  {
    id: 'nav-tasks',
    triggers: ['go to tasks', 'open tasks', 'show tasks'],
    matchPosition: 'anywhere',
    description: 'Navigate to the task manager',
    category: 'navigation',
  },
  {
    id: 'nav-graph',
    triggers: ['go to graph', 'open graph', 'show graph'],
    matchPosition: 'anywhere',
    description: 'Navigate to the graph builder',
    category: 'navigation',
  },
  {
    id: 'nav-autopilot',
    triggers: ['go to autopilot', 'open autopilot', 'show autopilot'],
    matchPosition: 'anywhere',
    description: 'Navigate to autopilot',
    category: 'navigation',
  },
  {
    id: 'nav-dashboard',
    triggers: ['go to dashboard', 'open dashboard', 'go home'],
    matchPosition: 'anywhere',
    description: 'Navigate to the dashboard',
    category: 'navigation',
  },
  {
    id: 'nav-management',
    triggers: ['go to management', 'open management', 'show management'],
    matchPosition: 'anywhere',
    description: 'Navigate to management',
    category: 'navigation',
  },
  {
    id: 'nav-diagrams',
    triggers: ['go to diagrams', 'open diagrams', 'show diagrams'],
    matchPosition: 'anywhere',
    description: 'Navigate to diagrams',
    category: 'navigation',
  },

  // ─── Theme commands ──────────────────────────────────────────────────
  {
    id: 'theme-dark',
    triggers: ['dark mode', 'switch to dark', 'turn on dark mode'],
    matchPosition: 'anywhere',
    description: 'Switch to dark theme',
    category: 'theme',
  },
  {
    id: 'theme-light',
    triggers: ['light mode', 'switch to light', 'turn on light mode'],
    matchPosition: 'anywhere',
    description: 'Switch to light theme',
    category: 'theme',
  },
  {
    id: 'theme-toggle',
    triggers: ['toggle theme', 'switch theme', 'change theme'],
    matchPosition: 'anywhere',
    description: 'Toggle between dark and light theme',
    category: 'theme',
  },

  // ─── Chat commands ───────────────────────────────────────────────────
  {
    id: 'chat-new-session',
    triggers: ['new session', 'new chat', 'start new session', 'start new chat', 'new conversation'],
    matchPosition: 'anywhere',
    description: 'Start a new chat session',
    category: 'chat',
  },
  {
    id: 'chat-clear-context',
    triggers: ['clear context', 'clear the context', 'reset context'],
    matchPosition: 'anywhere',
    description: 'Clear the current chat context',
    category: 'chat',
  },

  // ─── Git commands ────────────────────────────────────────────────────
  {
    id: 'git-commit',
    triggers: ['commit changes', 'git commit', 'make a commit'],
    matchPosition: 'anywhere',
    description: 'Commit staged changes',
    category: 'git',
    requiresConfirmation: true,
  },
  {
    id: 'git-push',
    triggers: ['push changes', 'git push', 'push to remote'],
    matchPosition: 'anywhere',
    description: 'Push commits to remote',
    category: 'git',
    requiresConfirmation: true,
  },
  {
    id: 'git-pull',
    triggers: ['pull changes', 'git pull', 'pull from remote'],
    matchPosition: 'anywhere',
    description: 'Pull changes from remote',
    category: 'git',
    requiresConfirmation: true,
  },
];

/**
 * Parse transcript text and check if it ends/contains a voice command.
 * Longer trigger phrases are checked first to avoid partial matches
 * (e.g. "send it" before "send").
 */
/**
 * Split transcript into sentences/clauses by punctuation or common separators.
 * Returns the boundary index where the last clause starts.
 */
function lastClauseBoundary(text: string): number {
  // Find the last sentence boundary (. ! ? , ;) that has text after it
  const match = text.match(/.*[.!?,;]\s*/);
  return match ? match[0].length : 0;
}

export function parseTranscript(text: string): ParseResult {
  // Strip trailing punctuation that speech recognition adds (. , ! ? …)
  const stripped = text.replace(/[\s.,!?;:…]+$/, '').trim();
  const normalized = stripped.toLowerCase();
  if (!normalized) return { matched: false };

  for (const cmd of commands) {
    const sorted = [...cmd.triggers].sort((a, b) => b.length - a.length);
    for (const trigger of sorted) {
      if (cmd.matchPosition === 'end') {
        // Strategy 1: strict endsWith
        if (normalized.endsWith(trigger)) {
          const before = stripped.slice(0, stripped.length - trigger.length).trim();
          const cleaned = before.replace(/[\s.,!?;:…]+$/, '').trim();
          return { matched: true, command: cmd, textBeforeCommand: cleaned };
        }

        // Strategy 2: trigger appears as the last clause/sentence
        // e.g. "write something for me. Send it. Ready" → last clause boundary
        // after "Send it" even if "Ready" follows
        const boundary = lastClauseBoundary(stripped);
        if (boundary > 0) {
          const beforeBoundary = stripped.slice(0, boundary).replace(/[\s.,!?;:…]+$/, '').trim();
          const normalizedBefore = beforeBoundary.toLowerCase();
          if (normalizedBefore.endsWith(trigger)) {
            const msgBefore = beforeBoundary.slice(0, beforeBoundary.length - trigger.length).trim();
            const cleaned = msgBefore.replace(/[\s.,!?;:…]+$/, '').trim();
            if (cleaned) {
              return { matched: true, command: cmd, textBeforeCommand: cleaned };
            }
          }
        }

        // Strategy 3: trigger appears as a standalone word boundary near the end
        // Handles "hello world send ready" where "send" isn't at the very end
        const wordBoundaryPattern = new RegExp(`\\b${trigger}\\b`, 'gi');
        let lastMatch: RegExpExecArray | null = null;
        let m: RegExpExecArray | null;
        while ((m = wordBoundaryPattern.exec(normalized)) !== null) {
          lastMatch = m;
        }
        if (lastMatch) {
          const afterTrigger = normalized.slice(lastMatch.index + trigger.length).trim();
          const wordCountAfter = afterTrigger ? afterTrigger.split(/\s+/).length : 0;
          // Only match if trigger is within the last 3 words of transcript
          if (wordCountAfter <= 2) {
            const before = stripped.slice(0, lastMatch.index).trim();
            const cleaned = before.replace(/[\s.,!?;:…]+$/, '').trim();
            if (cleaned) {
              return { matched: true, command: cmd, textBeforeCommand: cleaned };
            }
          }
        }
      } else {
        const idx = normalized.indexOf(trigger);
        if (idx !== -1) {
          const before = stripped.slice(0, idx).trim();
          return { matched: true, command: cmd, textBeforeCommand: before };
        }
      }
    }
  }

  return { matched: false };
}

/**
 * Parse transcript for global (non-recording) commands.
 * These are standalone commands that don't need text before them.
 * Used by the wake word system and global voice command handler.
 */
export function parseGlobalCommand(text: string): ParseResult {
  const stripped = text.replace(/[\s.,!?;:…]+$/, '').trim();
  const normalized = stripped.toLowerCase();
  if (!normalized) return { matched: false };

  const globalCommands = commands.filter(c => c.category !== 'recording');

  for (const cmd of globalCommands) {
    const sorted = [...cmd.triggers].sort((a, b) => b.length - a.length);
    for (const trigger of sorted) {
      // For global commands, check if the trigger appears anywhere as a word boundary
      const pattern = new RegExp(`\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (pattern.test(normalized)) {
        return { matched: true, command: cmd, textBeforeCommand: '' };
      }
    }
  }

  return { matched: false };
}

export function registerCommand(cmd: VoiceCommand) {
  // Replace if same id exists
  const idx = commands.findIndex(c => c.id === cmd.id);
  if (idx !== -1) commands[idx] = cmd;
  else commands.push(cmd);
}

export function getCommands(): readonly VoiceCommand[] {
  return commands;
}
