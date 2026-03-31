<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { markdown2confluence, markdown2html } from './markdown2confluence';
import { apiFetch } from '@/lib/apiFetch';
import { useProviderStore } from '@/stores/provider';
import { useSettingsStore } from '@/stores/settings';
import { useConfluenceStore } from '@/stores/confluence';
import { useChatStore } from '@/stores/chat';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useDiagramsStore } from '@/stores/diagrams';
import { parseCommandBlocks, executeDiagramCommands } from '@/composables/diagram/useDiagramAI';
import { renderDiagramToPng } from './diagramRenderer';
import { FileText, Check, ArrowRight, ArrowLeft, Trash2, Sparkles, Loader2, ClipboardPaste, Plus, Save, Network, ImageIcon, ZoomIn } from 'lucide-vue-next';

const providerStore = useProviderStore();
const settings = useSettingsStore();
const confluenceStore = useConfluenceStore();
const diagramsStore = useDiagramsStore();
const chatStore = useChatStore();
const { confirm } = useConfirmDialog();

const showEditor = ref(false);
const newTitle = ref('');
const creating = ref(false);

const rawInput = ref('');
const storageOutput = ref('');
const lastMarkdown = ref('');
const copied = ref<string | null>(null);
const formatting = ref(false);
const formatStatus = ref('');
const saving = ref(false);

// Instructions dialog state
const showInstructions = ref(false);

// Diagram attachment
const showDiagramPicker = ref(false);
const attachingDiagram = ref(false);
const attachedDiagrams = ref<{ name: string; dataUrl: string }[]>([]);

// Diagram thumbnail preview
const diagramThumbnail = ref<string | null>(null);
const diagramCopied = ref(false);
const showDiagramZoom = ref(false);

const projectPath = computed(() => chatStore?.projectPath || '/tmp');
const hasInput = computed(() => rawInput.value.trim().length > 0);
const hasOutput = computed(() => storageOutput.value.length > 0);

/** HTML preview of the current output */
const htmlPreview = ref('');

function buildDiagramsHtml(): string {
  if (attachedDiagrams.value.length === 0) return '';
  // Use <table> wrapper because Confluence strips <div> on paste
  return attachedDiagrams.value.map(d =>
    `<table style="border-collapse:collapse;width:100%;margin:24px 0;border:none;">` +
    `<tr><td style="text-align:center;padding:12px;border:none;">` +
    `<img src="${d.dataUrl}" alt="${d.name}" style="max-width:100%;height:auto;border:1px solid #d0d7de;border-radius:6px;" />` +
    `</td></tr>` +
    `<tr><td style="text-align:center;padding:4px;border:none;font-size:0.85em;color:#57606a;font-style:italic;">${d.name}</td></tr>` +
    `</table>`
  ).join('');
}

function updatePreview() {
  if (!lastMarkdown.value && attachedDiagrams.value.length === 0) {
    htmlPreview.value = '';
    return;
  }
  const mdHtml = lastMarkdown.value ? markdown2html(lastMarkdown.value) : '';
  htmlPreview.value = mdHtml + buildDiagramsHtml();
}

watch([() => lastMarkdown.value, () => attachedDiagrams.value.length], () => updatePreview(), { immediate: true });

const hasUnsavedChanges = computed(() => {
  const page = confluenceStore.currentPage;
  if (!page) return hasInput.value || hasOutput.value;
  return (
    rawInput.value !== page.inputText ||
    lastMarkdown.value !== page.markdown ||
    storageOutput.value !== page.confluenceOutput
  );
});

onMounted(() => {
  confluenceStore.fetchPageList(projectPath.value);
  diagramsStore.fetchDiagramList(projectPath.value);
});

// ─── List actions ─────────────────────────────────────────────────────

async function createNew() {
  if (!newTitle.value.trim()) return;
  creating.value = true;
  const page = await confluenceStore.createPage(projectPath.value, {
    title: newTitle.value.trim(),
  });
  creating.value = false;
  if (page) {
    newTitle.value = '';
    loadEditorFromStore();
    showEditor.value = true;
  }
}

async function openPage(id: string) {
  await confluenceStore.loadPage(id);
  loadEditorFromStore();
  showEditor.value = true;
}

async function deletePage(id: string, e: Event) {
  e.stopPropagation();
  const ok = await confirm({ title: 'Delete Page', description: 'Are you sure you want to delete this conversion? This action cannot be undone.' });
  if (!ok) return;
  await confluenceStore.deletePage(id, projectPath.value);
}

function goBack() {
  showEditor.value = false;
  clearEditorState();
  confluenceStore.clearPage();
  confluenceStore.fetchPageList(projectPath.value);
}

function loadEditorFromStore() {
  const page = confluenceStore.currentPage;
  if (page) {
    rawInput.value = page.inputText || '';
    lastMarkdown.value = page.markdown || '';
    storageOutput.value = page.confluenceOutput || '';
  } else {
    clearEditorState();
  }
}

function clearEditorState() {
  rawInput.value = '';
  storageOutput.value = '';
  lastMarkdown.value = '';
  formatStatus.value = '';
}

// ─── ASCII art detection ─────────────────────────────────────────────

/** Detect if text contains ASCII art diagram patterns */
function detectAsciiArt(text: string): string | null {
  // Box-drawing characters (Unicode)
  const boxDrawing = /[┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬]/;
  // Text-based box patterns: +--+, |  |
  const textBoxes = /\+[-=]+\+/;
  // Arrow patterns
  const arrows = /(?:──>|<──|-->|<--|==>|<==|->|<-|\.\.>|<\.\.)/;
  // Vertical pipes used as connectors (at least 3 lines with | alignment)
  const verticalPipes = /^\s*\|/m;

  let score = 0;
  const lines = text.split('\n');

  // Count lines with diagram-like patterns
  let boxDrawingLines = 0;
  let textBoxLines = 0;
  let arrowLines = 0;
  let pipeLines = 0;

  for (const line of lines) {
    if (boxDrawing.test(line)) boxDrawingLines++;
    if (textBoxes.test(line)) textBoxLines++;
    if (arrows.test(line)) arrowLines++;
    if (verticalPipes.test(line)) pipeLines++;
  }

  // Need significant presence to consider it ASCII art
  if (boxDrawingLines >= 3) score += 3;
  if (textBoxLines >= 2) score += 3;
  if (arrowLines >= 2) score += 2;
  if (pipeLines >= 5) score += 1;

  if (score < 3) return null;

  // Extract the ASCII art region (contiguous lines with diagram chars)
  const diagramLines: string[] = [];
  let inDiagram = false;
  let blankCount = 0;

  for (const line of lines) {
    const isDiagramLine = boxDrawing.test(line) || textBoxes.test(line) || arrows.test(line) ||
      (verticalPipes.test(line) && inDiagram) || (line.trim().length > 0 && inDiagram);

    if (isDiagramLine) {
      // Add any blank lines we skipped (up to 2)
      if (inDiagram && blankCount > 0 && blankCount <= 2) {
        for (let i = 0; i < blankCount; i++) diagramLines.push('');
      }
      blankCount = 0;
      inDiagram = true;
      diagramLines.push(line);
    } else if (inDiagram) {
      if (line.trim() === '') {
        blankCount++;
        if (blankCount > 2) {
          inDiagram = false;
          blankCount = 0;
        }
      } else {
        // Non-diagram text after diagram started — include if short (labels)
        if (line.trim().length < 80) {
          diagramLines.push(line);
        } else {
          inDiagram = false;
          blankCount = 0;
        }
      }
    }
  }

  return diagramLines.length >= 3 ? diagramLines.join('\n') : null;
}

// ─── Editor actions ───────────────────────────────────────────────────

async function saveCurrentPage() {
  const page = confluenceStore.currentPage;
  if (!page) return;
  saving.value = true;
  await confluenceStore.updatePage(page.id, {
    inputText: rawInput.value,
    markdown: lastMarkdown.value,
    confluenceOutput: storageOutput.value,
  } as any);
  saving.value = false;
}

/** Stream SSE from the format endpoint and return the final markdown */
async function streamFormat(): Promise<string> {
  const res = await apiFetch('/api/confluence/format', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: rawInput.value,
      providerId: providerStore.activeProviderId,
      model: settings.model,
    }),
  });

  if (!res.ok) throw new Error(res.statusText);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalMarkdown = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.replace(/^data: /, '').trim();
      if (!line || line === '[DONE]') continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          formatStatus.value = 'Formatting with AI...';
        } else if (event.type === 'done' && event.markdown) {
          finalMarkdown = event.markdown;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
      }
    }
  }

  return finalMarkdown;
}

/** Generate a diagram from ASCII art, save it, render PNG via canvas, return data URL */
async function generateDiagramFromAsciiArt(asciiArt: string): Promise<{ name: string; dataUrl: string } | null> {
  formatStatus.value = 'Generating architecture diagram...';

  const res = await apiFetch('/api/confluence/generate-diagram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asciiArt,
      providerId: providerStore.activeProviderId,
      model: settings.model,
    }),
  });

  if (!res.ok) throw new Error(`Diagram generation failed: ${res.statusText}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let commandsText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.replace(/^data: /, '').trim();
      if (!line || line === '[DONE]') continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'done' && event.commands) {
          commandsText = event.commands;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
      }
    }
  }

  if (!commandsText) return null;

  // Parse diagram commands from the AI response
  const commands = parseCommandBlocks(commandsText);
  if (commands.length === 0) return null;

  formatStatus.value = 'Building diagram...';

  // Execute commands against the diagrams store
  const result = executeDiagramCommands(commands, diagramsStore);
  if (!result.success || result.nodesCreated === 0) return null;

  // Save the diagram so it persists in the Diagrams section
  const proj = chatStore?.projectPath || '/tmp';
  diagramsStore.currentDiagramName = 'Auto-generated Architecture';
  await diagramsStore.saveDiagram(proj);

  // Render PNG via standalone canvas renderer (no DiagramEditor needed)
  formatStatus.value = 'Rendering diagram image...';
  const dataUrl = renderDiagramToPng(diagramsStore.nodes, diagramsStore.edges);
  if (!dataUrl) return null;

  return { name: 'Architecture Diagram', dataUrl };
}

async function formatAndConvert() {
  if (!hasInput.value) return;
  formatting.value = true;
  formatStatus.value = 'Formatting with AI...';
  storageOutput.value = '';
  lastMarkdown.value = '';

  try {
    // Detect ASCII art in the input
    const asciiArt = detectAsciiArt(rawInput.value);
    diagramThumbnail.value = null;

    // Run text formatting (always) and diagram generation (if ASCII art detected) in parallel
    const formatPromise = streamFormat();
    const diagramPromise = asciiArt
      ? generateDiagramFromAsciiArt(asciiArt).catch(err => {
          console.warn('[Confluence] Diagram auto-generation failed:', err);
          return null;
        })
      : Promise.resolve(null);

    const [finalMarkdown, diagramResult] = await Promise.all([formatPromise, diagramPromise]);

    if (finalMarkdown) {
      formatStatus.value = 'Converting to Confluence...';
      lastMarkdown.value = finalMarkdown;
      storageOutput.value = markdown2confluence(finalMarkdown);

      // If diagram was auto-generated, show as thumbnail for separate copy
      if (diagramResult) {
        diagramThumbnail.value = diagramResult.dataUrl;
        formatStatus.value = '';
      } else {
        formatStatus.value = '';
      }

      // Auto-save after conversion if we have a current page
      if (confluenceStore.currentPage) {
        await saveCurrentPage();
      }
    } else {
      formatStatus.value = 'No output received from AI';
    }
  } catch (err) {
    formatStatus.value = `Error: ${(err as Error).message}`;
  } finally {
    formatting.value = false;
  }
}

function convertDirect() {
  if (!hasInput.value) return;
  lastMarkdown.value = rawInput.value;
  storageOutput.value = markdown2confluence(rawInput.value);

  // Auto-save after direct conversion if we have a current page
  if (confluenceStore.currentPage) {
    saveCurrentPage();
  }
}

/**
 * Copy as rich HTML via native DOM selection.
 * This renders the HTML into a temporary off-screen element, selects it,
 * and copies via execCommand('copy'). This produces clipboard entries
 * indistinguishable from a manual user copy, which ProseMirror-based
 * editors like Confluence Cloud handle reliably.
 */
async function copyAsRichHtml() {
  if (!htmlPreview.value) return;

  // Create a temporary container with the rendered HTML (reuse the cached preview)
  const container = document.createElement('div');
  container.innerHTML = htmlPreview.value;
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.opacity = '0';
  document.body.appendChild(container);

  // Select the rendered content and copy
  const range = document.createRange();
  range.selectNodeContents(container);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('copy');
  selection.removeAllRanges();
  document.body.removeChild(container);

  copied.value = 'rich';
  showInstructions.value = true;
  setTimeout(() => { copied.value = null; }, 2000);
}

/** Copy diagram image to clipboard as PNG blob */
async function copyDiagramImage() {
  if (!diagramThumbnail.value) return;
  try {
    const resp = await fetch(diagramThumbnail.value);
    const blob = await resp.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    diagramCopied.value = true;
    setTimeout(() => { diagramCopied.value = false; }, 2000);
  } catch {
    // Fallback: open in new tab so user can right-click → copy
    window.open(diagramThumbnail.value, '_blank');
  }
}

function clear() {
  rawInput.value = '';
  storageOutput.value = '';
  lastMarkdown.value = '';
  formatStatus.value = '';
  attachedDiagrams.value = [];
  diagramThumbnail.value = null;
}

// ─── Diagram attachment ──────────────────────────────────────────────

async function attachDiagram(diagramId: string, diagramName: string) {
  showDiagramPicker.value = false;
  attachingDiagram.value = true;
  formatStatus.value = 'Capturing diagram...';

  try {
    // Load the diagram into the diagram editor (force-mounted in DOM)
    await diagramsStore.loadDiagram(diagramId);

    // Wait for Vue Flow to render the loaded diagram
    await new Promise(r => setTimeout(r, 500));

    // Capture the PNG via the registered export function
    const dataUrl = await diagramsStore.capturePngDataUrl();

    if (dataUrl) {
      attachedDiagrams.value.push({ name: diagramName, dataUrl });
      formatStatus.value = '';
    } else {
      formatStatus.value = 'Failed to capture diagram. Make sure the Diagrams tab has been opened at least once.';
    }
  } catch (err) {
    formatStatus.value = `Error: ${(err as Error).message}`;
  } finally {
    attachingDiagram.value = false;
  }
}

function removeDiagram(index: number) {
  attachedDiagrams.value.splice(index, 1);
}

const pasteSteps = [
  { step: 1, title: 'Open Confluence', desc: 'Go to your Confluence space and create a new page or open an existing one for editing.' },
  { step: 2, title: 'Click in the editor', desc: 'Place your cursor where you want the content to appear in the page body.' },
  { step: 3, title: 'Paste with Ctrl+V', desc: 'Press Ctrl+V (or Cmd+V on Mac). Confluence will automatically detect the HTML and render headings, tables, lists, bold, italic, and all formatting.' },
  { step: 4, title: 'Review & Publish', desc: 'Check that everything looks correct, then click Publish (or Update) to save the page.' },
];
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Editor view -->
    <template v-if="showEditor && confluenceStore.currentPage">
      <!-- Editor Header -->
      <div class="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" @click="goBack">
          <ArrowLeft class="mr-1 h-4 w-4" />
          Back
        </Button>
        <FileText class="h-5 w-5 text-primary" />
        <h2 class="text-lg font-semibold truncate">{{ confluenceStore.currentPage.title }}</h2>
        <div class="flex-1" />
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="!hasUnsavedChanges || saving"
            @click="saveCurrentPage"
          >
            <Loader2 v-if="saving" class="mr-1 h-3.5 w-3.5 animate-spin" />
            <Save v-else class="mr-1 h-3.5 w-3.5" />
            Save
          </Button>
          <Button variant="outline" size="sm" :disabled="!hasInput && !hasOutput" @click="clear">
            <Trash2 class="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>

      <!-- Content: side by side panels -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Left: Raw input -->
        <div class="flex flex-1 flex-col border-r border-border">
          <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
            <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Input (Markdown or raw text)</span>
          </div>
          <Textarea
            v-model="rawInput"
            placeholder="Paste your Markdown or raw text here..."
            class="flex-1 resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
            :disabled="formatting"
          />
        </div>

        <!-- Center: Action buttons -->
        <div class="flex flex-col items-center justify-center gap-3 px-3 bg-muted/20">
          <Button
            size="sm"
            variant="default"
            :disabled="!hasInput || formatting"
            @click="formatAndConvert"
            title="Format with AI + Convert"
            class="flex flex-col items-center gap-1 h-auto py-2 px-3"
          >
            <Loader2 v-if="formatting" class="h-4 w-4 animate-spin" />
            <Sparkles v-else class="h-4 w-4" />
            <span class="text-[10px]">AI Format</span>
          </Button>
          <div class="h-px w-6 bg-border" />
          <Button
            size="sm"
            variant="outline"
            :disabled="!hasInput || formatting"
            @click="convertDirect"
            title="Direct convert (input must be valid Markdown)"
            class="flex flex-col items-center gap-1 h-auto py-2 px-3"
          >
            <ArrowRight class="h-4 w-4" />
            <span class="text-[10px]">Direct</span>
          </Button>
          <div class="h-px w-6 bg-border" />
          <Button
            size="sm"
            variant="outline"
            :disabled="attachingDiagram || diagramsStore.diagramList.length === 0"
            @click="showDiagramPicker = true"
            title="Attach a diagram from the Diagram Editor as an image"
            class="flex flex-col items-center gap-1 h-auto py-2 px-3"
          >
            <Loader2 v-if="attachingDiagram" class="h-4 w-4 animate-spin" />
            <Network v-else class="h-4 w-4" />
            <span class="text-[10px]">Diagram</span>
          </Button>
        </div>

        <!-- Right: Preview -->
        <div class="flex flex-1 flex-col">
          <div class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
            <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</span>
            <div class="flex-1" />
            <Button
              variant="default"
              size="sm"
              class="h-7 text-xs"
              :disabled="!hasOutput"
              @click="copyAsRichHtml"
              title="Copy as rich HTML — paste directly into Confluence editor (Ctrl+V)"
            >
              <Check v-if="copied === 'rich'" class="mr-1 h-3.5 w-3.5" />
              <ClipboardPaste v-else class="mr-1 h-3.5 w-3.5" />
              {{ copied === 'rich' ? 'Copied!' : 'Copy for Paste' }}
            </Button>
          </div>
          <!-- Attached diagrams strip -->
          <div v-if="attachedDiagrams.length > 0" class="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5 overflow-x-auto">
            <span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">Diagrams:</span>
            <div
              v-for="(d, i) in attachedDiagrams"
              :key="i"
              class="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              <Network class="h-3 w-3" />
              <span class="max-w-[120px] truncate">{{ d.name }}</span>
              <button class="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive" @click="removeDiagram(i)">
                <Trash2 class="h-2.5 w-2.5" />
              </button>
            </div>
          </div>
          <!-- HTML preview rendered visually -->
          <div class="flex-1 overflow-auto p-4 bg-white dark:bg-muted/10">
            <div
              v-if="htmlPreview"
              v-html="htmlPreview"
              class="prose prose-sm max-w-none text-foreground"
            />
            <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground/60 italic select-none">
              {{ formatting ? '' : 'Preview will appear here after conversion...' }}
            </div>

            <!-- Diagram thumbnail -->
            <div v-if="diagramThumbnail" class="mt-4 border-t border-border pt-4">
              <div class="flex items-center gap-2 mb-2">
                <Network class="h-4 w-4 text-primary" />
                <span class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Architecture Diagram</span>
                <div class="flex-1" />
                <Button variant="outline" size="sm" class="h-7 text-xs" @click="showDiagramZoom = true">
                  <ZoomIn class="mr-1 h-3 w-3" />
                  Expand
                </Button>
                <Button variant="default" size="sm" class="h-7 text-xs" @click="copyDiagramImage">
                  <Check v-if="diagramCopied" class="mr-1 h-3.5 w-3.5" />
                  <ImageIcon v-else class="mr-1 h-3.5 w-3.5" />
                  {{ diagramCopied ? 'Copied!' : 'Copy Image' }}
                </Button>
              </div>
              <img
                :src="diagramThumbnail"
                alt="Architecture Diagram"
                class="w-full rounded-lg border border-border cursor-pointer hover:shadow-md transition-shadow"
                @click="showDiagramZoom = true"
              />
              <p class="mt-1 text-[10px] text-muted-foreground text-center italic">
                Click "Copy Image" then paste (Ctrl+V) into the Confluence page after the text.
                Also saved in the Diagrams tab.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-2 border-t border-border bg-muted/20 px-4 py-2">
        <span v-if="formatting" class="flex items-center gap-2 text-xs text-primary">
          <Loader2 class="h-3 w-3 animate-spin" />
          {{ formatStatus }}
        </span>
        <span v-else-if="formatStatus" class="text-xs text-destructive">{{ formatStatus }}</span>
        <span v-else class="text-xs text-muted-foreground">
          Click <strong>Copy for Paste</strong>, then press <strong>Ctrl+V</strong> directly inside the Confluence editor.
        </span>
      </div>
    </template>

    <!-- List view -->
    <div v-else class="flex h-full flex-col">
      <!-- Header -->
      <div class="flex items-center gap-3 border-b border-border px-4 py-3">
        <FileText class="h-5 w-5 text-primary" />
        <h2 class="text-lg font-semibold">Confluence Converter</h2>
        <div class="flex-1" />
        <div class="flex items-center gap-2">
          <Input
            v-model="newTitle"
            placeholder="New conversion title..."
            class="h-8 w-48 text-sm"
            @keydown.enter="createNew"
          />
          <Button size="sm" :disabled="!newTitle.trim() || creating" @click="createNew">
            <Loader2 v-if="creating" class="mr-1 h-4 w-4 animate-spin" />
            <Plus v-else class="mr-1 h-4 w-4" />
            Create
          </Button>
        </div>
      </div>

      <!-- Page list -->
      <div class="flex-1 overflow-auto p-4">
        <div v-if="confluenceStore.loading" class="flex items-center justify-center py-12">
          <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        </div>

        <div v-else-if="confluenceStore.pageList.length === 0" class="flex flex-col items-center justify-center py-16 text-center">
          <FileText class="mb-3 h-12 w-12 text-muted-foreground/50" />
          <h3 class="text-lg font-medium text-muted-foreground">No saved conversions</h3>
          <p class="mt-1 text-sm text-muted-foreground/70">
            Create a new conversion to get started. Paste your text, convert it to Confluence format, and save it for later.
          </p>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card
            v-for="page in confluenceStore.pageList"
            :key="page.id"
            class="cursor-pointer transition-shadow hover:shadow-md"
            @click="openPage(page.id)"
          >
            <CardHeader class="pb-2">
              <div class="flex items-start justify-between">
                <CardTitle class="text-sm font-medium leading-tight">
                  {{ page.title }}
                </CardTitle>
                <button
                  class="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title="Delete conversion"
                  @click="deletePage(page.id, $event)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div class="flex items-center justify-end">
                <span class="text-[10px] text-muted-foreground">
                  {{ new Date(page.updatedAt).toLocaleDateString() }}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <!-- Diagram Picker Dialog -->
    <Dialog v-model:open="showDiagramPicker">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Network class="h-5 w-5 text-primary" />
            Attach Diagram
          </DialogTitle>
          <DialogDescription>
            Select a diagram to capture as an image and embed in the output.
          </DialogDescription>
        </DialogHeader>

        <div class="max-h-64 overflow-auto space-y-1 py-2">
          <div v-if="diagramsStore.diagramList.length === 0" class="py-4 text-center text-sm text-muted-foreground">
            No diagrams found. Create one in the Diagrams tab first.
          </div>
          <button
            v-for="d in diagramsStore.diagramList"
            :key="d.id"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
            @click="attachDiagram(d.id, d.name)"
          >
            <Network class="h-4 w-4 shrink-0 text-muted-foreground" />
            <span class="flex-1 text-left truncate">{{ d.name }}</span>
            <span class="text-[10px] text-muted-foreground">{{ new Date(d.updatedAt).toLocaleDateString() }}</span>
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="showDiagramPicker = false">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Instructions Dialog -->
    <Dialog v-model:open="showInstructions">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Check class="h-5 w-5 text-green-500" />
            Copied to clipboard!
          </DialogTitle>
          <DialogDescription>
            Follow these steps to paste into Confluence's visual editor.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <div
            v-for="s in pasteSteps"
            :key="s.step"
            class="flex gap-3"
          >
            <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {{ s.step }}
            </div>
            <div class="flex-1 pt-0.5">
              <p class="text-sm font-medium text-foreground">{{ s.title }}</p>
              <p class="mt-0.5 text-xs text-muted-foreground leading-relaxed">{{ s.desc }}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button @click="showInstructions = false">Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Diagram Zoom Dialog -->
    <Dialog v-model:open="showDiagramZoom">
      <DialogContent class="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Network class="h-5 w-5 text-primary" />
            Architecture Diagram
          </DialogTitle>
          <DialogDescription>
            Click "Copy Image" to copy, then paste into Confluence with Ctrl+V.
          </DialogDescription>
        </DialogHeader>
        <div class="overflow-auto max-h-[70vh]">
          <img
            v-if="diagramThumbnail"
            :src="diagramThumbnail"
            alt="Architecture Diagram"
            class="w-full rounded-lg"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showDiagramZoom = false">Close</Button>
          <Button @click="copyDiagramImage">
            <Check v-if="diagramCopied" class="mr-1 h-4 w-4" />
            <ImageIcon v-else class="mr-1 h-4 w-4" />
            {{ diagramCopied ? 'Copied!' : 'Copy Image' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
