import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  GraphRun, NodeExecution,
  TimelineEntry,
} from '@/types/graph-runner';

export const useGraphRunnerStore = defineStore('graphRunner', () => {
  // ─── State ──────────────────────────────────────────────────────────
  const currentRun = ref<GraphRun | null>(null);
  const showRunnerPanel = ref(false);
  const selectedNodeId = ref<string | null>(null);

  // ─── Computed ───────────────────────────────────────────────────────
  const isRunning = computed(() => currentRun.value?.status === 'running');

  const activeNodeIds = computed(() => {
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    for (const [id, exec] of Object.entries(currentRun.value.executions)) {
      if (exec.status === 'running') ids.add(id);
    }
    return ids;
  });

  const completedNodeIds = computed(() => {
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    for (const [id, exec] of Object.entries(currentRun.value.executions)) {
      if (exec.status === 'completed') ids.add(id);
    }
    return ids;
  });

  const failedNodeIds = computed(() => {
    if (!currentRun.value) return new Set<string>();
    const ids = new Set<string>();
    for (const [id, exec] of Object.entries(currentRun.value.executions)) {
      if (exec.status === 'failed') ids.add(id);
    }
    return ids;
  });

  const timeline = computed(() => currentRun.value?.timeline ?? []);

  const selectedExecution = computed(() => {
    if (!selectedNodeId.value || !currentRun.value) return null;
    return currentRun.value.executions[selectedNodeId.value] ?? null;
  });

  // ─── Actions: Initialize Run ───────────────────────────────────────

  function onRunStarted(data: { runId: string; rootNodeId: string }) {
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

    // Track parent→child relationship
    if (data.parentNodeId) {
      const parentExec = currentRun.value.executions[data.parentNodeId];
      if (parentExec) parentExec.childExecutionIds.push(data.nodeId);
    }

    addTimeline('node_start', data.nodeId, data.nodeLabel, `Started execution`);
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
    }
    addTimeline('node_failed', data.nodeId, exec?.nodeLabel ?? data.nodeId, `Failed: ${data.error}`);
  }

  // ─── Actions: Delegation Events ───────────────────────────────────

  function onDelegation(data: { parentNodeId: string; childNodeId: string; childLabel: string; task: string }) {
    if (!currentRun.value) return;
    addTimeline('delegation', data.parentNodeId,
      currentRun.value.executions[data.parentNodeId]?.nodeLabel ?? data.parentNodeId,
      `Delegated to ${data.childLabel}: ${data.task.slice(0, 100)}`,
    );
  }

  function onResultReturn(data: { parentNodeId: string; childNodeId: string; childLabel: string; result: string }) {
    if (!currentRun.value) return;
    addTimeline('result_return', data.childNodeId, data.childLabel,
      `Returned result to parent (${data.result.length} chars)`,
    );
  }

  // ─── Actions: Run Completion ──────────────────────────────────────

  function onRunCompleted(data: { runId: string; finalOutput: string }) {
    if (!currentRun.value) return;
    currentRun.value.status = 'completed';
    currentRun.value.completedAt = Date.now();
    currentRun.value.finalOutput = data.finalOutput;
  }

  function onRunFailed(data: { runId: string; error: string }) {
    if (!currentRun.value) return;
    currentRun.value.status = 'failed';
    currentRun.value.completedAt = Date.now();
    addTimeline('node_failed', '', 'Runner', `Run failed: ${data.error}`);
  }

  function onRunAborted(_data: { runId: string }) {
    if (!currentRun.value) return;
    currentRun.value.status = 'aborted';
    currentRun.value.completedAt = Date.now();
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  function addTimeline(type: TimelineEntry['type'], nodeId: string, nodeLabel: string, detail: string) {
    if (!currentRun.value) return;
    currentRun.value.timeline.push({
      timestamp: Date.now(),
      type,
      nodeId,
      nodeLabel,
      detail,
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
  }

  return {
    // State
    currentRun, showRunnerPanel, selectedNodeId,
    // Computed
    isRunning, activeNodeIds, completedNodeIds, failedNodeIds, timeline, selectedExecution,
    // Actions
    onRunStarted, onNodeStarted, onNodeDelta, onNodeThinkingStart, onNodeThinkingDelta,
    onNodeThinkingEnd, onNodeToolUse, onNodeCompleted, onNodeFailed,
    onDelegation, onResultReturn, onRunCompleted, onRunFailed, onRunAborted,
    selectExecution, togglePanel, reset,
  };
});
