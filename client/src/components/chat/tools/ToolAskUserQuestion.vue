<script setup lang="ts">
import { ref, computed, watch, nextTick, inject } from 'vue';
import type { ToolUseInfo } from '@/stores/chat';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Check, ChevronRight, ChevronLeft, MessageCircleQuestion, Send } from 'lucide-vue-next';

const props = defineProps<{ toolUse: ToolUseInfo }>();

const respondToTool = inject<(requestId: string, approved: boolean, answers?: Record<string, string>) => void>('respondToTool')!;

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

const questions = computed((): Question[] => {
  const raw = props.toolUse.input.questions;
  if (!Array.isArray(raw)) return [];
  return raw.map((q: any) => ({
    question: q.question || '',
    header: q.header || '',
    options: Array.isArray(q.options)
      ? q.options.map((o: any) =>
          typeof o === 'string' ? { label: o } : { label: o.label || '', description: o.description || '' },
        )
      : [],
    multiSelect: q.multiSelect || false,
  }));
});

const isAnswered = computed(() => props.toolUse.status === 'approved' || props.toolUse.status === 'rejected');

// Modal state
const showModal = ref(false);
const currentStep = ref(0);
const answers = ref<Record<number, string[]>>({});
const customInputs = ref<Record<number, string>>({});
const useCustom = ref<Record<number, boolean>>({});

// Auto-open when tool arrives and is pending
watch(() => props.toolUse.status, (status) => {
  if (status === 'pending' && questions.value.length > 0 && !props.toolUse.isInputStreaming) {
    showModal.value = true;
    currentStep.value = 0;
  }
}, { immediate: true });

// Also open when input finishes streaming
watch(() => props.toolUse.isInputStreaming, (streaming) => {
  if (!streaming && props.toolUse.status === 'pending' && questions.value.length > 0) {
    showModal.value = true;
    currentStep.value = 0;
  }
});

const currentQuestion = computed(() => questions.value[currentStep.value]);
const isLastStep = computed(() => currentStep.value === questions.value.length - 1);
const totalSteps = computed(() => questions.value.length);

function selectOption(label: string) {
  const q = currentQuestion.value;
  if (!q) return;

  useCustom.value[currentStep.value] = false;

  if (q.multiSelect) {
    const current = answers.value[currentStep.value] || [];
    const idx = current.indexOf(label);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(label);
    }
    answers.value[currentStep.value] = [...current];
  } else {
    answers.value[currentStep.value] = [label];
    // Auto-advance for single-select if not the last step
    if (!isLastStep.value) {
      nextTick(() => {
        currentStep.value++;
      });
    }
  }
}

function toggleCustom() {
  useCustom.value[currentStep.value] = !useCustom.value[currentStep.value];
  if (useCustom.value[currentStep.value]) {
    answers.value[currentStep.value] = [];
  }
}

function isSelected(label: string): boolean {
  return (answers.value[currentStep.value] || []).includes(label);
}

const canProceed = computed(() => {
  if (useCustom.value[currentStep.value]) {
    return (customInputs.value[currentStep.value] || '').trim().length > 0;
  }
  return (answers.value[currentStep.value] || []).length > 0;
});

function goNext() {
  if (isLastStep.value) {
    submitAll();
  } else {
    currentStep.value++;
  }
}

function goBack() {
  if (currentStep.value > 0) {
    currentStep.value--;
  }
}

function submitAll() {
  const result: Record<string, string> = {};
  for (let i = 0; i < questions.value.length; i++) {
    const q = questions.value[i]!;
    const key = q.question;
    if (useCustom.value[i]) {
      result[key] = customInputs.value[i] || '';
    } else {
      result[key] = (answers.value[i] || []).join(', ');
    }
  }
  showModal.value = false;
  respondToTool(props.toolUse.requestId, true, result);
}

// Summary of answers for inline display after answered
const answerSummary = computed(() => {
  const stored = props.toolUse.input._userAnswers as Record<string, string> | undefined;
  if (!stored) return null;
  return stored;
});

const stepProgress = computed(() => {
  if (totalSteps.value <= 1) return '';
  return `${currentStep.value + 1} of ${totalSteps.value}`;
});
</script>

<template>
  <!-- Inline card content: show summary when answered, prompt to open when pending -->
  <div class="px-3.5 py-2.5">
    <!-- Answered: show responses -->
    <div v-if="isAnswered && answerSummary" class="space-y-2">
      <div
        v-for="(value, key) in answerSummary"
        :key="key"
        class="flex items-start gap-2"
      >
        <Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
        <div class="text-xs">
          <span class="text-muted-foreground">{{ key }}:</span>
          <span class="ml-1 font-medium text-foreground">{{ value }}</span>
        </div>
      </div>
    </div>

    <!-- Pending: show question preview -->
    <div v-else-if="questions.length > 0" class="space-y-2">
      <div class="flex items-center gap-2">
        <MessageCircleQuestion class="h-3.5 w-3.5 text-primary" />
        <span class="text-xs text-muted-foreground">
          {{ questions.length === 1 ? '1 question' : `${questions.length} questions` }} to answer
        </span>
      </div>
      <Button
        v-if="toolUse.status === 'pending'"
        size="sm"
        variant="outline"
        class="h-7 gap-1.5 text-xs"
        @click="showModal = true"
      >
        <MessageCircleQuestion class="h-3.5 w-3.5" />
        Answer
      </Button>
    </div>

    <!-- Streaming -->
    <div v-else-if="toolUse.isInputStreaming" class="flex items-center gap-2">
      <span class="inline-block h-3 w-1 animate-pulse rounded-sm bg-primary" />
      <span class="text-xs text-muted-foreground">Loading questions...</span>
    </div>
  </div>

  <!-- Modal wizard -->
  <Dialog v-model:open="showModal" :show-close-button="false">
    <DialogContent class="max-w-lg gap-0 p-0" @interact-outside.prevent @escape-key-down.prevent>
      <!-- Header -->
      <DialogHeader class="border-b border-border px-5 py-4">
        <div class="flex items-center gap-2">
          <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <MessageCircleQuestion class="h-4 w-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <DialogTitle class="text-sm font-semibold">
              {{ currentQuestion?.header || 'Claude needs your input' }}
            </DialogTitle>
            <DialogDescription v-if="stepProgress" class="text-xs text-muted-foreground">
              Step {{ stepProgress }}
            </DialogDescription>
          </div>
        </div>

        <!-- Step indicators -->
        <div v-if="totalSteps > 1" class="mt-3 flex gap-1">
          <div
            v-for="i in totalSteps"
            :key="i"
            class="h-1 flex-1 rounded-full transition-colors duration-200"
            :class="i - 1 <= currentStep ? 'bg-primary' : 'bg-muted'"
          />
        </div>
      </DialogHeader>

      <!-- Question body -->
      <div class="px-5 py-4">
        <p class="mb-4 text-sm text-foreground">{{ currentQuestion?.question }}</p>

        <!-- Options -->
        <div class="space-y-2">
          <button
            v-for="(option, idx) in currentQuestion?.options || []"
            :key="idx"
            class="flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all duration-150"
            :class="isSelected(option.label)
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border hover:border-primary/40 hover:bg-muted/30'"
            @click="selectOption(option.label)"
          >
            <div
              class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors"
              :class="isSelected(option.label)
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground/40'"
            >
              <Check v-if="isSelected(option.label)" class="h-2.5 w-2.5" />
            </div>
            <div class="min-w-0 flex-1">
              <span class="text-sm font-medium text-foreground">{{ option.label }}</span>
              <p v-if="option.description" class="mt-0.5 text-xs text-muted-foreground">{{ option.description }}</p>
            </div>
          </button>

          <!-- Custom "Other" option -->
          <Separator class="my-2" />
          <button
            class="flex w-full items-start gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-all duration-150"
            :class="useCustom[currentStep]
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border hover:border-primary/40 hover:bg-muted/30'"
            @click="toggleCustom"
          >
            <div
              class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors"
              :class="useCustom[currentStep]
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted-foreground/40'"
            >
              <Check v-if="useCustom[currentStep]" class="h-2.5 w-2.5" />
            </div>
            <span class="text-sm font-medium text-foreground">Other</span>
          </button>
          <div v-if="useCustom[currentStep]" class="pl-7">
            <input
              v-model="customInputs[currentStep]"
              class="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none ring-0 transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
              placeholder="Type your answer..."
              @keydown.enter.prevent="canProceed && goNext()"
            />
          </div>
        </div>
      </div>

      <!-- Footer -->
      <DialogFooter class="border-t border-border px-5 py-3">
        <div class="flex w-full items-center justify-between">
          <Button
            v-if="currentStep > 0"
            variant="ghost"
            size="sm"
            class="h-8 gap-1.5 text-xs"
            @click="goBack"
          >
            <ChevronLeft class="h-3.5 w-3.5" />
            Back
          </Button>
          <div v-else />

          <Button
            size="sm"
            class="h-8 gap-1.5 text-xs"
            :disabled="!canProceed"
            @click="goNext"
          >
            <template v-if="isLastStep">
              <Send class="h-3.5 w-3.5" />
              Submit
            </template>
            <template v-else>
              Next
              <ChevronRight class="h-3.5 w-3.5" />
            </template>
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
