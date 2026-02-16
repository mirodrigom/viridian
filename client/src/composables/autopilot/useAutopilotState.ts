import { ref, computed } from 'vue';
import type {
  AutopilotRun,
  AutopilotCycle,
  AutopilotTimelineEntry,
  RunStatus,
  TokenUsage,
} from '@/types/autopilot';

/**
 * Composable for managing autopilot run state and timeline
 */
export function useAutopilotState() {
  // Core run state
  const currentRun = ref<AutopilotRun | null>(null);
  const selectedCycleNumber = ref<number | null>(null);
  const timeline = ref<AutopilotTimelineEntry[]>([]);
  const isLoadingRun = ref(false);

  // Computed values
  const isRunning = computed(() =>
    currentRun.value?.status === 'running' || currentRun.value?.status === 'rate_limited',
  );

  const isPaused = computed(() => currentRun.value?.status === 'paused');

  const currentCycle = computed(() => {
    if (!currentRun.value) return null;
    const n = currentRun.value.currentCycleNumber;
    return currentRun.value.cycles[n] || null;
  });

  const totalTokensUsed = computed(() => {
    if (!currentRun.value) return 0;
    const t = currentRun.value.totalTokens;
    return t.agentA.inputTokens + t.agentA.outputTokens +
      t.agentB.inputTokens + t.agentB.outputTokens;
  });

  const selectedCycle = computed(() => {
    if (!currentRun.value || selectedCycleNumber.value === null) return null;
    return currentRun.value.cycles.find(
      (c) => c.cycleNumber === selectedCycleNumber.value,
    ) || null;
  });

  // State management actions
  function setCurrentRun(run: AutopilotRun | null) {
    currentRun.value = run;
  }

  function setSelectedCycleNumber(cycleNumber: number | null) {
    selectedCycleNumber.value = cycleNumber;
  }

  function updateRunStatus(status: RunStatus) {
    if (currentRun.value) {
      currentRun.value.status = status;
    }
  }

  function updateRunTokens(agent: 'agentA' | 'agentB', tokens: TokenUsage) {
    if (currentRun.value) {
      currentRun.value.totalTokens[agent].inputTokens += tokens.inputTokens;
      currentRun.value.totalTokens[agent].outputTokens += tokens.outputTokens;
    }
  }

  function incrementCommitCount() {
    if (currentRun.value) {
      currentRun.value.totalCommits++;
    }
  }

  function setRateLimitedUntil(until: number | null) {
    if (currentRun.value) {
      currentRun.value.rateLimitedUntil = until;
    }
  }

  function setRunCompleted(timestamp?: number) {
    if (currentRun.value) {
      currentRun.value.completedAt = timestamp || Date.now();
    }
  }

  // Timeline management
  function addTimeline(
    type: AutopilotTimelineEntry['type'],
    cycleNumber: number | null,
    detail: string,
    meta?: Record<string, unknown>,
  ) {
    timeline.value.push({
      timestamp: Date.now(),
      type,
      cycleNumber,
      detail,
      meta,
    });
  }

  function clearTimeline() {
    timeline.value = [];
  }

  // Cycle management
  function getCycle(cycleNumber: number): AutopilotCycle | null {
    if (!currentRun.value) return null;
    return currentRun.value.cycles.find((c) => c.cycleNumber === cycleNumber) || null;
  }

  function addCycle(cycle: AutopilotCycle) {
    if (currentRun.value) {
      currentRun.value.cycles.push(cycle);
    }
  }

  function updateCycleStatus(cycleNumber: number, status: string) {
    const cycle = getCycle(cycleNumber);
    if (cycle) {
      cycle.status = status;
    }
  }

  function setCurrentCycleNumber(cycleNumber: number) {
    if (currentRun.value) {
      currentRun.value.currentCycleNumber = cycleNumber;
    }
  }

  // Full state clearing
  function clearState() {
    currentRun.value = null;
    timeline.value = [];
    selectedCycleNumber.value = null;
  }

  return {
    // State
    currentRun,
    selectedCycleNumber,
    timeline,
    isLoadingRun,

    // Computed
    isRunning,
    isPaused,
    currentCycle,
    totalTokensUsed,
    selectedCycle,

    // Actions
    setCurrentRun,
    setSelectedCycleNumber,
    updateRunStatus,
    updateRunTokens,
    incrementCommitCount,
    setRateLimitedUntil,
    setRunCompleted,
    addTimeline,
    clearTimeline,
    getCycle,
    addCycle,
    updateCycleStatus,
    setCurrentCycleNumber,
    clearState,
  };
}