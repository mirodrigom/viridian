import { ref, watch, onUnmounted, type Ref } from 'vue';
import { toast } from 'vue-sonner';

const SpeechRecognitionApi =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

/** Keywords that trigger wake word detection (speech recognition often mishears "buddy") */
const TRIGGER_WORDS = [
  'buddy', 'body', 'birdie', 'bunny', 'buggy', 'betty',
  'bloody', 'money', 'bonnie', 'bday',
];

export function useWakeWord(options: {
  onWakeWordDetected: () => void;
  paused: Ref<boolean>;
}) {
  const isListening = ref(false);
  const isSupported = ref(!!SpeechRecognitionApi);

  let recognition: any = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  let inCooldown = false;
  /** True when we intentionally want to be listening (user enabled the feature) */
  let wantListening = false;

  function createRecognition() {
    const rec = new SpeechRecognitionApi();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      if (inCooldown) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript: string = event.results[i][0].transcript.toLowerCase();
        const confidence: number = event.results[i][0].confidence;
        const isFinal: boolean = event.results[i].isFinal;
        console.log(`[WakeWord] ${isFinal ? 'FINAL' : 'interim'}: "${transcript}" (confidence: ${(confidence * 100).toFixed(1)}%)`);
        const detected = TRIGGER_WORDS.some(w => transcript.includes('hey ' + w) || transcript.includes('hey, ' + w));
        if (detected) {
          console.log('[WakeWord] ✓ Trigger detected:', transcript);
          inCooldown = true;
          cooldownTimer = setTimeout(() => { inCooldown = false; }, 3000);
          options.onWakeWordDetected();
          return;
        }
      }
    };

    rec.onend = () => {
      console.log('[WakeWord] Recognition ended, wantListening:', wantListening, 'paused:', options.paused.value);
      recognition = null;
      // Auto-restart if still supposed to be listening and not paused
      if (wantListening && !options.paused.value) {
        restartTimer = setTimeout(() => {
          if (wantListening && !options.paused.value) {
            beginListening();
          }
        }, 500);
      }
    };

    rec.onerror = (event: any) => {
      console.warn('[WakeWord] Error:', event.error);
      if (event.error === 'no-speech' || event.error === 'aborted') {
        // Expected — recognition will restart via onend
        return;
      }
      if (event.error === 'not-allowed' || event.error === 'audio-capture') {
        toast.error('Wake word: microphone access denied');
        wantListening = false;
        isListening.value = false;
        return;
      }
      if (event.error === 'network') {
        toast.error('Wake word: speech recognition unavailable (network error)');
        wantListening = false;
        isListening.value = false;
        return;
      }
    };

    return rec;
  }

  /** Create a fresh recognition instance and start it */
  function beginListening() {
    // Clean up any existing instance
    if (recognition) {
      try { recognition.abort(); } catch { /* ignore */ }
      recognition = null;
    }

    try {
      recognition = createRecognition();
      recognition.start();
      isListening.value = true;
      console.log('[WakeWord] Listening started');
    } catch (e) {
      console.error('[WakeWord] Failed to start:', e);
      isListening.value = false;
    }
  }

  function start() {
    if (!isSupported.value) {
      toast.error('Wake word: speech recognition not supported in this browser');
      return;
    }
    wantListening = true;

    if (options.paused.value) {
      // Will start when paused becomes false
      isListening.value = true;
      console.log('[WakeWord] Enabled but paused — will start when overlay closes');
      toast.info('Wake word enabled — say "Hey Buddy" to activate voice input');
      return;
    }

    toast.info('Wake word enabled — say "Hey Buddy" to activate voice input');
    beginListening();
  }

  function stop() {
    wantListening = false;
    isListening.value = false;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
    inCooldown = false;
    if (recognition) {
      try { recognition.abort(); } catch { /* ignore */ }
      recognition = null;
    }
  }

  // Pause/resume when AudioOverlay opens/closes
  watch(options.paused, (paused) => {
    if (!wantListening) return;

    if (paused) {
      console.log('[WakeWord] Pausing (overlay opened)');
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (recognition) {
        try { recognition.abort(); } catch { /* ignore */ }
        recognition = null;
      }
    } else {
      console.log('[WakeWord] Resuming (overlay closed)');
      restartTimer = setTimeout(() => beginListening(), 800);
    }
  });

  onUnmounted(() => stop());

  return { isListening, isSupported, start, stop };
}
