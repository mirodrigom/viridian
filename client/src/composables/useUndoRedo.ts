import { ref, computed } from 'vue';

export interface UndoRedoOptions {
  /** Maximum number of snapshots to keep in history */
  maxHistory?: number;
  /** Serialize current state to a string snapshot */
  getSnapshot: () => string;
  /** Restore state from a string snapshot. Called inside the restoring guard. */
  restoreSnapshot: (snapshot: string) => void;
}

/**
 * Generic undo/redo snapshot system.
 *
 * Usage:
 * ```ts
 * const { undo, redo, canUndo, canRedo, pushSnapshot, clearHistory } = useUndoRedo({
 *   getSnapshot: () => JSON.stringify(state),
 *   restoreSnapshot: (snap) => Object.assign(state, JSON.parse(snap)),
 * });
 * ```
 */
export function useUndoRedo(options: UndoRedoOptions) {
  const maxHistory = options.maxHistory ?? 50;
  const history = ref<string[]>([]);
  const historyIndex = ref(-1);

  /** Flag to prevent pushSnapshot calls inside mutations triggered by undo/redo */
  let _restoring = false;

  const canUndo = computed(() => historyIndex.value > 0);
  const canRedo = computed(() => historyIndex.value < history.value.length - 1);

  /** Check if we are currently restoring a snapshot (callers can skip side-effects). */
  function isRestoring(): boolean {
    return _restoring;
  }

  /** Capture a snapshot and push it onto the history stack. */
  function pushSnapshot() {
    if (_restoring) return;

    const snap = options.getSnapshot();
    // Truncate any redo stack beyond current index
    history.value = history.value.slice(0, historyIndex.value + 1);
    history.value.push(snap);
    if (history.value.length > maxHistory) {
      history.value = history.value.slice(history.value.length - maxHistory);
    }
    historyIndex.value = history.value.length - 1;
  }

  function undo() {
    if (!canUndo.value) return;
    historyIndex.value--;
    _restoring = true;
    try {
      options.restoreSnapshot(history.value[historyIndex.value]!);
    } finally {
      _restoring = false;
    }
  }

  function redo() {
    if (!canRedo.value) return;
    historyIndex.value++;
    _restoring = true;
    try {
      options.restoreSnapshot(history.value[historyIndex.value]!);
    } finally {
      _restoring = false;
    }
  }

  function clearHistory() {
    history.value = [];
    historyIndex.value = -1;
  }

  return {
    canUndo,
    canRedo,
    undo,
    redo,
    pushSnapshot,
    clearHistory,
    isRestoring,
  };
}
