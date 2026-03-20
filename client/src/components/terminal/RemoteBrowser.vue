<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { resolveWsUrl } from '@/lib/serverUrl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

const props = defineProps<{
  url: string;
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'auth-complete': [code?: string];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const connected = ref(false);
const authCompleted = ref(false);
const currentUrl = ref('');
const remainingSeconds = ref(300); // 5 minutes

let ws: WebSocket | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let frameImage: HTMLImageElement | null = null;

const VIEWPORT_W = 1024;
const VIEWPORT_H = 768;

// Actual page dimensions from the screencast metadata (for coordinate mapping)
let pageWidth = VIEWPORT_W;
let pageHeight = VIEWPORT_H;

const remainingTime = computed(() => {
  const m = Math.floor(remainingSeconds.value / 60);
  const s = remainingSeconds.value % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
});

function connect() {
  const auth = useAuthStore();
  const wsUrl = resolveWsUrl('/ws/auth-browser', auth.token ?? '')
    + `&url=${encodeURIComponent(props.url)}`;

  ws = new WebSocket(wsUrl);
  currentUrl.value = props.url;

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'browser_ready':
          connected.value = true;
          startCountdown();
          break;

        case 'frame':
          if (msg.pageWidth) pageWidth = msg.pageWidth;
          if (msg.pageHeight) pageHeight = msg.pageHeight;
          renderFrame(msg.data);
          break;

        case 'navigated':
          currentUrl.value = msg.url;
          break;

        case 'auth_complete':
          authCompleted.value = true;
          emit('auth-complete');
          setTimeout(() => close(), 2000);
          break;

        case 'auth_code':
          // Code extracted from OAuth callback page — auto-paste into terminal
          authCompleted.value = true;
          emit('auth-complete', msg.code);
          setTimeout(() => close(), 2000);
          break;

        case 'timeout':
          close();
          break;

        case 'error':
          console.error('Auth browser error:', msg.message);
          close();
          break;
      }
    } catch {
      // ignore
    }
  };

  ws.onclose = () => {
    connected.value = false;
    stopCountdown();
  };
}

function renderFrame(base64: string) {
  const canvas = canvasRef.value;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!frameImage) {
    frameImage = new Image();
    frameImage.onload = () => {
      // Always draw scaled to fill the fixed canvas
      ctx.clearRect(0, 0, VIEWPORT_W, VIEWPORT_H);
      ctx.drawImage(frameImage!, 0, 0, VIEWPORT_W, VIEWPORT_H);
    };
  }
  frameImage.src = `data:image/jpeg;base64,${base64}`;
}

function getScaledCoords(e: MouseEvent): { x: number; y: number } {
  const canvas = canvasRef.value;
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  // Map from display coordinates to actual page coordinates
  // The canvas displays a stretched version of the page, so we need
  // to map to the real page dimensions (e.g. 500x600 popup), not canvas size (1024x768)
  return {
    x: Math.round((e.clientX - rect.left) / rect.width * pageWidth),
    y: Math.round((e.clientY - rect.top) / rect.height * pageHeight),
  };
}

function send(data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Throttle mouse move to every 50ms
let lastMoveTime = 0;
function onMouseMove(e: MouseEvent) {
  const now = Date.now();
  if (now - lastMoveTime < 50) return;
  lastMoveTime = now;
  const { x, y } = getScaledCoords(e);
  send({ type: 'mouse_move', x, y });
}

function onMouseDown(e: MouseEvent) {
  // Focus the canvas for keyboard events
  canvasRef.value?.focus();
  const { x, y } = getScaledCoords(e);
  send({ type: 'mouse_down', x, y, button: e.button === 2 ? 'right' : 'left' });
}

function onMouseUp(e: MouseEvent) {
  const { x, y } = getScaledCoords(e);
  send({ type: 'mouse_up', x, y, button: e.button === 2 ? 'right' : 'left' });
}

function onClick(e: MouseEvent) {
  const { x, y } = getScaledCoords(e);
  send({ type: 'click', x, y });
}

function onKeyDown(e: KeyboardEvent) {
  e.preventDefault();
  send({
    type: 'key_down',
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
  });
}

function onKeyUp(e: KeyboardEvent) {
  e.preventDefault();
  send({ type: 'key_up', key: e.key, code: e.code });
}

function onScroll(e: WheelEvent) {
  e.preventDefault();
  const { x, y } = getScaledCoords(e);
  send({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
}

function startCountdown() {
  remainingSeconds.value = 300;
  countdownInterval = setInterval(() => {
    remainingSeconds.value--;
    if (remainingSeconds.value <= 0) stopCountdown();
  }, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function close() {
  emit('update:open', false);
}

function disconnect() {
  stopCountdown();
  ws?.close();
  ws = null;
  connected.value = false;
  authCompleted.value = false;
  frameImage = null;
  pageWidth = VIEWPORT_W;
  pageHeight = VIEWPORT_H;
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    connect();
  } else {
    disconnect();
  }
});

onUnmounted(() => {
  disconnect();
});
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="!max-w-[min(1080px,90vw)] !p-4" :show-close-button="true">
      <DialogHeader>
        <DialogTitle>Authenticate</DialogTitle>
        <DialogDescription>
          Complete the sign-in below. This browser runs inside the server — the auth callback will be captured automatically.
        </DialogDescription>
      </DialogHeader>

      <!-- URL bar -->
      <div class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 min-w-0">
        <div class="h-2 w-2 shrink-0 rounded-full" :class="connected ? 'bg-green-500' : 'bg-yellow-500'" />
        <span class="truncate font-mono text-xs text-muted-foreground">{{ currentUrl }}</span>
      </div>

      <!-- Browser canvas — fixed 4:3 aspect ratio, never resizes -->
      <div class="relative w-full overflow-hidden rounded-md border border-border" style="aspect-ratio: 4/3">
        <canvas
          ref="canvasRef"
          :width="VIEWPORT_W"
          :height="VIEWPORT_H"
          class="absolute inset-0 h-full w-full cursor-default"
          tabindex="0"
          @click="onClick"
          @mousedown="onMouseDown"
          @mouseup="onMouseUp"
          @mousemove="onMouseMove"
          @keydown="onKeyDown"
          @keyup="onKeyUp"
          @wheel.prevent="onScroll"
          @contextmenu.prevent
        />

        <!-- Loading overlay -->
        <div
          v-if="!connected"
          class="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        >
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Launching browser...
          </div>
        </div>

        <!-- Auth complete overlay -->
        <div
          v-if="authCompleted"
          class="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        >
          <div class="flex items-center gap-2 text-sm font-medium text-green-500">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Authentication complete
          </div>
        </div>
      </div>

      <DialogFooter class="flex items-center justify-between sm:justify-between">
        <span class="text-xs text-muted-foreground">
          Session expires in {{ remainingTime }}
        </span>
        <span v-if="authCompleted" class="rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-500">
          Authenticated
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
