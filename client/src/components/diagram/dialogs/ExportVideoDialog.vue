<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDiagramsStore } from '@/stores/diagrams';
import { toast } from 'vue-sonner';

const props = defineProps<{
  open: boolean;
  flowContainer: HTMLDivElement | undefined;
  getViewport: () => { x: number; y: number; zoom: number };
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const diagrams = useDiagramsStore();
const duration = ref(3);
const fps = ref(8);
const scale = ref(1);
const isExporting = ref(false);
const progress = ref(0);
const exportPhase = ref<'capturing' | 'encoding'>('capturing');

const durationOptions = [2, 3, 5];
const fpsOptions = [6, 8, 12];
const scaleOptions = [
  { value: 0.5, label: '0.5x (Draft)' },
  { value: 1, label: '1x (Good)' },
  { value: 2, label: '2x (Sharp)' },
];

/** Detect the best supported video MIME type this browser can record. */
function detectMimeType(): { mimeType: string; ext: string } {
  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: '', ext: 'webm' };
}

const detectedFormat = computed(() => detectMimeType());

const totalFrames = computed(() => duration.value * fps.value);
const estimatedSeconds = computed(() => Math.round(totalFrames.value * 1.5));

const estimatedSize = computed(() => {
  const bounds = diagrams.getContentBounds(20);
  if (!bounds) {
    const el = props.flowContainer;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { w: Math.round(rect.width * scale.value), h: Math.round(rect.height * scale.value) };
  }
  const vp = props.getViewport();
  const w = Math.round(bounds.width * vp.zoom * scale.value);
  const h = Math.round(bounds.height * vp.zoom * scale.value);
  return { w, h };
});

function close() {
  if (isExporting.value) return;
  emit('update:open', false);
}

// ─── Color space helpers (copied from GIF dialog) ────────────────────────────

const _probeCanvas = document.createElement('canvas');
_probeCanvas.width = 1;
_probeCanvas.height = 1;
const _probeCtx = _probeCanvas.getContext('2d')!;

function oklchToRgb(oklchValue: string): string {
  _probeCtx.clearRect(0, 0, 1, 1);
  _probeCtx.fillStyle = oklchValue;
  _probeCtx.fillRect(0, 0, 1, 1);
  const imgData = _probeCtx.getImageData(0, 0, 1, 1).data;
  const [r, g, b, a] = [imgData[0]!, imgData[1]!, imgData[2]!, imgData[3]!];
  if (a === 0) return 'rgba(0,0,0,0)';
  if (a === 255) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function resolveOklchInString(value: string): string {
  return value.replace(/oklch\([^)]+\)/g, (match) => oklchToRgb(match));
}

function patchLiveStyles(): () => void {
  const patches: { el: HTMLStyleElement; original: string }[] = [];
  for (const style of document.querySelectorAll<HTMLStyleElement>('style')) {
    if (style.textContent?.includes('oklch')) {
      patches.push({ el: style, original: style.textContent });
      style.textContent = resolveOklchInString(style.textContent);
    }
  }
  return () => {
    for (const { el, original } of patches) {
      el.textContent = original;
    }
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function startExport() {
  if (!props.flowContainer) {
    toast.error('Cannot find diagram canvas');
    return;
  }

  const captureTarget = props.flowContainer;
  const FLOW_PADDING = 20;
  const bounds = diagrams.getContentBounds(FLOW_PADDING);
  if (!bounds) {
    toast.error('No nodes to export');
    return;
  }

  isExporting.value = true;
  exportPhase.value = 'capturing';
  progress.value = 0;

  const restoreStyles = patchLiveStyles();

  try {
    const { toCanvas } = await import('html-to-image');

    const vp = props.getViewport();
    const contentX = bounds.x * vp.zoom + vp.x;
    const contentY = bounds.y * vp.zoom + vp.y;
    const contentW = bounds.width * vp.zoom;
    const contentH = bounds.height * vp.zoom;

    // MediaRecorder requires even dimensions for most codecs
    const rawW = Math.max(2, Math.round(contentW * scale.value));
    const rawH = Math.max(2, Math.round(contentH * scale.value));
    const canvasWidth  = rawW % 2 === 0 ? rawW : rawW + 1;
    const canvasHeight = rawH % 2 === 0 ? rawH : rawH + 1;

    // ── Step 1: capture all frames as ImageBitmap objects ─────────────────────
    const { mimeType, ext } = detectedFormat.value;
    const frameDelay = Math.round(1000 / fps.value);
    const total = totalFrames.value;

    // Output canvas that MediaRecorder will stream from
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width  = canvasWidth;
    outputCanvas.height = canvasHeight;
    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) throw new Error('Canvas 2D context unavailable');

    diagrams.gifExportProgress = 0;
    await nextTick();

    // Capture phase — render frames into ImageBitmap array
    const frameBitmaps: ImageBitmap[] = [];

    for (let i = 0; i < total; i++) {
      diagrams.gifExportProgress = (i / total) % 1;
      await nextTick();

      const fullCanvas = await toCanvas(captureTarget, {
        backgroundColor: '#0a0a0a',
        pixelRatio: 1,
        filter: (node: Element) => {
          if (node.classList?.contains('vue-flow__controls')) return false;
          if (node.classList?.contains('vue-flow__minimap')) return false;
          if (node.classList?.contains('vue-flow__handle')) return false;
          if (node.tagName === 'animateMotion' || node.tagName === 'mpath') return false;
          return true;
        },
      });

      // Crop to content region
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width  = canvasWidth;
      frameCanvas.height = canvasHeight;
      const ctx = frameCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      const safeX = Math.max(0, contentX);
      const safeY = Math.max(0, contentY);
      const safeW = Math.min(contentW, fullCanvas.width  - safeX);
      const safeH = Math.min(contentH, fullCanvas.height - safeY);
      ctx.drawImage(fullCanvas, safeX, safeY, safeW, safeH, 0, 0, canvasWidth, canvasHeight);

      frameBitmaps.push(await createImageBitmap(frameCanvas));

      progress.value = Math.round(((i + 1) / total) * 100);
      await new Promise(r => setTimeout(r, 0));
    }

    // ── Step 2: encode via MediaRecorder ─────────────────────────────────────
    exportPhase.value = 'encoding';
    progress.value = 0;

    const stream = outputCanvas.captureStream(0); // 0 = manual frame control
    const recorderOptions: MediaRecorderOptions = {};
    if (mimeType) recorderOptions.mimeType = mimeType;

    const recorder = new MediaRecorder(stream, recorderOptions);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const recordingDone = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const type = mimeType || 'video/webm';
        resolve(new Blob(chunks, { type }));
      };
      recorder.onerror = (e) => reject(new Error('MediaRecorder error: ' + String(e)));
    });

    recorder.start();

    const videoTrack = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };

    for (let i = 0; i < frameBitmaps.length; i++) {
      const bitmap = frameBitmaps[i]!;
      outputCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      outputCtx.drawImage(bitmap, 0, 0);
      bitmap.close();

      // Signal that a new frame is ready
      if (videoTrack.requestFrame) {
        videoTrack.requestFrame();
      }

      // Hold this frame for the configured duration
      await new Promise(r => setTimeout(r, frameDelay));

      progress.value = Math.round(((i + 1) / frameBitmaps.length) * 100);
    }

    recorder.stop();
    const blob = await recordingDone;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Video exported successfully (${ext.toUpperCase()})`);
    emit('update:open', false);
  } catch (err) {
    console.error('Video export error:', err);
    toast.error('Video export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
  } finally {
    diagrams.gifExportProgress = null;
    restoreStyles();
    isExporting.value = false;
    progress.value = 0;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="props.open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="close">
        <div class="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
          <h3 class="mb-4 text-sm font-semibold">Export Video</h3>

          <div class="space-y-4">
            <!-- Duration -->
            <div class="space-y-1">
              <Label class="text-[11px]">Duration (seconds)</Label>
              <div class="flex gap-1">
                <button
                  v-for="d in durationOptions"
                  :key="d"
                  class="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="duration === d ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                  @click="duration = d"
                >
                  {{ d }}s
                </button>
              </div>
            </div>

            <!-- FPS -->
            <div class="space-y-1">
              <Label class="text-[11px]">Frames Per Second</Label>
              <div class="flex gap-1">
                <button
                  v-for="f in fpsOptions"
                  :key="f"
                  class="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="fps === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                  @click="fps = f"
                >
                  {{ f }} fps
                </button>
              </div>
            </div>

            <!-- Scale -->
            <div class="space-y-1">
              <Label class="text-[11px]">Resolution Scale</Label>
              <div class="flex gap-1">
                <button
                  v-for="s in scaleOptions"
                  :key="s.value"
                  class="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="scale === s.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                  @click="scale = s.value"
                >
                  {{ s.label }}
                </button>
              </div>
            </div>

            <!-- Info -->
            <div class="rounded-md border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground space-y-0.5">
              <div>Total frames: <span class="text-foreground font-medium">{{ totalFrames }}</span></div>
              <div v-if="estimatedSize">Output: <span class="text-foreground font-medium">{{ estimatedSize.w }} x {{ estimatedSize.h }}px</span></div>
              <div>Estimated time: <span class="text-foreground font-medium">~{{ estimatedSeconds }}s</span></div>
              <div>
                Format:
                <span class="text-foreground font-medium uppercase">{{ detectedFormat.ext }}</span>
                <span class="ml-1 text-muted-foreground/70">({{ detectedFormat.mimeType || 'default' }})</span>
              </div>
              <div class="text-muted-foreground">Cropped to diagram content</div>
            </div>

            <!-- Progress -->
            <div v-if="isExporting" class="space-y-1">
              <div class="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  {{
                    exportPhase === 'capturing'
                      ? `Capturing frame ${Math.round(progress * totalFrames / 100)} / ${totalFrames}`
                      : `Encoding frame ${Math.round(progress * totalFrames / 100)} / ${totalFrames}`
                  }}
                </span>
                <span class="tabular-nums">{{ progress }}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full transition-all duration-200"
                  :class="exportPhase === 'encoding' ? 'bg-green-500' : 'bg-primary'"
                  :style="{ width: progress + '%' }"
                />
              </div>
              <div class="text-[9px] text-muted-foreground/60">
                {{ exportPhase === 'capturing' ? 'Tip: use 0.5x scale for faster export' : 'Encoding frames into video...' }}
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <Button variant="ghost" size="sm" :disabled="isExporting" @click="close">Cancel</Button>
            <Button size="sm" :disabled="isExporting" @click="startExport">
              {{ isExporting ? 'Exporting...' : 'Export Video' }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
