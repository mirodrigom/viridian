// ─── Execution Status ──────────────────────────────────────────────────
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted';
export type NodeExecStatus = 'pending' | 'delegated' | 'running' | 'completed' | 'failed';

// ─── Edge Flow Animation ──────────────────────────────────────────────
export interface EdgeFlowState {
  direction: 'forward' | 'reverse';
  type: 'delegation' | 'result_return';
  startedAt: number;
}

// ─── Tool Call Tracking ────────────────────────────────────────────────
export interface ToolCallEntry {
  tool: string;
  input: Record<string, unknown>;
  requestId: string;
  status: 'running' | 'completed';
}

// ─── Per-node execution state ──────────────────────────────────────────
export interface NodeExecution {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: NodeExecStatus;
  inputPrompt: string;
  outputText: string;
  thinkingText: string;
  isThinking: boolean;
  toolCalls: ToolCallEntry[];
  childExecutionIds: string[];
  parentExecutionId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

// ─── Timeline entry ────────────────────────────────────────────────────
export type TimelineEntryType =
  | 'node_start'
  | 'node_complete'
  | 'node_failed'
  | 'node_delegated'
  | 'node_skipped'
  | 'delegation'
  | 'result_return'
  | 'tool_use'
  | 'message';

export interface TimelineEntryMeta {
  parentNodeId?: string;
  childNodeId?: string;
}

export interface TimelineEntry {
  timestamp: number;
  type: TimelineEntryType;
  nodeId: string;
  nodeLabel: string;
  detail: string;
  meta?: TimelineEntryMeta;
}

// ─── Full run state ────────────────────────────────────────────────────
export interface GraphRun {
  runId: string;
  graphId: string | null;
  status: RunStatus;
  rootNodeId: string | null;
  executions: Record<string, NodeExecution>;
  timeline: TimelineEntry[];
  startedAt: number | null;
  completedAt: number | null;
  finalOutput: string | null;
}

// ─── WebSocket Protocol: Client → Server ───────────────────────────────
export interface WsRunGraph {
  type: 'run_graph';
  graphData: {
    nodes: { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }[];
    edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string; data: Record<string, unknown> }[];
  };
  prompt: string;
  cwd: string;
}

export interface WsAbortRun {
  type: 'abort_run';
}

export type WsClientMessage = WsRunGraph | WsAbortRun;

// ─── WebSocket Protocol: Server → Client ───────────────────────────────
export interface WsRunStarted {
  type: 'run_started';
  runId: string;
  rootNodeId: string;
}

export interface WsNodeStarted {
  type: 'node_started';
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  inputPrompt: string;
  parentNodeId: string | null;
}

export interface WsNodeDelta {
  type: 'node_delta';
  nodeId: string;
  text: string;
}

export interface WsNodeThinkingStart {
  type: 'node_thinking_start';
  nodeId: string;
}

export interface WsNodeThinkingDelta {
  type: 'node_thinking_delta';
  nodeId: string;
  text: string;
}

export interface WsNodeThinkingEnd {
  type: 'node_thinking_end';
  nodeId: string;
}

export interface WsNodeToolUse {
  type: 'node_tool_use';
  nodeId: string;
  tool: string;
  input: Record<string, unknown>;
  requestId: string;
}

export interface WsNodeCompleted {
  type: 'node_completed';
  nodeId: string;
  outputText: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface WsNodeFailed {
  type: 'node_failed';
  nodeId: string;
  error: string;
}

export interface WsNodeDelegated {
  type: 'node_delegated';
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  parentNodeId: string;
  inputPrompt: string;
}

export interface WsNodeSkipped {
  type: 'node_skipped';
  nodeId: string;
  reason: string;
}

export interface WsDelegation {
  type: 'delegation';
  parentNodeId: string;
  childNodeId: string;
  childLabel: string;
  task: string;
}

export interface WsResultReturn {
  type: 'result_return';
  parentNodeId: string;
  childNodeId: string;
  childLabel: string;
  result: string;
}

export interface WsRunCompleted {
  type: 'run_completed';
  runId: string;
  finalOutput: string;
}

export interface WsRunFailed {
  type: 'run_failed';
  runId: string;
  error: string;
}

export interface WsRunAborted {
  type: 'run_aborted';
  runId: string;
}

export type WsServerMessage =
  | WsRunStarted
  | WsNodeStarted
  | WsNodeDelta
  | WsNodeThinkingStart
  | WsNodeThinkingDelta
  | WsNodeThinkingEnd
  | WsNodeToolUse
  | WsNodeCompleted
  | WsNodeFailed
  | WsNodeDelegated
  | WsNodeSkipped
  | WsDelegation
  | WsResultReturn
  | WsRunCompleted
  | WsRunFailed
  | WsRunAborted;
