<script setup lang="ts">
import { computed } from 'vue';
import { useFilesStore } from '@/stores/files';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  path: string;
  lastModified: number;
}>();

const filesStore = useFilesStore();
const auth = useAuthStore();

const pdfUrl = computed(() => {
  const root = encodeURIComponent(filesStore.rootPath);
  const filePath = encodeURIComponent(props.path);
  return `/api/files/content?root=${root}&path=${filePath}&raw=true&t=${props.lastModified}&token=${auth.token}`;
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <span class="text-[11px] font-medium text-muted-foreground">PDF Preview</span>
    </div>
    <iframe
      :src="pdfUrl"
      class="flex-1 border-0"
      type="application/pdf"
      title="PDF Preview"
    />
  </div>
</template>
