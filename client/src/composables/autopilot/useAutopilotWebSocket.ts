import { createStoreWebSocket } from '@/lib/storeWebSocket';
import type {
  AutopilotRun,
  AutopilotCycle,
  AutopilotProfile,
  TokenUsage,
} from '@/types/autopilot';

/**
 * Composable for managing autopilot WebSocket connection and event handling
 */
export function useAutopilotWebSocket() {
  const { connected, connect: connectBase, disconnect, send, on } = createStoreWebSocket('/ws/autopilot');

  function connect(currentRun?: AutopilotRun | null) {
    connectBase();
    // Re-wire to active run after reconnect so events (e.g. Agent B deltas) keep flowing
    if (currentRun && ['running', 'paused', 'rate_limited'].includes(currentRun.status)) {
      // Small delay to ensure socket is open
      setTimeout(() => {
        send({ type: 'get_run_state', runId: currentRun.runId });
      }, 100);
    }
  }

  // WebSocket actions
  function startAdhoc(opts: {
    goalPrompt: string;
    agentAProfileId: string;
    agentBProfileId: string;
    agentAModel?: string;
    agentBModel?: string;
    cwd: string;
    allowedPaths: string[];
    maxIterations: number;
    runTestVerification?: boolean;
  }) {
    send({
      type: 'start_adhoc',
      ...opts,
    });
  }

  function startFromConfig(configId: string, cwd: string) {
    send({
      type: 'start_run',
      configId,
      cwd,
    });
  }

  function pauseRun(runId: string) {
    send({ type: 'pause_run', runId });
  }

  function resumeRun(runId: string) {
    send({ type: 'resume_run', runId });
  }

  function abortRun(runId: string) {
    send({ type: 'abort_run', runId });
  }

  function resumeFailedRun(runId: string) {
    send({ type: 'resume_failed_run', runId });
  }

  // Event handler setup with state management callbacks
  function setupEventHandlers(callbacks: {
    onRunStarted: (data: {
      runId: string;
      configId: string | null;
      branchName: string;
      agentAProfile: AutopilotProfile;
      agentBProfile: AutopilotProfile;
    }) => void;
    onCycleStarted: (data: { runId: string; cycleNumber: number; phase: string; isTestVerification?: boolean }) => void;
    onCyclePhaseChange: (data: { cycleNumber: number }) => void;
    onAgentADelta: (data: { cycleNumber: number; text: string }) => void;
    onAgentAThinkingStart: (data: { cycleNumber: number }) => void;
    onAgentAThinkingDelta: (data: { cycleNumber: number; text: string }) => void;
    onAgentAThinkingEnd: (data: { cycleNumber: number }) => void;
    onAgentAToolUse: (data: { cycleNumber: number; tool: string; input: Record<string, unknown>; requestId: string }) => void;
    onAgentAComplete: (data: { cycleNumber: number; response: string; tokens: TokenUsage }) => void;
    onAgentBDelta: (data: { cycleNumber: number; text: string }) => void;
    onAgentBThinkingStart: (data: { cycleNumber: number }) => void;
    onAgentBThinkingDelta: (data: { cycleNumber: number; text: string }) => void;
    onAgentBThinkingEnd: (data: { cycleNumber: number }) => void;
    onAgentBToolUse: (data: { cycleNumber: number; tool: string; input: Record<string, unknown>; requestId: string }) => void;
    onAgentBComplete: (data: { cycleNumber: number; response: string; tokens: TokenUsage }) => void;
    onCommitMade: (data: { cycleNumber: number; hash: string; message: string; filesChanged: string[] }) => void;
    onCycleCompleted: (data: { cycleNumber: number; summary: string }) => void;
    onRateLimited: (data: { until: number }) => void;
    onRateLimitCleared: () => void;
    onRunPaused: (data: { reason: string }) => void;
    onRunResumed: () => void;
    onRunCompleted: (data: { totalCycles: number; totalCommits: number; summary: string; reason?: string }) => void;
    onPRCreated: (data: { prUrl: string }) => void;
    onRunFailed: (data: { error: string }) => void;
    onRunAborted: () => void;
    onError: (data: { error: string }) => void;
  }) {
    // Run lifecycle events
    on('run_started', (data: unknown) => callbacks.onRunStarted(data as any));
    on('cycle_started', (data: unknown) => callbacks.onCycleStarted(data as any));
    on('cycle_phase_change', (data: unknown) => callbacks.onCyclePhaseChange(data as any));

    // Agent A events
    on('agent_a_delta', (data: unknown) => callbacks.onAgentADelta(data as any));
    on('agent_a_thinking_start', (data: unknown) => callbacks.onAgentAThinkingStart(data as any));
    on('agent_a_thinking_delta', (data: unknown) => callbacks.onAgentAThinkingDelta(data as any));
    on('agent_a_thinking_end', (data: unknown) => callbacks.onAgentAThinkingEnd(data as any));
    on('agent_a_tool_use', (data: unknown) => callbacks.onAgentAToolUse(data as any));
    on('agent_a_complete', (data: unknown) => callbacks.onAgentAComplete(data as any));

    // Agent B events
    on('agent_b_delta', (data: unknown) => callbacks.onAgentBDelta(data as any));
    on('agent_b_thinking_start', (data: unknown) => callbacks.onAgentBThinkingStart(data as any));
    on('agent_b_thinking_delta', (data: unknown) => callbacks.onAgentBThinkingDelta(data as any));
    on('agent_b_thinking_end', (data: unknown) => callbacks.onAgentBThinkingEnd(data as any));
    on('agent_b_tool_use', (data: unknown) => callbacks.onAgentBToolUse(data as any));
    on('agent_b_complete', (data: unknown) => callbacks.onAgentBComplete(data as any));

    // Commit and cycle completion
    on('commit_made', (data: unknown) => callbacks.onCommitMade(data as any));
    on('cycle_completed', (data: unknown) => callbacks.onCycleCompleted(data as any));

    // Rate limiting
    on('rate_limited', (data: unknown) => callbacks.onRateLimited(data as any));
    on('rate_limit_cleared', () => callbacks.onRateLimitCleared());

    // Run state changes
    on('run_paused', (data: unknown) => callbacks.onRunPaused(data as any));
    on('run_resumed', () => callbacks.onRunResumed());
    on('run_completed', (data: unknown) => callbacks.onRunCompleted(data as any));
    on('pr_created', (data: unknown) => callbacks.onPRCreated(data as any));
    on('run_failed', (data: unknown) => callbacks.onRunFailed(data as any));
    on('run_aborted', () => callbacks.onRunAborted());
    on('error', (data: unknown) => callbacks.onError(data as any));
  }

  return {
    // Connection state
    connected,

    // Connection management
    connect,
    disconnect,
    send,

    // Event handling
    setupEventHandlers,

    // Actions
    startAdhoc,
    startFromConfig,
    pauseRun,
    resumeRun,
    abortRun,
    resumeFailedRun,
  };
}