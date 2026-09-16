/**
 * The receipt for what the assistant changed — or is asking permission to.
 *
 * ## Why a card and not just the reply text
 *
 * The assistant already says "added 12 boxes of the oak" in prose. The card is
 * not a repetition of that; it is the part the prose cannot be trusted for. A
 * model can narrate a write that failed, or narrate two when it made one. This
 * renders the actions the CLIENT actually holds, with the status the client
 * actually observed — so a failure shows as a failure under a sentence claiming
 * success, which is the honest way round.
 *
 * ## Three audiences, three renderings
 *
 *  - **The actor, pending confirmation** — buttons. This is the only state with
 *    controls, and it exists for destructive and overwriting writes only.
 *  - **The actor, after the fact** — a checked or failed line per action.
 *  - **Everyone else in the room** — the list, with no status and no controls.
 *    Their device did not run these and cannot know how they went; claiming
 *    "applied" here would be a guess rendered as a fact.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import { useAppColors } from '@theme';
import { CornerRadius, Spacing } from '@theme/designTokens';

import type { ChatMessageActions } from './useChatActions';

interface Props {
  entry: ChatMessageActions;
  onConfirm: () => void;
  onDecline: () => void;
}

export function ChatActionCard({ entry, onConfirm, onDecline }: Props) {
  const colors = useAppColors();
  const { actions, states, isActor } = entry;
  if (actions.length === 0) return null;

  const awaitingConfirm =
    isActor && actions.some((a) => a.confirm && states[a.id]?.status === 'pending');
  const busy = actions.some((a) => states[a.id]?.status === 'running');

  return (
    <View
      testID="chat-action-card"
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderColor }]}
    >
      {actions.map((action) => {
        const state = states[action.id] ?? { status: 'pending' as const };
        // A non-actor sees the change, not a verdict on it.
        const glyph = !isActor
          ? null
          : state.status === 'applied'
            ? { name: 'checkmark-circle' as const, color: colors.success }
            : state.status === 'failed'
              ? { name: 'alert-circle' as const, color: colors.error }
              : state.status === 'declined'
                ? { name: 'close-circle' as const, color: colors.textSecondary }
                : null;

        return (
          <View key={action.id} style={styles.row}>
            {state.status === 'running' ? (
              <ActivityIndicator size="small" color={colors.primary} style={styles.glyph} />
            ) : glyph ? (
              <Icon name={glyph.name} size={16} color={glyph.color} style={styles.glyph} />
            ) : (
              <View style={[styles.bullet, { backgroundColor: colors.textSecondary }]} />
            )}
            <View style={styles.rowText}>
              <Typography
                variant="footnote"
                color={state.status === 'declined' ? colors.textSecondary : colors.textPrimary}
              >
                {action.summary}
              </Typography>
              {state.status === 'failed' && !!state.error && (
                <Typography variant="caption2" color={colors.error}>
                  {state.error}
                </Typography>
              )}
            </View>
          </View>
        );
      })}

      {awaitingConfirm && !busy && (
        <View style={styles.buttons}>
          <Pressable
            onPress={onDecline}
            accessibilityRole="button"
            accessibilityLabel="Don't make this change"
            testID="chat-action-decline"
            style={[styles.btn, { borderColor: colors.borderColor }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
              Not now
            </Typography>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel="Confirm this change"
            testID="chat-action-confirm"
            style={[styles.btn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              Confirm
            </Typography>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: CornerRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  glyph: { marginTop: 1, width: 16 },
  bullet: { width: 4, height: 4, borderRadius: 2, marginTop: 7, marginLeft: 6, marginRight: 6 },
  rowText: { flex: 1, gap: 2 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.xs, marginTop: Spacing.xs },
  btn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
