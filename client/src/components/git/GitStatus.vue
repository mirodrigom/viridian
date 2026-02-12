<script setup lang="ts">
import { computed } from 'vue';
import { useGitStore } from '@/stores/git';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Undo2, Columns2 } from 'lucide-vue-next';

const git = useGitStore();

function confirmDiscard(filePath: string) {
  if (confirm(`Discard changes to ${filePath}?`)) {
    git.discardFile(filePath);
  }
}

const allUnstagedPaths = computed(() => [
  ...git.modified.map(f => f.path),
  ...git.untracked,
]);

const allSelected = computed(() =>
  allUnstagedPaths.value.length > 0 &&
  allUnstagedPaths.value.every(p => git.selectedFiles.has(p))
);

const someSelected = computed(() =>
  allUnstagedPaths.value.some(p => git.selectedFiles.has(p))
);

function toggleSelectAll() {
  if (allSelected.value) {
    git.clearSelection();
  } else {
    git.selectAllModified();
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Staged Changes -->
    <div v-if="git.staged.length > 0">
      <div class="mb-1 flex items-center justify-between">
        <h4 class="text-xs font-medium uppercase text-muted-foreground">Staged Changes</h4>
        <Button variant="ghost" size="sm" class="h-6 text-xs" @click="git.unstageFiles(git.staged.map(f => f.path))">
          Unstage All
        </Button>
      </div>
      <div class="space-y-0.5">
        <div
          v-for="file in git.staged"
          :key="'s-' + file.path"
          class="group flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
          :class="{ 'bg-accent': git.selectedFile === file.path }"
          @click="git.fetchFileDiff(file.path)"
        >
          <span class="min-w-0 flex-1 truncate text-foreground">{{ file.path }}</span>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              class="hidden h-5 w-5 p-0 group-hover:inline-flex"
              title="Open diff in editor"
              @click.stop="git.openDiffInEditor(file.path)"
            >
              <Columns2 class="h-3 w-3" />
            </Button>
            <Badge variant="default" class="text-xs">staged</Badge>
          </div>
        </div>
      </div>
    </div>

    <!-- Modified + Untracked with checkboxes -->
    <div v-if="git.modified.length > 0 || git.untracked.length > 0">
      <div class="mb-1 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="someSelected && !allSelected"
            class="h-3.5 w-3.5 rounded border-border accent-primary"
            @change="toggleSelectAll"
          />
          <h4 class="text-xs font-medium uppercase text-muted-foreground">Changes</h4>
        </div>
        <div class="flex items-center gap-1">
          <Button
            v-if="someSelected"
            variant="ghost"
            size="sm"
            class="h-6 text-xs text-primary"
            @click="git.stageSelected()"
          >
            Stage Selected ({{ git.selectedFiles.size }})
          </Button>
          <Button variant="ghost" size="sm" class="h-6 text-xs" @click="git.stageFiles([...git.modified.map(f => f.path), ...git.untracked])">
            Stage All
          </Button>
        </div>
      </div>

      <!-- Modified files -->
      <div class="space-y-0.5">
        <div
          v-for="file in git.modified"
          :key="'m-' + file.path"
          class="group flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
          :class="{ 'bg-accent': git.selectedFile === file.path }"
        >
          <input
            type="checkbox"
            :checked="git.selectedFiles.has(file.path)"
            class="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary"
            @change="git.toggleFileSelection(file.path)"
            @click.stop
          />
          <button class="min-w-0 flex-1 truncate text-left text-foreground" @click="git.fetchFileDiff(file.path)">
            {{ file.path }}
          </button>
          <div class="flex items-center gap-1">
            <Badge variant="secondary" class="text-xs">M</Badge>
            <Button
              variant="ghost"
              size="sm"
              class="hidden h-5 w-5 p-0 group-hover:inline-flex"
              title="Open diff in editor"
              @click.stop="git.openDiffInEditor(file.path)"
            >
              <Columns2 class="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="hidden h-5 w-5 p-0 text-destructive group-hover:inline-flex"
              title="Discard changes"
              @click.stop="confirmDiscard(file.path)"
            >
              <Undo2 class="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="hidden h-5 px-1 text-xs group-hover:inline-flex"
              @click.stop="git.stageFiles([file.path])"
            >
              +
            </Button>
          </div>
        </div>

        <!-- Untracked files (in same section) -->
        <div
          v-for="file in git.untracked"
          :key="'u-' + file"
          class="group flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
        >
          <input
            type="checkbox"
            :checked="git.selectedFiles.has(file)"
            class="h-3.5 w-3.5 shrink-0 rounded border-border accent-primary"
            @change="git.toggleFileSelection(file)"
            @click.stop
          />
          <span class="min-w-0 flex-1 truncate text-foreground">{{ file }}</span>
          <div class="flex items-center gap-1">
            <Badge variant="outline" class="text-xs">U</Badge>
            <Button
              variant="ghost"
              size="sm"
              class="hidden h-5 px-1 text-xs group-hover:inline-flex"
              @click.stop="git.stageFiles([file])"
            >
              +
            </Button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="git.staged.length === 0 && git.modified.length === 0 && git.untracked.length === 0">
      <p class="text-center text-sm text-muted-foreground">No changes</p>
    </div>
  </div>
</template>
