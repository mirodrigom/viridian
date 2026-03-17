<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, FileText, AlertTriangle, CheckCircle2, Loader2, Sparkles } from 'lucide-vue-next';
import { parseLucidCSV, isLucidCSV, parseDrawioXML, isDrawioXML, getLucidPages, buildLucidAIPrompt } from '@/lib/import';
import type { ImportResult, LucidPageInfo } from '@/lib/import';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{
  import: [result: ImportResult, options: { autoLayout: boolean }];
  aiImport: [prompt: string];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const fileName = ref('');
const fileContent = ref('');
const parsing = ref(false);
const importResult = ref<ImportResult | null>(null);
const parseError = ref('');
const autoLayout = ref(true);
const importMode = ref<'direct' | 'ai'>('direct');
const lucidPages = ref<LucidPageInfo[]>([]);
const selectedPageId = ref<string>('');

// Auto-detect format
const detectedFormat = computed(() => {
  if (!fileContent.value) return null;
  if (isDrawioXML(fileContent.value)) return 'drawio-xml' as const;
  if (isLucidCSV(fileContent.value)) return 'lucidchart-csv' as const;
  return null;
});

const formatLabel = computed(() => {
  if (!detectedFormat.value) return '';
  return detectedFormat.value === 'drawio-xml' ? 'draw.io' : 'Lucidchart CSV';
});

watch(open, (val) => {
  if (val) {
    fileName.value = '';
    fileContent.value = '';
    importResult.value = null;
    parseError.value = '';
    parsing.value = false;
    autoLayout.value = true;
    importMode.value = 'direct';
    lucidPages.value = [];
    selectedPageId.value = '';
  }
});

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  fileName.value = file.name;
  importResult.value = null;
  parseError.value = '';

  const reader = new FileReader();
  reader.onload = async (e) => {
    fileContent.value = e.target?.result as string;
    await parseFile();
  };
  reader.readAsText(file);
}

async function parseFile() {
  if (!fileContent.value) return;

  parsing.value = true;
  parseError.value = '';

  try {
    if (isDrawioXML(fileContent.value)) {
      importResult.value = await parseDrawioXML(fileContent.value);
    } else if (isLucidCSV(fileContent.value)) {
      importResult.value = parseLucidCSV(fileContent.value);
      lucidPages.value = getLucidPages(fileContent.value);
      selectedPageId.value = lucidPages.value[0]?.id ?? '';
    } else {
      parseError.value = 'Unrecognized file format. Supported formats: draw.io (.drawio, .xml), Lucidchart CSV (.csv)';
    }
  } catch (err) {
    parseError.value = `Parse error: ${(err as Error).message}`;
  } finally {
    parsing.value = false;
  }
}

function onImport() {
  if (!importResult.value) return;
  emit('import', importResult.value, { autoLayout: autoLayout.value });
  open.value = false;
}

function onAIImport() {
  const prompt = buildLucidAIPrompt(fileContent.value, selectedPageId.value || undefined);
  if (!prompt) return;
  emit('aiImport', prompt);
  open.value = false;
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  fileName.value = file.name;
  importResult.value = null;
  parseError.value = '';

  const reader = new FileReader();
  reader.onload = async (e) => {
    fileContent.value = e.target?.result as string;
    await parseFile();
  };
  reader.readAsText(file);
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Import Diagram</DialogTitle>
        <DialogDescription>Import from draw.io (.drawio, .xml) or Lucidchart (.csv)</DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <!-- File drop zone -->
        <div
          class="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-6 transition-colors hover:border-primary/50"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".drawio,.xml,.csv"
            class="hidden"
            @change="onFileChange"
          />

          <div v-if="!fileName" class="text-center">
            <Upload class="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p class="text-sm text-muted-foreground">
              Drag and drop a file here, or
            </p>
            <Button variant="outline" size="sm" class="mt-2 text-xs" @click="fileInput?.click()">
              Browse Files
            </Button>
          </div>

          <div v-else class="w-full space-y-3">
            <div class="flex items-center gap-2">
              <FileText class="h-5 w-5 text-primary" />
              <div class="flex-1">
                <p class="text-sm font-medium">{{ fileName }}</p>
                <p v-if="formatLabel" class="text-xs text-muted-foreground">
                  Detected format: {{ formatLabel }}
                </p>
              </div>
              <Button variant="ghost" size="sm" class="h-7 text-xs" @click="fileInput?.click()">
                Change
              </Button>
            </div>

            <!-- AI vs Direct mode selector (Lucid CSV only) -->
            <div v-if="detectedFormat === 'lucidchart-csv' && !parsing" class="flex gap-2 rounded-lg border border-border bg-muted/30 p-1">
              <button
                class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                :class="importMode === 'direct' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="importMode = 'direct'"
              >
                Direct Import
              </button>
              <button
                class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                :class="importMode === 'ai' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
                @click="importMode = 'ai'"
              >
                Smart Import (AI)
              </button>
            </div>

            <!-- Page selector for AI mode -->
            <div v-if="importMode === 'ai' && lucidPages.length > 1" class="space-y-1">
              <label class="text-xs text-muted-foreground">Page to import</label>
              <select
                v-model="selectedPageId"
                class="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              >
                <option value="">All pages</option>
                <option v-for="p in lucidPages" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>

            <!-- AI mode description -->
            <div v-if="importMode === 'ai'" class="rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
              <p class="font-medium text-foreground mb-1">Smart Import uses AI to understand the diagram</p>
              <p>Instead of importing {{ importResult?.stats.totalShapes ?? 'all' }} elements literally, the AI will analyze the architecture and recreate a clean, well-organized diagram.</p>
            </div>
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="parsing" class="flex items-center justify-center gap-2 py-4">
          <Loader2 class="h-4 w-4 animate-spin text-primary" />
          <span class="text-sm text-muted-foreground">Parsing file...</span>
        </div>

        <!-- Parse error -->
        <div v-if="parseError" class="flex items-start gap-2 rounded-md bg-destructive/10 p-3">
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p class="text-sm text-destructive">{{ parseError }}</p>
        </div>

        <!-- Import preview -->
        <div v-if="importResult && !parsing" class="space-y-3">
          <!-- Stats -->
          <div class="rounded-md border border-border bg-muted/30 p-3">
            <div class="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 class="h-4 w-4 text-primary" />
              Preview
            </div>
            <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div class="text-muted-foreground">Shapes found:</div>
              <div class="font-medium">{{ importResult.stats.totalShapes }}</div>
              <div class="text-muted-foreground">Connections:</div>
              <div class="font-medium">{{ importResult.stats.totalConnections }}</div>
              <div class="text-muted-foreground">Mapped AWS services:</div>
              <div class="font-medium text-primary">{{ importResult.stats.mappedServices }}</div>
              <div v-if="importResult.stats.unmappedServices > 0" class="text-muted-foreground">Unmapped shapes:</div>
              <div v-if="importResult.stats.unmappedServices > 0" class="font-medium text-amber-500">{{ importResult.stats.unmappedServices }}</div>
              <div v-if="importResult.stats.groups > 0" class="text-muted-foreground">Groups:</div>
              <div v-if="importResult.stats.groups > 0" class="font-medium">{{ importResult.stats.groups }}</div>
            </div>
          </div>

          <!-- Warnings -->
          <div v-if="importResult.warnings.length > 0" class="space-y-1">
            <Label class="text-xs text-amber-500">
              {{ importResult.warnings.length }} warning{{ importResult.warnings.length > 1 ? 's' : '' }}
            </Label>
            <ScrollArea class="max-h-[120px]">
              <div class="space-y-1 pr-3">
                <div
                  v-for="(w, i) in importResult.warnings"
                  :key="i"
                  class="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                >
                  <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                  <span>{{ w.message }}</span>
                </div>
              </div>
            </ScrollArea>
          </div>

          <!-- Options -->
          <div class="flex items-center gap-2">
            <input
              id="auto-layout"
              v-model="autoLayout"
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            <label for="auto-layout" class="text-xs text-muted-foreground">
              Auto-layout after import
              <span v-if="importResult.format === 'lucidchart-csv'" class="text-amber-500">(recommended — CSV has no position data)</span>
            </label>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" @click="open = false">Cancel</Button>
        <Button
          v-if="importMode === 'direct'"
          size="sm"
          :disabled="!importResult || parsing || importResult.nodes.length === 0"
          @click="onImport"
        >
          Import {{ importResult ? `(${importResult.nodes.length} nodes)` : '' }}
        </Button>
        <Button
          v-if="importMode === 'ai'"
          size="sm"
          :disabled="!importResult || parsing"
          @click="onAIImport"
        >
          <Sparkles class="mr-1.5 h-3.5 w-3.5" />
          Import with AI
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
