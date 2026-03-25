<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Upload, X } from 'lucide-vue-next';

const props = defineProps<{
  label: string;
  modelValue: string;
  extractColors?: boolean;
  brandColors?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:brandColors': [colors: string[]];
}>();

const fileInput = ref<HTMLInputElement | null>(null);

function handleFileSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    emit('update:modelValue', dataUrl);

    if (props.extractColors) {
      extractDominantColors(dataUrl);
    }
  };
  reader.readAsDataURL(file);
}

function extractDominantColors(dataUrl: string) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Scale down for faster processing
    const maxSize = 100;
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    canvas.width = Math.floor(img.width * scale);
    canvas.height = Math.floor(img.height * scale);

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    // Collect non-transparent, non-white, non-black pixels into buckets
    const colorMap = new Map<string, { r: number; g: number; b: number; count: number }>();

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      const g = pixels[i + 1]!;
      const b = pixels[i + 2]!;
      const a = pixels[i + 3]!;

      // Skip transparent pixels
      if (a < 128) continue;

      // Skip near-white and near-black
      const brightness = (r + g + b) / 3;
      if (brightness > 240 || brightness < 15) continue;

      // Quantize to reduce similar colors (bucket by 32)
      const qr = Math.round(r / 32) * 32;
      const qg = Math.round(g / 32) * 32;
      const qb = Math.round(b / 32) * 32;
      const key = `${qr},${qg},${qb}`;

      const existing = colorMap.get(key);
      if (existing) {
        // Running average for more accurate color
        existing.r = Math.round((existing.r * existing.count + r) / (existing.count + 1));
        existing.g = Math.round((existing.g * existing.count + g) / (existing.count + 1));
        existing.b = Math.round((existing.b * existing.count + b) / (existing.count + 1));
        existing.count++;
      } else {
        colorMap.set(key, { r, g, b, count: 1 });
      }
    }

    // Sort by frequency and take top 5
    const sorted = Array.from(colorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Filter out colors that are too similar to each other
    const distinct: string[] = [];
    for (const color of sorted) {
      const hex = rgbToHex(color.r, color.g, color.b);
      const isDuplicate = distinct.some(existing => colorDistance(existing, hex) < 50);
      if (!isDuplicate) {
        distinct.push(hex);
      }
      if (distinct.length >= 5) break;
    }

    if (distinct.length > 0) {
      emit('update:brandColors', distinct);
    }
  };
  img.src = dataUrl;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function clear() {
  emit('update:modelValue', '');
  if (fileInput.value) fileInput.value.value = '';
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <label class="text-sm font-medium text-foreground">{{ label }}</label>
    <div
      v-if="!modelValue"
      class="flex h-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50 hover:bg-muted/50"
      @click="fileInput?.click()"
    >
      <div class="flex flex-col items-center gap-1 text-muted-foreground">
        <Upload class="h-5 w-5" />
        <span class="text-xs">Click to upload logo</span>
      </div>
    </div>
    <div v-else class="relative inline-block">
      <img :src="modelValue" :alt="label" class="h-20 max-w-[160px] rounded border border-border object-contain bg-white p-1" />
      <button
        class="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
        @click="clear"
      >
        <X class="h-3 w-3" />
      </button>
    </div>

    <!-- Brand color palette preview -->
    <div v-if="extractColors && brandColors && brandColors.length > 0" class="flex items-center gap-1.5">
      <span class="text-[10px] text-muted-foreground">Brand colors:</span>
      <div class="flex gap-1">
        <div
          v-for="(color, idx) in brandColors"
          :key="idx"
          class="h-4 w-4 rounded-sm border border-border shadow-sm"
          :style="{ backgroundColor: color }"
          :title="color"
        />
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="handleFileSelect"
    />
  </div>
</template>
