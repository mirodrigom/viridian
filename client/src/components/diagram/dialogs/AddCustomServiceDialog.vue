<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Link, Image } from 'lucide-vue-next';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ add: [name: string, iconUrl: string, color: string] }>();

const name = ref('');
const iconUrl = ref('');
const color = ref('#6B7280');
const iconPreview = ref('');
const iconMode = ref<'url' | 'upload'>('upload');
const fileInput = ref<HTMLInputElement | null>(null);

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

watch(open, (val) => {
  if (val) {
    name.value = '';
    iconUrl.value = '';
    iconPreview.value = '';
    color.value = '#6B7280';
    iconMode.value = 'upload';
  }
});

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result as string;
    iconUrl.value = dataUrl;
    iconPreview.value = dataUrl;
  };
  reader.readAsDataURL(file);
}

function onUrlInput(url: string) {
  iconUrl.value = url;
  iconPreview.value = url;
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
              @update:model-value="onUrlInput"
            />
          </div>

          <!-- Preview -->
          <div v-if="iconPreview" class="flex items-center gap-3 rounded-md border border-border p-2">
            <img :src="iconPreview" alt="Icon preview" class="h-8 w-8 object-contain" />
            <span class="text-xs text-muted-foreground">Preview</span>
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
