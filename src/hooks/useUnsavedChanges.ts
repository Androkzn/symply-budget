import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { showToast } from '@services/toastManager';

/**
 * Structural deep-equality tuned for JSON-ish form state (primitives, plain
 * objects, arrays, and Dates). Good enough to tell whether an edit form has
 * diverged from its last-saved snapshot without pulling in a dependency.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keysA = Object.keys(aObj);
  const keysB = Object.keys(bObj);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

/**
 * Pure change detector: `true` when the live form `values` differ from the
 * last-saved `baseline`. Use directly when a screen manages its own save flow
 * (e.g. a react-query mutation) and only needs to gate the Save button.
 */
export function useIsDirty<T>(values: T, baseline: T): boolean {
  return useMemo(() => !deepEqual(values, baseline), [values, baseline]);
}

export interface UseUnsavedChangesOptions<T> {
  /** Live form state. */
  values: T;
  /** The last-saved snapshot to diff against (usually derived from loaded data). */
  baseline: T;
  /**
   * Persists the change. Throw to surface the error toast. Return `false` to
   * abort quietly — use this when the caller already showed its own validation
   * message and does not want the success toast / close to fire.
   */
  onSave: () => Promise<unknown> | unknown;
  /** Dismisses the view after a successful save: `navigation.goBack()` or a modal `onClose`. */
  onClose: () => void;
  /** Toast shown on success. */
  successMessage?: string;
  /**
   * When false, {@link save} no-ops even if the form looks editable. Defaults to
   * `isDirty`; pass a custom predicate for E2E cases where native input does not
   * fire `onChangeText` before Save.
   */
  saveWhen?: (values: T, isDirty: boolean) => boolean;
  /** Toast shown when `onSave` throws. */
  errorMessage?: string;
}

export interface UseUnsavedChangesResult {
  /** Whether the form has unsaved edits. Drive the Save button with `disabled={!isDirty}`. */
  isDirty: boolean;
  /** Whether a save is in flight. Drive the Save button with `loading={isSaving}`. */
  isSaving: boolean;
  /**
   * Runs the save: no-ops when there is nothing to save or a save is already in
   * flight; on success shows a confirmation toast then closes the view; on
   * failure shows an error toast and keeps the view open.
   */
  save: () => Promise<void>;
  /**
   * Guarded dismiss for a Back/Cancel press: prompts to discard when the form is
   * dirty, otherwise closes immediately.
   */
  confirmDiscard: (onDiscard?: () => void) => void;
}

/**
 * Standard behaviour for editing screens: track changes, disable Save when
 * nothing changed, and on a successful save show a confirmation toast and close
 * the view. Keeps the three rules in one place so every edit screen behaves the
 * same way.
 *
 * ```tsx
 * const { isDirty, isSaving, save } = useUnsavedChanges({
 *   values: form,
 *   baseline,
 *   onSave: () => api.update(id, form),
 *   onClose: () => navigation.goBack(),
 *   successMessage: 'Changes saved',
 * });
 *
 * <Button title="Save" disabled={!isDirty} loading={isSaving} onPress={save} />
 * ```
 */
export function useUnsavedChanges<T>({
  values,
  baseline,
  onSave,
  onClose,
  successMessage = 'Changes saved',
  errorMessage = 'Could not save. Please try again.',
  saveWhen,
}: UseUnsavedChangesOptions<T>): UseUnsavedChangesResult {
  const [isSaving, setIsSaving] = useState(false);
  const isDirty = useIsDirty(values, baseline);
  const canSave = saveWhen ? saveWhen(values, isDirty) : isDirty;

  const save = useCallback(async () => {
    if (isSaving || !canSave) return;
    setIsSaving(true);
    try {
      const result = await onSave();
      if (result === false) return; // caller aborted (e.g. validation failed)
      showToast('success', successMessage);
      onClose();
    } catch (error) {
      console.warn('[useUnsavedChanges] save failed:', error);
      showToast('error', errorMessage);
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, canSave, onSave, onClose, successMessage, errorMessage]);

  const confirmDiscard = useCallback(
    (onDiscard: () => void = onClose) => {
      if (!isDirty) {
        onDiscard();
        return;
      }
      Alert.alert('Unsaved changes', 'You have unsaved changes. Discard them?', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onDiscard },
      ]);
    },
    [isDirty, onClose]
  );

  return { isDirty, isSaving, save, confirmDiscard };
}
