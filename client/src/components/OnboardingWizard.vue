<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import ViridianLogo from '@/components/icons/ViridianLogo.vue';
import DirectoryPicker from '@/components/DirectoryPicker.vue';
import {
  ArrowRight, ArrowLeft, Check, FolderOpen, Search,
} from 'lucide-vue-next';

const emit = defineEmits<{ complete: [path: string] }>();

const ONBOARDING_KEY = 'onboarding-complete';

const settings = useSettingsStore();
const open = ref(!localStorage.getItem(ONBOARDING_KEY));
const step = ref(0);
const projectsDir = ref(settings.projectsDir);
const showDirPicker = ref(false);

const totalSteps = 2;
const isLast = computed(() => step.value === totalSteps - 1);

function next() {
  if (isLast.value) {
    finish();
  } else {
    step.value++;
  }
}

function prev() {
  if (step.value > 0) step.value--;
}

function finish() {
  settings.projectsDir = projectsDir.value;
  settings.save();
  localStorage.setItem(ONBOARDING_KEY, '1');
  open.value = false;
  if (projectsDir.value) {
    emit('complete', projectsDir.value);
  }
}

function onDirSelect(path: string) {
  projectsDir.value = path;
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-3xl" @interact-outside.prevent>
      <!-- Step 0: Welcome -->
      <template v-if="step === 0">
        <DialogHeader>
          <div class="mb-2 flex justify-center">
            <div class="rounded-2xl bg-primary/10 p-3">
              <ViridianLogo :size="36" />
            </div>
          </div>
          <DialogTitle class="text-center text-xl">Welcome to Viridian</DialogTitle>
          <DialogDescription class="text-center">
            Let's get you set up in a few quick steps.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-foreground">Projects directory</label>
            <p class="mb-2 text-xs text-muted-foreground">
              Where your code projects live. You can change this later.
            </p>
            <div class="flex items-center gap-2">
              <div class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
                <span class="truncate font-mono text-sm text-foreground">{{ projectsDir || 'No directory selected' }}</span>
              </div>
              <Button variant="outline" @click="showDirPicker = true" class="shrink-0 gap-1">
                <Search class="h-4 w-4" />
                Browse
              </Button>
            </div>
          </div>
        </div>

        <DirectoryPicker
          v-model:open="showDirPicker"
          :initial-path="projectsDir || '/home'"
          @select="onDirSelect"
        />
      </template>

      <!-- Step 1: Tips -->
      <template v-if="step === 1">
        <DialogHeader>
          <DialogTitle>Quick tips</DialogTitle>
          <DialogDescription>A few things to help you get started.</DialogDescription>
        </DialogHeader>

        <div class="space-y-3 py-4">
          <div class="rounded-lg border border-border bg-muted/30 p-3">
            <p class="mb-1 text-sm font-medium text-foreground">/ for commands</p>
            <p class="text-xs text-muted-foreground">Type <code class="rounded bg-muted px-1">/</code> in the chat to access slash commands like /clear, /model, /status</p>
          </div>
          <div class="rounded-lg border border-border bg-muted/30 p-3">
            <p class="mb-1 text-sm font-medium text-foreground">@ for file mentions</p>
            <p class="text-xs text-muted-foreground">Type <code class="rounded bg-muted px-1">@</code> followed by a filename to include files as context</p>
          </div>
          <div class="rounded-lg border border-border bg-muted/30 p-3">
            <p class="mb-1 text-sm font-medium text-foreground">Drag & drop images</p>
            <p class="text-xs text-muted-foreground">Drop images into the chat input or paste from clipboard (up to 5)</p>
          </div>
          <div class="rounded-lg border border-border bg-muted/30 p-3">
            <p class="mb-1 text-sm font-medium text-foreground">Ctrl+F to search</p>
            <p class="text-xs text-muted-foreground">Search through conversation messages with keyboard navigation</p>
          </div>
        </div>
      </template>

      <!-- Footer with navigation -->
      <DialogFooter class="flex items-center justify-between sm:justify-between">
        <div class="flex items-center gap-1.5">
          <div
            v-for="i in totalSteps"
            :key="i"
            class="h-1.5 w-6 rounded-full transition-colors"
            :class="i - 1 <= step ? 'bg-primary' : 'bg-muted'"
          />
        </div>
        <div class="flex gap-2">
          <Button v-if="step > 0" variant="outline" size="sm" @click="prev" class="gap-1">
            <ArrowLeft class="h-3.5 w-3.5" />
            Back
          </Button>
          <Button v-if="step === 0" variant="ghost" size="sm" @click="finish">
            Skip
          </Button>
          <Button size="sm" @click="next" class="gap-1">
            {{ isLast ? 'Get Started' : 'Next' }}
            <Check v-if="isLast" class="h-3.5 w-3.5" />
            <ArrowRight v-else class="h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
