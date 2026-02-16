// ─── Autopilot Profile ─────────────────────────────────────────────────
export type ProfileRole =
  | 'analyst'
  | 'qa'
  | 'architect'
  | 'feature_creator'
  | 'reviewer'
  | 'serial_questioner'
  | 'fullstack_dev'
  | 'frontend_specialist'
  | 'backend_specialist'
  | 'api_designer'
  | 'security_auditor'
  | 'performance_tester'
  | 'accessibility_checker'
  | 'cicd_optimizer'
  | 'container_specialist'
  | 'db_optimizer'
  | 'i18n_specialist'
  | 'doc_writer'
  | 'multi_agent_coordinator'
  | 'sprint_planner'
  | 'review_team'
  | 'github_workflow'
  | 'custom';

export type ProfileCategory = 'development' | 'testing' | 'devops' | 'domain' | 'orchestrator' | 'general';

export interface SubagentDefinition {
  key: string;
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
}

export interface McpServerReference {
  name: string;
  requiredTools?: string[];
}

export interface AutopilotProfile {
  id: string;
  userId?: number;
  name: string;
  role: ProfileRole;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  disallowedTools: string[];
  model: string | null;
  isBuiltin: boolean;
  createdAt?: string;
  // Extended fields
  category: ProfileCategory;
  tags: string[];
  subagents: SubagentDefinition[];
  mcpServers: McpServerReference[];
  appendSystemPrompt: string | null;
  maxTurns: number | null;
  permissionMode: string | null;
  icon: string | null;
  difficulty: string | null;
}

// ─── Autopilot Config ──────────────────────────────────────────────────
export interface AutopilotConfig {
  id: string;
  userId?: number;
  projectPath: string;
  name: string;
  agentAProfile: string;        // profile ID
  agentBProfile: string;        // profile ID
  allowedPaths: string[];       // glob patterns
  agentAModel: string;
  agentBModel: string;
  maxIterations: number;
  maxTokensPerSession: number;
  scheduleEnabled: boolean;
  scheduleStartTime: string | null;   // HH:MM
  scheduleEndTime: string | null;     // HH:MM
  scheduleDays: number[];             // 0=Sun, 1=Mon, ...
  scheduleTimezone: string;
  goalPrompt: string;
  runTestVerification: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Token Usage ───────────────────────────────────────────────────────
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// ─── Tool Call Entry ───────────────────────────────────────────────────
export interface AutopilotToolCall {
  tool: string;
  input: Record<string, unknown>;
  requestId: string;
}

// ─── Interleaved content block (text or tool) for rendering ───────────
export type AutopilotContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; toolCall: AutopilotToolCall };

// ─── Cycle ─────────────────────────────────────────────────────────────
export type CycleStatus =
  | 'pending'
  | 'agent_a_running'
  | 'agent_b_running'
  | 'committing'
  | 'committed'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface AutopilotCycleCommit {
  hash: string;
  message: string;
  filesChanged: string[];
}

export interface AutopilotAgentState {
  prompt: string;
  response: string;
  thinking: string;
  isThinking: boolean;
  toolCalls: AutopilotToolCall[];
  contentBlocks: AutopilotContentBlock[];
  tokens: TokenUsage;
}

export interface AutopilotCycle {
  cycleNumber: number;
  status: CycleStatus;
  agentA: AutopilotAgentState;
  agentB: AutopilotAgentState;
  commit: AutopilotCycleCommit | null;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  isTestVerification: boolean;
}

// ─── Run ───────────────────────────────────────────────────────────────
export type RunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'rate_limited'
  | 'completed'
  | 'schedule_timeout'
  | 'failed'
  | 'aborted';

export interface AutopilotRun {
  runId: string;
  configId: string | null;
  status: RunStatus;
  branchName: string;
  agentAProfile: AutopilotProfile;
  agentBProfile: AutopilotProfile;
  cycles: AutopilotCycle[];
  currentCycleNumber: number;
  totalTokens: {
    agentA: TokenUsage;
    agentB: TokenUsage;
  };
  totalCommits: number;
  rateLimitedUntil: number | null;
  startedAt: number | null;
  completedAt: number | null;
}

// ─── Run Summary (for sidebar listing) ────────────────────────────────
export interface AutopilotRunSummary {
  id: string;
  configId: string | null;
  projectPath: string;
  status: string;
  branchName: string | null;
  goalPrompt: string;
  agentAProfileId: string | null;
  agentBProfileId: string | null;
  commitCount: number;
  cycleCount: number;
  tokens: { agentA: TokenUsage; agentB: TokenUsage };
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

// ─── Timeline Entry ────────────────────────────────────────────────────
export type AutopilotTimelineType =
  | 'run_started'
  | 'cycle_started'
  | 'agent_a_complete'
  | 'agent_b_complete'
  | 'commit_made'
  | 'cycle_completed'
  | 'rate_limited'
  | 'rate_limit_cleared'
  | 'run_paused'
  | 'run_resumed'
  | 'run_completed'
  | 'schedule_timeout'
  | 'run_failed'
  | 'pr_created'
  | 'test_verification_started'
  | 'test_verification_completed'
  | 'test_verification_failed';

export interface AutopilotTimelineEntry {
  timestamp: number;
  type: AutopilotTimelineType;
  cycleNumber: number | null;
  detail: string;
  meta?: Record<string, unknown>;
}

// ─── WebSocket Protocol: Client → Server ───────────────────────────────
export interface WsStartRun {
  type: 'start_run';
  configId: string;
  cwd: string;
}

export interface WsStartAdhoc {
  type: 'start_adhoc';
  goalPrompt: string;
  agentAProfileId: string;
  agentBProfileId: string;
  agentAModel?: string;
  agentBModel?: string;
  cwd: string;
  allowedPaths: string[];
  maxIterations: number;
  runTestVerification?: boolean;
}

export interface WsPauseRun {
  type: 'pause_run';
  runId: string;
}

export interface WsResumeRun {
  type: 'resume_run';
  runId: string;
}

export interface WsAbortRun {
  type: 'abort_run';
  runId: string;
}

export interface WsGetRunState {
  type: 'get_run_state';
  runId: string;
}

export interface WsResumeFailedRun {
  type: 'resume_failed_run';
  runId: string;
}

export type WsAutopilotClientMessage =
  | WsStartRun
  | WsStartAdhoc
  | WsPauseRun
  | WsResumeRun
  | WsAbortRun
  | WsGetRunState
  | WsResumeFailedRun;

// ─── WebSocket Protocol: Server → Client ───────────────────────────────
export interface WsApRunStarted {
  type: 'run_started';
  runId: string;
  configId: string | null;
  branchName: string;
  agentAProfile: AutopilotProfile;
  agentBProfile: AutopilotProfile;
}

export interface WsApCycleStarted {
  type: 'cycle_started';
  runId: string;
  cycleNumber: number;
  phase: 'agent_a' | 'agent_b';
  isTestVerification?: boolean;
}

export interface WsApCyclePhaseChange {
  type: 'cycle_phase_change';
  runId: string;
  cycleNumber: number;
  phase: 'agent_b';
}

export interface WsApAgentDelta {
  type: 'agent_a_delta' | 'agent_b_delta';
  runId: string;
  cycleNumber: number;
  text: string;
}

export interface WsApAgentThinkingStart {
  type: 'agent_a_thinking_start' | 'agent_b_thinking_start';
  runId: string;
  cycleNumber: number;
}

export interface WsApAgentThinkingDelta {
  type: 'agent_a_thinking_delta' | 'agent_b_thinking_delta';
  runId: string;
  cycleNumber: number;
  text: string;
}

export interface WsApAgentThinkingEnd {
  type: 'agent_a_thinking_end' | 'agent_b_thinking_end';
  runId: string;
  cycleNumber: number;
}

export interface WsApAgentToolUse {
  type: 'agent_a_tool_use' | 'agent_b_tool_use';
  runId: string;
  cycleNumber: number;
  tool: string;
  input: Record<string, unknown>;
  requestId: string;
}

export interface WsApAgentComplete {
  type: 'agent_a_complete' | 'agent_b_complete';
  runId: string;
  cycleNumber: number;
  response: string;
  tokens: TokenUsage;
}

export interface WsApCommitMade {
  type: 'commit_made';
  runId: string;
  cycleNumber: number;
  hash: string;
  message: string;
  filesChanged: string[];
}

export interface WsApCycleCompleted {
  type: 'cycle_completed';
  runId: string;
  cycleNumber: number;
  summary: string;
}

export interface WsApRateLimited {
  type: 'rate_limited';
  runId: string;
  until: number;
}

export interface WsApRateLimitCleared {
  type: 'rate_limit_cleared';
  runId: string;
}

export interface WsApRunPaused {
  type: 'run_paused';
  runId: string;
  reason: string;
}

export interface WsApRunResumed {
  type: 'run_resumed';
  runId: string;
}

export interface WsApRunCompleted {
  type: 'run_completed';
  runId: string;
  totalCycles: number;
  totalCommits: number;
  summary: string;
}

export interface WsApRunFailed {
  type: 'run_failed';
  runId: string;
  error: string;
}

export interface WsApRunAborted {
  type: 'run_aborted';
  runId: string;
}

export interface WsApRunState {
  type: 'run_state';
  run: AutopilotRun;
}

export interface WsApError {
  type: 'error';
  error: string;
}

export type WsAutopilotServerMessage =
  | WsApRunStarted
  | WsApCycleStarted
  | WsApCyclePhaseChange
  | WsApAgentDelta
  | WsApAgentThinkingStart
  | WsApAgentThinkingDelta
  | WsApAgentThinkingEnd
  | WsApAgentToolUse
  | WsApAgentComplete
  | WsApCommitMade
  | WsApCycleCompleted
  | WsApRateLimited
  | WsApRateLimitCleared
  | WsApRunPaused
  | WsApRunResumed
  | WsApRunCompleted
  | WsApRunFailed
  | WsApRunAborted
  | WsApRunState
  | WsApError;
