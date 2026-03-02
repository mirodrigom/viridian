<script setup lang="ts">
import { ref, computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDiagramsStore } from '@/stores/diagrams';
import { toast } from 'vue-sonner';

const props = defineProps<{
  open: boolean;
  flowContainer: HTMLDivElement | undefined;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

const diagrams = useDiagramsStore();

const duration = ref(3);
const fps = ref(8);
const scale = ref(0.5);
const isExporting = ref(false);
const progress = ref(0);

const durationOptions = [2, 3, 5];
const fpsOptions = [6, 8, 12];
const scaleOptions = [
  { value: 0.5, label: '0.5x (fast)' },
  { value: 1, label: '1x' },
];

const estimatedSeconds = computed(() => Math.round(totalFrames.value * 1.5));

const totalFrames = computed(() => duration.value * fps.value);

function close() {
  if (isExporting.value) return;
  emit('update:open', false);
}

/**
 * Build a <style> tag that overrides all oklch() CSS custom properties
 * with hex equivalents. Injected ONCE before the capture loop so that
 * html2canvas clones inherit the overrides — no per-frame DOM traversal needed.
 */
function buildOklchOverrideStyle(): HTMLStyleElement {
  const root = document.documentElement;
  const computed = window.getComputedStyle(root);
  const overrides: string[] = [];

  function toHex(value: string): string {
    return value.replace(
      /oklch\(([\d.]+)\s+[\d.]+\s+[\d.]+(?:\s*\/\s*([\d.]+%?))?\)/g,
      (_match, l, alpha) => {
        const gray = Math.round(parseFloat(l) * 255);
        const hex = gray.toString(16).padStart(2, '0');
        if (alpha !== undefined) {
          const a = alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha);
          return `rgba(${gray},${gray},${gray},${a})`;
        }
        return `#${hex}${hex}${hex}`;
      }
    );
  }

  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (prop.startsWith('--')) {
      const val = computed.getPropertyValue(prop);
      if (val.includes('oklch')) {
        overrides.push(`  ${prop}: ${toHex(val)};`);
      }
    }
  }

  const style = document.createElement('style');
  style.id = '__gif-oklch-override';
  style.textContent = `:root {\n${overrides.join('\n')}\n}`;
  return style;
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

  // Inject oklch override ONCE — html2canvas clones inherit the style tag
  const overrideStyle = buildOklchOverrideStyle();
  document.head.appendChild(overrideStyle);

  try {
    const html2canvas = (await import('html2canvas')).default;
    const { encodeGif } = await import('modern-gif');

    const { width: w, height: h } = captureTarget.getBoundingClientRect();
    const canvasWidth = Math.round(w * scale.value);
    const canvasHeight = Math.round(h * scale.value);
    const frameDelay = Math.round(1000 / fps.value);
    const frames: { data: Uint8ClampedArray; width: number; height: number; delay: number }[] = [];

    const total = totalFrames.value;
    for (let i = 0; i < total; i++) {
      const canvas = await html2canvas(captureTarget, {
        width: w,
        height: h,
        scale: scale.value,
        backgroundColor: '#0a0a0a',
        logging: false,
        useCORS: true,
        allowTaint: true,
      });

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
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

    const gifData = await encodeGif(frames, { width: canvasWidth, height: canvasHeight });

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
    document.head.removeChild(overrideStyle);
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
              <div>Estimated time: <span class="text-foreground font-medium">~{{ estimatedSeconds }}s</span></div>
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
