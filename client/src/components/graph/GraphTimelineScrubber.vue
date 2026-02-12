<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { useGraphRunnerStore } from '@/stores/graphRunner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  RotateCcw, Play, Pause, Radio,
  ChevronLeft, ChevronRight,
} from 'lucide-vue-next';

const runner = useGraphRunnerStore();
const trackRef = ref<HTMLDivElement>();
const isDragging = ref(false);

// ─── Playback tick via requestAnimationFrame ─────────────────────────
let rafId: number | null = null;
let lastFrameTime = 0;

function tick(now: number) {
  if (!runner.playbackPlaying) {
    rafId = null;
    return;
  }
  if (lastFrameTime > 0) {
    const deltaMs = (now - lastFrameTime) * runner.playbackSpeed;
    const newTime = runner.playbackTimeMs + deltaMs;
    if (newTime >= runner.runEndMs) {
      runner.setPlaybackTime(runner.runEndMs);
      runner.playbackPlaying = false;
      rafId = null;
      return;
    }
    runner.setPlaybackTime(newTime);
  }
  lastFrameTime = now;
  rafId = requestAnimationFrame(tick);
}

watch(() => runner.playbackPlaying, (playing) => {
  if (playing) {
    // If at end, restart from beginning
    if (runner.playbackTimeMs >= runner.runEndMs) {
      runner.setPlaybackTime(runner.runStartMs);
    }
    lastFrameTime = 0;
    rafId = requestAnimationFrame(tick);
  } else {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
});

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
});

// ─── Speed cycling ──────────────────────────────────────────────────
const speeds = [0.5, 1, 2, 4];
const speedLabel = computed(() => `${runner.playbackSpeed}x`);

function cycleSpeed() {
  const idx = speeds.indexOf(runner.playbackSpeed);
  const next = speeds[(idx + 1) % speeds.length] ?? 1;
  runner.setPlaybackSpeed(next);
}

// ─── Time formatting ────────────────────────────────────────────────
function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const currentTimeLabel = computed(() => {
  if (!runner.playbackMode) return formatMs(runner.runDurationMs);
  return formatMs(runner.playbackTimeMs - runner.runStartMs);
});

const totalTimeLabel = computed(() => formatMs(runner.runDurationMs));

// ─── Event markers on the track ─────────────────────────────────────
const markers = computed(() => {
  if (!runner.currentRun || runner.runDurationMs <= 1) return [];
  const all = runner.timeline;
  return all
    .filter(e => ['node_start', 'node_complete', 'node_failed', 'delegation', 'result_return'].includes(e.type))
    .map(e => ({
      ratio: Math.max(0, Math.min(1, (e.timestamp - runner.runStartMs) / runner.runDurationMs)),
      type: e.type,
      detail: `${e.nodeLabel}: ${e.detail}`,
    }));
});

function markerColor(type: string): string {
  switch (type) {
    case 'node_start': return 'var(--chart-4)';       // yellow
    case 'node_complete': return 'var(--chart-3)';     // green
    case 'node_failed': return 'var(--destructive)';   // red
    case 'delegation': return 'var(--chart-2)';        // cyan
    case 'result_return': return 'var(--chart-5)';     // orange
    default: return 'var(--muted-foreground)';
  }
}

// ─── Scrubber interaction ───────────────────────────────────────────
function onTrackClick(event: MouseEvent) {
  if (!trackRef.value) return;
  const rect = trackRef.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  if (!runner.playbackMode) runner.enterPlayback();
  runner.setPlaybackRatio(ratio);
}

function onPointerDown(event: PointerEvent) {
  isDragging.value = true;
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
  onTrackClick(event);
}

function onPointerMove(event: PointerEvent) {
  if (!isDragging.value || !trackRef.value) return;
  const rect = trackRef.value.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  runner.setPlaybackRatio(ratio);
}

function onPointerUp() {
  isDragging.value = false;
}

// ─── Step controls ──────────────────────────────────────────────────
function stepBackward() {
  if (!runner.playbackMode) runner.enterPlayback();
  // Find the previous timeline event before current playhead
  const entries = runner.timeline;
  let target = runner.runStartMs;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.timestamp < runner.playbackTimeMs - 50) {
      target = entry.timestamp;
      break;
    }
  }
  runner.setPlaybackTime(target);
}

function stepForward() {
  if (!runner.playbackMode) runner.enterPlayback();
  // Find the next timeline event after current playhead
  const entries = runner.timeline;
  let target = runner.runEndMs;
  for (const entry of entries) {
    if (entry.timestamp > runner.playbackTimeMs + 50) {
      target = entry.timestamp;
      break;
    }
  }
  runner.setPlaybackTime(target);
}

// ─── Computed state ─────────────────────────────────────────────────
const fillRatio = computed(() => {
  if (!runner.playbackMode) return 1;
  return runner.playbackRatio;
});

const isLive = computed(() => !runner.playbackMode);
</script>

<template>
  <div class="flex h-9 items-center gap-1 border-b border-border bg-card/80 px-2">
    <TooltipProvider :delay-duration="300">
      <!-- Replay (enter playback from start) -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            :disabled="!runner.currentRun"
            @click="runner.enterPlayback()"
          >
            <RotateCcw class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Replay from start</TooltipContent>
      </Tooltip>

      <!-- Step backward -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            :disabled="!runner.currentRun"
            @click="stepBackward"
          >
            <ChevronLeft class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Previous event</TooltipContent>
      </Tooltip>

      <!-- Play / Pause -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            :disabled="!runner.currentRun"
            @click="runner.togglePlayPause()"
          >
            <Pause v-if="runner.playbackPlaying" class="h-3.5 w-3.5" />
            <Play v-else class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ runner.playbackPlaying ? 'Pause' : 'Play' }}</TooltipContent>
      </Tooltip>

      <!-- Step forward -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 w-6 p-0"
            :disabled="!runner.currentRun"
            @click="stepForward"
          >
            <ChevronRight class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Next event</TooltipContent>
      </Tooltip>

      <!-- Speed -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 px-1.5 text-[10px] font-mono"
            @click="cycleSpeed"
          >
            {{ speedLabel }}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Playback speed</TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <div class="mx-1 h-4 w-px bg-border" />

    <!-- Current time -->
    <span class="w-8 text-right font-mono text-[10px] text-muted-foreground">
      {{ currentTimeLabel }}
    </span>

    <!-- Track -->
    <div
      ref="trackRef"
      class="relative mx-1 h-4 flex-1 cursor-pointer rounded-sm"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <!-- Track background -->
      <div class="absolute inset-y-1 left-0 right-0 rounded-full bg-muted" />

      <!-- Filled portion -->
      <div
        class="absolute inset-y-1 left-0 rounded-full bg-primary/40 transition-[width] duration-75"
        :style="{ width: `${fillRatio * 100}%` }"
      />

      <!-- Event markers -->
      <div
        v-for="(m, i) in markers"
        :key="i"
        class="absolute top-0.5 h-3 w-0.5 rounded-full opacity-70"
        :style="{ left: `${m.ratio * 100}%`, backgroundColor: markerColor(m.type) }"
        :title="m.detail"
      />

      <!-- Playhead thumb (only in playback mode) -->
      <div
        v-if="runner.playbackMode"
        class="absolute top-0 h-4 w-1 -translate-x-1/2 rounded-full bg-primary shadow-sm shadow-primary/50 transition-[left] duration-75"
        :style="{ left: `${fillRatio * 100}%` }"
      />
    </div>

    <!-- Total time -->
    <span class="w-8 font-mono text-[10px] text-muted-foreground">
      {{ totalTimeLabel }}
    </span>

    <div class="mx-1 h-4 w-px bg-border" />

    <!-- Go Live / LIVE indicator -->
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-6 gap-1 px-1.5 text-[10px]"
            :class="isLive ? 'text-green-500' : 'text-muted-foreground hover:text-foreground'"
            @click="runner.exitPlayback()"
          >
            <Radio class="h-3 w-3" />
            LIVE
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ isLive ? 'Viewing live' : 'Return to live view' }}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
