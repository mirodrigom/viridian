<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Mic, MicOff, Loader2 } from 'lucide-vue-next';

type EnhanceMode = 'raw' | 'clean' | 'expand' | 'code';

const emit = defineEmits<{
  transcript: [text: string, mode: EnhanceMode];
}>();

const isRecording = ref(false);
const isProcessing = ref(false);
const enhanceMode = ref<EnhanceMode>('raw');
const showModeMenu = ref(false);
const errorMessage = ref('');
let recognition: any = null;
let finalTranscript = '';

const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const isSupported = computed(() => !!SpeechRecognitionApi);

const ENHANCE_MODES: { value: EnhanceMode; label: string; description: string }[] = [
  { value: 'raw', label: 'Raw', description: 'Unmodified transcription' },
  { value: 'clean', label: 'Clean', description: 'Fix grammar and punctuation' },
  { value: 'expand', label: 'Expand', description: 'Elaborate into detailed prompt' },
  { value: 'code', label: 'Code', description: 'Convert to coding instruction' },
];

function startRecording() {
  if (!SpeechRecognitionApi) {
    toast.error('Speech recognition is not supported in this browser');
    return;
  }

  errorMessage.value = '';
  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  finalTranscript = '';

  recognition.onresult = (event: any) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]!;
      if (result.isFinal) {
        finalTranscript += result[0]!.transcript;
      } else {
        interim += result[0]!.transcript;
      }
    }
  };

  let hadError = false;
  let recordingStartedAt = 0;

  recognition.onerror = (event: any) => {
    hadError = true;
    isRecording.value = false;
    isProcessing.value = false;
    const msg = event.error === 'not-allowed'
      ? 'Microphone access denied — check browser permissions'
      : event.error === 'no-speech'
        ? 'No speech detected — try again'
        : event.error === 'network'
          ? 'Speech recognition requires a network connection (Brave may block this — try Chrome)'
          : `Speech recognition error: ${event.error}`;
    errorMessage.value = msg;
    toast.error(msg);
  };

  recognition.onend = () => {
    isRecording.value = false;
    if (hadError) return;

    if (finalTranscript.trim()) {
      isProcessing.value = true;
      emit('transcript', finalTranscript.trim(), enhanceMode.value);
      isProcessing.value = false;
    } else {
      const elapsed = Date.now() - recordingStartedAt;
      if (elapsed < 1000) {
        // Ended too quickly — likely blocked by the browser
        const msg = 'Speech recognition stopped unexpectedly — your browser may not support it (try Chrome)';
        errorMessage.value = msg;
        toast.error(msg);
      }
    }
  };

  try {
    recognition.start();
    isRecording.value = true;
    recordingStartedAt = Date.now();
  } catch (e: any) {
    toast.error(`Could not start recording: ${e.message}`);
    isRecording.value = false;
  }
}

function stopRecording() {
  recognition?.stop();
}

function toggleRecording() {
  if (isRecording.value) {
    stopRecording();
  } else {
    startRecording();
  }
}

function selectMode(mode: EnhanceMode) {
  enhanceMode.value = mode;
  showModeMenu.value = false;
}

onUnmounted(() => {
  recognition?.abort();
});
</script>

<template>
  <div v-if="isSupported" class="relative">
    <TooltipProvider :delay-duration="300">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 w-8 rounded-lg p-0"
            :class="{
              'text-destructive hover:text-destructive': isRecording,
              'text-muted-foreground hover:text-foreground': !isRecording,
            }"
            @click="toggleRecording"
            @contextmenu.prevent="showModeMenu = !showModeMenu"
          >
            <Loader2 v-if="isProcessing" class="h-4 w-4 animate-spin" />
            <MicOff v-else-if="isRecording" class="h-4 w-4 animate-pulse" />
            <Mic v-else class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div class="text-xs">
            <div>{{ isRecording ? 'Stop recording' : 'Voice input' }}</div>
            <div class="text-muted-foreground">Mode: {{ ENHANCE_MODES.find(m => m.value === enhanceMode)?.label }} (right-click to change)</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>

    <!-- Recording indicator pulse -->
    <div v-if="isRecording" class="pointer-events-none absolute inset-0 animate-ping rounded-lg bg-destructive/20" />

    <!-- Enhancement mode menu -->
    <div
      v-if="showModeMenu"
      class="absolute bottom-full right-0 mb-1 w-48 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
    >
      <div class="px-3 py-1.5 text-[10px] font-medium uppercase text-muted-foreground">Enhancement mode</div>
      <button
        v-for="mode in ENHANCE_MODES"
        :key="mode.value"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
        :class="enhanceMode === mode.value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'"
        @click="selectMode(mode.value)"
      >
        <div class="flex-1">
          <div class="text-xs font-medium">{{ mode.label }}</div>
          <div class="text-[10px] text-muted-foreground">{{ mode.description }}</div>
        </div>
        <div v-if="enhanceMode === mode.value" class="h-1.5 w-1.5 rounded-full bg-primary" />
      </button>
    </div>
  </div>
</template>
