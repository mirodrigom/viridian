import { onMounted, onUnmounted, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore, type ChatMessage } from '@/stores/chat';

/**
 * Export the current session as a Markdown file download.
 * Can be called from any component without registering keyboard listeners.
 */
export function exportSession() {
  const chat = useChatStore();
  if (chat.messages.length === 0) return;

  const markdown = messagesToMarkdown(chat.messages);
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
  const filename = `session_${timestamp}.md`;

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Register global keyboard shortcuts. Call once from a root component (e.g. AppLayout).
 * @param commandPaletteOpen - ref to control the command palette visibility
 */
export function useKeyboardShortcuts(commandPaletteOpen?: Ref<boolean>, splitViewOpen?: Ref<boolean>) {
  const router = useRouter();
  const chat = useChatStore();

  function handleKeyDown(e: KeyboardEvent) {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.contentEditable === 'true';

    // Ctrl/Cmd + K — open command palette (or close if already open)
    if (ctrlOrCmd && e.key === 'k') {
      e.preventDefault();
      if (commandPaletteOpen) {
        commandPaletteOpen.value = !commandPaletteOpen.value;
      }
      return;
    }

    // Ctrl/Cmd + \ — toggle split view
    if (ctrlOrCmd && e.key === '\\') {
      e.preventDefault();
      if (splitViewOpen) {
        splitViewOpen.value = !splitViewOpen.value;
      }
      return;
    }

    // Ctrl/Cmd + N — new session (skip if typing in input)
    if (ctrlOrCmd && e.key === 'n' && !isInput) {
      e.preventDefault();
      chat.clearMessages();
      router.push({ name: 'project' });
      return;
    }

    // Ctrl/Cmd + Shift + E — export session
    if (ctrlOrCmd && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      exportSession();
      return;
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown));
}

function messagesToMarkdown(messages: ChatMessage[]): string {
  let md = '# Claude Code Session Export\n\n';
  md += `**Exported:** ${new Date().toLocaleString()}\n`;
  md += `**Messages:** ${messages.length}\n\n`;
  md += '---\n\n';

  for (const msg of messages) {
    if (msg.role === 'user') {
      md += '## User\n\n';
      md += msg.content + '\n\n';
      if (msg.images?.length) {
        md += `*[${msg.images.length} image(s) attached]*\n\n`;
      }
    } else if (msg.role === 'assistant') {
      md += '## Claude\n\n';
      if (msg.thinking) {
        md += '<details>\n<summary>Thinking</summary>\n\n';
        md += '```\n' + msg.thinking + '\n```\n\n';
        md += '</details>\n\n';
      }
      md += msg.content + '\n\n';
    } else if (msg.toolUse) {
      md += `### Tool: ${msg.toolUse.tool}\n\n`;
      md += '<details>\n';
      md += `<summary>${msg.toolUse.tool} (${msg.toolUse.status})</summary>\n\n`;
      md += '```json\n' + JSON.stringify(msg.toolUse.input, null, 2) + '\n```\n\n';
      md += '</details>\n\n';
    } else if (msg.role === 'system') {
      md += `> **System:** ${msg.content}\n\n`;
    }

    md += '---\n\n';
  }

  return md;
}
