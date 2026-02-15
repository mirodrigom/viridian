import { describe, it, expect } from 'vitest';

/**
 * Tests for pure functions from graphRunner.ts.
 * Re-implemented to avoid Pinia store and WebSocket dependencies.
 */

// ─── Types ──────────────────────────────────────────────────────────────

type NodeExecStatus = 'running' | 'completed' | 'failed' | 'delegated' | 'pending';
type RunStatus = 'running' | 'completed' | 'failed' | 'aborted';

interface TimelineEntry {
  type: string;
  nodeId: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

// ─── Re-implemented: nodeStatusFromTimeline ─────────────────────────────

function nodeStatusFromTimeline(
  timeline: TimelineEntry[],
  nodeId: string,
): NodeExecStatus | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i]!;
    if (e.nodeId !== nodeId) continue;
    if (e.type === 'node_complete' || e.type === 'node_skipped') return 'completed';
    if (e.type === 'node_failed') return 'failed';
    if (e.type === 'node_start') return 'running';
    if (e.type === 'node_delegated') return 'delegated';
  }
  return null;
}

// ─── Re-implemented: effectiveTimeline (playback filter) ────────────────

function effectiveTimeline(
  timeline: TimelineEntry[],
  playbackMode: boolean,
  playbackTimeMs: number,
): TimelineEntry[] {
  if (!playbackMode) return timeline;
  return timeline.filter(e => e.timestamp <= playbackTimeMs);
}

// ─── Re-implemented: activeNodeIds / completedNodeIds ───────────────────

function getNodeIdsByStatus(
  executions: Record<string, { status: string }>,
  timeline: TimelineEntry[],
  playbackMode: boolean,
  targetStatus: NodeExecStatus,
): Set<string> {
  const ids = new Set<string>();
  if (playbackMode) {
    for (const id of Object.keys(executions)) {
      if (nodeStatusFromTimeline(timeline, id) === targetStatus) ids.add(id);
    }
  } else {
    for (const [id, exec] of Object.entries(executions)) {
      if (exec.status === targetStatus) ids.add(id);
    }
  }
  return ids;
}

// ─── Re-implemented: playback ratio ─────────────────────────────────────

function playbackRatio(
  playbackMode: boolean,
  playbackTimeMs: number,
  runStartMs: number,
  runDurationMs: number,
): number {
  if (!playbackMode || runDurationMs <= 1) return 1;
  return Math.max(0, Math.min(1, (playbackTimeMs - runStartMs) / runDurationMs));
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('nodeStatusFromTimeline', () => {
  it('returns running for node_start', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('running');
  });

  it('returns completed for node_complete', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
      { type: 'node_complete', nodeId: 'n1', timestamp: 200 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('completed');
  });

  it('returns completed for node_skipped', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_skipped', nodeId: 'n1', timestamp: 100 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('completed');
  });

  it('returns failed for node_failed', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
      { type: 'node_failed', nodeId: 'n1', timestamp: 200 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('failed');
  });

  it('returns delegated for node_delegated', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_delegated', nodeId: 'n1', timestamp: 100 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('delegated');
  });

  it('returns null for unknown node', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n99')).toBeNull();
  });

  it('returns null for empty timeline', () => {
    expect(nodeStatusFromTimeline([], 'n1')).toBeNull();
  });

  it('uses latest event (scans from end)', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
      { type: 'node_delegated', nodeId: 'n1', timestamp: 150 },
      { type: 'node_start', nodeId: 'n1', timestamp: 200 }, // resumed
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('running');
  });

  it('isolates by nodeId', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
      { type: 'node_complete', nodeId: 'n2', timestamp: 200 },
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('running');
    expect(nodeStatusFromTimeline(timeline, 'n2')).toBe('completed');
  });

  it('ignores unknown event types', () => {
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
      { type: 'node_text_delta', nodeId: 'n1', timestamp: 150 }, // not a status event
    ];
    expect(nodeStatusFromTimeline(timeline, 'n1')).toBe('running');
  });
});

describe('effectiveTimeline', () => {
  const timeline: TimelineEntry[] = [
    { type: 'node_start', nodeId: 'n1', timestamp: 100 },
    { type: 'node_text_delta', nodeId: 'n1', timestamp: 200 },
    { type: 'node_complete', nodeId: 'n1', timestamp: 300 },
  ];

  it('returns all entries when playback mode is off', () => {
    expect(effectiveTimeline(timeline, false, 0)).toHaveLength(3);
  });

  it('filters entries before playback time', () => {
    expect(effectiveTimeline(timeline, true, 150)).toHaveLength(1);
    expect(effectiveTimeline(timeline, true, 250)).toHaveLength(2);
    expect(effectiveTimeline(timeline, true, 300)).toHaveLength(3);
  });

  it('returns empty when playback time is before all events', () => {
    expect(effectiveTimeline(timeline, true, 50)).toHaveLength(0);
  });
});

describe('getNodeIdsByStatus', () => {
  it('in live mode, reads from executions directly', () => {
    const executions = {
      'n1': { status: 'running' },
      'n2': { status: 'completed' },
      'n3': { status: 'running' },
    };
    const running = getNodeIdsByStatus(executions, [], false, 'running');
    expect(running.size).toBe(2);
    expect(running.has('n1')).toBe(true);
    expect(running.has('n3')).toBe(true);
  });

  it('in playback mode, derives status from timeline', () => {
    const executions = {
      'n1': { status: 'completed' }, // final status
      'n2': { status: 'completed' },
    };
    // In playback, n1 started but n2 already completed
    const timeline: TimelineEntry[] = [
      { type: 'node_start', nodeId: 'n1', timestamp: 100 },
      { type: 'node_complete', nodeId: 'n2', timestamp: 50 },
    ];

    const running = getNodeIdsByStatus(executions, timeline, true, 'running');
    expect(running.size).toBe(1);
    expect(running.has('n1')).toBe(true);

    const completed = getNodeIdsByStatus(executions, timeline, true, 'completed');
    expect(completed.size).toBe(1);
    expect(completed.has('n2')).toBe(true);
  });
});

describe('playbackRatio', () => {
  it('returns 1 when not in playback mode', () => {
    expect(playbackRatio(false, 500, 0, 1000)).toBe(1);
  });

  it('returns 1 when duration is <= 1ms', () => {
    expect(playbackRatio(true, 500, 500, 0)).toBe(1);
    expect(playbackRatio(true, 500, 500, 1)).toBe(1);
  });

  it('calculates correct ratio', () => {
    expect(playbackRatio(true, 250, 0, 1000)).toBe(0.25);
    expect(playbackRatio(true, 500, 0, 1000)).toBe(0.5);
    expect(playbackRatio(true, 750, 0, 1000)).toBe(0.75);
  });

  it('clamps to [0, 1]', () => {
    expect(playbackRatio(true, -100, 0, 1000)).toBe(0);
    expect(playbackRatio(true, 2000, 0, 1000)).toBe(1);
  });

  it('handles non-zero start time', () => {
    // Run from 1000ms to 3000ms (duration 2000ms)
    expect(playbackRatio(true, 2000, 1000, 2000)).toBe(0.5);
  });
});
