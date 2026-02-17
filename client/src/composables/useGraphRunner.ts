import { useGraphRunnerStore } from '@/stores/graphRunner';
import { useGraphStore } from '@/stores/graph';
import { useChatStore } from '@/stores/chat';
import { toast } from 'vue-sonner';
import type { ExecutionPreview } from '@/types/graph-runner';

let initialized = false;

export function useGraphRunner() {
  const runner = useGraphRunnerStore();
  const graph = useGraphStore();

  function init() {
    // Only wire up handlers once — the WebSocket lives in the store
    if (initialized) return;
    initialized = true;

    runner.wsConnect();

    runner.wsOn('run_started', (data: unknown) => {
      runner.onRunStarted(data as { runId: string; rootNodeId: string });
    });

    runner.wsOn('node_started', (data: unknown) => {
      runner.onNodeStarted(data as {
        nodeId: string; nodeLabel: string; nodeType: string;
        inputPrompt: string; parentNodeId: string | null;
      });
    });

    runner.wsOn('node_delta', (data: unknown) => {
      runner.onNodeDelta(data as { nodeId: string; text: string });
    });

    runner.wsOn('node_thinking_start', (data: unknown) => {
      runner.onNodeThinkingStart(data as { nodeId: string });
    });

    runner.wsOn('node_thinking_delta', (data: unknown) => {
      runner.onNodeThinkingDelta(data as { nodeId: string; text: string });
    });

    runner.wsOn('node_thinking_end', (data: unknown) => {
      runner.onNodeThinkingEnd(data as { nodeId: string });
    });

    runner.wsOn('node_tool_use', (data: unknown) => {
      runner.onNodeToolUse(data as {
        nodeId: string; tool: string;
        input: Record<string, unknown>; requestId: string;
      });
    });

    runner.wsOn('node_completed', (data: unknown) => {
      runner.onNodeCompleted(data as {
        nodeId: string; outputText: string;
        usage: { inputTokens: number; outputTokens: number };
      });
    });

    runner.wsOn('node_failed', (data: unknown) => {
      const d = data as { nodeId: string; error: string };
      runner.onNodeFailed(d);
      toast.error(`Node failed: ${d.error.slice(0, 200)}`, { duration: 6000 });
    });

    runner.wsOn('node_delegated', (data: unknown) => {
      runner.onNodeDelegated(data as {
        nodeId: string; nodeLabel: string; nodeType: string;
        parentNodeId: string; inputPrompt: string;
      });
    });

    runner.wsOn('node_skipped', (data: unknown) => {
      runner.onNodeSkipped(data as { nodeId: string; reason: string });
    });

    runner.wsOn('node_phase', (data: unknown) => {
      runner.onNodePhase(data as { nodeId: string; phase: string });
    });

    runner.wsOn('delegation', (data: unknown) => {
      runner.onDelegation(data as {
        parentNodeId: string; childNodeId: string;
        childLabel: string; task: string;
      });
    });

    runner.wsOn('result_return', (data: unknown) => {
      runner.onResultReturn(data as {
        parentNodeId: string; childNodeId: string;
        childLabel: string; result: string;
      });
    });

    runner.wsOn('budget_warning', (data: unknown) => {
      const d = data as { totalTokensUsed: number; tokenBudget: number; percentage: number };
      toast.warning(`Token budget at ${d.percentage}% (${d.totalTokensUsed.toLocaleString()} / ${d.tokenBudget.toLocaleString()})`, { duration: 10000 });
    });

    runner.wsOn('budget_exceeded', (data: unknown) => {
      const d = data as { totalTokensUsed: number; tokenBudget: number };
      toast.error(`Token budget exceeded (${d.totalTokensUsed.toLocaleString()} / ${d.tokenBudget.toLocaleString()}). Run aborted.`, { duration: 15000 });
    });

    runner.wsOn('run_completed', (data: unknown) => {
      runner.onRunCompleted(data as { runId: string; finalOutput: string });
    });

    runner.wsOn('run_failed', (data: unknown) => {
      const d = data as { runId: string; error: string };
      runner.onRunFailed(d);
      toast.error(`Run failed: ${d.error.slice(0, 200)}`, { duration: 8000 });
    });

    runner.wsOn('run_aborted', (data: unknown) => {
      runner.onRunAborted(data as { runId: string });
    });

    runner.wsOn('error', (data: unknown) => {
      const d = data as { error: string };
      console.error('[GraphRunner WS]', d.error);
      toast.error(`Graph error: ${d.error.slice(0, 200)}`, { duration: 6000 });
    });

    // Preview events
    runner.wsOn('preview_result', (data: unknown) => {
      const d = data as { preview: ExecutionPreview };
      runner.setPreview(d.preview);
    });

    runner.wsOn('preview_error', (data: unknown) => {
      const d = data as { error: string };
      toast.error(`Preview failed: ${d.error.slice(0, 200)}`, { duration: 6000 });
      runner.setPreview(null);
    });
  }

  function runGraph(prompt: string, cwd: string) {
    runner.reset();
    const graphData = graph.serialize();
    const sent = runner.wsSend({
      type: 'run_graph',
      graphData,
      prompt,
      cwd,
      graphId: graph.currentGraphId,
    });
    if (!sent) {
      toast.error('Graph runner not connected. Reconnecting...', { duration: 4000 });
      runner.wsConnect();
    }
  }

  /** Run a graph directly from template data (no graph editor needed) */
  function quickRun(template: { name: string; nodes: unknown[]; edges: unknown[] }, prompt: string) {
    runner.reset();
    // Load template into graph store so the canvas renders nodes with execution overlays
    graph.loadTemplate(template as import('@/data/graphTemplates').GraphTemplate);
    // Send the store's serialized data (with remapped IDs) so node IDs match
    const graphData = graph.serialize();
    const chat = useChatStore();
    const cwd = chat.projectPath || '/home';
    const sent = runner.wsSend({
      type: 'run_graph',
      graphData,
      prompt,
      cwd,
      graphId: null,
    });
    if (!sent) {
      toast.error('Graph runner not connected. Reconnecting...', { duration: 4000 });
      runner.wsConnect();
    }
  }

  function abort() {
    runner.wsSend({ type: 'abort_run' });
  }

  return { connected: runner.wsConnected, init, runGraph, quickRun, abort };
}
