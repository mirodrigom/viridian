<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useManualsStore, type LogoPosition } from '@/stores/manuals';
import { useChatStore } from '@/stores/chat';
import { useProviderStore } from '@/stores/provider';
import { useSettingsStore } from '@/stores/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Download, Printer, FileText, FileCode, Loader2, Sparkles, Save, Upload, X, Brain, PenLine, FolderOpen, History, RotateCcw, Eye } from 'lucide-vue-next';
import LogoUploader from './LogoUploader.vue';
import ManualPreview from './ManualPreview.vue';
import { apiFetch } from '@/lib/apiFetch';

const manualsStore = useManualsStore();
const providerStore = useProviderStore();
const settingsStore = useSettingsStore();

const emit = defineEmits<{
  back: [];
}>();

const manual = computed(() => manualsStore.currentManual);

// Local editable state
const editTitle = ref(manual.value?.title || '');
const editPrompt = ref(manual.value?.prompt || '');
const logo1Data = ref(manual.value?.logo1Data || '');
const logo2Data = ref(manual.value?.logo2Data || '');
const logo1Position = ref<LogoPosition>(manual.value?.logo1Position || { x: 50, y: 30, width: 120, height: 60 });
const logo2Position = ref<LogoPosition>(manual.value?.logo2Position || { x: 530, y: 30, width: 120, height: 60 });
const brandColors = ref<string[]>(manual.value?.brandColors || []);
const pdfData = ref(manual.value?.pdfData || '');
const editorMode = ref<'generate' | 'enhance'>(manual.value?.mode || 'generate');
const activeView = ref<'edit' | 'preview'>('edit');

const pdfFileInput = ref<HTMLInputElement | null>(null);
const pdfFileName = ref('');
const htmlFileInput = ref<HTMLInputElement | null>(null);

// Version history panel
const showVersionHistory = ref(false);
const versionPreviewContent = ref<string | null>(null);
const versionPreviewId = ref<string | null>(null);
const exportingPdf = ref(false);

// Sync when manual changes
watch(manual, (m) => {
  if (m) {
    editTitle.value = m.title;
    editPrompt.value = m.prompt;
    logo1Data.value = m.logo1Data;
    logo2Data.value = m.logo2Data;
    logo1Position.value = { ...m.logo1Position };
    logo2Position.value = { ...m.logo2Position };
    brandColors.value = [...(m.brandColors || [])];
    pdfData.value = m.pdfData || '';
    editorMode.value = m.mode || 'generate';
    manualsStore.fetchVersions(m.id);
  }
}, { immediate: true });

const hasContent = computed(() => !!manual.value?.content);

const canGenerate = computed(() => {
  if (manualsStore.generating) return false;
  if (editorMode.value === 'enhance') {
    return !!pdfData.value;
  }
  return !!editPrompt.value.trim();
});

function handlePdfSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || file.type !== 'application/pdf') return;

  pdfFileName.value = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    pdfData.value = reader.result as string;
  };
  reader.readAsDataURL(file);
}

function clearPdf() {
  pdfData.value = '';
  pdfFileName.value = '';
  if (pdfFileInput.value) pdfFileInput.value.value = '';
}

async function generate() {
  if (!manual.value) return;
  await save();
  const result = await manualsStore.generateContent(
    manual.value.id,
    providerStore.activeProviderId,
    settingsStore.model || undefined,
  );
  if (result?.content) {
    activeView.value = 'preview';
  }
}

async function save() {
  if (!manual.value) return;
  await manualsStore.updateManual(manual.value.id, {
    title: editTitle.value,
    prompt: editPrompt.value,
    logo1Data: logo1Data.value,
    logo2Data: logo2Data.value,
    logo1Position: logo1Position.value,
    logo2Position: logo2Position.value,
    brandColors: brandColors.value,
    pdfData: pdfData.value,
    mode: editorMode.value,
  } as never);
}

function handleHtmlImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !file.name.endsWith('.html')) return;
  const reader = new FileReader();
  reader.onload = async () => {
    if (!manual.value) return;
    await manualsStore.updateManual(manual.value.id, {
      content: reader.result as string,
      status: 'generated',
    } as never);
    activeView.value = 'preview';
    if (htmlFileInput.value) htmlFileInput.value.value = '';
  };
  reader.readAsText(file);
}

function printManual() {
  if (!manual.value?.content) return;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(manual.value.content);
  printWindow.document.close();
  printWindow.onload = () => printWindow.print();
}

async function exportPdf() {
  if (!manual.value) return;
  exportingPdf.value = true;
  try {
    const res = await apiFetch(`/api/manuals/${manual.value.id}/export-pdf`, { method: 'POST' });
    if (!res.ok) { console.error('PDF export failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editTitle.value.replace(/[^a-zA-Z0-9]/g, '_') || 'manual'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    exportingPdf.value = false;
  }
}

async function previewVersion(versionId: string) {
  if (!manual.value) return;
  if (versionPreviewId.value === versionId) {
    versionPreviewId.value = null;
    versionPreviewContent.value = null;
    return;
  }
  const v = await manualsStore.getVersionContent(manual.value.id, versionId);
  if (v) {
    versionPreviewId.value = versionId;
    versionPreviewContent.value = v.content;
  }
}

async function restoreVersion(versionId: string) {
  if (!manual.value) return;
  await manualsStore.restoreVersion(manual.value.id, versionId);
  versionPreviewId.value = null;
  versionPreviewContent.value = null;
  showVersionHistory.value = false;
  activeView.value = 'preview';
}

function formatVersionDate(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function downloadHtml() {
  if (!manual.value?.content) return;
  const blob = new Blob([manual.value.content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${editTitle.value.replace(/[^a-zA-Z0-9]/g, '_')}.html`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center gap-3 border-b border-border px-4 py-2">
      <Button variant="ghost" size="sm" @click="emit('back')">
        <ArrowLeft class="mr-1 h-4 w-4" />
        Back
      </Button>

      <Input
        v-model="editTitle"
        placeholder="Manual title"
        class="h-8 max-w-xs text-sm font-medium"
        @blur="save"
      />

      <div class="flex-1" />

      <!-- View toggle -->
      <div class="flex rounded-md border border-border">
        <button
          class="px-3 py-1 text-xs font-medium transition-colors"
          :class="activeView === 'edit' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="activeView = 'edit'"
        >
          Edit
        </button>
        <button
          class="px-3 py-1 text-xs font-medium transition-colors"
          :class="activeView === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
          :disabled="!hasContent"
          @click="activeView = 'preview'"
        >
          Preview
        </button>
      </div>

      <Button variant="outline" size="sm" @click="htmlFileInput?.click()" title="Import an existing HTML file as manual content">
        <FolderOpen class="mr-1 h-4 w-4" />
        Import HTML
      </Button>
      <input
        ref="htmlFileInput"
        type="file"
        accept=".html,text/html"
        class="hidden"
        @change="handleHtmlImport"
      />

      <Button variant="outline" size="sm" @click="save">
        <Save class="mr-1 h-4 w-4" />
        Save
      </Button>

      <Button
        v-if="manualsStore.versions.length > 0"
        variant="outline"
        size="sm"
        :class="showVersionHistory ? 'bg-muted' : ''"
        @click="showVersionHistory = !showVersionHistory"
      >
        <History class="mr-1 h-4 w-4" />
        History
        <span class="ml-1 rounded-full bg-muted-foreground/20 px-1.5 text-[10px] font-semibold">{{ manualsStore.versions.length }}</span>
      </Button>

      <Button
        v-if="hasContent"
        variant="outline"
        size="sm"
        :disabled="exportingPdf"
        @click="exportPdf"
      >
        <Loader2 v-if="exportingPdf" class="mr-1 h-4 w-4 animate-spin" />
        <Download v-else class="mr-1 h-4 w-4" />
        PDF
      </Button>

      <Button
        v-if="hasContent"
        variant="outline"
        size="sm"
        @click="downloadHtml"
      >
        <FileCode class="mr-1 h-4 w-4" />
        HTML
      </Button>
    </div>

    <!-- Content area (main + optional history panel) -->
    <div class="flex flex-1 overflow-hidden">
      <div class="flex-1 overflow-auto">
      <!-- Edit view -->
      <div v-if="activeView === 'edit'" class="mx-auto max-w-3xl space-y-6 p-6">

        <!-- Mode toggle -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-foreground">Mode</label>
          <div class="flex rounded-lg border border-border p-1">
            <button
              class="flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors"
              :class="editorMode === 'generate'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'"
              @click="editorMode = 'generate'"
            >
              <Sparkles class="mr-1.5 inline h-4 w-4" />
              Generate from prompt
            </button>
            <button
              class="flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors"
              :class="editorMode === 'enhance'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'"
              @click="editorMode = 'enhance'"
            >
              <FileText class="mr-1.5 inline h-4 w-4" />
              Enhance existing PDF
            </button>
          </div>
        </div>

        <!-- PDF Upload (enhance mode only) -->
        <div v-if="editorMode === 'enhance'" class="space-y-2">
          <label class="text-sm font-medium text-foreground">Upload PDF to enhance</label>
          <div v-if="!pdfData" class="space-y-2">
            <div
              class="flex h-32 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50 hover:bg-muted/50"
              @click="pdfFileInput?.click()"
            >
              <div class="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload class="h-8 w-8" />
                <span class="text-sm">Click to upload a PDF file</span>
                <span class="text-xs text-muted-foreground/60">The PDF will be sent to Claude for content extraction and enhancement</span>
              </div>
            </div>
            <input
              ref="pdfFileInput"
              type="file"
              accept="application/pdf"
              class="hidden"
              @change="handlePdfSelect"
            />
          </div>
          <div v-else class="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
            <FileText class="h-8 w-8 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-foreground">{{ pdfFileName || 'Uploaded PDF' }}</p>
              <p class="text-xs text-muted-foreground">PDF loaded and ready for enhancement</p>
            </div>
            <button
              class="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              @click="clearPdf"
            >
              <X class="h-4 w-4" />
            </button>
          </div>
        </div>

        <!-- Logo uploads -->
        <div class="grid grid-cols-2 gap-6">
          <LogoUploader
            label="Company Logo (Logo 1)"
            :model-value="logo1Data"
            :extract-colors="true"
            :brand-colors="brandColors"
            @update:model-value="logo1Data = $event"
            @update:brand-colors="brandColors = $event"
          />
          <LogoUploader
            label="Partner Logo (Logo 2)"
            :model-value="logo2Data"
            @update:model-value="logo2Data = $event"
          />
        </div>

        <!-- Brand colors summary (shown if colors were extracted) -->
        <div v-if="brandColors.length > 0" class="rounded-lg border border-border bg-muted/20 p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">Extracted brand colors</span>
              <div class="flex gap-1.5">
                <div
                  v-for="(color, idx) in brandColors"
                  :key="idx"
                  class="h-6 w-6 rounded border border-border shadow-sm"
                  :style="{ backgroundColor: color }"
                  :title="color"
                />
              </div>
            </div>
            <button
              class="text-xs text-muted-foreground hover:text-foreground"
              @click="brandColors = []"
            >
              Clear
            </button>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            These colors will be applied as the theme of the generated manual.
          </p>
        </div>

        <!-- Prompt -->
        <div class="space-y-2">
          <label class="text-sm font-medium text-foreground">
            {{ editorMode === 'enhance' ? 'Enhancement Instructions' : 'Manual Description / Prompt' }}
          </label>
          <Textarea
            v-model="editPrompt"
            :placeholder="editorMode === 'enhance'
              ? 'Describe how to enhance the PDF: e.g., Add our logo to the header, partner logo to footer, apply brand colors, improve formatting...'
              : 'Describe the manual you want to create, the tone, sections, style, or any specific content...'"
            class="min-h-[200px] resize-y"
          />
        </div>

        <!-- Generate button -->
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <Button
              :disabled="!canGenerate"
              @click="generate"
            >
              <Loader2 v-if="manualsStore.generating" class="mr-2 h-4 w-4 animate-spin" />
              <Sparkles v-else class="mr-2 h-4 w-4" />
              {{ manualsStore.generating
                ? 'Generating...'
                : editorMode === 'enhance'
                  ? 'Enhance PDF'
                  : 'Generate Manual' }}
            </Button>
            <span v-if="!manualsStore.generating && editorMode === 'enhance' && !pdfData" class="text-xs text-muted-foreground">
              Upload a PDF to enable enhancement
            </span>
          </div>
          <!-- Live generation status -->
          <div
            v-if="manualsStore.generating && manualsStore.generationStatus"
            class="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <FileText v-if="manualsStore.generationStatus.type === 'tool'" class="h-4 w-4 shrink-0 animate-pulse text-blue-500" />
            <Brain v-else-if="manualsStore.generationStatus.type === 'thinking'" class="h-4 w-4 shrink-0 animate-pulse text-purple-500" />
            <PenLine v-else-if="manualsStore.generationStatus.type === 'writing'" class="h-4 w-4 shrink-0 animate-pulse text-green-500" />
            <Loader2 v-else class="h-4 w-4 shrink-0 animate-spin" />
            <span>{{ manualsStore.generationStatus.text }}</span>
          </div>
          <div
            v-else-if="manualsStore.generating"
            class="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 class="h-4 w-4 shrink-0 animate-spin" />
            <span>Connecting...</span>
          </div>
        </div>

        <!-- Content preview hint -->
        <div v-if="hasContent" class="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <p class="text-sm text-primary">
            Manual content has been generated. Switch to the <strong>Preview</strong> tab to see it, reposition logos, and export.
          </p>
        </div>
      </div>

      <!-- Preview view -->
      <div v-else class="p-6">
        <div class="mx-auto max-w-4xl rounded-lg border border-border bg-white shadow-lg">
          <ManualPreview
            v-if="manual"
            :content="manual.content"
            :logo1-data="logo1Data"
            :logo2-data="logo2Data"
            :logo1-position="logo1Position"
            :logo2-position="logo2Position"
            @update:logo1-position="logo1Position = $event"
            @update:logo2-position="logo2Position = $event"
          />
        </div>
        <p class="mt-3 text-center text-xs text-muted-foreground">
          Drag logos to reposition them. Use the PDF or HTML buttons to export.
        </p>
      </div>
      </div>

      <!-- Version history side panel -->
      <Transition name="slide-right">
        <div v-if="showVersionHistory" class="flex w-72 shrink-0 flex-col border-l border-border bg-muted/20">
          <div class="flex items-center justify-between border-b border-border px-4 py-2">
            <span class="text-sm font-medium">Version History</span>
            <button class="rounded-md p-1 text-muted-foreground hover:text-foreground" @click="showVersionHistory = false">
              <X class="h-4 w-4" />
            </button>
          </div>
          <div v-if="manualsStore.versionsLoading" class="flex items-center justify-center py-8">
            <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
          <div v-else-if="manualsStore.versions.length === 0" class="px-4 py-6 text-center text-sm text-muted-foreground">
            No saved versions yet. Versions are saved automatically before each generation.
          </div>
          <div v-else class="flex-1 overflow-auto">
            <div
              v-for="(version, idx) in manualsStore.versions"
              :key="version.id"
              class="border-b border-border/50 px-4 py-3"
            >
              <div class="flex items-center justify-between gap-2">
                <div>
                  <p class="text-xs font-medium text-foreground">
                    Version {{ manualsStore.versions.length - idx }}
                  </p>
                  <p class="text-[10px] text-muted-foreground">{{ formatVersionDate(version.createdAt) }}</p>
                </div>
                <div class="flex gap-1">
                  <button
                    class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    :class="versionPreviewId === version.id ? 'bg-primary/10 text-primary' : ''"
                    title="Preview"
                    @click="previewVersion(version.id)"
                  >
                    <Eye class="h-3.5 w-3.5" />
                  </button>
                  <button
                    class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Restore this version"
                    @click="restoreVersion(version.id)"
                  >
                    <RotateCcw class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Version preview iframe -->
          <div v-if="versionPreviewContent" class="border-t border-border">
            <div class="flex items-center justify-between px-4 py-1.5">
              <span class="text-[10px] text-muted-foreground">Preview</span>
              <button class="text-[10px] text-primary underline" @click="restoreVersion(versionPreviewId!)">Restore</button>
            </div>
            <iframe
              :srcdoc="versionPreviewContent"
              class="h-48 w-full border-0 bg-white"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.2s ease;
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
