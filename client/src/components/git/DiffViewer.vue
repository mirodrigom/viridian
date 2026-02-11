<script setup lang="ts">
import { computed } from 'vue';
import { useGitStore } from '@/stores/git';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { FileText, Columns2 } from 'lucide-vue-next';

const git = useGitStore();

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hdr';
  text: string;
  oldLine?: number;
  newLine?: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  adds: number;
  dels: number;
}

const parsedFiles = computed((): DiffFile[] => {
  if (!git.diff) return [];
  const files: DiffFile[] = [];
  const rawFiles = git.diff.split(/^diff --git /m).filter(Boolean);

  for (const raw of rawFiles) {
    const lines = raw.split('\n');
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    const path = headerMatch ? headerMatch[2] : lines[0] || 'unknown';

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
    let adds = 0;
    let dels = 0;

    for (const line of lines.slice(1)) {
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
      if (hunkMatch) {
        currentHunk = {
          header: line,
          lines: [],
        };
        oldLine = parseInt(hunkMatch[1]);
        newLine = parseInt(hunkMatch[2]);
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', text: line.slice(1), newLine: newLine++ });
        adds++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', text: line.slice(1), oldLine: oldLine++ });
        dels++;
      } else if (line.startsWith('\\')) {
        currentHunk.lines.push({ type: 'hdr', text: line });
      } else {
        currentHunk.lines.push({ type: 'ctx', text: line.slice(1) || '', oldLine: oldLine++, newLine: newLine++ });
      }
    }

    if (hunks.length > 0) {
      files.push({ path, hunks, adds, dels });
    }
  }
  return files;
});

const totalAdds = computed(() => parsedFiles.value.reduce((s, f) => s + f.adds, 0));
const totalDels = computed(() => parsedFiles.value.reduce((s, f) => s + f.dels, 0));
</script>

<template>
  <ScrollArea class="h-full">
    <div v-if="!git.diff" class="flex items-center justify-center p-8 text-sm text-muted-foreground">
      Select a file or click "Working Changes" / "Staged Changes" to view diffs.
    </div>

    <div v-else class="pb-8">
      <!-- Summary bar -->
      <div v-if="parsedFiles.length > 1" class="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
        <span>{{ parsedFiles.length }} files changed</span>
        <span class="text-green-400">+{{ totalAdds }}</span>
        <span class="text-red-400">-{{ totalDels }}</span>
      </div>

      <!-- Per-file diffs -->
      <div v-for="file in parsedFiles" :key="file.path" class="border-b border-border">
        <div class="sticky top-0 z-[5] flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 backdrop-blur">
          <span class="font-mono text-xs font-medium text-foreground">{{ file.path }}</span>
          <Button variant="ghost" size="sm" class="h-5 w-5 p-0" title="Open in editor" @click="git.openFileInEditor(file.path)">
            <FileText class="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" class="h-5 w-5 p-0" title="Open diff in editor" @click="git.openDiffInEditor(file.path)">
            <Columns2 class="h-3 w-3" />
          </Button>
          <span class="ml-auto text-[10px] text-green-400">+{{ file.adds }}</span>
          <span class="text-[10px] text-red-400">-{{ file.dels }}</span>
        </div>

        <div v-for="(hunk, hi) in file.hunks" :key="hi">
          <div class="bg-blue-500/5 px-4 py-1 font-mono text-[11px] text-blue-400">
            {{ hunk.header }}
          </div>
          <table class="w-full font-mono text-xs">
            <tbody>
              <tr
                v-for="(line, li) in hunk.lines"
                :key="li"
                :class="{
                  'bg-green-500/10': line.type === 'add',
                  'bg-red-500/10': line.type === 'del',
                }"
              >
                <td class="w-10 select-none border-r border-border/30 px-1.5 text-right text-[10px] text-muted-foreground/50">
                  {{ line.type !== 'add' && line.type !== 'hdr' ? line.oldLine : '' }}
                </td>
                <td class="w-10 select-none border-r border-border/30 px-1.5 text-right text-[10px] text-muted-foreground/50">
                  {{ line.type !== 'del' && line.type !== 'hdr' ? line.newLine : '' }}
                </td>
                <td class="w-4 select-none px-1 text-center">
                  <span v-if="line.type === 'add'" class="text-green-400">+</span>
                  <span v-else-if="line.type === 'del'" class="text-red-400">-</span>
                </td>
                <td class="whitespace-pre-wrap break-all pr-4">
                  <span
                    :class="{
                      'text-green-300/90': line.type === 'add',
                      'text-red-300/90': line.type === 'del',
                      'text-foreground/70': line.type === 'ctx',
                      'text-muted-foreground italic': line.type === 'hdr',
                    }"
                  >{{ line.text }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </ScrollArea>
</template>
