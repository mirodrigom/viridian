<script setup lang="ts">
import { defineAsyncComponent, watch } from 'vue';
import { usePreviewStore } from '@/stores/preview';
import { useFilesStore } from '@/stores/files';
import PreviewTabBar from './PreviewTabBar.vue';
import { Button } from '@/components/ui/button';
import { Eye, Loader2 } from 'lucide-vue-next';
import FileSidebar from '@/components/layout/FileSidebar.vue';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';

const MarkdownPreview = defineAsyncComponent(() => import('./renderers/MarkdownPreview.vue'));
const HtmlPreview = defineAsyncComponent(() => import('./renderers/HtmlPreview.vue'));
const ImagePreview = defineAsyncComponent(() => import('./renderers/ImagePreview.vue'));
const CodePreview = defineAsyncComponent(() => import('./renderers/CodePreview.vue'));
const MermaidPreview = defineAsyncComponent(() => import('./renderers/MermaidPreview.vue'));
const PdfPreview = defineAsyncComponent(() => import('./renderers/PdfPreview.vue'));

const preview = usePreviewStore();
const files = useFilesStore();

// When a file is opened in the files store (via the shared FileSidebar),
// also open it in the preview panel
watch(() => files.activeFile, (newPath) => {
  if (newPath) {
    preview.openPreview(newPath);
  }
});
</script>

<template>
  <ResizablePanelGroup direction="horizontal">
    <ResizablePanel :default-size="20" :min-size="15" :max-size="40">
      <FileSidebar />
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel :default-size="80" :min-size="40">
      <div class="flex h-full min-h-0 flex-col">
        <PreviewTabBar />

        <!-- Active tab content -->
        <div v-if="preview.activeTab" class="flex-1 overflow-hidden">
          <!-- Loading spinner -->
          <div v-if="preview.activeTab.loading" class="flex h-full items-center justify-center">
            <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
          </div>

          <!-- Markdown -->
          <MarkdownPreview
            v-else-if="preview.activeTab.fileType === 'markdown'"
            :content="preview.activeTab.content"
          />

          <!-- HTML -->
          <HtmlPreview
            v-else-if="preview.activeTab.fileType === 'html'"
            :content="preview.activeTab.content"
          />

          <!-- Mermaid -->
          <MermaidPreview
            v-else-if="preview.activeTab.fileType === 'mermaid'"
            :content="preview.activeTab.content"
          />

          <!-- Image -->
          <ImagePreview
            v-else-if="preview.activeTab.fileType === 'image'"
            :path="preview.activeTab.path"
            :last-modified="preview.activeTab.lastModified"
          />

          <!-- PDF -->
          <PdfPreview
            v-else-if="preview.activeTab.fileType === 'pdf'"
            :path="preview.activeTab.path"
            :last-modified="preview.activeTab.lastModified"
          />

          <!-- Code (default) -->
          <CodePreview
            v-else
            :content="preview.activeTab.content"
            :language="preview.activeTab.language"
            :name="preview.activeTab.name"
          />
        </div>

        <!-- Empty state -->
        <div v-else class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Eye class="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h3 class="text-sm font-medium text-foreground">Document Preview</h3>
            <p class="mt-1 max-w-sm text-xs text-muted-foreground">
              Select a file from the sidebar to preview it. Supports Markdown, HTML, images, code files, Mermaid diagrams, and PDFs.
            </p>
          </div>
          <div class="flex flex-wrap justify-center gap-2 text-[10px] text-muted-foreground/70">
            <span class="rounded-full bg-muted px-2 py-0.5">.md</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.html</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.mmd</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.png</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.svg</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.pdf</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.ts</span>
            <span class="rounded-full bg-muted px-2 py-0.5">.py</span>
            <span class="rounded-full bg-muted px-2 py-0.5">+30 more</span>
          </div>
        </div>
      </div>
    </ResizablePanel>
  </ResizablePanelGroup>
</template>
