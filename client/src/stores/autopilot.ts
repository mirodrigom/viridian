import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import type {
  AutopilotRun,
  AutopilotCycle,
  AutopilotProfile,
  AutopilotConfig,
  AutopilotRunSummary,
  AutopilotTimelineEntry,
  AutopilotToolCall,
  RunStatus,
  TokenUsage,
} from '@/types/autopilot';

export const useAutopilotStore = defineStore('autopilot', () => {
  // ─── State ──────────────────────────────────────────────────────────
  const currentRun = ref<AutopilotRun | null>(null);
  const selectedCycleNumber = ref<number | null>(null);
  const timeline = ref<AutopilotTimelineEntry[]>([]);

  // Config / profiles / run history (loaded from REST API)
  const configs = ref<AutopilotConfig[]>([]);
  const profiles = ref<AutopilotProfile[]>([]);
  const runs = ref<AutopilotRunSummary[]>([]);
  const isLoadingRun = ref(false);

  // ─── WebSocket (persists across tab switches) ─────────────────────
  let ws: WebSocket | null = null;
  const wsConnected = ref(false);
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let intentionalClose = false;

  const MAX_RECONNECT_DELAY = 10_000;
  const BASE_RECONNECT_DELAY = 500;

  function wsConnect() {
    if (ws) {
      intentionalClose = true;
      ws.close();
      ws = null;
    }
    intentionalClose = false;

    const auth = useAuthStore();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/autopilot?token=${auth.token}`;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      wsConnected.value = true;
      reconnectAttempts = 0;

      // Re-wire to active run after reconnect so events (e.g. Agent B deltas) keep flowing
      if (currentRun.value && ['running', 'paused', 'rate_limited'].includes(currentRun.value.status)) {
        socket.send(JSON.stringify({ type: 'get_run_state', runId: currentRun.value.runId }));
      }
    };

    socket.onclose = () => {
      wsConnected.value = false;
      ws = null;
      if (!intentionalClose) scheduleReconnect();
    };

    socket.onerror = () => {};

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as string;
        const typeHandlers = handlers.get(type);
        if (typeHandlers) {
          typeHandlers.forEach((handler) => handler(data));
        }
      } catch { /* ignore */ }
    };

    ws = socket;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      wsConnect();
    }, delay);
  }

  function wsSend(data: Record<string, unknown>): boolean {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function wsOn(type: string, handler: (data: unknown) => void) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(handler);
  }

  function wsDisconnect() {
    intentionalClose = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    wsConnected.value = false;
  }

  // ─── Computed ─────────────────────────────────────────────────────
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

  // ─── Actions: Start / Pause / Resume / Abort ─────────────────────

  function startAdhoc(opts: {
    goalPrompt: string;
    agentAProfileId: string;
    agentBProfileId: string;
    agentAModel?: string;
    agentBModel?: string;
    cwd: string;
    allowedPaths: string[];
    maxIterations: number;
  }) {
    // Reset state
    currentRun.value = null;
    timeline.value = [];
    selectedCycleNumber.value = null;

    wsSend({
      type: 'start_adhoc',
      ...opts,
    });
  }

  function startFromConfig(configId: string, cwd: string) {
    currentRun.value = null;
    timeline.value = [];
    selectedCycleNumber.value = null;

    wsSend({
      type: 'start_run',
      configId,
      cwd,
    });
  }

  function pause() {
    if (!currentRun.value) return;
    wsSend({ type: 'pause_run', runId: currentRun.value.runId });
  }

  function resume() {
    if (!currentRun.value) return;
    wsSend({ type: 'resume_run', runId: currentRun.value.runId });
  }

  function abort() {
    if (!currentRun.value) return;
    wsSend({ type: 'abort_run', runId: currentRun.value.runId });
  }

  /** Resume a failed/aborted run from where it left off */
  function resumeFailedRun(runId: string) {
    // Reset timeline — server will emit run_started and new cycle events
    timeline.value = [];
    selectedCycleNumber.value = null;

    // Keep the loaded run data (cycles, etc.) — server will send new events on top
    if (currentRun.value && currentRun.value.runId === runId) {
      currentRun.value.status = 'running';
    }

    wsSend({ type: 'resume_failed_run', runId });
  }

  // ─── Actions: REST API ────────────────────────────────────────────

  const auth = useAuthStore();

  async function fetchProfiles() {
    const res = await fetch('/api/autopilot/profiles', {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      profiles.value = data.profiles;
    }
  }

  async function fetchConfigs(project: string) {
    const res = await fetch(`/api/autopilot/configs?project=${encodeURIComponent(project)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      configs.value = data.configs;
    }
  }

  async function fetchRuns(project?: string) {
    const url = project
      ? `/api/autopilot/runs?project=${encodeURIComponent(project)}&limit=20`
      : '/api/autopilot/runs?limit=20';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (res.ok) {
      return (await res.json()).runs;
    }
    return [];
  }

  async function fetchRunHistory(project?: string) {
    const url = project
      ? `/api/autopilot/runs?project=${encodeURIComponent(project)}&limit=50`
      : '/api/autopilot/runs?limit=50';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (res.ok) {
      runs.value = (await res.json()).runs as AutopilotRunSummary[];
    }
  }

  async function loadRun(runId: string) {
    if (isRunning.value) return; // Don't switch while running
    isLoadingRun.value = true;
    try {
      // Fetch run metadata + cycles in parallel
      const [runRes, cyclesRes] = await Promise.all([
        fetch(`/api/autopilot/runs/${runId}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        }),
        fetch(`/api/autopilot/runs/${runId}/cycles`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        }),
      ]);

      if (!runRes.ok || !cyclesRes.ok) return;

      const runData = await runRes.json();
      const cyclesData = await cyclesRes.json();

      // Find profiles
      if (profiles.value.length === 0) await fetchProfiles();
      const agentAProfile = profiles.value.find(p => p.id === runData.agentAProfileId)
        || { id: runData.agentAProfileId || 'unknown', name: 'Agent A', role: 'custom' as const, description: '', systemPrompt: '', allowedTools: [], disallowedTools: [], model: null, isBuiltin: false };
      const agentBProfile = profiles.value.find(p => p.id === runData.agentBProfileId)
        || { id: runData.agentBProfileId || 'unknown', name: 'Agent B', role: 'custom' as const, description: '', systemPrompt: '', allowedTools: [], disallowedTools: [], model: null, isBuiltin: false };

      // Reconstruct cycles
      const cycles: AutopilotCycle[] = (cyclesData.cycles || []).map((c: Record<string, unknown>) => ({
        cycleNumber: c.cycleNumber as number,
        status: (c.status as string) || 'completed',
        agentA: {
          prompt: (c as { agentA?: { prompt?: string } }).agentA?.prompt || '',
          response: (c as { agentA?: { response?: string } }).agentA?.response || '',
          thinking: '',
          isThinking: false,
          toolCalls: [],
          tokens: (c as { agentA?: { tokens?: TokenUsage } }).agentA?.tokens || { inputTokens: 0, outputTokens: 0 },
        },
        agentB: {
          prompt: (c as { agentB?: { prompt?: string } }).agentB?.prompt || '',
          response: (c as { agentB?: { response?: string } }).agentB?.response || '',
          thinking: '',
          isThinking: false,
          toolCalls: [],
          tokens: (c as { agentB?: { tokens?: TokenUsage } }).agentB?.tokens || { inputTokens: 0, outputTokens: 0 },
        },
        commit: (c as { commit?: { hash: string; message: string; filesChanged: string[] } }).commit || null,
        summary: null,
        startedAt: c.startedAt ? new Date(c.startedAt as string).getTime() : null,
        completedAt: c.completedAt ? new Date(c.completedAt as string).getTime() : null,
      }));

      // Reconstruct currentRun
      currentRun.value = {
        runId: runData.id,
        configId: runData.configId,
        status: runData.status as RunStatus,
        branchName: runData.branchName || '',
        agentAProfile,
        agentBProfile,
        cycles,
        currentCycleNumber: cycles.length > 0 ? cycles[cycles.length - 1].cycleNumber : 0,
        totalTokens: runData.tokens || {
          agentA: { inputTokens: 0, outputTokens: 0 },
          agentB: { inputTokens: 0, outputTokens: 0 },
        },
        totalCommits: runData.commitCount || 0,
        rateLimitedUntil: null,
        startedAt: runData.startedAt ? new Date(runData.startedAt).getTime() : null,
        completedAt: runData.completedAt ? new Date(runData.completedAt).getTime() : null,
      };

      // Reconstruct timeline from cycles
      timeline.value = [];
      addTimeline('run_started', null, `Run started on branch ${runData.branchName || 'unknown'}`);
      for (const cycle of cycles) {
        addTimeline('cycle_started', cycle.cycleNumber, `Cycle ${cycle.cycleNumber + 1} started`);
        if (cycle.agentA.response) {
          const snippetA = cycle.agentA.response.slice(0, 80).replace(/\n/g, ' ').trim();
          addTimeline('agent_a_complete', cycle.cycleNumber, `Agent A finished: ${snippetA}${cycle.agentA.response.length > 80 ? '...' : ''}`);
        }
        if (cycle.agentB.response) {
          const snippetB = cycle.agentB.response.slice(0, 80).replace(/\n/g, ' ').trim();
          addTimeline('agent_b_complete', cycle.cycleNumber, `Agent B finished: ${snippetB}${cycle.agentB.response.length > 80 ? '...' : ''}`);
        }
        if (cycle.commit) {
          addTimeline('commit_made', cycle.cycleNumber, `Commit: ${cycle.commit.message}`, { hash: cycle.commit.hash });
        }
      }
      if (runData.status === 'completed') {
        addTimeline('run_completed', null, 'Run completed');
      } else if (runData.status === 'failed') {
        addTimeline('run_failed', null, `Failed: ${runData.error || 'Unknown error'}`);
      }

      selectedCycleNumber.value = null;
    } finally {
      isLoadingRun.value = false;
    }
  }

  function clearCurrentRun() {
    currentRun.value = null;
    timeline.value = [];
    selectedCycleNumber.value = null;
  }

  // ─── Event Handlers ───────────────────────────────────────────────

  function initEventHandlers() {
    wsOn('run_started', (data: unknown) => {
      const d = data as {
        runId: string;
        configId: string | null;
        branchName: string;
        agentAProfile: AutopilotProfile;
        agentBProfile: AutopilotProfile;
      };
      currentRun.value = {
        runId: d.runId,
        configId: d.configId,
        status: 'running',
        branchName: d.branchName,
        agentAProfile: d.agentAProfile,
        agentBProfile: d.agentBProfile,
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
      };
      addTimeline('run_started', null, `Run started on branch ${d.branchName}`);
    });

    wsOn('cycle_started', (data: unknown) => {
      const d = data as { runId: string; cycleNumber: number; phase: string };
      if (!currentRun.value) return;
      currentRun.value.currentCycleNumber = d.cycleNumber;

      const cycle: AutopilotCycle = {
        cycleNumber: d.cycleNumber,
        status: 'agent_a_running',
        agentA: {
          prompt: '',
          response: '',
          thinking: '',
          isThinking: false,
          toolCalls: [],
          tokens: { inputTokens: 0, outputTokens: 0 },
        },
        agentB: {
          prompt: '',
          response: '',
          thinking: '',
          isThinking: false,
          toolCalls: [],
          tokens: { inputTokens: 0, outputTokens: 0 },
        },
        commit: null,
        summary: null,
        startedAt: Date.now(),
        completedAt: null,
      };
      currentRun.value.cycles.push(cycle);
      addTimeline('cycle_started', d.cycleNumber, `Cycle ${d.cycleNumber + 1} started`);
    });

    wsOn('cycle_phase_change', (data: unknown) => {
      const d = data as { cycleNumber: number };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.status = 'agent_b_running';
    });

    // Agent A events
    wsOn('agent_a_delta', (data: unknown) => {
      const d = data as { cycleNumber: number; text: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentA.response += d.text;
    });

    wsOn('agent_a_thinking_start', (data: unknown) => {
      const d = data as { cycleNumber: number };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentA.isThinking = true;
    });

    wsOn('agent_a_thinking_delta', (data: unknown) => {
      const d = data as { cycleNumber: number; text: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentA.thinking += d.text;
    });

    wsOn('agent_a_thinking_end', (data: unknown) => {
      const d = data as { cycleNumber: number };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentA.isThinking = false;
    });

    wsOn('agent_a_tool_use', (data: unknown) => {
      const d = data as { cycleNumber: number; tool: string; input: Record<string, unknown>; requestId: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentA.toolCalls.push({ tool: d.tool, input: d.input, requestId: d.requestId });
    });

    wsOn('agent_a_complete', (data: unknown) => {
      const d = data as { cycleNumber: number; response: string; tokens: TokenUsage };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) {
        cycle.agentA.response = d.response;
        cycle.agentA.tokens = d.tokens;
      }
      if (currentRun.value) {
        currentRun.value.totalTokens.agentA.inputTokens += d.tokens.inputTokens;
        currentRun.value.totalTokens.agentA.outputTokens += d.tokens.outputTokens;
      }
      const cycleForA = getCycle(d.cycleNumber);
      const toolCountA = cycleForA?.agentA.toolCalls.length || 0;
      const toolsA = toolCountA > 0 ? ` (${toolCountA} tool${toolCountA > 1 ? 's' : ''})` : '';
      const snippetA = d.response.slice(0, 80).replace(/\n/g, ' ').trim();
      addTimeline('agent_a_complete', d.cycleNumber, `Agent A finished${toolsA}: ${snippetA}${d.response.length > 80 ? '...' : ''}`);
    });

    // Agent B events
    wsOn('agent_b_delta', (data: unknown) => {
      const d = data as { cycleNumber: number; text: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentB.response += d.text;
    });

    wsOn('agent_b_thinking_start', (data: unknown) => {
      const d = data as { cycleNumber: number };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentB.isThinking = true;
    });

    wsOn('agent_b_thinking_delta', (data: unknown) => {
      const d = data as { cycleNumber: number; text: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentB.thinking += d.text;
    });

    wsOn('agent_b_thinking_end', (data: unknown) => {
      const d = data as { cycleNumber: number };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentB.isThinking = false;
    });

    wsOn('agent_b_tool_use', (data: unknown) => {
      const d = data as { cycleNumber: number; tool: string; input: Record<string, unknown>; requestId: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) cycle.agentB.toolCalls.push({ tool: d.tool, input: d.input, requestId: d.requestId });
    });

    wsOn('agent_b_complete', (data: unknown) => {
      const d = data as { cycleNumber: number; response: string; tokens: TokenUsage };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) {
        cycle.agentB.response = d.response;
        cycle.agentB.tokens = d.tokens;
      }
      if (currentRun.value) {
        currentRun.value.totalTokens.agentB.inputTokens += d.tokens.inputTokens;
        currentRun.value.totalTokens.agentB.outputTokens += d.tokens.outputTokens;
      }
      const cycleForB = getCycle(d.cycleNumber);
      const toolCountB = cycleForB?.agentB.toolCalls.length || 0;
      const toolsB = toolCountB > 0 ? ` (${toolCountB} tool${toolCountB > 1 ? 's' : ''})` : '';
      const snippetB = d.response.slice(0, 80).replace(/\n/g, ' ').trim();
      addTimeline('agent_b_complete', d.cycleNumber, `Agent B finished${toolsB}: ${snippetB}${d.response.length > 80 ? '...' : ''}`);
    });

    // Commit
    wsOn('commit_made', (data: unknown) => {
      const d = data as { cycleNumber: number; hash: string; message: string; filesChanged: string[] };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) {
        cycle.commit = { hash: d.hash, message: d.message, filesChanged: d.filesChanged };
        cycle.status = 'committed';
      }
      if (currentRun.value) currentRun.value.totalCommits++;
      addTimeline('commit_made', d.cycleNumber, `Commit: ${d.message}`, { hash: d.hash });
    });

    // Cycle completed
    wsOn('cycle_completed', (data: unknown) => {
      const d = data as { cycleNumber: number; summary: string };
      const cycle = getCycle(d.cycleNumber);
      if (cycle) {
        if (cycle.status !== 'committed') cycle.status = 'completed';
        cycle.completedAt = Date.now();
        cycle.summary = d.summary;
      }
      addTimeline('cycle_completed', d.cycleNumber, d.summary);
    });

    // Rate limiting
    wsOn('rate_limited', (data: unknown) => {
      const d = data as { until: number };
      if (currentRun.value) {
        currentRun.value.status = 'rate_limited';
        currentRun.value.rateLimitedUntil = d.until;
      }
      addTimeline('rate_limited', null, `Rate limited until ${new Date(d.until).toLocaleTimeString()}`);
    });

    wsOn('rate_limit_cleared', () => {
      if (currentRun.value) {
        currentRun.value.status = 'running';
        currentRun.value.rateLimitedUntil = null;
      }
      addTimeline('rate_limit_cleared', null, 'Rate limit cleared, resuming');
    });

    // Run lifecycle
    wsOn('run_paused', (data: unknown) => {
      const d = data as { reason: string };
      if (currentRun.value) currentRun.value.status = 'paused';
      addTimeline('run_paused', null, d.reason);
    });

    wsOn('run_resumed', () => {
      if (currentRun.value) currentRun.value.status = 'running';
      addTimeline('run_resumed', null, 'Run resumed');
    });

    wsOn('run_completed', (data: unknown) => {
      const d = data as { totalCycles: number; totalCommits: number; summary: string };
      if (currentRun.value) {
        currentRun.value.status = 'completed';
        currentRun.value.completedAt = Date.now();
      }
      addTimeline('run_completed', null, d.summary);
    });

    wsOn('pr_created', (data: unknown) => {
      const d = data as { prUrl: string };
      addTimeline('pr_created', null, `PR created: ${d.prUrl}`, { prUrl: d.prUrl });
    });

    wsOn('run_failed', (data: unknown) => {
      const d = data as { error: string };
      if (currentRun.value) {
        currentRun.value.status = 'failed';
        currentRun.value.completedAt = Date.now();
      }
      addTimeline('run_failed', null, `Failed: ${d.error}`);
    });

    wsOn('run_aborted', () => {
      if (currentRun.value) {
        currentRun.value.status = 'aborted';
        currentRun.value.completedAt = Date.now();
      }
      addTimeline('run_failed', null, 'Run aborted');
    });

    wsOn('error', (data: unknown) => {
      const d = data as { error: string };
      console.error('[Autopilot WS Error]', d.error);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  function getCycle(cycleNumber: number): AutopilotCycle | null {
    if (!currentRun.value) return null;
    return currentRun.value.cycles.find((c) => c.cycleNumber === cycleNumber) || null;
  }

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

  return {
    // State
    currentRun,
    selectedCycleNumber,
    timeline,
    configs,
    profiles,
    runs,
    isLoadingRun,
    wsConnected,

    // Computed
    isRunning,
    isPaused,
    currentCycle,
    totalTokensUsed,
    selectedCycle,

    // WS management
    wsConnect,
    wsDisconnect,
    wsSend,
    initEventHandlers,

    // Actions
    startAdhoc,
    startFromConfig,
    pause,
    resume,
    abort,
    resumeFailedRun,
    fetchProfiles,
    fetchConfigs,
    fetchRuns,
    fetchRunHistory,
    loadRun,
    clearCurrentRun,
  };
});
