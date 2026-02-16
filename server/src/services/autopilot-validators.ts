/**
 * Autopilot Validators — pure validation functions for autopilot operations.
 *
 * Contains token budget validation, schedule window checks, and rate limit parsing.
 */

import { type AutopilotContext } from './autopilot-run-manager.js';

// ─── Token Budget Validation ─────────────────────────────────────────────

export function isOverTokenBudget(ctx: AutopilotContext): boolean {
  const total =
    ctx.totalTokens.agentA.inputTokens + ctx.totalTokens.agentA.outputTokens +
    ctx.totalTokens.agentB.inputTokens + ctx.totalTokens.agentB.outputTokens;
  return total >= ctx.maxTokens;
}

// ─── Schedule Window Validation ──────────────────────────────────────────

export function isOutsideScheduleWindow(ctx: AutopilotContext): boolean {
  if (!ctx.scheduleEndTime) return false;
  return Date.now() > ctx.scheduleEndTime;
}

// ─── Rate Limit Detection and Parsing ────────────────────────────────────

export function isRateLimitError(error: string): boolean {
  return /rate.?limit|overloaded|too many requests|429/i.test(error);
}

export function parseRateLimitReset(error: string): number {
  // Try to extract reset time from error message
  const match = error.match(/resets?\s+(\w+\s+\d{1,2},?\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (match) {
    try {
      const resetDate = new Date(match[1]!);
      if (!isNaN(resetDate.getTime())) return resetDate.getTime();
    } catch { /* fallback */ }
  }
  // Default: wait 5 minutes
  return Date.now() + 5 * 60 * 1000;
}