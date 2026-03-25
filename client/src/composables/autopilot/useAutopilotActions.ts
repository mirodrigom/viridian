import { apiFetch } from '@/lib/apiFetch';
import type {
  AutopilotRun,
  AutopilotCycle,
  AutopilotProfile,
  TokenUsage,
} from '@/types/autopilot';

/**
 * Composable for high-level autopilot actions and run loading
 */
export function useAutopilotActions() {

  async function loadRun(
    runId: string,
    callbacks: {
      setLoadingRun: (loading: boolean) => void;
      setCurrentRun: (run: AutopilotRun | null) => void;
      clearTimeline: () => void;
      addTimeline: (type: string, cycleNumber: number | null, detail: string, meta?: Record<string, unknown>) => void;
      setSelectedCycleNumber: (cycleNumber: number | null) => void;
      fetchProfiles: () => Promise<void>;
      getProfiles: () => AutopilotProfile[];
      isRunning: () => boolean;
    }
  ) {
    if (callbacks.isRunning()) return; // Don't switch while running

    callbacks.setLoadingRun(true);
    try {
      // Fetch run metadata + cycles in parallel
      const [runRes, cyclesRes] = await Promise.all([
        apiFetch(`/api/autopilot/runs/${runId}`),
        apiFetch(`/api/autopilot/runs/${runId}/cycles`),
      ]);

      if (!runRes.ok || !cyclesRes.ok) return;

      const runData = await runRes.json();
      const cyclesData = await cyclesRes.json();

      // Find profiles
      const profiles = callbacks.getProfiles();
      if (profiles.length === 0) await callbacks.fetchProfiles();

      const updatedProfiles = callbacks.getProfiles();
      const agentAProfile = (updatedProfiles.find(p => p.id === runData.agentAProfileId)
        || { id: runData.agentAProfileId || 'unknown', name: 'Agent A', role: 'custom' as const, description: '', systemPrompt: '', allowedTools: [], disallowedTools: [], model: null, isBuiltin: false }) as AutopilotProfile;
      const agentBProfile = (updatedProfiles.find(p => p.id === runData.agentBProfileId)
        || { id: runData.agentBProfileId || 'unknown', name: 'Agent B', role: 'custom' as const, description: '', systemPrompt: '', allowedTools: [], disallowedTools: [], model: null, isBuiltin: false }) as AutopilotProfile;

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
          contentBlocks: [],
          tokens: (c as { agentA?: { tokens?: TokenUsage } }).agentA?.tokens || { inputTokens: 0, outputTokens: 0 },
        },
        agentB: {
          prompt: (c as { agentB?: { prompt?: string } }).agentB?.prompt || '',
          response: (c as { agentB?: { response?: string } }).agentB?.response || '',
          thinking: '',
          isThinking: false,
          toolCalls: [],
          contentBlocks: [],
          tokens: (c as { agentB?: { tokens?: TokenUsage } }).agentB?.tokens || { inputTokens: 0, outputTokens: 0 },
        },
        commit: (c as { commit?: { hash: string; message: string; filesChanged: string[] } }).commit || null,
        summary: null,
        startedAt: c.startedAt ? new Date(c.startedAt as string).getTime() : null,
        completedAt: c.completedAt ? new Date(c.completedAt as string).getTime() : null,
        isTestVerification: !!(c as { isTestVerification?: boolean }).isTestVerification,
      }));

      // Reconstruct currentRun
      const run: AutopilotRun = {
        runId: runData.id,
        configId: runData.configId,
        status: runData.status,
        branchName: runData.branchName || '',
        agentAProfile,
        agentBProfile,
        cycles,
        currentCycleNumber: cycles.length > 0 ? (cycles[cycles.length - 1]?.cycleNumber ?? 0) : 0,
        totalTokens: runData.tokens || {
          agentA: { inputTokens: 0, outputTokens: 0 },
          agentB: { inputTokens: 0, outputTokens: 0 },
        },
        totalCommits: runData.commitCount || 0,
        rateLimitedUntil: null,
        startedAt: runData.startedAt ? new Date(runData.startedAt).getTime() : null,
        completedAt: runData.completedAt ? new Date(runData.completedAt).getTime() : null,
      };

      callbacks.setCurrentRun(run);

      // Reconstruct timeline from cycles
      callbacks.clearTimeline();
      callbacks.addTimeline('run_started', null, `Run started on branch ${runData.branchName || 'unknown'}`);
      for (const cycle of cycles) {
        callbacks.addTimeline('cycle_started', cycle.cycleNumber, `Cycle ${cycle.cycleNumber + 1} started`);
        if (cycle.agentA.response) {
          const snippetA = cycle.agentA.response.slice(0, 80).replace(/\n/g, ' ').trim();
          callbacks.addTimeline('agent_a_complete', cycle.cycleNumber, `Agent A finished: ${snippetA}${cycle.agentA.response.length > 80 ? '...' : ''}`);
        }
        if (cycle.agentB.response) {
          const snippetB = cycle.agentB.response.slice(0, 80).replace(/\n/g, ' ').trim();
          callbacks.addTimeline('agent_b_complete', cycle.cycleNumber, `Agent B finished: ${snippetB}${cycle.agentB.response.length > 80 ? '...' : ''}`);
        }
        if (cycle.commit) {
          callbacks.addTimeline('commit_made', cycle.cycleNumber, `Commit: ${cycle.commit.message}`, { hash: cycle.commit.hash });
        }
      }
      if (runData.status === 'completed') {
        callbacks.addTimeline('run_completed', null, 'Run completed');
      } else if (runData.status === 'failed') {
        callbacks.addTimeline('run_failed', null, `Failed: ${runData.error || 'Unknown error'}`);
      }

      callbacks.setSelectedCycleNumber(null);
    } finally {
      callbacks.setLoadingRun(false);
    }
  }

  return {
    loadRun,
  };
}