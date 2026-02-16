<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useGitStore } from '@/stores/git';
import { useConfirmDialog } from '@/composables/useConfirmDialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  GitBranch, RefreshCw, ChevronRight, ArrowDownToLine,
  ArrowUpFromLine, Download, Sparkles, History, Loader2, Plus, Trash2,
} from 'lucide-vue-next';
import GitStatus from './GitStatus.vue';
import DiffViewer from './DiffViewer.vue';

const git = useGitStore();
const { confirm } = useConfirmDialog();
const showBranches = ref(false);
const showHistory = ref(false);
const newBranch = ref('');
const creatingBranch = ref(false);

onMounted(() => {
  git.fetchStatus();
  git.fetchBranches();
  git.fetchLog();
});

function onBranchesToggle(open: boolean) {
  if (open && git.branches.length === 0) {
    git.fetchBranches();
  }
}

function onHistoryToggle(open: boolean) {
  if (open && git.log.length === 0) {
    git.fetchLog();
  }
}

async function handleCreateBranch() {
  if (!newBranch.value.trim()) return;
  creatingBranch.value = true;
  try {
    await git.createBranch(newBranch.value.trim());
    newBranch.value = '';
  } finally {
    creatingBranch.value = false;
  }
}

async function handleDeleteBranch(branchName: string) {
  const ok = await confirm({
    title: `Delete branch "${branchName}"?`,
    description: 'This will delete the local branch. This cannot be undone.',
  });
  if (!ok) return;
  try {
    await git.deleteBranch(branchName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not fully merged')) {
      const forceOk = await confirm({
        title: `Force delete "${branchName}"?`,
        description: 'This branch is not fully merged. Force deleting may cause you to lose commits.',
      });
      if (forceOk) {
        await git.deleteBranch(branchName, true);
      }
    }
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
</script>

<template>
  <div class="flex h-full">
    <!-- Left: Status + Commit + Remote + Branches + History -->
    <div class="flex w-72 shrink-0 flex-col border-r border-border">
      <!-- Header with branch and refresh -->
      <div class="flex h-9 items-center justify-between border-b border-border px-3">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Source Control</span>
          <Badge
            v-if="git.branch"
            variant="outline"
            class="cursor-pointer text-[10px]"
          >
            <GitBranch class="mr-1 h-3 w-3" />
            {{ git.branch }}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="git.fetchStatus">
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': git.loading }" />
        </Button>
      </div>

      <!-- Remote operations -->
      <div class="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="git.remoteLoading"
          @click="git.doFetch"
        >
          <Download class="h-3 w-3" />
          Fetch
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="git.remoteLoading"
          @click="git.doPull"
        >
          <ArrowDownToLine class="h-3 w-3" />
          Pull
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="git.remoteLoading"
          @click="git.doPush"
        >
          <ArrowUpFromLine class="h-3 w-3" />
          Push
        </Button>
        <Loader2 v-if="git.remoteLoading" class="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>

      <!-- Commit input — pinned at top, always visible -->
      <div class="shrink-0 border-b border-border p-3">
        <div class="mb-2 flex items-center gap-1">
          <Textarea
            v-model="git.commitMessage"
            placeholder="Commit message..."
            class="min-h-[60px] flex-1 resize-none text-sm"
            rows="2"
          />
        </div>
        <div class="flex gap-1.5">
          <Button
            size="sm"
            class="flex-1"
            :disabled="!git.commitMessage.trim() || git.staged.length === 0"
            @click="git.doCommit"
          >
            Commit
            <Badge v-if="git.staged.length > 0" variant="secondary" class="ml-1.5 h-4 px-1 text-[10px]">{{ git.staged.length }}</Badge>
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="gap-1"
            :disabled="git.staged.length === 0 || git.generatingMessage"
            @click="git.generateCommitMessage"
          >
            <Sparkles v-if="!git.generatingMessage" class="h-3.5 w-3.5" />
            <Loader2 v-else class="h-3.5 w-3.5 animate-spin" />
          </Button>
        </div>
      </div>

      <!-- Scrollable area: file list + branches + history -->
      <ScrollArea class="min-h-0 flex-1">
        <!-- File status list -->
        <div class="border-b border-border p-3">
          <GitStatus />
        </div>

        <!-- Branch management -->
        <Collapsible v-model:open="showBranches" @update:open="onBranchesToggle">
          <CollapsibleTrigger
            class="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            <ChevronRight class="h-3 w-3 shrink-0 transition-transform duration-200" :class="{ 'rotate-90': showBranches }" />
            <GitBranch class="h-3.5 w-3.5" />
            <span>Branches</span>
            <Badge variant="outline" class="ml-auto text-[10px]">{{ git.branches.length }}</Badge>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="border-b border-border">
              <div class="flex items-center gap-1 p-2">
                <input
                  v-model="newBranch"
                  class="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                  placeholder="New branch name..."
                  @keyup.enter="handleCreateBranch"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 w-7 p-0"
                  :disabled="!newBranch.trim() || creatingBranch"
                  @click="handleCreateBranch"
                >
                  <Plus class="h-3.5 w-3.5" />
                </Button>
              </div>
              <div
                v-for="b in git.branches"
                :key="b.name"
                class="group flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/30"
                :class="{ 'bg-primary/10 text-primary font-medium': b.current }"
                @click="!b.current && git.checkoutBranch(b.name)"
              >
                <GitBranch class="h-3 w-3 shrink-0" />
                <span class="truncate">{{ b.name }}</span>
                <Badge v-if="b.current" variant="default" class="ml-auto text-[9px]">current</Badge>
                <Button
                  v-if="!b.current"
                  variant="ghost"
                  size="sm"
                  class="ml-auto h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                  title="Delete branch"
                  @click.stop="handleDeleteBranch(b.name)"
                >
                  <Trash2 class="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- Commit history -->
        <Collapsible v-model:open="showHistory" @update:open="onHistoryToggle">
          <CollapsibleTrigger
            class="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
          >
            <ChevronRight class="h-3 w-3 shrink-0 transition-transform duration-200" :class="{ 'rotate-90': showHistory }" />
            <History class="h-3.5 w-3.5" />
            <span>History</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div>
              <div
                v-for="entry in git.log"
                :key="entry.hash"
                class="cursor-pointer border-b border-border/50 px-3 py-2 transition-colors hover:bg-muted/30"
                @click="git.showCommit(entry.hash)"
              >
                <p class="truncate text-xs font-medium text-foreground">{{ entry.message }}</p>
                <div class="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <code class="rounded bg-muted px-1 py-0.5">{{ entry.hash.slice(0, 7) }}</code>
                  <span>{{ entry.author_name }}</span>
                  <span class="ml-auto">{{ formatDate(entry.date) }}</span>
                </div>
              </div>
              <div v-if="git.log.length === 0" class="px-3 py-4 text-center text-xs text-muted-foreground">
                No commits yet
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </ScrollArea>
    </div>

    <!-- Right: Diff viewer -->
    <div class="flex flex-1 flex-col">
      <div class="flex h-9 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="sm"
          class="h-6 text-xs"
          :class="{ 'bg-muted': !git.showStagedDiff }"
          @click="git.fetchDiff(false)"
        >
          Working Changes
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 text-xs"
          :class="{ 'bg-muted': git.showStagedDiff }"
          @click="git.fetchDiff(true)"
        >
          Staged Changes
        </Button>
        <span v-if="git.selectedFile" class="ml-2 truncate font-mono text-[11px] text-muted-foreground">
          {{ git.selectedFile }}
        </span>
      </div>
      <DiffViewer class="flex-1" />
    </div>
  </div>
</template>
