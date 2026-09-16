/**
 * Edit one line of a project's plan — a Timeline phase, or a Blocker.
 *
 * A sheet rather than an inline editor that grows inside the row, and that is a
 * consequence of how the rows are reordered: `ReorderableList` measures every
 * row to run the drag, so a row that doubles in height when it is tapped
 * changes the geometry the sorter is holding. Editing somewhere else leaves the
 * list still a list.
 *
 * A sheet rather than `Alert.prompt` for `HomeProjectRenameSheet`'s reason:
 * `Alert.prompt` is iOS-only and this ships on Android too.
 *
 * `height="short"` and never `"content"` — a content-sized sheet has no
 * definite height in this chain and collapses to zero on device. See the note
 * on `contentAuto` in `BottomSheet`.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type {
  HomeProjectBlocker,
  HomeProjectBlockerStatus,
  HomeProjectPhase,
  HomeProjectPhaseStatus,
} from '@api/home-projects';
import {
  BottomSheet,
  GradientButton,
  TextInput,
  Typography,
} from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

/** `phases`/`blockers` route schemas — `z.string().min(1).max(200)`. */
export const STEP_TITLE_MAX_LENGTH = 200;
/** `blockers` route schema — `notes: z.string().max(4000)`. */
export const BLOCKER_NOTES_MAX_LENGTH = 4000;

export const PHASE_STATUS_LABELS: Record<HomeProjectPhaseStatus, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

export const BLOCKER_SEVERITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const BLOCKER_STATUS_LABELS: Record<HomeProjectBlockerStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
};

const BLOCKER_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/**
 * A labelled row of exclusive choices.
 *
 * Not `<Chip>`: that primitive is a status badge that happens to take an
 * `onPress`, so a selected and an unselected one differ only in tint and a row
 * of them reads as four badges rather than one question with four answers. The
 * selected option here is filled and the rest are outlined, which is the same
 * shape as the section tabs at the top of this screen.
 */
function ChoiceRow<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
  testID,
}: {
  label: string;
  options: readonly T[];
  labels: Record<string, string>;
  value: T;
  onChange: (next: T) => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.choiceBlock}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <View style={styles.choiceRow}>
        {options.map(option => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`${testID}-${option}`}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? colors.primary : 'transparent',
                  borderColor: selected ? colors.primary : colors.borderColor,
                },
              ]}
            >
              <Typography
                variant="footnote"
                weight="semibold"
                color={selected ? colors.white : colors.textPrimary}
              >
                {labels[option] ?? option}
              </Typography>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Delete, kept visually quiet and textually explicit.
 *
 * The caller owns the confirmation — this sheet does not know whether the row
 * it is showing is one the member just typed or one a Smart Project draft has
 * been built around.
 */
function DeleteButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      style={styles.deleteButton}
    >
      <Typography
        variant="body"
        weight="semibold"
        color={disabled ? colors.textTertiary : colors.error}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

export interface PhasePatch {
  title?: string;
  status?: HomeProjectPhaseStatus;
}

/** Normalises whatever a backend stored into one of the three offered. */
export function readPhaseStatus(status: string): HomeProjectPhaseStatus {
  const value = status.toLowerCase();
  // `smart-project.ts` treats all three of these as finished, so the badge must
  // too — a phase stored as `complete` by an older writer is Done here, not an
  // unknown that silently resets to Not started the first time it is edited.
  if (value === 'done' || value === 'complete' || value === 'completed') {
    return 'done';
  }
  if (value === 'in_progress' || value === 'active') return 'in_progress';
  return 'pending';
}

export function PhaseEditSheet({
  visible,
  phase,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  /** Null while closed — the sheet outlives any one phase. */
  phase: HomeProjectPhase | null;
  onClose: () => void;
  /** Rejects on failure: the sheet stays open so the edit is not lost. */
  onSave: (patch: PhasePatch) => Promise<void>;
  onDelete: () => void;
}) {
  const colors = useAppColors();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<HomeProjectPhaseStatus>('pending');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && phase) {
      setTitle(phase.title);
      setStatus(readPhaseStatus(phase.status));
    }
  }, [visible, phase]);

  const trimmed = title.trim();
  const changed =
    trimmed !== (phase?.title ?? '').trim() ||
    status !== readPhaseStatus(phase?.status ?? 'pending');
  const canSave = trimmed.length > 0 && changed;

  const save = async () => {
    if (!canSave) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      // Only what actually changed: an unchanged title in the patch is a write
      // that can lose a rename another member made between the read and here.
      await onSave({
        ...(trimmed !== (phase?.title ?? '').trim() ? { title: trimmed } : {}),
        ...(status !== readPhaseStatus(phase?.status ?? 'pending')
          ? { status }
          : {}),
      });
      onClose();
    } catch {
      // The caller raises the alert; staying open keeps what was typed.
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Edit phase"
      height="short"
      showCloseButton
    >
      <View style={styles.body}>
        <TextInput
          testID="home-project-phase-title-input"
          label="Phase"
          placeholder="Insulate walls and ceiling"
          value={title}
          onChangeText={setTitle}
          maxLength={STEP_TITLE_MAX_LENGTH}
          autoCapitalize="sentences"
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />

        <ChoiceRow
          label="Where it has got to"
          options={['pending', 'in_progress', 'done'] as const}
          labels={PHASE_STATUS_LABELS}
          value={status}
          onChange={setStatus}
          testID="home-project-phase-status"
        />

        <GradientButton
          title={saving ? 'Saving…' : 'Save'}
          disabled={saving || !canSave}
          fullWidth
          onPress={() => void save()}
          testID="home-project-phase-save"
        />

        <DeleteButton
          label="Delete phase"
          disabled={saving}
          onPress={onDelete}
          testID="home-project-phase-delete"
        />

        <Typography variant="caption2" color={colors.textTertiary}>
          Drag the grip beside a phase to change the order.
        </Typography>
      </View>
    </BottomSheet>
  );
}

export interface BlockerPatch {
  title?: string;
  severity?: string;
  status?: HomeProjectBlockerStatus;
  notes?: string | null;
}

/** Anything a backend stored that is not `resolved` is still in the way. */
export function readBlockerStatus(status: string): HomeProjectBlockerStatus {
  return status.toLowerCase() === 'resolved' ? 'resolved' : 'open';
}

export function BlockerEditSheet({
  visible,
  blocker,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  blocker: HomeProjectBlocker | null;
  onClose: () => void;
  onSave: (patch: BlockerPatch) => Promise<void>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<string>('medium');
  const [status, setStatus] = useState<HomeProjectBlockerStatus>('open');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && blocker) {
      setTitle(blocker.title);
      setSeverity(
        BLOCKER_SEVERITIES.includes(
          blocker.severity as (typeof BLOCKER_SEVERITIES)[number],
        )
          ? blocker.severity
          : 'medium',
      );
      setStatus(readBlockerStatus(blocker.status));
      setNotes(blocker.notes ?? '');
    }
  }, [visible, blocker]);

  const trimmedTitle = title.trim();
  const trimmedNotes = notes.trim();
  // `null` and `''` are the same thing to a member and different rows in D1;
  // the empty string is normalised to null so clearing a note twice is not two
  // different writes.
  const nextNotes = trimmedNotes.length > 0 ? trimmedNotes : null;
  const titleChanged = trimmedTitle !== (blocker?.title ?? '').trim();
  const severityChanged = severity !== (blocker?.severity ?? 'medium');
  const statusChanged = status !== readBlockerStatus(blocker?.status ?? 'open');
  const notesChanged = nextNotes !== (blocker?.notes ?? null);
  const canSave =
    trimmedTitle.length > 0 &&
    (titleChanged || severityChanged || statusChanged || notesChanged);

  const save = async () => {
    if (!canSave) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...(titleChanged ? { title: trimmedTitle } : {}),
        ...(severityChanged ? { severity } : {}),
        ...(statusChanged ? { status } : {}),
        ...(notesChanged ? { notes: nextNotes } : {}),
      });
      onClose();
    } catch {
      // As above: the caller alerts, the sheet keeps the edit.
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Edit blocker"
      height="standard"
      showCloseButton
    >
      <View style={styles.body}>
        <TextInput
          testID="home-project-blocker-title-input"
          label="Blocker"
          placeholder="Permits for change of use"
          value={title}
          onChangeText={setTitle}
          maxLength={STEP_TITLE_MAX_LENGTH}
          autoCapitalize="sentences"
        />

        <ChoiceRow
          label="How much it matters"
          options={BLOCKER_SEVERITIES}
          labels={BLOCKER_SEVERITY_LABELS}
          value={severity}
          onChange={setSeverity}
          testID="home-project-blocker-severity"
        />

        <ChoiceRow
          label="Still in the way?"
          options={['open', 'resolved'] as const}
          labels={BLOCKER_STATUS_LABELS}
          value={status}
          onChange={setStatus}
          testID="home-project-blocker-status"
        />

        <TextInput
          testID="home-project-blocker-notes-input"
          label="What you found out"
          placeholder="Council says a change of use needs a permit"
          value={notes}
          onChangeText={setNotes}
          maxLength={BLOCKER_NOTES_MAX_LENGTH}
          multiline
          autoCapitalize="sentences"
        />

        <GradientButton
          title={saving ? 'Saving…' : 'Save'}
          disabled={saving || !canSave}
          fullWidth
          onPress={() => void save()}
          testID="home-project-blocker-save"
        />

        <DeleteButton
          label="Delete blocker"
          disabled={saving}
          onPress={onDelete}
          testID="home-project-blocker-delete"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.base, paddingBottom: Spacing.lg },
  choiceBlock: { gap: Spacing.sm },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  choice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
  },
  deleteButton: { alignSelf: 'center', paddingVertical: Spacing.sm },
});
