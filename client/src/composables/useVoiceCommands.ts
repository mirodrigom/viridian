/**
 * Voice command registry for detecting spoken commands during audio recording.
 *
 * Commands are matched against the transcript text. Each command specifies
 * trigger phrases and where they should appear (end of transcript vs anywhere).
 */

export interface VoiceCommand {
  id: string;
  /** Trigger phrases (lowercased) */
  triggers: string[];
  /** 'end' = only match at end of transcript, 'anywhere' = match anywhere */
  matchPosition: 'end' | 'anywhere';
  description: string;
}

export type ParseResult =
  | { matched: true; command: VoiceCommand; textBeforeCommand: string }
  | { matched: false }

const commands: VoiceCommand[] = [
  {
    id: 'send',
    triggers: ['send it', 'send message', 'send please', 'send'],
    matchPosition: 'end',
    description: 'Stop recording and send the message',
  },
  {
    id: 'cancel',
    triggers: ['never mind', 'forget it', 'cancel recording', 'cancel'],
    matchPosition: 'end',
    description: 'Cancel recording and close overlay',
  },
  {
    id: 'redo',
    triggers: ['start over', 'redo', 'try again'],
    matchPosition: 'end',
    description: 'Discard and restart recording',
  },
  {
    id: 'stop',
    triggers: ['stop recording', 'stop'],
    matchPosition: 'end',
    description: 'Stop recording (place text in input without sending)',
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

export function registerCommand(cmd: VoiceCommand) {
  // Replace if same id exists
  const idx = commands.findIndex(c => c.id === cmd.id);
  if (idx !== -1) commands[idx] = cmd;
  else commands.push(cmd);
}

export function getCommands(): readonly VoiceCommand[] {
  return commands;
}
