<script setup lang="ts">
import { ref, computed, onUnmounted, onMounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useDiagramsStore } from '@/stores/diagrams';
import {
  Save, FolderOpen, FilePlus, Maximize2, Download, ImageDown, FileJson, FileType, Grid3x3, MousePointerSquareDashed,
  Minimize2, Maximize, Film, Clapperboard, Undo2, Redo2, Import, FileUp, Copy,
  Play, Pause, SkipBack, SkipForward, StopCircle, Share2, Link, Check, Loader2, Unlink,
} from 'lucide-vue-next';
import { apiFetch } from '@/lib/apiFetch';

const props = defineProps<{
  snapToGrid: boolean;
  selectedCount: number;
}>();

const diagrams = useDiagramsStore();

// ─── Share dialog ────────────────────────────────────────────────────────────
const showShareDialog = ref(false);
const shareLoading = ref(false);
const shareStatus = ref<{ shared: boolean; shareToken?: string }>({ shared: false });
const shareCopied = ref(false);

const canShare = computed(() => !!diagrams.currentDiagramId);

const shareUrl = computed(() => {
  if (!shareStatus.value.shareToken) return '';
  return `${window.location.origin}/share/d/${shareStatus.value.shareToken}`;
});

async function openShareDialog() {
  showShareDialog.value = true;
  if (!diagrams.currentDiagramId) return;

  shareLoading.value = true;
  try {
    const res = await apiFetch(`/api/diagrams/${diagrams.currentDiagramId}/share-status`);
    if (res.ok) {
      shareStatus.value = await res.json();
    }
  } finally {
    shareLoading.value = false;
  }
}

async function createShareLink() {
  if (!diagrams.currentDiagramId) return;
  shareLoading.value = true;
  try {
    const res = await apiFetch(`/api/diagrams/${diagrams.currentDiagramId}/share`, {
      method: 'POST',
    });
    if (res.ok) {
      const data = await res.json();
      shareStatus.value = { shared: true, shareToken: data.shareToken };
    }
  } finally {
    shareLoading.value = false;
  }
}

async function removeShareLink() {
  if (!diagrams.currentDiagramId) return;
  shareLoading.value = true;
  try {
    const res = await apiFetch(`/api/diagrams/${diagrams.currentDiagramId}/share`, {
      method: 'DELETE',
    });
    if (res.ok || res.status === 204) {
      shareStatus.value = { shared: false };
    }
  } finally {
    shareLoading.value = false;
  }
}

async function copyShareUrl() {
  if (!shareUrl.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    shareCopied.value = true;
    setTimeout(() => { shareCopied.value = false; }, 2000);
  } catch {
    // Fallback for environments without clipboard API
    const input = document.createElement('input');
    input.value = shareUrl.value;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    shareCopied.value = true;
    setTimeout(() => { shareCopied.value = false; }, 2000);
  }
}

// ─── Flow playback ──────────────────────────────────────────────────────────
const isPlaying = ref(false);
let playTimer: ReturnType<typeof setTimeout> | null = null;

/** Show the playback section whenever there are edges to step through. */
const showPlayback = computed(() => diagrams.edgeCount > 0);

function enterPlayback() {
  diagrams.setPlaybackStep(0);
}

function exitPlayback() {
  stopAutoPlay();
  diagrams.setPlaybackStep(null);
}

function prevStep() {
  if (diagrams.playbackStep === null || diagrams.playbackStep <= 0) return;
  diagrams.setPlaybackStep(diagrams.playbackStep - 1);
}

function nextStep() {
  if (diagrams.playbackStep === null) { diagrams.setPlaybackStep(0); return; }
  if (diagrams.playbackStep < diagrams.playbackMaxStep) {
    diagrams.setPlaybackStep(diagrams.playbackStep + 1);
  } else {
    stopAutoPlay();
  }
}

function toggleAutoPlay() {
  isPlaying.value ? stopAutoPlay() : startAutoPlay();
}

function startAutoPlay() {
  isPlaying.value = true;
  if (diagrams.playbackStep === null || diagrams.playbackStep >= diagrams.playbackMaxStep) {
    diagrams.setPlaybackStep(0);
  }
  const advance = () => {
    if (!isPlaying.value) return;
    if (diagrams.playbackStep === null || diagrams.playbackStep >= diagrams.playbackMaxStep) {
      stopAutoPlay();
      return;
    }
    diagrams.setPlaybackStep(diagrams.playbackStep + 1);
    playTimer = setTimeout(advance, 2000);
  };
  playTimer = setTimeout(advance, 2000);
}

function stopAutoPlay() {
  isPlaying.value = false;
  if (playTimer !== null) { clearTimeout(playTimer); playTimer = null; }
}

onUnmounted(stopAutoPlay);

const emit = defineEmits<{
  (e: 'fitView'): void;
  (e: 'save'): void;
  (e: 'load'): void;
  (e: 'new'): void;
  (e: 'exportPng'): void;
  (e: 'exportSvg'): void;
  (e: 'exportJson'): void;
  (e: 'exportGif'): void;
  (e: 'exportVideo'): void;
  (e: 'exportDrawio'): void;
  (e: 'import'): void;
  (e: 'importJson'): void;
  (e: 'toggleSnap'): void;
  (e: 'collapseAll'): void;
  (e: 'expandAll'): void;
  (e: 'duplicate'): void;
}>();

const tools = [
  { event: 'new' as const, icon: FilePlus, label: 'New Diagram' },
  { event: 'save' as const, icon: Save, label: 'Save' },
  { event: 'load' as const, icon: FolderOpen, label: 'Load' },
  { event: 'fitView' as const, icon: Maximize2, label: 'Fit View' },
] as const;

const exportTools = [
  { event: 'exportPng' as const, icon: ImageDown, label: 'Export PNG' },
  { event: 'exportSvg' as const, icon: FileType, label: 'Export SVG' },
  { event: 'exportJson' as const, icon: FileJson, label: 'Export JSON' },
  { event: 'exportGif' as const, icon: Film, label: 'Export GIF' },
  { event: 'exportVideo' as const, icon: Clapperboard, label: 'Export Video (WebM/MP4)' },
] as const;
</script>

<template>
  <div data-testid="diagram-toolbar" class="flex h-9 items-center gap-0.5 border-b border-border bg-muted/30 px-2">
    <TooltipProvider :delay-duration="300">
      <!-- Main tools -->
      <Tooltip v-for="tool in tools" :key="tool.event">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :data-testid="`toolbar-${tool.event}`"
            @click="(emit as (e: string) => void)(tool.event)"
          >
            <component :is="tool.icon" class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ tool.label }}</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Undo / Redo -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-undo"
            :disabled="!diagrams.canUndo"
            @click="diagrams.undo()"
          >
            <Undo2 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-redo"
            :disabled="!diagrams.canRedo"
            @click="diagrams.redo()"
          >
            <Redo2 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Snap to grid toggle -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-toggleSnap"
            :class="props.snapToGrid ? 'bg-primary/10 text-primary' : ''"
            @click="emit('toggleSnap')"
          >
            <Grid3x3 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Snap to Grid {{ props.snapToGrid ? '(On)' : '(Off)' }}</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Collapse / Expand All -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" data-testid="toolbar-collapseAll" class="h-7 w-7 p-0" @click="emit('collapseAll')">
            <Minimize2 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Collapse All Groups</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="sm" data-testid="toolbar-expandAll" class="h-7 w-7 p-0" @click="emit('expandAll')">
            <Maximize class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Expand All Groups</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Import -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-import"
            @click="emit('import')"
          >
            <Import class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import (draw.io, Lucidchart)</TooltipContent>
      </Tooltip>

      <!-- Import JSON -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-importJson"
            @click="emit('importJson')"
          >
            <FileUp class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import JSON</TooltipContent>
      </Tooltip>

      <!-- Separator -->
      <div class="mx-1 h-4 w-px bg-border" />

      <!-- Export tools -->
      <Tooltip v-for="tool in exportTools" :key="tool.event">
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :data-testid="`toolbar-${tool.event}`"
            @click="(emit as (e: string) => void)(tool.event)"
          >
            <component :is="tool.icon" class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ tool.label }}</TooltipContent>
      </Tooltip>

      <!-- Export draw.io -->
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            data-testid="toolbar-exportDrawio"
            @click="emit('exportDrawio')"
          >
            <Share2 class="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Export draw.io / Lucidchart (.drawio)</TooltipContent>
      </Tooltip>

      <!-- Share -->
      <template v-if="canShare">
        <div class="mx-1 h-4 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 p-0"
              data-testid="toolbar-share"
              @click="openShareDialog"
            >
              <Link class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Share Diagram</TooltipContent>
        </Tooltip>
      </template>

      <!-- Flow playback controls — only visible when diagram has numbered flow levels -->
      <template v-if="showPlayback">
        <div class="mx-1 h-4 w-px bg-border" />

        <!-- Enter playback: single "Flow" button when not in playback mode -->
        <Tooltip v-if="diagrams.playbackStep === null">
          <TooltipTrigger as-child>
            <Button
              variant="ghost" size="sm"
              class="h-7 gap-1.5 px-2 text-[11px] font-medium"
              @click="enterPlayback()"
            >
              <Play class="h-3 w-3" />
              Flow
            </Button>
          </TooltipTrigger>
          <TooltipContent>Step through the flow animation level by level</TooltipContent>
        </Tooltip>

        <!-- Playback controls when active -->
        <template v-else>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0"
                :disabled="diagrams.playbackStep <= 0" @click="prevStep()">
                <SkipBack class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Previous step</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0" @click="toggleAutoPlay()">
                <Pause v-if="isPlaying" class="h-3.5 w-3.5" />
                <Play v-else class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ isPlaying ? 'Pause' : 'Play' }} auto-advance</TooltipContent>
          </Tooltip>

          <span class="mx-1 min-w-[32px] text-center text-[11px] font-medium tabular-nums text-foreground">
            {{ diagrams.playbackStep + 1 }}<span class="text-muted-foreground">/{{ diagrams.playbackMaxStep + 1 }}</span>
          </span>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0"
                :disabled="diagrams.playbackStep >= diagrams.playbackMaxStep" @click="nextStep()">
                <SkipForward class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Next step</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="sm" class="h-7 w-7 p-0 text-muted-foreground" @click="exitPlayback()">
                <StopCircle class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Exit flow playback (show all)</TooltipContent>
          </Tooltip>
        </template>
      </template>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Selection count badge + Duplicate button -->
      <template v-if="props.selectedCount > 0">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 w-7 p-0"
              data-testid="toolbar-duplicate"
              @click="emit('duplicate')"
            >
              <Copy class="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Duplicate Selected (Ctrl+D)</TooltipContent>
        </Tooltip>
      </template>
      <div v-if="props.selectedCount > 1" class="mr-2 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
        <MousePointerSquareDashed class="h-3 w-3 text-primary" />
        <span class="text-[10px] font-medium tabular-nums text-primary">{{ props.selectedCount }} selected</span>
      </div>

      <!-- Stats -->
      <div data-testid="diagram-stats" class="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{{ diagrams.nodeCount }} nodes</span>
        <span>{{ diagrams.edgeCount }} edges</span>
      </div>
    </TooltipProvider>

    <!-- Share Dialog -->
    <Dialog v-model:open="showShareDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Diagram</DialogTitle>
          <DialogDescription>
            Create a public link to share a read-only view of this diagram.
          </DialogDescription>
        </DialogHeader>

        <!-- Loading state -->
        <div v-if="shareLoading" class="flex items-center justify-center py-6">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <!-- Not shared yet -->
        <div v-else-if="!shareStatus.shared" class="py-4">
          <p class="mb-4 text-sm text-muted-foreground">
            Anyone with the link will be able to view this diagram without signing in.
          </p>
          <Button class="w-full" @click="createShareLink">
            <Link class="mr-2 h-4 w-4" />
            Create Share Link
          </Button>
        </div>

        <!-- Already shared -->
        <div v-else class="space-y-4 py-4">
          <div class="flex items-center gap-2">
            <input
              :value="shareUrl"
              readonly
              class="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <Button variant="outline" size="sm" class="shrink-0" @click="copyShareUrl">
              <Check v-if="shareCopied" class="mr-1 h-3.5 w-3.5 text-green-500" />
              <Copy v-else class="mr-1 h-3.5 w-3.5" />
              {{ shareCopied ? 'Copied' : 'Copy' }}
            </Button>
          </div>

          <div class="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
            <span class="text-xs text-muted-foreground">This diagram is publicly shared</span>
            <Button variant="ghost" size="sm" class="h-7 text-xs text-destructive hover:text-destructive" @click="removeShareLink">
              <Unlink class="mr-1 h-3 w-3" />
              Unshare
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
