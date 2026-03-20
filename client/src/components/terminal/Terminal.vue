<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { resolveWsUrl } from '@/lib/serverUrl';
import RemoteBrowser from './RemoteBrowser.vue';
import '@xterm/xterm/css/xterm.css';

const terminalRef = ref<HTMLElement | null>(null);
const codeInputRef = ref<HTMLInputElement | null>(null);
const detectedAuthUrl = ref<string | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;
let authDismissTimer: ReturnType<typeof setTimeout> | null = null;
let contextMenuHandler: ((e: MouseEvent) => void) | null = null;
const showRemoteBrowser = ref(false);
const showCodeInput = ref(false);
const authCode = ref('');

// Patterns that indicate an auth/login URL
const AUTH_URL_PATTERN = /https?:\/\/[^\s"'<>]+(?:\/(?:auth|login|oauth|authorize|device|callback|verify|confirm|activate)[^\s"'<>]*|[?&](?:code|token|state)=[^\s"'<>]*)/i;

let bufferFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastMatchedUrl = '';
// Characters valid at URL line-wrap boundaries
const URL_BOUNDARY_RE = /[A-Za-z0-9%=&_.\-\/+:~]/;

function checkForAuthUrl(_chunk: string) {
  if (bufferFlushTimer) clearTimeout(bufferFlushTimer);
  bufferFlushTimer = setTimeout(() => {
    if (!terminal) return;

    const buf = terminal.buffer.active;
    const totalLines = buf.baseY + buf.cursorY + 1;
    const startLine = Math.max(0, totalLines - 30);

    let assembled = '';
    for (let i = startLine; i < totalLines; i++) {
      const line = buf.getLine(i);
      if (!line) continue;
      const content = line.translateToString(true);
      if (!content) { assembled += ' '; continue; }

      const prevEnd = assembled[assembled.length - 1] || '';
      const currStart = content[0] || '';
      const isUrlContinuation = line.isWrapped
        || (!content.includes(' ')
            && URL_BOUNDARY_RE.test(prevEnd)
            && URL_BOUNDARY_RE.test(currStart));

      if (isUrlContinuation) {
        assembled += content;
      } else if (assembled) {
        assembled += ' ' + content;
      } else {
        assembled = content;
      }
    }

    const match = assembled.match(AUTH_URL_PATTERN);
    if (match && match[0] !== lastMatchedUrl) {
      lastMatchedUrl = match[0];
      detectedAuthUrl.value = match[0];
      if (authDismissTimer) clearTimeout(authDismissTimer);
      authDismissTimer = setTimeout(() => {
        detectedAuthUrl.value = null;
        showCodeInput.value = false;
      }, 120000);
    }
  }, 1500);
}

/** Primary flow: open URL in user's browser + show code input */
function startAuthFlow() {
  if (detectedAuthUrl.value) {
    window.open(detectedAuthUrl.value, '_blank');
  }
  showCodeInput.value = true;
  authCode.value = '';
  nextTick(() => codeInputRef.value?.focus());
}

/** Submit the code to the terminal */
function submitCode() {
  const code = authCode.value.trim();
  if (!code) return;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: code + '\n' }));
  }
  showCodeInput.value = false;
  detectedAuthUrl.value = null;
  authCode.value = '';
}

function openAuthUrl() {
  if (detectedAuthUrl.value) window.open(detectedAuthUrl.value, '_blank');
}

function copyAuthUrl() {
  if (detectedAuthUrl.value) navigator.clipboard.writeText(detectedAuthUrl.value);
}

function dismissAuthUrl() {
  detectedAuthUrl.value = null;
  showCodeInput.value = false;
}

/** Fallback: use remote browser (Puppeteer) */
function useRemoteBrowser() {
  showCodeInput.value = false;
  showRemoteBrowser.value = true;
}

function onRemoteBrowserComplete(code?: string) {
  detectedAuthUrl.value = null;
  showCodeInput.value = false;
  if (code && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: code + '\n' }));
  }
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

  try {
    terminal.loadAddon(new WebglAddon());
  } catch {
    // WebGL not available, falls back to canvas renderer
  }

  fitAddon.fit();

  connect();

  // Custom Ctrl+C / Ctrl+V / Ctrl+Shift+C/V handling
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    if (event.ctrlKey && event.key === 'c' && event.type === 'keydown') {
      const selection = terminal!.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
        terminal!.clearSelection();
        return false;
      }
      return true;
    }
    if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
      const selection = terminal!.getSelection();
      if (selection) navigator.clipboard.writeText(selection);
      return false;
    }
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

    <!-- Auth URL detected — primary action: open tab + paste code -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <div
        v-if="detectedAuthUrl && !showCodeInput && !showRemoteBrowser"
        class="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-primary/30 bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur"
      >
        <p class="mb-2 text-xs font-medium text-foreground">Authentication required</p>
        <p class="mb-2.5 max-w-xs truncate font-mono text-[11px] text-muted-foreground">{{ detectedAuthUrl }}</p>
        <div class="flex gap-2">
          <button
            class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            @click="startAuthFlow"
          >Authenticate</button>
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

    <!-- Code input overlay — shown after browser tab opens -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-2 opacity-0"
    >
      <div
        v-if="showCodeInput"
        class="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-primary/30 bg-card/95 px-5 py-4 shadow-lg backdrop-blur"
      >
        <p class="mb-1 text-sm font-medium text-foreground">Paste your authorization code</p>
        <p class="mb-3 text-xs text-muted-foreground">
          Authorize in the browser tab, then paste the code below.
        </p>
        <form class="flex gap-2" @submit.prevent="submitCode">
          <input
            ref="codeInputRef"
            v-model="authCode"
            type="text"
            placeholder="Paste code here..."
            class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            :disabled="!authCode.trim()"
            class="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >Continue</button>
        </form>
        <div class="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          <button class="hover:text-foreground" @click="openAuthUrl">Open tab again</button>
          <span class="opacity-40">|</span>
          <button class="hover:text-foreground" @click="copyAuthUrl">Copy URL</button>
          <span class="opacity-40">|</span>
          <button class="hover:text-foreground" @click="useRemoteBrowser">Use remote browser</button>
          <span class="opacity-40">|</span>
          <button class="hover:text-foreground" @click="dismissAuthUrl">Dismiss</button>
        </div>
      </div>
    </Transition>

    <!-- Remote browser fallback for OAuth authentication -->
    <RemoteBrowser
      v-if="detectedAuthUrl"
      v-model:open="showRemoteBrowser"
      :url="detectedAuthUrl"
      @auth-complete="onRemoteBrowserComplete"
    />
  </div>
</template>
