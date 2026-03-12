<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';

const props = defineProps<{ content: string }>();

const iframeRef = ref<HTMLIFrameElement | null>(null);

function updateIframe() {
  const iframe = iframeRef.value;
  if (!iframe) return;

  const doc = iframe.contentDocument;
  if (!doc) return;

  doc.open();
  doc.write(props.content);
  doc.close();
}

onMounted(() => {
  updateIframe();
});

watch(() => props.content, () => {
  updateIframe();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
      <span class="text-[11px] font-medium text-muted-foreground">HTML Preview (sandboxed)</span>
    </div>
    <iframe
      ref="iframeRef"
      sandbox="allow-scripts allow-same-origin"
      class="flex-1 border-0 bg-white"
      title="HTML Preview"
    />
  </div>
</template>
