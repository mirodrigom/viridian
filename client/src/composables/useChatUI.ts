import { ref, computed, watch } from 'vue';
import type { ChatMessage } from './useChatMessages';

/**
 * Composable for managing chat UI state: scrolling, plan mode, and rate limits
 */
export function useChatUI() {
  // Auto-scroll state — shared so status bar can toggle it
  const autoScroll = ref(true);

  // Plan mode — toggled when Claude calls EnterPlanMode / ExitPlanMode
  const inPlanMode = ref(sessionStorage.getItem('chat-inPlanMode') === 'true');

  // Plan review — activated when ExitPlanMode captures the plan text
  const planReviewText = ref<string | null>(null);
  const isPlanReviewActive = ref(false);

  // Rate limit — timestamp (ms) until which the user is blocked
  const rateLimitedUntil = ref<number | null>(null);
  let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;

  const isRateLimited = computed(() => {
    return rateLimitedUntil.value !== null && Date.now() < rateLimitedUntil.value;
  });

  const rateLimitRemainingMs = computed(() => {
    if (!rateLimitedUntil.value) return 0;
    return Math.max(0, rateLimitedUntil.value - Date.now());
  });

  function setRateLimitedUntil(until: number) {
    rateLimitedUntil.value = until;
    // Auto-clear when timer expires
    if (rateLimitTimer) clearTimeout(rateLimitTimer);
    const remaining = until - Date.now();
    if (remaining > 0) {
      rateLimitTimer = setTimeout(() => {
        rateLimitedUntil.value = null;
      }, remaining);
    }
  }

  function clearRateLimit() {
    rateLimitedUntil.value = null;
    if (rateLimitTimer) {
      clearTimeout(rateLimitTimer);
      rateLimitTimer = null;
    }
  }

  function activatePlanReview(planText: string) {
    planReviewText.value = planText;
    isPlanReviewActive.value = true;
  }

  function dismissPlanReview() {
    planReviewText.value = null;
    isPlanReviewActive.value = false;
  }

  /** Scan messages for EnterPlanMode / ExitPlanMode tool calls to restore plan mode state. */
  function restorePlanModeFromMessages(msgs: ChatMessage[]) {
    let planMode = false;
    for (const msg of msgs) {
      if (msg.toolUse?.tool === 'EnterPlanMode') {
        planMode = true;
      } else if (msg.toolUse?.tool === 'ExitPlanMode') {
        planMode = false;
      }
    }
    inPlanMode.value = planMode;
  }

  function clearUI() {
    inPlanMode.value = false;
    planReviewText.value = null;
    isPlanReviewActive.value = false;
    clearRateLimit();
  }

  // Persist plan mode state across page reloads
  watch(inPlanMode, (v) => {
    if (v) sessionStorage.setItem('chat-inPlanMode', 'true');
    else sessionStorage.removeItem('chat-inPlanMode');
  });

  return {
    // State
    autoScroll,
    inPlanMode,
    planReviewText,
    isPlanReviewActive,
    rateLimitedUntil,

    // Computed
    isRateLimited,
    rateLimitRemainingMs,

    // Actions
    setRateLimitedUntil,
    clearRateLimit,
    activatePlanReview,
    dismissPlanReview,
    restorePlanModeFromMessages,
    clearUI,
  };
}