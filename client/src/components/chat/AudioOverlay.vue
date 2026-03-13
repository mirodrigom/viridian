<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import { toast } from 'vue-sonner';
import { X, Square, Check, RotateCcw, Send } from 'lucide-vue-next';
import { useAudioProviderStore } from '@/stores/audioProvider';
import { parseTranscript } from '@/composables/useVoiceCommands';

type TranscriptMode = 'raw' | 'voice-send';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  'update:open': [value: boolean];
  transcript: [text: string, mode: TranscriptMode];
}>();

const audioStore = useAudioProviderStore();

const canvas = ref<HTMLCanvasElement | null>(null);
const isRecording = ref(false);
const isProcessing = ref(false);
const isConfirming = ref(false);
const confirmedText = ref('');
const confirmCountdown = ref(0);
const elapsed = ref(0);
const errorMsg = ref('');
const liveTranscript = ref('');

const AUTO_SEND_SECONDS = 5;

// Audio analysis
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let animationId = 0;
let timerInterval = 0;

// Browser speech recognition
let recognition: any = null;
let finalTranscript = '';
let usingBrowserProvider = true;
const SpeechRecognitionApi = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

// Confirmation speech recognition
let confirmRecognition: any = null;
let countdownInterval = 0;

// ─── 3D Particle Sphere ─────────────────────────────────────────────

const PARTICLE_COUNT = 2000;

interface SpherePoint {
  bx: number;
  by: number;
  bz: number;
  band: number;
}

let spherePoints: SpherePoint[] = [];
let startTime = 0;
let rotationY = 0;
let rotationX = 0;

function generateSpherePoints() {
  spherePoints = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    const band = Math.floor(((y + 1) / 2) * 127);
    spherePoints.push({ bx: x, by: y, bz: z, band });
  }
}

const formattedTime = computed(() => {
  const m = Math.floor(elapsed.value / 60);
  const s = elapsed.value % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
});

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

// ─── Canvas Animation (3D Particle Sphere) ───────────────────────────

function drawFrame() {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  if (c.width !== rect.width * dpr || c.height !== rect.height * dpr) {
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }

  const w = rect.width;
  const h = rect.height;
  const cx = w / 2;
  const cy = h * 0.42;
  const time = (Date.now() - startTime) / 1000;

  ctx.fillStyle = 'rgb(2, 6, 4)';
  ctx.fillRect(0, 0, w, h);

  let avgVolume = 0;
  const bins = analyser?.frequencyBinCount || 128;
  const freqData = new Uint8Array(bins);
  if (analyser) {
    analyser.getByteFrequencyData(freqData);
    for (let i = 0; i < freqData.length; i++) avgVolume += freqData[i]!;
    avgVolume = avgVolume / freqData.length / 255;
  }

  const confirmPulse = isConfirming.value;
  const energy = isProcessing.value
    ? 0.25 + Math.sin(time * 3) * 0.1
    : confirmPulse
      ? 0.15 + Math.sin(time * 1.5) * 0.08
      : avgVolume;
  const baseRadius = Math.min(w, h) * 0.28;

  rotationY += 0.003 + energy * 0.015;
  rotationX = Math.sin(time * 0.2) * 0.3;

  const cosRY = Math.cos(rotationY);
  const sinRY = Math.sin(rotationY);
  const cosRX = Math.cos(rotationX);
  const sinRX = Math.sin(rotationX);

  const fov = 600;

  const glowR = baseRadius * (1.8 + energy * 0.8);
  const glow = ctx.createRadialGradient(cx, cy, baseRadius * 0.5, cx, cy, glowR);
  if (confirmPulse) {
    glow.addColorStop(0, `hsla(210, 80%, 50%, ${0.08 + energy * 0.12})`);
    glow.addColorStop(0.5, `hsla(210, 70%, 35%, ${0.03 + energy * 0.05})`);
    glow.addColorStop(1, 'hsla(210, 60%, 20%, 0)');
  } else {
    glow.addColorStop(0, `hsla(155, 80%, 45%, ${0.08 + energy * 0.15})`);
    glow.addColorStop(0.5, `hsla(150, 70%, 30%, ${0.03 + energy * 0.06})`);
    glow.addColorStop(1, 'hsla(155, 60%, 20%, 0)');
  }
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  const projected: { sx: number; sy: number; z: number; size: number; alpha: number; hue: number; light: number }[] = [];

  for (let i = 0; i < spherePoints.length; i++) {
    const p = spherePoints[i]!;
    const freqVal = (freqData[p.band] || 0) / 255;
    const displacement = 1 + freqVal * 0.35 + energy * 0.15;
    const wobble = 1 + Math.sin(p.bx * 4 + time * 1.5) * 0.02
      + Math.cos(p.by * 3 + time * 1.2) * 0.02
      + Math.sin(p.bz * 5 + time * 0.8) * 0.015;

    const r = baseRadius * displacement * wobble;
    let x = p.bx * r;
    let y = p.by * r;
    let z = p.bz * r;

    const x1 = x * cosRY - z * sinRY;
    const z1 = x * sinRY + z * cosRY;
    x = x1;
    z = z1;

    const y1 = y * cosRX - z * sinRX;
    const z2 = y * sinRX + z * cosRX;
    y = y1;
    z = z2;

    const scale = fov / (fov + z);
    const sx = cx + x * scale;
    const sy = cy + y * scale;

    const depthNorm = (z + baseRadius) / (2 * baseRadius);
    const dotSize = (1.0 + freqVal * 1.5 + energy * 0.5) * scale;
    const alpha = 0.3 + depthNorm * 0.7;
    const hue = confirmPulse ? 210 + freqVal * 15 : 145 + freqVal * 20;
    const light = 40 + depthNorm * 25 + freqVal * 15;

    projected.push({ sx, sy, z, size: dotSize, alpha, hue, light });
  }

  projected.sort((a, b) => b.z - a.z);

  for (const pt of projected) {
    if (isProcessing.value) {
      const pulse = 0.7 + Math.sin(time * 4) * 0.15;
      ctx.fillStyle = `hsla(${35 + pt.light * 0.2}, 85%, ${pt.light + 10}%, ${pt.alpha * pulse})`;
    } else if (confirmPulse) {
      const pulse = 0.8 + Math.sin(time * 2) * 0.1;
      ctx.fillStyle = `hsla(${pt.hue}, 75%, ${pt.light}%, ${pt.alpha * pulse})`;
    } else {
      ctx.fillStyle = `hsla(${pt.hue}, 80%, ${pt.light}%, ${pt.alpha})`;
    }

    ctx.beginPath();
    ctx.arc(pt.sx, pt.sy, pt.size, 0, Math.PI * 2);
    ctx.fill();

    if (pt.size > 1.8 && pt.alpha > 0.6) {
      ctx.beginPath();
      ctx.arc(pt.sx, pt.sy, pt.size * 2.5, 0, Math.PI * 2);
      if (isProcessing.value) {
        ctx.fillStyle = `hsla(40, 80%, 55%, ${pt.alpha * 0.06})`;
      } else if (confirmPulse) {
        ctx.fillStyle = `hsla(${pt.hue}, 70%, 55%, ${pt.alpha * 0.05})`;
      } else {
        ctx.fillStyle = `hsla(${pt.hue}, 75%, 55%, ${pt.alpha * 0.06})`;
      }
      ctx.fill();
    }
  }

  animationId = requestAnimationFrame(drawFrame);
}

// ─── Recording ────────────────────────────────────────────────────────

async function startRecording() {
  elapsed.value = 0;
  errorMsg.value = '';
  audioChunks = [];
  startTime = Date.now();
  rotationY = 0;
  isConfirming.value = false;
  confirmedText.value = '';
  liveTranscript.value = '';
  commandHandled = false;
  generateSpherePoints();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    errorMsg.value = 'Microphone requires HTTPS. Access this site via https:// or localhost.';
    animationId = requestAnimationFrame(drawFrame);
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e: any) {
    errorMsg.value = e.name === 'NotAllowedError'
      ? 'Microphone access denied — check browser permissions'
      : e.name === 'NotFoundError'
        ? 'No microphone found'
        : `Could not access microphone: ${e.message}`;
    animationId = requestAnimationFrame(drawFrame);
    return;
  }

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);

  const { useBrowser } = getEffectiveProvider();
  usingBrowserProvider = useBrowser;
  console.log('[AudioOverlay] startRecording — useBrowser:', useBrowser, 'activeProvider:', audioStore.activeProviderId);

  if (useBrowser) {
    startBrowserRecording();
  } else {
    startMediaRecording();
  }

  isRecording.value = true;
  timerInterval = window.setInterval(() => elapsed.value++, 1000);
  animationId = requestAnimationFrame(drawFrame);
}

function startBrowserRecording() {
  if (!SpeechRecognitionApi) {
    toast.error('Speech recognition not supported in this browser');
    close();
    return;
  }

  recognition = new SpeechRecognitionApi();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = getBrowserLang();
  finalTranscript = '';

  recognition.onresult = (event: any) => {
    if (isConfirming.value || !isRecording.value) return;

    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i]!.isFinal) {
        finalTranscript += event.results[i]![0]!.transcript;
      } else {
        interim += event.results[i]![0]!.transcript;
      }
    }

    // Update live transcript for display
    const full = (finalTranscript + interim).trim();
    liveTranscript.value = full;

    // Only check commands on final results to avoid false triggers from interim text
    const hasFinal = Array.from({ length: event.results.length - event.resultIndex }, (_, k) => event.results[event.resultIndex + k])
      .some((r: any) => r.isFinal);
    if (hasFinal) {
      const result = parseTranscript(finalTranscript.trim());
      if (result.matched) {
        console.log('[AudioOverlay] Voice command detected:', result.command.id, '— text:', result.textBeforeCommand);
        handleVoiceCommand(result.command.id, result.textBeforeCommand);
      }
    }
  };

  recognition.onerror = (event: any) => {
    console.warn('[AudioOverlay] SpeechRecognition error:', event.error);
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    const msg = event.error === 'not-allowed'
      ? 'Microphone access denied'
      : `Speech error: ${event.error}`;
    toast.error(msg);
  };

  recognition.onend = () => {
    console.log('[AudioOverlay] SpeechRecognition ended, finalTranscript:', JSON.stringify(finalTranscript));
  };

  recognition.start();
}

let commandHandled = false;

function handleVoiceCommand(commandId: string, text: string) {
  if (commandHandled || isConfirming.value) return;
  commandHandled = true;

  if (commandId === 'send') {
    if (!text.trim()) {
      commandHandled = false;
      toast.info('Nothing to send');
      return;
    }
    enterConfirmation(text.trim());
  } else if (commandId === 'cancel') {
    cancel();
  } else if (commandId === 'redo') {
    restartRecording();
  } else if (commandId === 'stop') {
    stopRecordingOnly(text.trim());
  }
}

function startMediaRecording() {
  if (!mediaStream) return;

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : 'audio/mp4';

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) audioChunks.push(event.data);
  };

  mediaRecorder.start(250);
}

function getEffectiveProvider(): { useBrowser: boolean } {
  if (!audioStore.isBrowserProvider) return { useBrowser: false };

  const serverProvider = audioStore.providers.find(
    p => p.id !== 'audio-browser' && p.configured,
  );
  if (serverProvider) {
    console.log('[AudioOverlay] Auto-switching from browser to configured provider:', serverProvider.id);
    audioStore.setProvider(serverProvider.id);
    return { useBrowser: false };
  }

  return { useBrowser: true };
}

// ─── Confirmation Flow ────────────────────────────────────────────────

function enterConfirmation(text: string) {
  // Stop recording but keep animation running
  isRecording.value = false;
  clearInterval(timerInterval);

  if (recognition) {
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try { recognition.abort(); } catch { /* ignore */ }
    recognition = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }

  // Stop microphone tracks for recording but keep audioContext for animation
  mediaStream?.getTracks().forEach(t => t.stop());
  mediaStream = null;
  mediaRecorder = null;

  confirmedText.value = text;
  isConfirming.value = true;
  confirmCountdown.value = AUTO_SEND_SECONDS;

  // Start countdown
  countdownInterval = window.setInterval(() => {
    confirmCountdown.value--;
    if (confirmCountdown.value <= 0) {
      clearInterval(countdownInterval);
      confirmSend();
    }
  }, 1000);

  // Delay confirm recognition — browser needs time to release the previous instance
  setTimeout(() => {
    if (isConfirming.value) startConfirmRecognition();
  }, 600);
}

function startConfirmRecognition() {
  if (!SpeechRecognitionApi) return;

  confirmRecognition = new SpeechRecognitionApi();
  confirmRecognition.continuous = true;
  confirmRecognition.interimResults = true;
  confirmRecognition.lang = getBrowserLang();

  const CONFIRM_WORDS = ['ok', 'okay', 'confirm', 'yes', 'send', 'send it', 'go'];
  const REDO_WORDS = ['redo', 'again', 'retry', 'no', 'start over'];
  const CANCEL_WORDS = ['cancel', 'never mind', 'forget it'];

  confirmRecognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript: string = event.results[i]![0]!.transcript.toLowerCase().trim();
      console.log(`[AudioOverlay] Confirm heard: "${transcript}" (final: ${event.results[i]!.isFinal})`);

      if (CONFIRM_WORDS.some(w => transcript.includes(w))) {
        confirmSend();
        return;
      }
      if (REDO_WORDS.some(w => transcript.includes(w))) {
        confirmRedo();
        return;
      }
      if (CANCEL_WORDS.some(w => transcript.includes(w))) {
        confirmCancel();
        return;
      }
    }
  };

  confirmRecognition.onerror = (event: any) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    console.warn('[AudioOverlay] Confirm recognition error:', event.error);
  };

  confirmRecognition.onend = () => {
    // Restart if still in confirmation mode
    if (isConfirming.value) {
      try { confirmRecognition?.start(); } catch { /* ignore */ }
    }
  };

  try {
    confirmRecognition.start();
  } catch (e) {
    console.warn('[AudioOverlay] Could not start confirm recognition:', e);
  }
}

function stopConfirmRecognition() {
  clearInterval(countdownInterval);
  if (confirmRecognition) {
    try { confirmRecognition.abort(); } catch { /* ignore */ }
    confirmRecognition = null;
  }
}

function confirmSend() {
  stopConfirmRecognition();
  const text = confirmedText.value;
  isConfirming.value = false;
  cleanup();
  emit('transcript', text, 'voice-send');
  emit('update:open', false);
}

function confirmRedo() {
  stopConfirmRecognition();
  isConfirming.value = false;
  confirmedText.value = '';
  cleanup();
  // Restart fresh
  nextTick(() => startRecording());
}

function confirmCancel() {
  stopConfirmRecognition();
  isConfirming.value = false;
  confirmedText.value = '';
  cleanup();
  emit('update:open', false);
}

// ─── Stop helpers ─────────────────────────────────────────────────────

/** Stop recording and place text in input without sending */
function stopRecordingOnly(text: string) {
  isRecording.value = false;
  clearInterval(timerInterval);
  recognition?.stop();
  recognition = null;
  cleanup();

  if (text) {
    emit('transcript', text, 'raw');
  } else {
    toast.info('No speech detected');
  }
  emit('update:open', false);
}

async function stopAndTranscribe() {
  isRecording.value = false;
  isProcessing.value = true;
  clearInterval(timerInterval);

  const useBrowser = usingBrowserProvider;
  console.log('[AudioOverlay] stopAndTranscribe — useBrowser:', useBrowser, 'activeProvider:', audioStore.activeProviderId);

  try {
    if (useBrowser) {
      recognition?.stop();
      recognition = null;
      await new Promise(r => setTimeout(r, 300));
      cleanup();
      if (finalTranscript.trim()) {
        // Check if transcript ends with a send command
        const result = parseTranscript(finalTranscript.trim());
        if (result.matched && result.command.id === 'send' && result.textBeforeCommand) {
          enterConfirmation(result.textBeforeCommand);
          isProcessing.value = false;
          return;
        }
        emit('transcript', finalTranscript.trim(), 'raw');
      } else {
        toast.info('No speech detected');
      }
    } else {
      const mimeType = mediaRecorder?.mimeType || 'audio/webm';

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        await new Promise<void>(resolve => {
          mediaRecorder!.addEventListener('stop', () => resolve(), { once: true });
          mediaRecorder!.stop();
        });
      }

      const chunks = [...audioChunks];
      audioChunks = [];
      cleanup();

      if (chunks.length === 0) {
        toast.info('No audio recorded');
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });

      if (blob.size < 100) {
        toast.error('Recording too short');
        return;
      }

      const result = await audioStore.transcribe(blob);

      if (result && result.text.trim()) {
        // Check if transcript ends with a send command
        const parsed = parseTranscript(result.text.trim());
        if (parsed.matched && parsed.command.id === 'send' && parsed.textBeforeCommand) {
          enterConfirmation(parsed.textBeforeCommand);
          isProcessing.value = false;
          return;
        }
        emit('transcript', result.text.trim(), 'raw');
      } else {
        toast.info('No speech detected');
      }
    }
  } catch (err) {
    console.error('[AudioOverlay] Transcription error:', err);
    toast.error(err instanceof Error ? err.message : 'Transcription failed');
  } finally {
    isProcessing.value = false;
    emit('update:open', false);
  }
}

function restartRecording() {
  isRecording.value = false;
  clearInterval(timerInterval);
  recognition?.abort();
  recognition = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  cleanup();
  finalTranscript = '';
  liveTranscript.value = '';
  nextTick(() => startRecording());
}

function cancel() {
  isRecording.value = false;
  isProcessing.value = false;
  isConfirming.value = false;
  clearInterval(timerInterval);
  stopConfirmRecognition();
  recognition?.abort();
  recognition = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  cleanup();
  emit('update:open', false);
}

function cleanup() {
  cancelAnimationFrame(animationId);
  mediaStream?.getTracks().forEach(t => t.stop());
  mediaStream = null;
  mediaRecorder = null;
  audioContext?.close();
  audioContext = null;
  analyser = null;
  spherePoints = [];
}

function close() {
  cancel();
}

function onKeydown(e: KeyboardEvent) {
  if (isConfirming.value) {
    if (e.key === 'Enter') { e.preventDefault(); confirmSend(); }
    else if (e.key === 'Escape') { e.preventDefault(); confirmCancel(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); confirmRedo(); }
    return;
  }
  if (e.key === 'Escape') cancel();
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (isRecording.value) stopAndTranscribe();
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    await nextTick();
    startRecording();
    window.addEventListener('keydown', onKeydown);
  } else {
    window.removeEventListener('keydown', onKeydown);
  }
});

onUnmounted(() => {
  cleanup();
  stopConfirmRecognition();
  clearInterval(timerInterval);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Transition name="audio-overlay">
    <div
      v-if="open"
      class="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-hidden rounded-[inherit]"
      style="background: rgb(2, 6, 4)"
    >
        <!-- Canvas -->
        <canvas ref="canvas" class="absolute inset-0 h-full w-full" />

        <!-- Spacer -->
        <div class="relative z-10 mt-auto" />

        <!-- Error state -->
        <template v-if="errorMsg">
          <div class="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
            <div class="text-base font-medium text-red-400">{{ errorMsg }}</div>
            <button
              class="mt-4 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-6 py-2 text-sm text-emerald-300 transition-all hover:bg-emerald-500/20"
              @click="cancel"
            >
              Close
            </button>
          </div>
        </template>

        <!-- Confirmation state -->
        <template v-else-if="isConfirming">
          <!-- Transcript preview centered in sphere area -->
          <div class="relative z-10 flex flex-col items-center gap-4 px-6 text-center max-w-lg">
            <div class="rounded-xl border border-blue-500/20 bg-blue-500/5 px-5 py-4 text-sm text-blue-200/90 leading-relaxed max-h-40 overflow-y-auto">
              {{ confirmedText }}
            </div>

            <!-- Countdown -->
            <div class="text-xs text-blue-400/60">
              Sending in <span class="font-mono text-blue-300">{{ confirmCountdown }}s</span>
            </div>
          </div>

          <!-- Spacer to push controls to bottom -->
          <div class="flex-1 min-h-8" />

          <!-- Controls -->
          <div class="relative z-10 mb-4 flex items-center gap-6">
            <button
              class="flex h-11 w-11 items-center justify-center rounded-full border border-red-500/20 bg-red-500/5 text-red-400/70 transition-all hover:bg-red-500/15 hover:text-red-300"
              title="Cancel (Esc)"
              @click="confirmCancel"
            >
              <X class="h-4 w-4" />
            </button>

            <button
              class="flex h-11 w-11 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/5 text-amber-400/70 transition-all hover:bg-amber-500/15 hover:text-amber-300"
              title="Redo (R)"
              @click="confirmRedo"
            >
              <RotateCcw class="h-4 w-4" />
            </button>

            <button
              class="flex h-14 w-14 items-center justify-center rounded-full border border-blue-500/25 bg-blue-500/10 text-blue-300 transition-all hover:bg-blue-500/20 hover:border-blue-400/50"
              title="Send (Enter)"
              @click="confirmSend"
            >
              <Send class="h-5 w-5" />
            </button>
          </div>

          <!-- Hint -->
          <div class="relative z-10 mb-6 text-[10px] text-blue-400/30">
            Say <span class="text-blue-400/50">"ok"</span> to send &middot;
            <span class="text-blue-400/50">"redo"</span> to re-record &middot;
            <span class="text-blue-400/50">"cancel"</span> to discard
          </div>
        </template>

        <!-- Normal recording / processing state -->
        <template v-else>
          <!-- Spacer to push everything below the sphere -->
          <div class="flex-1 min-h-8" />

          <!-- Status info below sphere, above controls -->
          <div class="relative z-10 mb-6 flex flex-col items-center gap-2">
            <div
              class="text-sm font-mono tabular-nums tracking-wider"
              :class="isProcessing ? 'text-amber-400/80' : 'text-emerald-400/60'"
            >
              {{ formattedTime }}
            </div>
            <div
              class="text-base font-medium"
              :class="isProcessing ? 'text-amber-400' : 'text-emerald-300/90'"
            >
              {{ isProcessing ? 'Transcribing...' : 'Listening...' }}
            </div>
            <!-- Live transcript preview -->
            <div
              v-if="liveTranscript && isRecording"
              class="mt-1 max-w-md px-4 text-center text-xs text-emerald-400/40 leading-relaxed line-clamp-2"
            >
              {{ liveTranscript }}
            </div>
          </div>

          <!-- Controls -->
          <div class="relative z-10 mb-4 flex items-center gap-8">
            <button
              class="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/15 bg-emerald-500/5 text-emerald-400/60 transition-all hover:bg-emerald-500/15 hover:text-emerald-300"
              title="Cancel"
              @click="cancel"
            >
              <X class="h-5 w-5" />
            </button>

            <button
              class="flex h-16 w-16 items-center justify-center rounded-full transition-all"
              :class="isProcessing
                ? 'bg-amber-500/15 text-amber-400 cursor-wait'
                : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/25 hover:border-emerald-400/50'"
              :disabled="isProcessing"
              title="Stop recording"
              @click="stopAndTranscribe"
            >
              <div v-if="isProcessing" class="h-5 w-5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <Square v-else class="h-5 w-5" />
            </button>
          </div>

          <!-- Hint -->
          <div class="relative z-10 mb-6 text-xs text-emerald-400/25">
            Say <span class="text-emerald-400/40">"send"</span> when done
            &middot;
            Press <kbd class="mx-0.5 rounded border border-emerald-500/20 px-1 py-0.5 font-mono text-[10px]">Space</kbd> to stop
            &middot;
            <kbd class="mx-0.5 rounded border border-emerald-500/20 px-1 py-0.5 font-mono text-[10px]">Esc</kbd> to cancel
          </div>
        </template>
    </div>
  </Transition>
</template>

<style scoped>
.audio-overlay-enter-active {
  transition: all 0.3s ease-out;
}
.audio-overlay-leave-active {
  transition: all 0.2s ease-in;
}
.audio-overlay-enter-from {
  opacity: 0;
  transform: scale(1.05);
}
.audio-overlay-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
