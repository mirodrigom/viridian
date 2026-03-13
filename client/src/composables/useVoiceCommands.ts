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
export function parseTranscript(text: string): ParseResult {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return { matched: false };

  for (const cmd of commands) {
    // Sort triggers longest-first to match most specific first
    const sorted = [...cmd.triggers].sort((a, b) => b.length - a.length);
    for (const trigger of sorted) {
      if (cmd.matchPosition === 'end') {
        if (normalized.endsWith(trigger)) {
          const before = text.slice(0, text.length - trigger.length).trim();
          // Strip trailing punctuation/comma left over
          const cleaned = before.replace(/[,.\s]+$/, '').trim();
          return { matched: true, command: cmd, textBeforeCommand: cleaned };
        }
      } else {
        const idx = normalized.indexOf(trigger);
        if (idx !== -1) {
          const before = text.slice(0, idx).trim();
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
