<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { resolveWsUrl } from '@/lib/serverUrl';
import '@xterm/xterm/css/xterm.css';

const terminalRef = ref<HTMLElement | null>(null);
const detectedAuthUrl = ref<string | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;
let authDismissTimer: ReturnType<typeof setTimeout> | null = null;
let contextMenuHandler: ((e: MouseEvent) => void) | null = null;

// Patterns that indicate an auth/login URL
const AUTH_URL_PATTERN = /https?:\/\/[^\s"'<>]+(?:\/(?:auth|login|oauth|authorize|device|callback|verify|confirm|activate)[^\s"'<>]*|[?&](?:code|token|state)=[^\s"'<>]*)/i;

function checkForAuthUrl(text: string) {
  const match = text.match(AUTH_URL_PATTERN);
  if (match) {
    detectedAuthUrl.value = match[0];
    if (authDismissTimer) clearTimeout(authDismissTimer);
    authDismissTimer = setTimeout(() => { detectedAuthUrl.value = null; }, 30000);
  }
}

function openAuthUrl() {
  if (detectedAuthUrl.value) window.open(detectedAuthUrl.value, '_blank');
  detectedAuthUrl.value = null;
}

function copyAuthUrl() {
  if (detectedAuthUrl.value) navigator.clipboard.writeText(detectedAuthUrl.value);
  detectedAuthUrl.value = null;
}

function dismissAuthUrl() {
  detectedAuthUrl.value = null;
}

function connect() {
  const auth = useAuthStore();
  const chat = useChatStore();
  const cwd = chat.projectPath || '/home';
  const url = resolveWsUrl('/ws/shell', auth.token ?? '') + `&cwd=${encodeURIComponent(cwd)}`;

  ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output' && terminal) {
        terminal.write(msg.data);
        checkForAuthUrl(msg.data);
      } else if (msg.type === 'exit') {
        terminal?.writeln(`\r\n[Process exited with code ${msg.exitCode}]`);
      }
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    terminal?.writeln('\r\n[Connection closed]');
  };
}

onMounted(() => {
  if (!terminalRef.value) return;

  terminal = new Terminal({
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      selectionBackground: '#264f78',
    },
    cursorBlink: true,
    scrollback: 5000,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.open(terminalRef.value);

  // WebGL addon must be loaded after terminal.open()
  try {
    terminal.loadAddon(new WebglAddon());
  } catch {
    // WebGL not available, falls back to canvas renderer
  }

  fitAddon.fit();

  connect();

  // Custom Ctrl+C / Ctrl+V / Ctrl+Shift+C/V handling
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    // Ctrl+C: copy selection if any, otherwise let through as SIGINT
    if (event.ctrlKey && event.key === 'c' && event.type === 'keydown') {
      const selection = terminal!.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        terminal!.clearSelection();
        return false; // Prevent sending to PTY
      }
      // No selection — let ^C pass through as SIGINT
      return true;
    }
    // Ctrl+Shift+C: always copy
    if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
      const selection = terminal!.getSelection();
      if (selection) navigator.clipboard.writeText(selection);
      return false;
    }
    // Ctrl+V or Ctrl+Shift+V: paste from clipboard
    if (event.ctrlKey && (event.key === 'v' || event.key === 'V') && event.type === 'keydown') {
      navigator.clipboard.readText().then((text) => {
        if (text && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: text }));
        }
      });
      return false;
    }
    return true;
  });

  // Right-click paste
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    navigator.clipboard.readText().then((text) => {
      if (text && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: text }));
      }
    });
  };
  terminalRef.value.addEventListener('contextmenu', handleContextMenu);
  contextMenuHandler = handleContextMenu;

  terminal.onData((data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  });

  // Auto-resize on container size change
  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit();
    if (ws?.readyState === WebSocket.OPEN && terminal) {
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  });
  resizeObserver.observe(terminalRef.value);
});

onUnmounted(() => {
  if (contextMenuHandler && terminalRef.value) {
    terminalRef.value.removeEventListener('contextmenu', contextMenuHandler);
  }
  resizeObserver?.disconnect();
  ws?.close();
  terminal?.dispose();
});
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="terminalRef" class="h-full w-full" />
    <!-- Auth URL detection overlay -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <div
        v-if="detectedAuthUrl"
        class="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-primary/30 bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur"
      >
        <p class="mb-2 text-xs font-medium text-foreground">Authentication URL detected</p>
        <p class="mb-2.5 max-w-xs truncate font-mono text-[11px] text-muted-foreground">{{ detectedAuthUrl }}</p>
        <div class="flex gap-2">
          <button
            class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            @click="openAuthUrl"
          >Open in Browser</button>
          <button
            class="rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-accent"
            @click="copyAuthUrl"
          >Copy URL</button>
          <button
            class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            @click="dismissAuthUrl"
          >Dismiss</button>
        </div>
      </div>
    </Transition>
  </div>
</template>
