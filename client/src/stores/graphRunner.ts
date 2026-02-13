import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import type {
  GraphRun, NodeExecution,
  TimelineEntry, TimelineEntryMeta, EdgeFlowState,
  NodeExecStatus,
} from '@/types/graph-runner';

export const useGraphRunnerStore = defineStore('graphRunner', () => {
  // ─── State ──────────────────────────────────────────────────────────
  const currentRun = ref<GraphRun | null>(null);
  const showRunnerPanel = ref(false);
  const selectedNodeId = ref<string | null>(null);
  const activeEdgeFlows = ref<Record<string, EdgeFlowState>>({});

  // ─── Playback State ────────────────────────────────────────────────
  const playbackMode = ref(false);
  const playbackTimeMs = ref(0);
  const playbackPlaying = ref(false);
  const playbackSpeed = ref(1);

  // ─── WebSocket (lives in store so it persists across tab switches) ─
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
    const url = `${protocol}//${host}/ws/graph-runner?token=${auth.token}`;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      wsConnected.value = true;
      reconnectAttempts = 0;
    };

    socket.onclose = () => {
      wsConnected.value = false;
      ws = null;
      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    socket.onerror = () => {
      // onerror is always followed by onclose
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const type = data.type as string;
        const typeHandlers = handlers.get(type);
        if (typeHandlers) {
          typeHandlers.forEach(handler => handler(data));
        }
      } catch {
        // ignore non-JSON
      }
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
    if (!handlers.has(type)) {
      handlers.set(type, new Set());
    }
    handlers.get(type)!.add(handler);
  }

  function wsDisconnect() {
    intentionalClose = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
    wsConnected.value = false;
  }

  // ─── Computed: Playback time bounds ────────────────────────────────
  const isRunning = computed(() => currentRun.value?.status === 'running');

  const runStartMs = computed(() => currentRun.value?.startedAt ?? 0);
  const runEndMs = computed(() => {
    if (!currentRun.value) return 0;
    return currentRun.value.completedAt ?? Date.now();
  });
  const runDurationMs = computed(() => Math.max(1, runEndMs.value - runStartMs.value));
  const playbackRatio = computed(() => {
    if (!playbackMode.value || runDurationMs.value <= 1) return 1;
    return Math.max(0, Math.min(1, (playbackTimeMs.value - runStartMs.value) / runDurationMs.value));
  });

  // ─── Computed: Playback-aware timeline ────────────────────────────
  const effectiveTimeline = computed<TimelineEntry[]>(() => {
    if (!currentRun.value) return [];
    const all = currentRun.value.timeline;
    if (!playbackMode.value) return all;
    return all.filter(e => e.timestamp <= playbackTimeMs.value);
  });

  // Use a version counter to force reactivity on execution status changes
  const execVersion = ref(0);

  /** Derive node status from timeline events (playback-aware) */
  function nodeStatusFromTimeline(nodeId: string): NodeExecStatus | null {
    const entries = effectiveTimeline.value;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.nodeId !== nodeId) continue;
      if (e.type === 'node_complete' || e.type === 'node_skipped') return 'completed';
      if (e.type === 'node_failed') return 'failed';
      if (e.type === 'node_start') return 'running';
      if (e.type === 'node_delegated') return 'delegated';
    }
    return null;
  }

  const activeNodeIds = computed(() => {
    execVersion.value; // track
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    if (playbackMode.value) {
      for (const [id] of Object.entries(currentRun.value.executions)) {
        if (nodeStatusFromTimeline(id) === 'running') ids.add(id);
      }
    } else {
      for (const [id, exec] of Object.entries(currentRun.value.executions)) {
        if (exec.status === 'running') ids.add(id);
      }
    }
    return ids;
  });

  const completedNodeIds = computed(() => {
    execVersion.value; // track
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    if (playbackMode.value) {
      for (const [id] of Object.entries(currentRun.value.executions)) {
        if (nodeStatusFromTimeline(id) === 'completed') ids.add(id);
      }
    } else {
      for (const [id, exec] of Object.entries(currentRun.value.executions)) {
        if (exec.status === 'completed') ids.add(id);
      }
    }
    return ids;
  });

  const failedNodeIds = computed(() => {
    execVersion.value; // track
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    if (playbackMode.value) {
      for (const [id] of Object.entries(currentRun.value.executions)) {
        if (nodeStatusFromTimeline(id) === 'failed') ids.add(id);
      }
    } else {
      for (const [id, exec] of Object.entries(currentRun.value.executions)) {
        if (exec.status === 'failed') ids.add(id);
      }
    }
    return ids;
  });

  const delegatedNodeIds = computed(() => {
    execVersion.value; // track
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    if (playbackMode.value) {
      for (const [id] of Object.entries(currentRun.value.executions)) {
        if (nodeStatusFromTimeline(id) === 'delegated') ids.add(id);
      }
    } else {
      for (const [id, exec] of Object.entries(currentRun.value.executions)) {
        if (exec.status === 'delegated') ids.add(id);
      }
    }
    return ids;
  });

  /** Get the execution status for a specific node (reactive-friendly, playback-aware) */
  function nodeExecStatus(nodeId: string): 'running' | 'completed' | 'failed' | 'delegated' | null {
    execVersion.value; // track
    if (!currentRun.value) return null;
    if (playbackMode.value) {
      const s = nodeStatusFromTimeline(nodeId);
      return s === 'pending' ? null : s;
    }
    const exec = currentRun.value.executions[nodeId];
    if (!exec) return null;
    return exec.status === 'running' ? 'running'
      : exec.status === 'completed' ? 'completed'
      : exec.status === 'failed' ? 'failed'
      : exec.status === 'delegated' ? 'delegated'
      : null;
  }

  const timeline = computed(() => currentRun.value?.timeline ?? []);

  const selectedExecution = computed(() => {
    if (!selectedNodeId.value || !currentRun.value) return null;
    return currentRun.value.executions[selectedNodeId.value] ?? null;
  });

  // ─── Computed: Playback-aware edge flows ──────────────────────────
  const EDGE_FLOW_WINDOW = 1500;

  const effectiveEdgeFlows = computed<Record<string, EdgeFlowState>>(() => {
    if (!playbackMode.value) return activeEdgeFlows.value;
    const flows: Record<string, EdgeFlowState> = {};
    for (const entry of effectiveTimeline.value) {
      if (entry.type === 'delegation' && entry.meta?.parentNodeId && entry.meta?.childNodeId) {
        const edgeId = `e-${entry.meta.parentNodeId}-${entry.meta.childNodeId}`;
        if (playbackTimeMs.value - entry.timestamp < EDGE_FLOW_WINDOW && playbackTimeMs.value >= entry.timestamp) {
          flows[edgeId] = { direction: 'forward', type: 'delegation', startedAt: entry.timestamp };
        }
      }
      if (entry.type === 'result_return' && entry.meta?.parentNodeId && entry.meta?.childNodeId) {
        const edgeId = `e-${entry.meta.parentNodeId}-${entry.meta.childNodeId}`;
        if (playbackTimeMs.value - entry.timestamp < EDGE_FLOW_WINDOW && playbackTimeMs.value >= entry.timestamp) {
          flows[edgeId] = { direction: 'reverse', type: 'result_return', startedAt: entry.timestamp };
        }
      }
    }
    return flows;
  });

  // ─── Actions: Initialize Run ───────────────────────────────────────

  function onRunStarted(data: { runId: string; rootNodeId: string }) {
    // Exit playback mode on new run
    playbackMode.value = false;
    playbackPlaying.value = false;

    currentRun.value = {
      runId: data.runId,
      graphId: null,
      status: 'running',
      rootNodeId: data.rootNodeId,
      executions: {},
      timeline: [],
      startedAt: Date.now(),
      completedAt: null,
      finalOutput: null,
    };
    showRunnerPanel.value = true;
  }

  // ─── Actions: Node Events ─────────────────────────────────────────

  function onNodeStarted(data: {
    nodeId: string;
    nodeLabel: string;
    nodeType: string;
    inputPrompt: string;
    parentNodeId: string | null;
  }) {
    if (!currentRun.value) return;

    // Transition from delegated → running (lazy activation)
    const existing = currentRun.value.executions[data.nodeId];
    if (existing && existing.status === 'delegated') {
      existing.status = 'running';
      existing.inputPrompt = data.inputPrompt || existing.inputPrompt;
      existing.startedAt = Date.now();
      execVersion.value++;
      addTimeline('node_start', data.nodeId, data.nodeLabel, `Activated (producing output)`);
      return;
    }

    const exec: NodeExecution = {
      nodeId: data.nodeId,
      nodeLabel: data.nodeLabel,
      nodeType: data.nodeType,
      status: 'running',
      inputPrompt: data.inputPrompt,
      outputText: '',
      thinkingText: '',
      isThinking: false,
      toolCalls: [],
      childExecutionIds: [],
      parentExecutionId: data.parentNodeId,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    };

    currentRun.value.executions[data.nodeId] = exec;
    execVersion.value++;

    // Track parent->child relationship
    if (data.parentNodeId) {
      const parentExec = currentRun.value.executions[data.parentNodeId];
      if (parentExec) parentExec.childExecutionIds.push(data.nodeId);
    }

    addTimeline('node_start', data.nodeId, data.nodeLabel, `Started execution`);
  }

  function onNodeDelegated(data: {
    nodeId: string;
    nodeLabel: string;
    nodeType: string;
    parentNodeId: string;
    inputPrompt: string;
  }) {
    if (!currentRun.value) return;

    // Only create if not already existing (prevents overwriting an already-active node)
    if (!currentRun.value.executions[data.nodeId]) {
      const exec: NodeExecution = {
        nodeId: data.nodeId,
        nodeLabel: data.nodeLabel,
        nodeType: data.nodeType,
        status: 'delegated',
        inputPrompt: data.inputPrompt,
        outputText: '',
        thinkingText: '',
        isThinking: false,
        toolCalls: [],
        childExecutionIds: [],
        parentExecutionId: data.parentNodeId,
        startedAt: Date.now(),
        completedAt: null,
        error: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      currentRun.value.executions[data.nodeId] = exec;
      execVersion.value++;
    }

    // Track parent->child relationship
    if (data.parentNodeId) {
      const parentExec = currentRun.value.executions[data.parentNodeId];
      if (parentExec && !parentExec.childExecutionIds.includes(data.nodeId)) {
        parentExec.childExecutionIds.push(data.nodeId);
      }
    }

    addTimeline('node_delegated', data.nodeId, data.nodeLabel, `Delegated (waiting for activation)`);
  }

  function onNodeSkipped(data: { nodeId: string; reason: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec && exec.status === 'delegated') {
      exec.status = 'completed';
      exec.completedAt = Date.now();
      execVersion.value++;
    }
    addTimeline('node_skipped', data.nodeId, exec?.nodeLabel ?? data.nodeId, `Skipped: ${data.reason}`);
  }

  function onNodeDelta(data: { nodeId: string; text: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.outputText += data.text;
    }
  }

  function onNodeThinkingStart(data: { nodeId: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.isThinking = true;
    }
  }

  function onNodeThinkingDelta(data: { nodeId: string; text: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.thinkingText += data.text;
    }
  }

  function onNodeThinkingEnd(data: { nodeId: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.isThinking = false;
    }
  }

  function onNodeToolUse(data: { nodeId: string; tool: string; input: Record<string, unknown>; requestId: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.toolCalls.push({
        tool: data.tool,
        input: data.input,
        requestId: data.requestId,
        status: 'running',
      });
    }
    addTimeline('tool_use', data.nodeId, exec?.nodeLabel ?? data.nodeId, `Tool: ${data.tool}`);
  }

  function onNodeCompleted(data: { nodeId: string; outputText: string; usage: { inputTokens: number; outputTokens: number } }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.status = 'completed';
      exec.outputText = data.outputText;
      exec.completedAt = Date.now();
      exec.usage = data.usage;
      execVersion.value++;
      // Mark all running tool calls as completed
      for (const tc of exec.toolCalls) {
        if (tc.status === 'running') tc.status = 'completed';
      }
    }
    addTimeline('node_complete', data.nodeId, exec?.nodeLabel ?? data.nodeId, `Completed`);
  }

  function onNodeFailed(data: { nodeId: string; error: string }) {
    if (!currentRun.value) return;
    const exec = currentRun.value.executions[data.nodeId];
    if (exec) {
      exec.status = 'failed';
      exec.error = data.error;
      exec.completedAt = Date.now();
      execVersion.value++;
    }
    addTimeline('node_failed', data.nodeId, exec?.nodeLabel ?? data.nodeId, `Failed: ${data.error}`);
  }

  // ─── Actions: Delegation Events ───────────────────────────────────

  function onDelegation(data: { parentNodeId: string; childNodeId: string; childLabel: string; task: string }) {
    if (!currentRun.value) return;
    addTimeline('delegation', data.parentNodeId,
      currentRun.value.executions[data.parentNodeId]?.nodeLabel ?? data.parentNodeId,
      `Delegated to ${data.childLabel}: ${data.task.slice(0, 100)}`,
      { parentNodeId: data.parentNodeId, childNodeId: data.childNodeId },
    );

    // Trigger edge flow animation
    const edgeId = `e-${data.parentNodeId}-${data.childNodeId}`;
    const startedAt = Date.now();
    activeEdgeFlows.value[edgeId] = { direction: 'forward', type: 'delegation', startedAt };
    setTimeout(() => {
      if (activeEdgeFlows.value[edgeId]?.startedAt === startedAt) {
        delete activeEdgeFlows.value[edgeId];
      }
    }, 1500);
  }

  function onResultReturn(data: { parentNodeId: string; childNodeId: string; childLabel: string; result: string }) {
    if (!currentRun.value) return;
    addTimeline('result_return', data.childNodeId, data.childLabel,
      `Returned result to parent (${data.result.length} chars)`,
      { parentNodeId: data.parentNodeId, childNodeId: data.childNodeId },
    );

    // Trigger reverse edge flow animation
    const edgeId = `e-${data.parentNodeId}-${data.childNodeId}`;
    const startedAt = Date.now();
    activeEdgeFlows.value[edgeId] = { direction: 'reverse', type: 'result_return', startedAt };
    setTimeout(() => {
      if (activeEdgeFlows.value[edgeId]?.startedAt === startedAt) {
        delete activeEdgeFlows.value[edgeId];
      }
    }, 1500);
  }

  // ─── Actions: Run Completion ──────────────────────────────────────

  function onRunCompleted(data: { runId: string; finalOutput: string }) {
    if (!currentRun.value) return;
    currentRun.value.status = 'completed';
    currentRun.value.completedAt = Date.now();
    currentRun.value.finalOutput = data.finalOutput;
    activeEdgeFlows.value = {};
  }

  function onRunFailed(data: { runId: string; error: string }) {
    if (!currentRun.value) return;
    currentRun.value.status = 'failed';
    currentRun.value.completedAt = Date.now();
    addTimeline('node_failed', '', 'Runner', `Run failed: ${data.error}`);
    activeEdgeFlows.value = {};
  }

  function onRunAborted(_data: { runId: string }) {
    if (!currentRun.value) return;
    currentRun.value.status = 'aborted';
    currentRun.value.completedAt = Date.now();
    activeEdgeFlows.value = {};
  }

  // ─── Actions: Playback Controls ───────────────────────────────────

  function enterPlayback() {
    playbackMode.value = true;
    playbackPlaying.value = false;
    playbackTimeMs.value = runStartMs.value;
    execVersion.value++;
  }

  function exitPlayback() {
    playbackMode.value = false;
    playbackPlaying.value = false;
    execVersion.value++;
  }

  function setPlaybackTime(ms: number) {
    playbackTimeMs.value = Math.max(runStartMs.value, Math.min(ms, runEndMs.value));
    execVersion.value++;
  }

  function setPlaybackRatio(ratio: number) {
    setPlaybackTime(runStartMs.value + ratio * runDurationMs.value);
  }

  function togglePlayPause() {
    if (!playbackMode.value) enterPlayback();
    playbackPlaying.value = !playbackPlaying.value;
  }

  function setPlaybackSpeed(speed: number) {
    playbackSpeed.value = speed;
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  function addTimeline(type: TimelineEntry['type'], nodeId: string, nodeLabel: string, detail: string, meta?: TimelineEntryMeta) {
    if (!currentRun.value) return;
    currentRun.value.timeline.push({
      timestamp: Date.now(),
      type,
      nodeId,
      nodeLabel,
      detail,
      ...(meta ? { meta } : {}),
    });
  }

  function selectExecution(nodeId: string | null) {
    selectedNodeId.value = nodeId;
  }

  function togglePanel() {
    showRunnerPanel.value = !showRunnerPanel.value;
  }

  function reset() {
    currentRun.value = null;
    selectedNodeId.value = null;
    activeEdgeFlows.value = {};
    playbackMode.value = false;
    playbackPlaying.value = false;
    playbackTimeMs.value = 0;
  }

  return {
    // State
    currentRun, showRunnerPanel, selectedNodeId, wsConnected, activeEdgeFlows,
    // Playback state
    playbackMode, playbackTimeMs, playbackPlaying, playbackSpeed,
    // Computed
    isRunning, activeNodeIds, completedNodeIds, failedNodeIds, delegatedNodeIds,
    timeline, selectedExecution,
    runStartMs, runEndMs, runDurationMs, playbackRatio,
    effectiveTimeline, effectiveEdgeFlows,
    // Actions
    onRunStarted, onNodeStarted, onNodeDelegated, onNodeSkipped,
    onNodeDelta, onNodeThinkingStart, onNodeThinkingDelta,
    onNodeThinkingEnd, onNodeToolUse, onNodeCompleted, onNodeFailed,
    onDelegation, onResultReturn, onRunCompleted, onRunFailed, onRunAborted,
    selectExecution, togglePanel, reset, nodeExecStatus,
    // Playback actions
    enterPlayback, exitPlayback, setPlaybackTime, setPlaybackRatio,
    togglePlayPause, setPlaybackSpeed,
    // WebSocket
    wsConnect, wsSend, wsOn, wsDisconnect,
  };
});
