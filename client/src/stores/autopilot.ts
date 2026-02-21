import { defineStore } from 'pinia';
import { useAutopilotState } from '../composables/autopilot/useAutopilotState';
import { useAutopilotConfig } from '../composables/autopilot/useAutopilotConfig';
import { useAutopilotWebSocket } from '../composables/autopilot/useAutopilotWebSocket';
import { useAutopilotActions } from '../composables/autopilot/useAutopilotActions';
import type {
  AutopilotCycle,
  AutopilotToolCall,
} from '@/types/autopilot';

// Re-export types for external consumers
export type {
  AutopilotRun,
  AutopilotCycle,
  AutopilotProfile,
  AutopilotConfig,
  AutopilotRunSummary,
  AutopilotTimelineEntry,
  RunStatus,
  TokenUsage,
} from '@/types/autopilot';

export const useAutopilotStore = defineStore('autopilot', () => {
  // Initialize composables
  const state = useAutopilotState();
  const config = useAutopilotConfig();
  const websocket = useAutopilotWebSocket();
  const actions = useAutopilotActions();

  // Enhanced coordinating functions
  function startAdhoc(opts: {
    goalPrompt: string;
    agentAProfileId: string;
    agentBProfileId: string;
    agentAModel?: string;
    agentBModel?: string;
    agentAProvider?: string;
    agentBProvider?: string;
    cwd: string;
    allowedPaths: string[];
    maxIterations: number;
    runTestVerification?: boolean;
  }) {
    // Reset state
    state.clearState();
    websocket.startAdhoc(opts);
  }

  function startFromConfig(configId: string, cwd: string) {
    state.clearState();
    websocket.startFromConfig(configId, cwd);
  }

  function pause() {
    if (!state.currentRun.value) return;
    websocket.pauseRun(state.currentRun.value.runId);
  }

  function resume() {
    if (!state.currentRun.value) return;
    websocket.resumeRun(state.currentRun.value.runId);
  }

  function abort() {
    if (!state.currentRun.value) return;
    websocket.abortRun(state.currentRun.value.runId);
  }

  function resumeFailedRun(runId: string) {
    // Reset timeline — server will emit run_started and new cycle events
    state.clearTimeline();
    state.setSelectedCycleNumber(null);

    // Keep the loaded run data (cycles, etc.) — server will send new events on top
    if (state.currentRun.value && state.currentRun.value.runId === runId) {
      state.updateRunStatus('running');
    }

    websocket.resumeFailedRun(runId);
  }

  function wsConnect() {
    websocket.connect(state.currentRun.value);
  }

  function loadRun(runId: string) {
    return actions.loadRun(runId, {
      setLoadingRun: (loading: boolean) => { state.isLoadingRun.value = loading; },
      setCurrentRun: state.setCurrentRun,
      clearTimeline: state.clearTimeline,
      addTimeline: state.addTimeline,
      setSelectedCycleNumber: state.setSelectedCycleNumber,
      fetchProfiles: config.fetchProfiles,
      getProfiles: () => config.profiles.value,
      isRunning: () => state.isRunning.value,
    });
  }

  function clearCurrentRun() {
    state.clearState();
  }

  // Setup WebSocket event handlers
  function initEventHandlers() {
    websocket.setupEventHandlers({
      onRunStarted: (data) => {
        state.setCurrentRun({
          runId: data.runId,
          configId: data.configId,
          status: 'running',
          branchName: data.branchName,
          agentAProfile: data.agentAProfile,
          agentBProfile: data.agentBProfile,
          cycles: [],
          currentCycleNumber: 0,
          totalTokens: {
            agentA: { inputTokens: 0, outputTokens: 0 },
            agentB: { inputTokens: 0, outputTokens: 0 },
          },
          totalCommits: 0,
          rateLimitedUntil: null,
          startedAt: Date.now(),
          completedAt: null,
        });
        state.addTimeline('run_started', null, `Run started on branch ${data.branchName}`);
      },

      onCycleStarted: (data) => {
        if (!state.currentRun.value) return;
        state.setCurrentCycleNumber(data.cycleNumber);

        const cycle: AutopilotCycle = {
          cycleNumber: data.cycleNumber,
          status: data.phase === 'agent_b' ? 'agent_b_running' : 'agent_a_running',
          agentA: {
            prompt: '',
            response: '',
            thinking: '',
            isThinking: false,
            toolCalls: [],
            contentBlocks: [],
            tokens: { inputTokens: 0, outputTokens: 0 },
          },
          agentB: {
            prompt: '',
            response: '',
            thinking: '',
            isThinking: false,
            toolCalls: [],
            contentBlocks: [],
            tokens: { inputTokens: 0, outputTokens: 0 },
          },
          commit: null,
          summary: null,
          startedAt: Date.now(),
          completedAt: null,
          isTestVerification: data.isTestVerification || false,
        };
        state.addCycle(cycle);
        const label = data.isTestVerification
          ? 'Test Verification started'
          : `Cycle ${data.cycleNumber + 1} started`;
        state.addTimeline('cycle_started', data.cycleNumber, label);
      },

      onCyclePhaseChange: (data) => {
        state.updateCycleStatus(data.cycleNumber, 'agent_b_running');
      },

      // Agent A events
      onAgentADelta: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (!cycle) return;
        cycle.agentA.response += data.text;
        const blocks = cycle.agentA.contentBlocks;
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          last.text += data.text;
        } else {
          blocks.push({ type: 'text', text: data.text });
        }
      },

      onAgentAThinkingStart: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) cycle.agentA.isThinking = true;
      },

      onAgentAThinkingDelta: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) cycle.agentA.thinking += data.text;
      },

      onAgentAThinkingEnd: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) cycle.agentA.isThinking = false;
      },

      onAgentAToolUse: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (!cycle) return;
        const tc = { tool: data.tool, input: data.input, requestId: data.requestId };
        cycle.agentA.toolCalls.push(tc);
        cycle.agentA.contentBlocks.push({ type: 'tool', toolCall: tc });
      },

      onAgentAComplete: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) {
          cycle.agentA.response = data.response;
          cycle.agentA.tokens = data.tokens;
        }
        state.updateRunTokens('agentA', data.tokens);
        const cycleForA = state.getCycle(data.cycleNumber);
        const toolCountA = cycleForA?.agentA.toolCalls.length || 0;
        const toolsA = toolCountA > 0 ? ` (${toolCountA} tool${toolCountA > 1 ? 's' : ''})` : '';
        const snippetA = data.response.slice(0, 80).replace(/\n/g, ' ').trim();
        state.addTimeline('agent_a_complete', data.cycleNumber, `Agent A finished${toolsA}: ${snippetA}${data.response.length > 80 ? '...' : ''}`);
      },

      // Agent B events
      onAgentBDelta: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (!cycle) return;
        cycle.agentB.response += data.text;
        const blocks = cycle.agentB.contentBlocks;
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          last.text += data.text;
        } else {
          blocks.push({ type: 'text', text: data.text });
        }
      },

      onAgentBThinkingStart: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) cycle.agentB.isThinking = true;
      },

      onAgentBThinkingDelta: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) cycle.agentB.thinking += data.text;
      },

      onAgentBThinkingEnd: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) cycle.agentB.isThinking = false;
      },

      onAgentBToolUse: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (!cycle) return;
        const tc = { tool: data.tool, input: data.input, requestId: data.requestId };
        cycle.agentB.toolCalls.push(tc);
        cycle.agentB.contentBlocks.push({ type: 'tool', toolCall: tc });
      },

      onAgentBComplete: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) {
          cycle.agentB.response = data.response;
          cycle.agentB.tokens = data.tokens;
        }
        state.updateRunTokens('agentB', data.tokens);
        const cycleForB = state.getCycle(data.cycleNumber);
        const toolCountB = cycleForB?.agentB.toolCalls.length || 0;
        const toolsB = toolCountB > 0 ? ` (${toolCountB} tool${toolCountB > 1 ? 's' : ''})` : '';
        const snippetB = data.response.slice(0, 80).replace(/\n/g, ' ').trim();
        state.addTimeline('agent_b_complete', data.cycleNumber, `Agent B finished${toolsB}: ${snippetB}${data.response.length > 80 ? '...' : ''}`);
      },

      onCommitMade: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) {
          cycle.commit = { hash: data.hash, message: data.message, filesChanged: data.filesChanged };
          cycle.status = 'committed';
        }
        state.incrementCommitCount();
        state.addTimeline('commit_made', data.cycleNumber, `Commit: ${data.message}`, { hash: data.hash });
      },

      onCycleCompleted: (data) => {
        const cycle = state.getCycle(data.cycleNumber);
        if (cycle) {
          if (cycle.status !== 'committed') cycle.status = 'completed';
          cycle.completedAt = Date.now();
          cycle.summary = data.summary;
        }
        state.addTimeline('cycle_completed', data.cycleNumber, data.summary);
      },

      onRateLimited: (data) => {
        state.updateRunStatus('rate_limited');
        state.setRateLimitedUntil(data.until);
        state.addTimeline('rate_limited', null, `Rate limited until ${new Date(data.until).toLocaleTimeString()}`);
      },

      onRateLimitCleared: () => {
        state.updateRunStatus('running');
        state.setRateLimitedUntil(null);
        state.addTimeline('rate_limit_cleared', null, 'Rate limit cleared, resuming');
      },

      onRunPaused: (data) => {
        state.updateRunStatus('paused');
        state.addTimeline('run_paused', null, data.reason);
      },

      onRunResumed: () => {
        state.updateRunStatus('running');
        state.addTimeline('run_resumed', null, 'Run resumed');
      },

      onRunCompleted: (data) => {
        state.updateRunStatus(data.reason === 'schedule_timeout' ? 'schedule_timeout' : 'completed');
        state.setRunCompleted();
        const timelineType = data.reason === 'schedule_timeout' ? 'schedule_timeout' as const : 'run_completed' as const;
        state.addTimeline(timelineType, null, data.summary);
      },

      onPRCreated: (data) => {
        state.addTimeline('pr_created', null, `PR created: ${data.prUrl}`, { prUrl: data.prUrl });
      },

      onRunFailed: (data) => {
        state.updateRunStatus('failed');
        state.setRunCompleted();
        state.addTimeline('run_failed', null, `Failed: ${data.error}`);
      },

      onRunAborted: () => {
        state.updateRunStatus('aborted');
        state.setRunCompleted();
        state.addTimeline('run_failed', null, 'Run aborted');
      },

      onError: (data) => {
        console.error('[Autopilot WS Error]', data.error);
      },
    });
  }

  return {
    // State composable
    ...state,

    // Config composable
    ...config,

    // WebSocket composable (only the connection status, actions are wrapped above)
    wsConnected: websocket.connected,

    // Enhanced coordinating functions
    wsConnect,
    wsDisconnect: websocket.disconnect,
    wsSend: websocket.send,
    initEventHandlers,
    startAdhoc,
    startFromConfig,
    pause,
    resume,
    abort,
    resumeFailedRun,
    loadRun,
    clearCurrentRun,
  };
});
