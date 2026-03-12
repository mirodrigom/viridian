import { ref, computed, reactive } from 'vue';
import { createSessionState, type SessionState } from './useSessionState';

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

const sessions = reactive(new Map<string, SessionState>());
const activeSessionId = ref<string | null>(null);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

/** The currently active session, derived from activeSessionId. */
const activeSession = computed<SessionState | null>(() => {
  if (!activeSessionId.value) return null;
  return sessions.get(activeSessionId.value) ?? null;
});

/** IDs of all sessions that are currently streaming. */
const streamingSessionIds = computed<string[]>(() => {
  const ids: string[] = [];
  for (const [id, state] of sessions) {
    if (state.isStreaming) {
      ids.push(id);
    }
  }
  return ids;
});

/** Whether any session is currently streaming. */
const isAnyStreaming = computed(() => streamingSessionIds.value.length > 0);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Return the SessionState for the given ID, creating one if it doesn't exist.
 */
function getOrCreateSession(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = createSessionState(sessionId);
    sessions.set(sessionId, state);
  }
  return state;
}

/**
 * Remove a session from the registry. If it was the active session,
 * activeSessionId is set to null.
 */
function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
  if (activeSessionId.value === sessionId) {
    activeSessionId.value = null;
  }
}

/**
 * Switch to the given session, creating it if it doesn't exist yet.
 */
function switchToSession(sessionId: string): void {
  getOrCreateSession(sessionId);
  activeSessionId.value = sessionId;
}

// ---------------------------------------------------------------------------
// Composable export
// ---------------------------------------------------------------------------

/**
 * Singleton composable for managing multiple concurrent SessionState instances.
 * Module-level state ensures all consumers share the same registry.
 */
export function useSessionRegistry() {
  return {
    // State
    sessions,
    activeSessionId,

    // Computed
    activeSession,
    streamingSessionIds,
    isAnyStreaming,

    // Actions
    getOrCreateSession,
    removeSession,
    switchToSession,
  };
}
