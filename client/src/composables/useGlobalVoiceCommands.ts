import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { toast } from 'vue-sonner';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore } from '@/stores/chat';
import { useGitStore } from '@/stores/git';
import { parseGlobalCommand, type VoiceCommand } from './useVoiceCommands';

/**
 * Global voice command handler.
 *
 * Executes non-recording voice commands: navigation, theme, chat session
 * management, and git operations. Commands that require confirmation show
 * a toast and wait for a second voice trigger or timeout.
 */
export function useGlobalVoiceCommands() {
  const router = useRouter();
  const settings = useSettingsStore();
  const chat = useChatStore();
  const git = useGitStore();

  const pendingConfirmation = ref<VoiceCommand | null>(null);
  let confirmTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Route map for navigation commands */
  const NAV_ROUTES: Record<string, string> = {
    'nav-chat': 'project',
    'nav-editor': 'editor',
    'nav-git': 'git',
    'nav-tasks': 'tasks',
    'nav-graph': 'graph',
    'nav-autopilot': 'autopilot',
    'nav-dashboard': 'dashboard',
    'nav-management': 'management',
    'nav-diagrams': 'diagrams',
  };

  function clearPendingConfirmation() {
    pendingConfirmation.value = null;
    if (confirmTimeout) {
      clearTimeout(confirmTimeout);
      confirmTimeout = null;
    }
  }

  /**
   * Try to match and execute a global voice command from transcript text.
   * Returns true if a command was handled, false otherwise.
   */
  function tryExecute(text: string): boolean {
    // Check if we're waiting for confirmation
    if (pendingConfirmation.value) {
      const lower = text.toLowerCase().trim();
      const confirmWords = ['yes', 'confirm', 'ok', 'okay', 'do it', 'go ahead'];
      const cancelWords = ['no', 'cancel', 'never mind', 'forget it'];

      if (confirmWords.some(w => lower.includes(w))) {
        const cmd = pendingConfirmation.value;
        clearPendingConfirmation();
        executeCommand(cmd);
        return true;
      }
      if (cancelWords.some(w => lower.includes(w))) {
        clearPendingConfirmation();
        toast.info('Command cancelled');
        return true;
      }
      return false;
    }

    const result = parseGlobalCommand(text);
    if (!result.matched) return false;

    const cmd = result.command;

    if (cmd.requiresConfirmation) {
      pendingConfirmation.value = cmd;
      toast.info(`Say "confirm" to ${cmd.description.toLowerCase()}, or "cancel" to abort`, {
        duration: 8000,
      });
      confirmTimeout = setTimeout(() => {
        if (pendingConfirmation.value?.id === cmd.id) {
          pendingConfirmation.value = null;
          toast.info('Command timed out');
        }
      }, 8000);
      return true;
    }

    executeCommand(cmd);
    return true;
  }

  function executeCommand(cmd: VoiceCommand) {
    switch (cmd.category) {
      case 'navigation':
        executeNavigation(cmd);
        break;
      case 'theme':
        executeTheme(cmd);
        break;
      case 'chat':
        executeChat(cmd);
        break;
      case 'git':
        executeGit(cmd);
        break;
    }
  }

  function executeNavigation(cmd: VoiceCommand) {
    const routeName = NAV_ROUTES[cmd.id];
    if (routeName) {
      router.push({ name: routeName });
      toast.success(`Navigating to ${routeName}`);
    }
  }

  function executeTheme(cmd: VoiceCommand) {
    if (cmd.id === 'theme-dark') {
      if (!settings.darkMode) settings.toggleDarkMode();
      toast.success('Switched to dark mode');
    } else if (cmd.id === 'theme-light') {
      if (settings.darkMode) settings.toggleDarkMode();
      toast.success('Switched to light mode');
    } else if (cmd.id === 'theme-toggle') {
      settings.toggleDarkMode();
      toast.success(`Switched to ${settings.darkMode ? 'dark' : 'light'} mode`);
    }
  }

  function executeChat(cmd: VoiceCommand) {
    if (cmd.id === 'chat-new-session') {
      chat.suppressClearSession = true;
      chat.clearMessages();
      router.replace({ name: 'project' });
      toast.success('Started new session');
    } else if (cmd.id === 'chat-clear-context') {
      chat.clearMessages();
      toast.success('Context cleared');
    }
  }

  async function executeGit(cmd: VoiceCommand) {
    if (cmd.id === 'git-commit') {
      toast.success('Generating commit message with AI...');
      await git.generateCommitMessage();
      if (git.commitMessage.trim()) {
        await git.doCommit();
        toast.success('Changes committed');
      } else {
        toast.warning('Could not generate commit message — no staged changes?');
      }
    } else if (cmd.id === 'git-push') {
      git.doPush();
      toast.success('Pushing to remote...');
    } else if (cmd.id === 'git-pull') {
      git.doPull();
      toast.success('Pulling from remote...');
    }
  }

  return {
    tryExecute,
    pendingConfirmation,
    clearPendingConfirmation,
  };
}
