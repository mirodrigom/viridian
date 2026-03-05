<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import type { LogoPosition } from '@/stores/manuals';

const props = defineProps<{
  content: string;
  logo1Data: string;
  logo2Data: string;
  logo1Position: LogoPosition;
  logo2Position: LogoPosition;
}>();

defineEmits<{
  'update:logo1Position': [pos: LogoPosition];
  'update:logo2Position': [pos: LogoPosition];
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const iframeHeight = ref(600);

// Injected after the document loads to fix any fixed-position elements that would
// be invisible in a scrollable preview (but work fine in print/PDF).
// NOTE: We intentionally do NOT override body width/padding here because the
// generated document already has its own layout (.page { width: 900px }) and
// overriding body max-width causes the pages to overflow and look broken.
const PREVIEW_OVERRIDE = `
<style id="preview-override">
  /* Fix fixed/sticky positioned header/footer so they appear inline in preview */
  .page-header {
    position: relative !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
  }
  .page-footer {
    position: relative !important;
    bottom: auto !important;
    left: auto !important;
    right: auto !important;
  }
  /* Light background so page cards are framed nicely */
  body {
    background: #f0f0f0 !important;
    padding: 8px !important;
    margin: 0 !important;
  }
  /* Visually show page breaks as a separator */
  .page-break {
    display: block !important;
    border: none !important;
    border-top: 2px dashed #d1d5db !important;
    margin: 0 !important;
    height: 0 !important;
  }
</style>`;

function updateIframe() {
  const iframe = iframeRef.value;
  if (!iframe || !props.content) return;

  const isFullDoc = /^\s*<!DOCTYPE/i.test(props.content) || /^\s*<html/i.test(props.content);
  let html = isFullDoc ? props.content : `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${props.content}</body></html>`;

  // Inject preview override before </head>
  html = html.replace('</head>', `${PREVIEW_OVERRIDE}</head>`);

  const doc = iframe.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();

  setTimeout(() => {
    if (iframe.contentDocument?.body) {
      iframeHeight.value = Math.max(600, iframe.contentDocument.body.scrollHeight + 60);
    }
  }, 300);
}

onMounted(updateIframe);
watch(() => props.content, updateIframe);
</script>

<template>
  <div class="manual-preview-wrapper">
    <iframe
      ref="iframeRef"
      class="manual-iframe"
      :style="{ height: iframeHeight + 'px' }"
      sandbox="allow-same-origin allow-scripts"
      title="Manual Preview"
    />
  </div>
</template>

<style scoped>
.manual-preview-wrapper {
  width: 100%;
  background: #f3f4f6;
  padding: 16px;
  border-radius: 8px;
}

.manual-iframe {
  width: 100%;
  border: none;
  background: white;
  box-shadow: 0 2px 12px rgba(0,0,0,0.12);
  border-radius: 4px;
  display: block;
}
</style>
