import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import {
  activeInjuries,
  addInjury,
  affectsExerciseSuggestions,
  bodyPartById,
  bodyPartsByRegion,
  deleteInjury,
  draftFromInjury,
  editInjury,
  emptyInjuryDraft,
  injuryCauseLabel,
  injuryTypeLabel,
  INJURY_CAUSES,
  INJURY_TYPES,
  loadInjuries,
  loggedAgoLabel,
  PAIN_LEVELS,
  PAIN_LEVEL_LABELS,
  painLevelLabel,
  reactivateInjury,
  resolveInjury,
  resolvedInjuries,
  summarizeInjuries,
  validateInjuryDraft,
  type Injury,
  type InjuryDraft,
} from '../healthInjuryStorage';
import { maskDayKeyInput } from '../healthLocalStorage';

/**
 * Injury log — the donor's pain tracker (`BodyPainTrackerView` /
 * `InjuriesTabContentView`), and the WRITE half of the workout safety gate.
 *
 * What this screen is for: the workout library already flags movements that
 * load an injured part ("Avoid for now" / "Take care", plus a two-tap guard
 * before logging one). Until this screen existed there was no way to record an
 * injury, so that gate could never fire. Everything here feeds
 * `/health/injuries*`, which is what `/health/exercises` reads to compute those
 * flags.
 *
 * ── WHAT THIS SCREEN DOES NOT DO ─────────────────────────────────────────────
 *
 * It records what the user tells it. It does not diagnose, does not grade a
 * condition, and does not advise treatment. The donor's "Recovery Tips" card
 * ("Professional recommendations", "Consult a professional for persistent
 * pain", "Use RICE…") and its per-level interpretations ("Noticeable pain, may
 * limit some activities") are deliberately absent — see the header of
 * `healthInjuryStorage.ts`. The only claim this screen makes is a mechanical
 * one: which entries are currently steering the exercise list.
 *
 * ── DELIBERATE DIFFERENCES FROM THE DONOR ────────────────────────────────────
 *
 *  - **Resolved injuries are visible and reopenable.** The donor filters healed
 *    rows out of every list, so they become permanently unreachable and a
 *    flare-up has to be logged from scratch. The deployed route allows
 *    `is_active: true` on PUT precisely so it does not have to be.
 *  - **The form is INLINE, not a sheet.** The donor stacks six
 *    `.sheet(isPresented:)` modifiers and carries an in-code comment about the
 *    resulting "Attempt to present while a presentation is in progress" bug;
 *    UI_PARITY_AUDIT §8 declines that pattern, and the diary's edit/move verbs
 *    shipped inline for the same reason.
 *  - **There is a date field.** The donor always stamps today and cannot log a
 *    yesterday's injury. The route takes an optional `YYYY-MM-DD`.
 *  - **No interactive body map and no clinical muscle-group picker.** The map is
 *    a silhouette-drawing project of its own; the muscle picker offered "ACL",
 *    "MCL", "Meniscus", which is self-diagnosis. The gate reads neither.
 *  - **Delete confirms inline (two taps), not in an Alert.** Same reason as the
 *    form, and it keeps the destructive verb assertable.
 */

const CARD_KEYS = { active: 'active', resolved: 'resolved' } as const;

export function HealthInjuriesScreen() {
  const colors = useAppColors();

  const [injuries, setInjuries] = useState<Injury[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InjuryDraft>(() => emptyInjuryDraft());
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hydrate = useCallback(async () => {
    setInjuries(await loadInjuries());
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const live = useMemo(() => activeInjuries(injuries), [injuries]);
  const healed = useMemo(() => resolvedInjuries(injuries), [injuries]);
  const summary = useMemo(() => summarizeInjuries(injuries), [injuries]);

  const selectedPart = draft.bodyPartId === null ? null : bodyPartById(draft.bodyPartId);
  const selectedPartGates = selectedPart !== null && affectsExerciseSuggestions(selectedPart.id);

  const openForm = (injury: Injury | null) => {
    setDraft(injury === null ? emptyInjuryDraft() : draftFromInjury(injury));
    setEditingId(injury?.id ?? null);
    setFormOpen(true);
    setMessage(null);
    setConfirmingDeleteId(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyInjuryDraft());
  };

  const setDraftField = <K extends keyof InjuryDraft>(key: K, value: InjuryDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    const validated = validateInjuryDraft(draft);
    if (!validated.valid) {
      setMessage(validated.message);
      return;
    }
    setSaving(true);
    const result =
      editingId === null
        ? await addInjury(validated.payload)
        : await editInjury(editingId, validated.payload);
    setSaving(false);
    setInjuries(result.injuries);
    setMessage(result.message);
    // A rejected write left nothing on the server, so the form stays open with
    // the user's input intact rather than silently discarding it.
    if (result.status !== 'rejected') closeForm();
  };

  const runRowAction = async (action: () => Promise<{
    injuries: Injury[];
    message: string | null;
  }>) => {
    const result = await action();
    setInjuries(result.injuries);
    setMessage(result.message);
    setConfirmingDeleteId(null);
  };

  return (
    <HealthSectionScreen title="Injuries" testID="health-injuries-screen" loading={loading}>
      {/* What the log is for — stated mechanically, with no health claim */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-injuries-summary"
      >
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            YOUR LOG
          </Typography>
          {!formOpen && (
            <Pressable
              onPress={() => openForm(null)}
              accessibilityRole="button"
              accessibilityLabel="Log an injury"
              testID="health-injuries-add"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                Log an injury
              </Typography>
            </Pressable>
          )}
        </View>
        <Typography
          variant="body"
          color={colors.textPrimary}
          testID="health-injuries-counts"
          accessibilityLabel={`${summary.active} active, ${summary.resolved} resolved`}
        >
          {summary.active} active · {summary.resolved} resolved
        </Typography>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="health-injuries-gate-note"
        >
          {summary.gatingParts.length === 0
            ? 'Nothing here is changing your exercise suggestions right now.'
            : `Workouts that load ${listInWords(summary.gatingParts)} are flagged in the Workouts library while these stay active.`}
        </Typography>
      </Card>

      {message && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-injuries-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {/* The form — inline, never a sheet (see the header) */}
      {formOpen && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-injuries-form"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {editingId === null ? 'LOG AN INJURY' : 'EDIT ENTRY'}
          </Typography>

          {/* 1 — Affected area. The only required field, as in the donor. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Affected area
          </Typography>
          {bodyPartsByRegion().map((group) => (
            <View key={group.region} style={styles.filterRow}>
              <Typography variant="caption2" color={colors.textSecondary}>
                {group.label}
              </Typography>
              <View style={styles.chipWrap}>
                {group.parts.map((part) => {
                  const active = draft.bodyPartId === part.id;
                  return (
                    <Chip
                      key={part.id}
                      label={part.wire}
                      selected={active}
                      onPress={() => setDraftField('bodyPartId', part.id)}
                      accessibilityLabel={`Affected area: ${part.wire}`}
                      testID={`health-injury-part-${part.id}`}
                    />
                  );
                })}
              </View>
            </View>
          ))}
          {selectedPart !== null && !selectedPartGates && (
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-injury-part-no-gate"
            >
              {selectedPart.wire} is recorded in your log, but no exercise in the library is
              matched to it, so your suggestions will not change.
            </Typography>
          )}

          {/* 2 — Pain level. Names only; the donor's interpretations are dropped. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Pain level
          </Typography>
          <View style={styles.chipWrap} testID="health-injury-pain-row">
            {PAIN_LEVELS.map((level) => (
              <Chip
                key={level}
                label={PAIN_LEVEL_LABELS[level]}
                selected={draft.painLevel === level}
                onPress={() => setDraftField('painLevel', level)}
                accessibilityLabel={`Pain level: ${PAIN_LEVEL_LABELS[level]}`}
                testID={`health-injury-pain-${level}`}
              />
            ))}
          </View>

          {/* 3 — Type of discomfort (donor's own section name) */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Type of discomfort
          </Typography>
          <View style={styles.chipWrap}>
            {INJURY_TYPES.map((type) => (
              <Chip
                key={type.id}
                label={type.label}
                selected={draft.injuryType === type.id}
                onPress={() => setDraftField('injuryType', type.id)}
                accessibilityLabel={`Type: ${type.label}`}
                testID={`health-injury-type-${type.id}`}
              />
            ))}
          </View>

          {/* 4 — Cause */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Cause
          </Typography>
          <View style={styles.chipWrap}>
            {INJURY_CAUSES.map((cause) => (
              <Chip
                key={cause.id}
                label={cause.label}
                selected={draft.cause === cause.id}
                onPress={() =>
                  setDraftField('cause', draft.cause === cause.id ? null : cause.id)
                }
                accessibilityLabel={`Cause: ${cause.label}`}
                testID={`health-injury-cause-${cause.id}`}
              />
            ))}
          </View>

          {/* 5 — Date. The donor always stamps today; the route takes a day key. */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Date
          </Typography>
          <TextInput
            value={draft.date}
            onChangeText={(raw) => setDraftField('date', maskDayKeyInput(raw))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            autoCorrect={false}
            accessibilityLabel="Date, as YYYY-MM-DD"
            testID="health-injury-date-input"
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />

          {/* 6 — Notes, free text */}
          <Typography variant="caption1" color={colors.textSecondary}>
            Notes
          </Typography>
          <TextInput
            value={draft.notes}
            onChangeText={(raw) => setDraftField('notes', raw)}
            placeholder="Anything you want to remember about it"
            placeholderTextColor={colors.textSecondary}
            multiline
            accessibilityLabel="Notes"
            testID="health-injury-notes-input"
            style={[
              styles.input,
              styles.notesInput,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />

          <View style={styles.formActions}>
            <Pressable
              onPress={() => void handleSave()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              accessibilityLabel={editingId === null ? 'Save injury' : 'Save changes'}
              testID="health-injury-save"
              style={[
                styles.primaryButton,
                { backgroundColor: saving ? colors.borderColor : colors.primary },
              ]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.white}>
                {editingId === null ? 'Save' : 'Save changes'}
              </Typography>
            </Pressable>
            <Pressable
              onPress={closeForm}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              testID="health-injury-cancel"
              style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                Cancel
              </Typography>
            </Pressable>
          </View>
        </Card>
      )}

      {/* Active */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-injuries-active-card"
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          ACTIVE
        </Typography>
        {live.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-injuries-active-empty"
          >
            Nothing active. Log an injury if something is bothering you and the Workouts library
            will flag exercises that load it.
          </Typography>
        ) : (
          live.map((injury) => (
            <InjuryRow
              key={injury.id}
              injury={injury}
              variant={CARD_KEYS.active}
              confirmingDelete={confirmingDeleteId === injury.id}
              onEdit={() => openForm(injury)}
              onPrimary={() => void runRowAction(() => resolveInjury(injury.id))}
              onDelete={() =>
                confirmingDeleteId === injury.id
                  ? void runRowAction(() => deleteInjury(injury.id))
                  : setConfirmingDeleteId(injury.id)
              }
            />
          ))
        )}
      </Card>

      {/* Resolved — visible and reopenable, unlike the donor */}
      {healed.length > 0 && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-injuries-resolved-card"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            RESOLVED
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Kept so you can look back, and reopened in one tap if it comes back.
          </Typography>
          {healed.map((injury) => (
            <InjuryRow
              key={injury.id}
              injury={injury}
              variant={CARD_KEYS.resolved}
              confirmingDelete={confirmingDeleteId === injury.id}
              onEdit={() => openForm(injury)}
              onPrimary={() => void runRowAction(() => reactivateInjury(injury.id))}
              onDelete={() =>
                confirmingDeleteId === injury.id
                  ? void runRowAction(() => deleteInjury(injury.id))
                  : setConfirmingDeleteId(injury.id)
              }
            />
          ))}
        </Card>
      )}
    </HealthSectionScreen>
  );
}

/** "your left knee" / "your knee and lower back" — the user's own wording. */
function listInWords(names: string[]): string {
  const lower = names.map((n) => n.toLowerCase());
  if (lower.length === 1) return `your ${lower[0]}`;
  const head = lower.slice(0, -1).join(', ');
  return `your ${head} and ${lower[lower.length - 1]}`;
}

function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      testID={testID}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.backgroundMain,
          borderColor: colors.borderColor,
        },
      ]}
    >
      <Typography
        variant="caption1"
        weight="semibold"
        color={selected ? colors.white : colors.textSecondary}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

function InjuryRow({
  injury,
  variant,
  confirmingDelete,
  onEdit,
  onPrimary,
  onDelete,
}: {
  injury: Injury;
  variant: 'active' | 'resolved';
  confirmingDelete: boolean;
  onEdit: () => void;
  onPrimary: () => void;
  onDelete: () => void;
}) {
  const colors = useAppColors();
  const isActive = variant === 'active';

  return (
    <View
      testID={`health-injury-row-${injury.id}`}
      style={[styles.row, { borderTopColor: colors.borderColor }]}
    >
      <View style={styles.rowText}>
        <Typography variant="body" color={colors.textPrimary}>
          {injury.bodyPart}
        </Typography>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`health-injury-meta-${injury.id}`}
        >
          {injuryTypeLabel(injury.injuryType)} · {painLevelLabel(injury.painLevel)} ·{' '}
          {loggedAgoLabel(injury.date)}
        </Typography>
        <Typography variant="caption2" color={colors.textSecondary}>
          Cause: {injuryCauseLabel(injury.cause)}
        </Typography>
        {injury.notes.length > 0 && (
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            testID={`health-injury-notes-${injury.id}`}
          >
            {injury.notes}
          </Typography>
        )}

        <View style={styles.rowActions}>
          <RowAction
            icon="edit"
            label={`Edit ${injury.bodyPart} entry`}
            text="Edit"
            tone={colors.textSecondary}
            onPress={onEdit}
            testID={`health-injury-edit-${injury.id}`}
          />
          <RowAction
            icon={isActive ? 'complete' : 'history'}
            label={
              isActive
                ? `Mark ${injury.bodyPart} entry resolved`
                : `Reopen ${injury.bodyPart} entry`
            }
            text={isActive ? 'Mark resolved' : 'Reopen'}
            tone={colors.primary}
            onPress={onPrimary}
            testID={`health-injury-${isActive ? 'resolve' : 'reopen'}-${injury.id}`}
          />
          <RowAction
            icon="delete"
            label={
              confirmingDelete
                ? `Confirm deleting ${injury.bodyPart} entry`
                : `Delete ${injury.bodyPart} entry`
            }
            text={confirmingDelete ? 'Tap again to delete' : 'Delete'}
            tone={colors.error}
            onPress={onDelete}
            testID={`health-injury-delete-${injury.id}`}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Icon + caption, never an icon alone — the repo's swipe/row-action rule: a bare
 * glyph is unreadable to VoiceOver and ambiguous next to a destructive sibling.
 */
function RowAction({
  icon,
  label,
  text,
  tone,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  text: string;
  tone: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
      style={styles.rowAction}
    >
      <Icon name={icon} size={14} color={tone} />
      <Typography variant="caption1" weight="semibold" color={tone}>
        {text}
      </Typography>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  filterRow: {
    gap: Spacing.xs,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  notesInput: {
    minHeight: 72,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingTop: Spacing.xs,
  },
  rowAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
