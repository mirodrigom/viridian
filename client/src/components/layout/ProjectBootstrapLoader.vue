<script setup lang="ts">
import { computed } from 'vue';
import { useManagementStore, type BootstrapStep } from '@/stores/management';
import ViridianLogo from '@/components/icons/ViridianLogo.vue';
import { Loader2, Check, Circle, FileCode, FileKey, Server } from 'lucide-vue-next';

const store = useManagementStore();

interface StepDef {
  id: BootstrapStep;
  label: string;
  icon: typeof FileCode;
}

const steps: StepDef[] = [
  { id: 'scripts', label: 'Scripts', icon: FileCode },
  { id: 'environments', label: 'Environments', icon: FileKey },
  { id: 'services', label: 'Services', icon: Server },
];

const stepOrder: BootstrapStep[] = ['scripts', 'environments', 'services', 'done'];

function stepState(stepId: BootstrapStep): 'pending' | 'loading' | 'done' {
  const current = store.bootstrapStep;
  const currentIdx = stepOrder.indexOf(current);
  const thisIdx = stepOrder.indexOf(stepId);
  if (thisIdx < currentIdx || current === 'done') return 'done';
  if (thisIdx === currentIdx) return 'loading';
  return 'pending';
}

function stepCount(stepId: BootstrapStep): string {
  const r = store.bootstrapResult;
  if (!r) return '';
  if (stepId === 'scripts' && r.scripts) return `${r.scripts.discovered} found, ${r.scripts.added} added`;
  if (stepId === 'environments' && r.environments) return `${r.environments.files.length} file${r.environments.files.length !== 1 ? 's' : ''}`;
  if (stepId === 'services' && r.services) return `${r.services.discovered} found, ${r.services.added} added`;
  return '';
}

const progress = computed(() => {
  const idx = stepOrder.indexOf(store.bootstrapStep);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / stepOrder.length) * 100);
});
</script>

<template>
  <div class="flex h-full items-center justify-center bg-background">
    <div class="w-80 text-center">
      <!-- Logo -->
      <div class="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <ViridianLogo :size="48" />
      </div>

      <h2 class="mb-6 text-xl font-semibold text-foreground">Setting up project</h2>

      <!-- Steps -->
      <div class="mb-6 space-y-3 text-left">
        <div
          v-for="step in steps"
          :key="step.id"
          class="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors"
          :class="stepState(step.id) === 'loading' ? 'bg-primary/5' : ''"
        >
          <!-- Status icon -->
          <div class="flex h-5 w-5 shrink-0 items-center justify-center">
            <Check
              v-if="stepState(step.id) === 'done'"
              class="h-4 w-4 text-green-500"
            />
            <Loader2
              v-else-if="stepState(step.id) === 'loading'"
              class="h-4 w-4 animate-spin text-primary"
            />
            <Circle
              v-else
              class="h-3.5 w-3.5 text-muted-foreground/40"
            />
          </div>

          <!-- Step icon + label -->
          <component :is="step.icon" class="h-3.5 w-3.5 text-muted-foreground" />
          <span
            class="text-sm"
            :class="stepState(step.id) === 'pending' ? 'text-muted-foreground/50' : 'text-foreground'"
          >{{ step.label }}</span>

          <!-- Count badge -->
          <span
            v-if="stepState(step.id) === 'done' && stepCount(step.id)"
            class="ml-auto text-[10px] text-muted-foreground"
          >{{ stepCount(step.id) }}</span>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="mx-3 h-1 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>
  </div>
</template>
