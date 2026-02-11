<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import '@xterm/xterm/css/xterm.css';

const terminalRef = ref<HTMLElement | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;

function connect() {
  const auth = useAuthStore();
  const chat = useChatStore();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const cwd = chat.projectPath || '/home';
  const url = `${protocol}//${host}/ws/shell?token=${auth.token}&cwd=${encodeURIComponent(cwd)}`;

  ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output' && terminal) {
        terminal.write(msg.data);
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
  resizeObserver?.disconnect();
  ws?.close();
  terminal?.dispose();
});
</script>

<template>
  <div ref="terminalRef" class="h-full w-full" />
</template>
