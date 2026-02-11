<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore, MODEL_OPTIONS, PERMISSION_OPTIONS, type ClaudeModel, type PermissionMode } from '@/stores/settings';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ClaudeLogo from '@/components/icons/ClaudeLogo.vue';
import {
  ArrowRight, ArrowLeft, Check, FolderOpen, Zap, Shield, FileEdit, ClipboardList,
} from 'lucide-vue-next';

const ONBOARDING_KEY = 'onboarding-complete';

const settings = useSettingsStore();
const open = ref(!localStorage.getItem(ONBOARDING_KEY));
const step = ref(0);
const projectsDir = ref(settings.projectsDir);

const totalSteps = 3;
const isLast = computed(() => step.value === totalSteps - 1);

const permissionIcons: Record<string, typeof Zap> = {
  bypassPermissions: Zap,
  acceptEdits: FileEdit,
  plan: ClipboardList,
  default: Shield,
};

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
}

function selectModel(value: ClaudeModel) {
  settings.model = value;
  settings.save();
}

function selectPermission(value: PermissionMode) {
  settings.permissionMode = value;
  settings.save();
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-lg" @interact-outside.prevent>
      <!-- Step 0: Welcome -->
      <template v-if="step === 0">
        <DialogHeader>
          <div class="mb-2 flex justify-center">
            <div class="rounded-2xl bg-primary/10 p-3">
              <ClaudeLogo :size="36" class="text-primary" />
            </div>
          </div>
          <DialogTitle class="text-center text-xl">Welcome to Claude Code Web</DialogTitle>
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
            <div class="flex gap-2">
              <FolderOpen class="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <Input v-model="projectsDir" class="font-mono text-sm" placeholder="/home/user/projects" />
            </div>
          </div>
        </div>
      </template>

      <!-- Step 1: Model + Permissions -->
      <template v-if="step === 1">
        <DialogHeader>
          <DialogTitle>Choose your defaults</DialogTitle>
          <DialogDescription>Select a model and permission mode. You can change these anytime.</DialogDescription>
        </DialogHeader>

        <div class="space-y-4 py-4">
          <div>
            <label class="mb-2 block text-sm font-medium text-foreground">Model</label>
            <div class="space-y-1.5">
              <button
                v-for="m in MODEL_OPTIONS"
                :key="m.value"
                class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all"
                :class="settings.model === m.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'"
                @click="selectModel(m.value)"
              >
                <div class="flex-1">
                  <div class="text-sm font-medium text-foreground">{{ m.label }}</div>
                  <div class="text-xs text-muted-foreground">{{ m.description }}</div>
                </div>
                <div v-if="settings.model === m.value" class="h-2 w-2 rounded-full bg-primary" />
              </button>
            </div>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-foreground">Permission mode</label>
            <div class="space-y-1.5">
              <button
                v-for="p in PERMISSION_OPTIONS"
                :key="p.value"
                class="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all"
                :class="settings.permissionMode === p.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'"
                @click="selectPermission(p.value)"
              >
                <component :is="permissionIcons[p.value] || Shield" class="h-4 w-4 shrink-0 text-muted-foreground" />
                <div class="flex-1">
                  <div class="text-sm font-medium text-foreground">{{ p.label }}</div>
                  <div class="text-xs text-muted-foreground">{{ p.description }}</div>
                </div>
                <div v-if="settings.permissionMode === p.value" class="h-2 w-2 rounded-full bg-primary" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- Step 2: Tips -->
      <template v-if="step === 2">
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
