/**
 * Autopilot Scheduler — checks every 60 seconds for configs with
 * scheduled time windows and starts/stops runs automatically.
 */

import { getDb } from '../db/database.js';
import { safeJsonParse } from '../lib/safeJson.js';
import { createLogger } from '../logger.js';

const log = createLogger('autopilot-scheduler');
import {
  startAutopilotRun,
  getActiveRun,
  pauseRun,
  type AutopilotContext,
  type AutopilotRunConfig,
} from './autopilot.js';
import { seedBuiltinProfiles } from './autopilot-profiles.js';

const CHECK_INTERVAL = 60_000; // 60 seconds
let checkTimer: ReturnType<typeof setInterval> | null = null;
const scheduledRuns = new Map<string, string>(); // configId → runId

export function startScheduler() {
  // Seed built-in profiles on scheduler start
  seedBuiltinProfiles();

  if (checkTimer) return;
  checkTimer = setInterval(tick, CHECK_INTERVAL);
  log.info('Started — checking every 60s');
  // Initial check
  tick();
}

export function stopScheduler() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  log.info('Stopped');
}

function tick() {
  try {
    const db = getDb();
    const now = new Date();

    // Find all configs with schedule_enabled = 1
    const configs = db.prepare(`
      SELECT * FROM autopilot_configs WHERE schedule_enabled = 1
    `).all() as Record<string, unknown>[];

    for (const cfg of configs) {
      const configId = cfg.id as string;
      const existingRunId = scheduledRuns.get(configId);

      // Check if there's an active run for this config
      if (existingRunId) {
        const ctx = getActiveRun(existingRunId);
        if (ctx) {
          // Run is active — check if we should stop it (outside window)
          if (!isWithinWindow(cfg, now)) {
            log.info({ configId, runId: existingRunId }, 'Outside window, pausing run');
            pauseRun(existingRunId);
            scheduledRuns.delete(configId);
          }
          continue;
        }
        // Run no longer active — clean up
        scheduledRuns.delete(configId);
      }

      // Check if there's already a running/paused run in DB
      const activeDbRun = db.prepare(`
        SELECT id FROM autopilot_runs
        WHERE config_id = ? AND status IN ('running', 'paused', 'rate_limited')
      `).get(configId) as { id: string } | undefined;

      if (activeDbRun) continue; // Already running

      // Check if within schedule window
      if (isWithinWindow(cfg, now)) {
        log.info({ configId }, 'Within window, starting run');
        try {
          const runConfig: AutopilotRunConfig = {
            configId,
            userId: cfg.user_id as number,
            projectPath: cfg.project_path as string,
            cwd: cfg.project_path as string,
            goalPrompt: cfg.goal_prompt as string,
            agentAProfileId: cfg.agent_a_profile as string,
            agentBProfileId: cfg.agent_b_profile as string,
            agentAModel: cfg.agent_a_model as string,
            agentBModel: cfg.agent_b_model as string,
            allowedPaths: safeJsonParse<string[]>(cfg.allowed_paths as string, []),
            maxIterations: cfg.max_iterations as number,
            maxTokensPerSession: cfg.max_tokens_per_session as number,
            scheduleEndTime: getWindowEnd(cfg, now),
          };

          const ctx = startAutopilotRun(runConfig);
          scheduledRuns.set(configId, ctx.runId);
        } catch (err) {
          log.error({ err, configId }, 'Failed to start run');
        }
      }
    }
  } catch (err) {
    log.error({ err }, 'Error in tick');
  }
}

/**
 * Check if current time is within the config's schedule window.
 * Handles windows that cross midnight (e.g., 22:00 → 10:00).
 */
function isWithinWindow(cfg: Record<string, unknown>, now: Date): boolean {
  const startStr = cfg.schedule_start_time as string | null;
  const endStr = cfg.schedule_end_time as string | null;
  if (!startStr || !endStr) return false;

  // Check day of week
  const days: number[] = safeJsonParse<number[]>(cfg.schedule_days as string, [1, 2, 3, 4, 5]);
  const currentDay = now.getDay(); // 0=Sun, 1=Mon, ...
  if (!days.includes(currentDay)) return false;

  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes <= endMinutes) {
    // Same-day window (e.g., 09:00 → 17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // Cross-midnight window (e.g., 22:00 → 10:00)
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

/**
 * Calculate the absolute timestamp when the current window ends.
 */
function getWindowEnd(cfg: Record<string, unknown>, now: Date): number {
  const endStr = cfg.schedule_end_time as string | null;
  if (!endStr) return Date.now() + 8 * 60 * 60 * 1000; // 8 hours default

  const [endH, endM] = endStr.split(':').map(Number);
  const end = new Date(now);
  end.setHours(endH, endM, 0, 0);

  // If end is before now, it's tomorrow
  if (end.getTime() <= now.getTime()) {
    end.setDate(end.getDate() + 1);
  }

  return end.getTime();
}
