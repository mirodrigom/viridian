<script setup lang="ts">
import { computed, ref } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useAuthStore } from '@/stores/auth';
import { ZoomIn, ZoomOut, RotateCw, Maximize2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';

const props = defineProps<{
  path: string;
  lastModified: number;
}>();

const filesStore = useFilesStore();
const auth = useAuthStore();

const zoom = ref(100);
const rotation = ref(0);

const imageUrl = computed(() => {
  const root = encodeURIComponent(filesStore.rootPath);
  const filePath = encodeURIComponent(props.path);
  // Append lastModified as cache-buster for auto-refresh
  return `/api/files/content?root=${root}&path=${filePath}&raw=true&t=${props.lastModified}&token=${auth.token}`;
});

function zoomIn() {
  zoom.value = Math.min(zoom.value + 25, 500);
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 25, 25);
}

function resetView() {
  zoom.value = 100;
  rotation.value = 0;
}

function rotate() {
  rotation.value = (rotation.value + 90) % 360;
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-1">
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Zoom out" @click="zoomOut">
        <ZoomOut class="h-3.5 w-3.5" />
      </Button>
      <span class="min-w-[3rem] text-center text-[11px] font-medium text-muted-foreground">{{ zoom }}%</span>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Zoom in" @click="zoomIn">
        <ZoomIn class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Rotate" @click="rotate">
        <RotateCw class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Reset view" @click="resetView">
        <Maximize2 class="h-3.5 w-3.5" />
      </Button>
    </div>
    <div class="flex flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-4">
      <img
        :src="imageUrl"
        :alt="path"
        class="max-w-none transition-transform duration-200"
        :style="{
          transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
        }"
        draggable="false"
      />
    </div>
  </div>
</template>
