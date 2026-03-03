<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDiagramsStore } from '@/stores/diagrams';
import { useVueFlow } from '@vue-flow/core';
import { toast } from 'vue-sonner';

const props = defineProps<{
  open: boolean;
  flowContainer: HTMLDivElement | undefined;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const diagrams = useDiagramsStore();
const { getViewport, getNodes } = useVueFlow('diagram-editor');

function getContentBounds(padding = 50): { x: number; y: number; width: number; height: number } | null {
  const visible = getNodes.value.filter(n => !n.hidden);
  if (visible.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of visible) {
    let absX = node.position.x;
    let absY = node.position.y;
    if (node.parentNode) {
      const parent = visible.find(n => n.id === node.parentNode);
      if (parent) {
        absX += parent.position.x;
        absY += parent.position.y;
      }
    }
    const w = node.dimensions?.width || (node.type === 'aws-group' ? 400 : 160);
    const h = node.dimensions?.height || (node.type === 'aws-group' ? 300 : 60);

    if (absX < minX) minX = absX;
    if (absY < minY) minY = absY;
    if (absX + w > maxX) maxX = absX + w;
    if (absY + h > maxY) maxY = absY + h;
  }

  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

const duration = ref(3);
const fps = ref(8);
const scale = ref(1);
const cropMode = ref<'content' | 'viewport'>('content');
const isExporting = ref(false);
const progress = ref(0);

const durationOptions = [2, 3, 5];
const fpsOptions = [6, 8, 12];
const scaleOptions = [
  { value: 0.5, label: '0.5x (Draft)' },
  { value: 1, label: '1x (Good)' },
  { value: 2, label: '2x (Sharp)' },
];

const totalFrames = computed(() => duration.value * fps.value);
const estimatedSeconds = computed(() => Math.round(totalFrames.value * 1.5));

// Show estimated output dimensions (content mode: based on diagram-space, not screen-space)
const estimatedSize = computed(() => {
  if (cropMode.value === 'content') {
    const bounds = getContentBounds();
    if (!bounds) return null;
    const w = Math.round(bounds.width * scale.value);
    const h = Math.round(bounds.height * scale.value);
    return { w, h };
  }
  const el = props.flowContainer;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { w: Math.round(rect.width * scale.value), h: Math.round(rect.height * scale.value) };
});

function close() {
  if (isExporting.value) return;
  emit('update:open', false);
}

/**
 * Convert any oklch() color string to rgb/rgba by drawing a 1×1 canvas pixel.
 * getComputedStyle() returns oklch as-is in Chrome 111+, but getImageData()
 * always returns raw RGBA bytes regardless of input color space.
 */
const _probeCanvas = document.createElement('canvas');
_probeCanvas.width = 1;
_probeCanvas.height = 1;
const _probeCtx = _probeCanvas.getContext('2d')!;

function oklchToRgb(oklchValue: string): string {
  _probeCtx.clearRect(0, 0, 1, 1);
  _probeCtx.fillStyle = oklchValue;
  _probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = _probeCtx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return 'rgba(0,0,0,0)';
  if (a === 255) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/**
 * Replace every oklch(...) occurrence in a string with its browser-resolved
 * rgb/rgba equivalent.
 */
function resolveOklchInString(value: string): string {
  return value.replace(
    /oklch\([^)]+\)/g,
    (match) => oklchToRgb(match),
  );
}

/**
 * Patch all live <style> tags that contain oklch() so the SVG serializer
 * (html-to-image) doesn't encounter unsupported color formats. Returns a restore function.
 */
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

const exportPhase = ref<'capturing' | 'encoding'>('capturing');

async function startExport() {
  if (!props.flowContainer) {
    toast.error('Cannot find diagram canvas');
    return;
  }

  const captureTarget = props.flowContainer.querySelector('.vue-flow__transformationpane') as HTMLElement
    ?? props.flowContainer.querySelector('.vue-flow__viewport') as HTMLElement
    ?? props.flowContainer;

  isExporting.value = true;
  exportPhase.value = 'capturing';
  progress.value = 0;

  // Patch live <style> tags that use oklch() (unsupported by serializers), restore after.
  const restoreStyles = patchLiveStyles();

  try {
    const { toCanvas } = await import('html-to-image');
    const { encode: encodeGif } = await import('modern-gif');

    // Determine capture region and compute zoom-independent output dimensions
    const targetRect = captureTarget.getBoundingClientRect();
    const viewport = getViewport();
    let cropX = 0;       // screen-space offset of content within the element
    let cropY = 0;
    let screenW = targetRect.width;   // content region in screen pixels
    let screenH = targetRect.height;
    let canvasWidth: number;
    let canvasHeight: number;
    let pixelRatio: number;

    if (cropMode.value === 'content') {
      const bounds = getContentBounds();
      if (!bounds) {
        toast.error('No nodes to export');
        return;
      }
      cropX = bounds.x * viewport.zoom + viewport.x;
      cropY = bounds.y * viewport.zoom + viewport.y;
      screenW = bounds.width * viewport.zoom;
      screenH = bounds.height * viewport.zoom;

      // Output size = diagram-space dimensions * scale (independent of zoom)
      canvasWidth = Math.round(bounds.width * scale.value);
      canvasHeight = Math.round(bounds.height * scale.value);

      // pixelRatio to ensure the full canvas has enough pixels to crop from
      // Capped at 4 to prevent excessive memory usage on very zoomed-out views
      pixelRatio = Math.min(scale.value / viewport.zoom, 4);
    } else {
      canvasWidth = Math.round(targetRect.width * scale.value);
      canvasHeight = Math.round(targetRect.height * scale.value);
      pixelRatio = scale.value;
    }

    const frameDelay = Math.round(1000 / fps.value);
    const frames: { data: Uint8ClampedArray; width: number; height: number; delay: number }[] = [];

    const total = totalFrames.value;

    // Switch edges to export mode — dots positioned via getPointAtLength
    diagrams.gifExportProgress = 0;
    await nextTick();

    for (let i = 0; i < total; i++) {
      // Advance animation: progress cycles 0 → 1 over the GIF duration
      diagrams.gifExportProgress = (i / total) % 1;
      await nextTick(); // Let Vue re-render dot positions

      const fullCanvas = await toCanvas(captureTarget, {
        backgroundColor: '#0a0a0a',
        pixelRatio,
        filter: (node: Element) => {
          // Exclude animateMotion elements (replaced by programmatic positions)
          if (node.tagName === 'animateMotion' || node.tagName === 'mpath') return false;
          return true;
        },
      });

      // Crop to content bounds if needed
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = canvasWidth;
      frameCanvas.height = canvasHeight;
      const ctx = frameCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      if (cropMode.value === 'content') {
        // Source region in the full canvas: screen coords * pixelRatio
        const srcX = cropX * pixelRatio;
        const srcY = cropY * pixelRatio;
        const srcW = screenW * pixelRatio;
        const srcH = screenH * pixelRatio;
        ctx.drawImage(
          fullCanvas,
          srcX, srcY, srcW, srcH,
          0, 0, canvasWidth, canvasHeight,
        );
      } else {
        ctx.drawImage(fullCanvas, 0, 0, canvasWidth, canvasHeight);
      }

      frames.push({
        data: ctx.getImageData(0, 0, canvasWidth, canvasHeight).data,
        width: canvasWidth,
        height: canvasHeight,
        delay: frameDelay,
      });

      progress.value = Math.round(((i + 1) / total) * 100);
      // Yield to browser so progress bar updates
      await new Promise(r => setTimeout(r, 0));
    }

    exportPhase.value = 'encoding';
    progress.value = 0;

    const gifData = await encodeGif({ width: canvasWidth, height: canvasHeight, frames });

    const blob = new Blob([gifData], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.gif`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('GIF exported successfully');
    emit('update:open', false);
  } catch (err) {
    console.error('GIF export error:', err);
    toast.error('GIF export failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
  } finally {
    // Resume live SVG animation
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
          <h3 class="mb-4 text-sm font-semibold">Export GIF Animation</h3>

          <div class="space-y-4">
            <!-- Crop Mode -->
            <div class="space-y-1">
              <Label class="text-[11px]">Crop</Label>
              <div class="flex gap-1">
                <button
                  class="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="cropMode === 'content' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                  @click="cropMode = 'content'"
                >
                  Fit to Content
                </button>
                <button
                  class="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                  :class="cropMode === 'viewport' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50'"
                  @click="cropMode = 'viewport'"
                >
                  Full Viewport
                </button>
              </div>
            </div>

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
              <div v-if="cropMode === 'content'" class="text-green-500">Cropped to content bounds</div>
            </div>

            <!-- Progress -->
            <div v-if="isExporting" class="space-y-1">
              <div class="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{{ exportPhase === 'capturing' ? `Capturing frame ${Math.round(progress * totalFrames / 100)} / ${totalFrames}` : 'Encoding GIF...' }}</span>
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
                {{ exportPhase === 'capturing' ? 'Tip: use 0.5x scale for faster export' : 'Encoding frames into GIF...' }}
              </div>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <Button variant="ghost" size="sm" :disabled="isExporting" @click="close">Cancel</Button>
            <Button size="sm" :disabled="isExporting" @click="startExport">
              {{ isExporting ? 'Exporting...' : 'Export GIF' }}
            </Button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
