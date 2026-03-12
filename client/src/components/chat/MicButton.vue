<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { toast } from 'vue-sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Mic, MicOff, Loader2 } from 'lucide-vue-next';
import { useAudioProviderStore } from '@/stores/audioProvider';

type EnhanceMode = 'raw' | 'clean' | 'expand' | 'code';

const emit = defineEmits<{
  transcript: [text: string, mode: EnhanceMode];
}>();

const audioStore = useAudioProviderStore();

const isRecording = ref(false);
const isProcessing = ref(false);
const enhanceMode = ref<EnhanceMode>('raw');
const showModeMenu = ref(false);
const errorMessage = ref('');

// Browser Speech Recognition (used when provider is 'audio-browser')
let recognition: any = null;
let finalTranscript = '';
const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

// MediaRecorder (used for server-side providers)
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let mediaStream: MediaStream | null = null;

const isSupported = computed(() => {
  // Supported if browser speech API exists OR if a server-side provider is configured
  return !!SpeechRecognitionApi || audioStore.configuredProviders.length > 0;
});

const ENHANCE_MODES: { value: EnhanceMode; label: string; description: string }[] = [
  { value: 'raw', label: 'Raw', description: 'Unmodified transcription' },
  { value: 'clean', label: 'Clean', description: 'Fix grammar and punctuation' },
  { value: 'expand', label: 'Expand', description: 'Elaborate into detailed prompt' },
  { value: 'code', label: 'Code', description: 'Convert to coding instruction' },
];

/** Language code for browser Speech API. */
function getBrowserLang(): string {
  const lang = audioStore.language;
  if (!lang || lang === 'auto') return 'en-US';
  if (lang === 'en') return 'en-US';
  if (lang === 'es') return 'es-ES';
  if (lang === 'fr') return 'fr-FR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'it') return 'it-IT';
  if (lang === 'ja') return 'ja-JP';
  if (lang === 'ko') return 'ko-KR';
  if (lang === 'zh') return 'zh-CN';
  return `${lang}-${lang.toUpperCase()}`;
}

// ─── Browser Speech API Recording ────────────────────────────────────────

function startBrowserRecording() {
  if (!SpeechRecognitionApi) {
    toast.error('Speech recognition is not supported in this browser');
    return;
  }

  errorMessage.value = '';
  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = getBrowserLang();
  finalTranscript = '';

  recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]!;
      if (result.isFinal) {
        finalTranscript += result[0]!.transcript;
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

function stopBrowserRecording() {
  recognition?.stop();
}

// ─── MediaRecorder Recording (for server-side providers) ─────────────────

async function startMediaRecording() {
  errorMessage.value = '';
  audioChunks = [];

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    const msg = e.name === 'NotAllowedError'
      ? 'Microphone access denied — check browser permissions'
      : `Could not access microphone: ${e.message}`;
    errorMessage.value = msg;
    toast.error(msg);
    return;
  }

  // Prefer webm/opus, fall back to whatever the browser supports
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.onstop = async () => {
    // Stop all tracks to release the microphone
    mediaStream?.getTracks().forEach(t => t.stop());
    mediaStream = null;

    if (audioChunks.length === 0) {
      isRecording.value = false;
      return;
    }

    const audioBlob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];

    if (audioBlob.size < 100) {
      isRecording.value = false;
      toast.error('Recording too short — try again');
      return;
    }

    // Send to server for transcription
    isProcessing.value = true;
    isRecording.value = false;
    try {
      const result = await audioStore.transcribe(audioBlob);
      if (result && result.text.trim()) {
        emit('transcript', result.text.trim(), enhanceMode.value);
      } else if (result) {
        toast.info('No speech detected — try again');
      }
    } finally {
      isProcessing.value = false;
    }
  };

  mediaRecorder.onerror = () => {
    isRecording.value = false;
    isProcessing.value = false;
    mediaStream?.getTracks().forEach(t => t.stop());
    mediaStream = null;
    toast.error('Recording failed');
  };

  mediaRecorder.start(250); // Collect data every 250ms
  isRecording.value = true;
}

function stopMediaRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

// ─── Unified Controls ────────────────────────────────────────────────────

function startRecording() {
  if (audioStore.isBrowserProvider) {
    startBrowserRecording();
  } else {
    startMediaRecording();
  }
}

function stopRecording() {
  if (audioStore.isBrowserProvider) {
    stopBrowserRecording();
  } else {
    stopMediaRecording();
  }
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

const providerLabel = computed(() => {
  const p = audioStore.activeProvider;
  if (!p) return 'Browser';
  return p.name;
});

onMounted(() => {
  audioStore.fetchProviders();
});

onUnmounted(() => {
  recognition?.abort();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaStream?.getTracks().forEach(t => t.stop());
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
              'text-muted-foreground hover:text-foreground': !isRecording && !isProcessing,
              'text-primary': isProcessing,
            }"
            :disabled="isProcessing"
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
            <div>{{ isProcessing ? 'Transcribing...' : isRecording ? 'Stop recording' : 'Voice input' }}</div>
            <div class="text-muted-foreground">{{ providerLabel }} &middot; Mode: {{ ENHANCE_MODES.find(m => m.value === enhanceMode)?.label }} (right-click to change)</div>
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
