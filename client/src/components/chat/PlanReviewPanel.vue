<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useChatStore } from '@/stores/chat';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ClipboardList, Check, X, MessageSquare, Send } from 'lucide-vue-next';
import { renderMarkdown, setupCodeCopyHandler } from '@/lib/markdown';

const chat = useChatStore();

const emit = defineEmits<{
  approve: [];
  deny: [];
  change: [feedback: string];
}>();

const feedback = ref('');
const showFeedbackInput = ref(false);

const renderedPlan = computed(() => {
  if (!chat.planReviewText) return '';
  return renderMarkdown(chat.planReviewText);
});

let cleanupCopy: (() => void) | null = null;
onMounted(() => { cleanupCopy = setupCodeCopyHandler(); });
onUnmounted(() => { cleanupCopy?.(); });

function handleSendFeedback() {
  const text = feedback.value.trim();
  if (!text) return;
  emit('change', text);
  feedback.value = '';
  showFeedbackInput.value = false;
}

function handleFeedbackKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendFeedback();
  }
}
</script>

<template>
  <div class="flex h-full flex-col bg-card/50">
    <!-- Header -->
    <div class="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <ClipboardList class="h-4 w-4 text-primary" />
      <span class="text-xs font-semibold text-foreground">Plan Review</span>
    </div>

    <!-- Scrollable plan content -->
    <ScrollArea class="flex-1 overflow-hidden">
      <div class="px-3 py-3">
        <div
          class="prose prose-sm prose-neutral max-w-none dark:prose-invert prose-pre:bg-muted/60 prose-pre:border prose-pre:border-border prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-p:leading-relaxed prose-headings:text-foreground"
          v-html="renderedPlan"
        />
      </div>
    </ScrollArea>

    <!-- Action area -->
    <div class="border-t border-border px-3 py-3 space-y-2">
      <!-- Feedback input (toggleable) -->
      <div v-if="showFeedbackInput" class="space-y-2">
        <textarea
          v-model="feedback"
          placeholder="Describe what to change..."
          class="block w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
          rows="3"
          @keydown="handleFeedbackKeydown"
        />
        <div class="flex gap-1.5">
          <Button
            size="sm"
            class="h-7 flex-1 gap-1 text-xs"
            :disabled="!feedback.trim()"
            @click="handleSendFeedback"
          >
            <Send class="h-3 w-3" />
            Send Feedback
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 text-xs"
            @click="showFeedbackInput = false"
          >
            Cancel
          </Button>
        </div>
      </div>

      <!-- Main action buttons -->
      <div v-else class="flex flex-col gap-1.5">
        <Button
          size="sm"
          class="h-8 w-full gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white"
          @click="emit('approve')"
        >
          <Check class="h-3.5 w-3.5" />
          Approve Plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="h-8 w-full gap-1.5 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
          @click="emit('deny')"
        >
          <X class="h-3.5 w-3.5" />
          Reject Plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="h-8 w-full gap-1.5 text-xs"
          @click="showFeedbackInput = true"
        >
          <MessageSquare class="h-3.5 w-3.5" />
          Request Changes
        </Button>
      </div>
    </div>
  </div>
</template>
