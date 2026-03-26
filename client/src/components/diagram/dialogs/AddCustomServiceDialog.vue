<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Link, Image, Sparkles, X } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ add: [name: string, iconUrl: string, color: string] }>();

const name = ref('');
const iconUrl = ref('');
const color = ref('#6B7280');
const iconPreview = ref('');
const iconMode = ref<'url' | 'upload'>('upload');
const fileInput = ref<HTMLInputElement | null>(null);

// Auto-fetch state
const autoFetchedUrl = ref('');
const autoFetchLoading = ref(false);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const colors = [
  { value: '#6B7280', label: 'Gray' },
  { value: '#FF9900', label: 'Orange' },
  { value: '#3F8624', label: 'Green' },
  { value: '#C925D1', label: 'Purple' },
  { value: '#8C4FFF', label: 'Violet' },
  { value: '#DD344C', label: 'Red' },
  { value: '#01A88D', label: 'Teal' },
  { value: '#E7157B', label: 'Pink' },
  { value: '#147EBA', label: 'Blue' },
];

/**
 * Derive a best-guess domain from the service name.
 * If the name already contains a dot treat it as a domain directly.
 * Otherwise append ".com".
 */
function toDomain(serviceName: string): string {
  const trimmed = serviceName.trim().toLowerCase();
  if (trimmed.includes('.')) return trimmed;
  // Strip spaces/special chars that wouldn't appear in a domain
  return trimmed.replace(/\s+/g, '') + '.com';
}

/**
 * Verify that the Google favicon URL resolves to a real icon (not the 1×1
 * transparent fallback Google returns for unknown domains).
 * We do this by drawing the image onto a canvas and checking whether any
 * non-transparent pixel exists.
 */
function verifyFaviconUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(true); return; }
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        // Look for at least one non-transparent pixel
        for (let i = 3; i < data.length; i += 4) {
          if ((data[i] ?? 0) > 10) { resolve(true); return; }
        }
        resolve(false);
      } catch {
        // Canvas tainted (CORS) — assume it loaded something real
        resolve(true);
      }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function fetchAutoLogo(serviceName: string) {
  const trimmed = serviceName.trim();
  if (!trimmed) {
    autoFetchedUrl.value = '';
    return;
  }

  autoFetchLoading.value = true;
  autoFetchedUrl.value = '';

  try {
    const domain = toDomain(trimmed);
    const candidate = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
    const valid = await verifyFaviconUrl(candidate);
    if (valid) {
      autoFetchedUrl.value = candidate;
    }
  } catch {
    // Silently ignore — auto-fetch is best-effort
  } finally {
    autoFetchLoading.value = false;
  }
}

watch(name, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  autoFetchedUrl.value = '';
  autoFetchLoading.value = false;

  if (!val.trim()) return;

  // Only auto-fetch when the user hasn't already chosen a logo manually
  if (iconUrl.value) return;

  debounceTimer = setTimeout(() => {
    fetchAutoLogo(val);
  }, 300);
});

watch(open, (val) => {
  if (val) {
    name.value = '';
    iconUrl.value = '';
    iconPreview.value = '';
    color.value = '#6B7280';
    iconMode.value = 'upload';
    autoFetchedUrl.value = '';
    autoFetchLoading.value = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }
});

function acceptAutoFetched() {
  iconUrl.value = autoFetchedUrl.value;
  iconPreview.value = autoFetchedUrl.value;
  autoFetchedUrl.value = '';
}

function dismissAutoFetched() {
  autoFetchedUrl.value = '';
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result as string;
    iconUrl.value = dataUrl;
    iconPreview.value = dataUrl;
    // Clear auto-suggestion when user manually picks an image
    autoFetchedUrl.value = '';
  };
  reader.readAsDataURL(file);
}

function onUrlInput(url: string) {
  iconUrl.value = url;
  iconPreview.value = url;
  // Clear auto-suggestion when user manually provides a URL
  if (url) autoFetchedUrl.value = '';
}

function onAdd() {
  if (!name.value.trim()) return;
  emit('add', name.value.trim(), iconUrl.value, color.value);
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add Custom Service</DialogTitle>
        <DialogDescription>Add a custom service or integration with your own logo.</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- Name -->
        <div class="space-y-1.5">
          <Label class="text-xs">Name</Label>
          <Input
            v-model="name"
            class="h-8 text-sm"
            placeholder="e.g. Salesforce, Stripe, Datadog..."
            @keydown.enter="onAdd"
          />
        </div>

        <!-- Icon -->
        <div class="space-y-1.5">
          <Label class="text-xs">Logo / Icon</Label>
          <div class="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              class="h-7 flex-1 text-xs"
              :class="iconMode === 'upload' ? 'border-primary bg-primary/10' : ''"
              @click="iconMode = 'upload'"
            >
              <Upload class="mr-1 h-3 w-3" /> Upload
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 flex-1 text-xs"
              :class="iconMode === 'url' ? 'border-primary bg-primary/10' : ''"
              @click="iconMode = 'url'"
            >
              <Link class="mr-1 h-3 w-3" /> URL
            </Button>
          </div>

          <!-- Upload mode -->
          <div v-if="iconMode === 'upload'" class="space-y-2">
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onFileChange"
            />
            <Button
              variant="outline"
              size="sm"
              class="w-full text-xs"
              @click="fileInput?.click()"
            >
              <Image class="mr-1.5 h-3.5 w-3.5" />
              {{ iconPreview ? 'Change image...' : 'Choose image...' }}
            </Button>
          </div>

          <!-- URL mode -->
          <div v-else>
            <Input
              :model-value="iconUrl"
              class="h-8 text-xs"
              placeholder="https://example.com/logo.svg"
              @update:model-value="(v: string | number) => onUrlInput(String(v))"
            />
          </div>

          <!-- Auto-fetched logo suggestion -->
          <div
            v-if="autoFetchedUrl && !iconPreview"
            class="flex items-center gap-3 rounded-md border border-dashed border-primary/50 bg-primary/5 p-2"
          >
            <img
              :src="autoFetchedUrl"
              alt="Auto-detected logo"
              class="h-8 w-8 shrink-0 object-contain"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <Sparkles class="h-3 w-3 text-primary" />
                <span class="text-xs font-medium text-primary">Auto-detected</span>
              </div>
              <p class="truncate text-[11px] text-muted-foreground">Logo found for {{ name.trim() }}</p>
            </div>
            <div class="flex shrink-0 gap-1">
              <Button
                size="sm"
                class="h-6 px-2 text-[11px]"
                @click="acceptAutoFetched"
              >
                Use
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0"
                @click="dismissAutoFetched"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>
          </div>

          <!-- Loading indicator while fetching -->
          <div
            v-if="autoFetchLoading && !iconPreview"
            class="flex items-center gap-2 rounded-md border border-border/50 p-2 text-xs text-muted-foreground"
          >
            <svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Looking up logo...
          </div>

          <!-- Manual preview (user-chosen) -->
          <div v-if="iconPreview" class="flex items-center gap-3 rounded-md border border-border p-2">
            <img :src="iconPreview" alt="Icon preview" class="h-8 w-8 object-contain" />
            <span class="flex-1 text-xs text-muted-foreground">Preview</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              @click="() => { iconUrl = ''; iconPreview = ''; }"
            >
              <X class="h-3 w-3" />
            </Button>
          </div>
        </div>

        <!-- Color -->
        <div class="space-y-1.5">
          <Label class="text-xs">Accent Color</Label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="c in colors"
              :key="c.value"
              class="h-6 w-6 rounded-md border transition-all"
              :class="color === c.value ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:scale-110'"
              :style="{ backgroundColor: c.value, borderColor: c.value + '60' }"
              @click="color = c.value"
            />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" @click="open = false">Cancel</Button>
        <Button size="sm" :disabled="!name.trim()" @click="onAdd">Add Service</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
