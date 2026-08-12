// Pure decision helpers for the workspace design bar's dirty-draft handling.
// No React or network imports here; keep this file testable in isolation.

export type DirtyAction = 'load' | 'prompt';

/**
 * Decides whether loading a different design can proceed immediately or
 * whether the user must be prompted first because the current draft has
 * unsaved changes.
 *
 * `baseline` is the last-synced serialized design (or null before any
 * load/save has happened). `current` is the serialized draft right now.
 */
export function decideLoad(current: string, baseline: string | null): DirtyAction {
  if (baseline === null || baseline === current) return 'load';
  return 'prompt';
}

export type PromptChoice = 'save' | 'discard' | 'cancel';
export type SaveMode = 'update' | 'saveAs' | 'blocked';

/**
 * Decides how (or whether) the dirty prompt's Save action should persist the
 * current draft before the pending load proceeds.
 *
 * For `discard` and `cancel` the caller never saves, so this returns
 * `blocked` for both; those choices are handled by the caller without
 * calling into the save path at all.
 */
export function resolveSaveMode(
  choice: PromptChoice,
  loadedDesignId: string | null,
  pendingName: string,
): SaveMode {
  if (choice !== 'save') return 'blocked';
  if (loadedDesignId) return 'update';
  if (pendingName.trim()) return 'saveAs';
  return 'blocked';
}
