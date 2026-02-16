/**
 * Autopilot Service — orchestrates dual-Claude autonomous collaboration.
 *
 * Agent A (Thinker) analyzes/reviews → Agent B (Doer) implements → auto-commit → loop.
 * Uses EventEmitter pattern (like graph-runner.ts) for real-time streaming to WebSocket.
 *
 * ## Architecture (Refactored)
 *
 * This module now acts as a facade, delegating to focused, modular services:
 *
 * - **autopilot-run-manager.ts** - Run lifecycle management and database persistence
 * - **autopilot-cycle-executor.ts** - Core cycle logic (Agent A → Agent B → auto-commit)
 * - **autopilot-agent-runner.ts** - Claude CLI spawn and streaming setup
 * - **autopilot-test-verifier.ts** - Test detection, execution, and reporting
 * - **autopilot-prompt-builder.ts** - Template-based prompt generation
 * - **autopilot-validators.ts** - Pure validation functions (token budget, schedule, rate limits)
 *
 * This refactoring reduces the original 1,057-line monolithic file into 6 focused modules,
 * each with a single responsibility, improving maintainability and testability.
 */

// Re-export types and functions from the new modular architecture
export type {
  AutopilotRunConfig,
  AutopilotContext
} from './autopilot-run-manager.js';

export {
  cleanupZombieRuns,
  startAutopilotRun,
  getActiveRun,
  pauseRun,
  resumeRun,
  abortRun,
  resumeFailedRun
} from './autopilot-run-manager.js';

