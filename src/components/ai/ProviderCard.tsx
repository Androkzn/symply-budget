/**
 * AI Providers card — one connected/unconnected provider, rendered the same way
 * across the picker, the manage hub, and the provider-detail screen.
 *
 * Connected: a default-provider `Toggle` (on = the app routes inference through
 * this provider) + an inline model dropdown defaulting to the provider's most
 * capable model. The selected model is highlighted (accent chip + check) in
 * addition to the toggle, and the whole card takes an accent border when active.
 * Unconnected: a Connect CTA (or "Unavailable" when the provider is flag-disabled).
 *
 * Brand-neutral copy (interpolate `brand.displayName`); provider names stay explicit.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AIModelOption, AIProviderId } from '@api/aiAccess';
import { ProviderBrandMark } from '@components/ai/ProviderBrandMark';
import { PROVIDER_META } from '@components/ai/providerMeta';
import { Icon, Toggle, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import type { BYOKConnectionView } from '@hooks/useAIEntitlement';
import { useAppColors } from '@theme';

export interface ProviderCardProps {
  provider: AIProviderId;
  /** null / undefined → not connected. */
  connection?: BYOKConnectionView | null;
  /** This provider is the active (default) one the app routes through. */
  isActive: boolean;
  /**
   * Server says this provider is connected, but THIS device has no key in the
   * Keychain — so every local-first BYOK feature will refuse to run. Rendered as
   * an explicit warning instead of the usual healthy status line, because the
   * server-derived "Active · Validated" is exactly what made this state
   * invisible for a day.
   */
  missingLocalKey?: boolean;
  /**
   * Whether to surface the default-provider toggle + DEFAULT pill at all. Only
   * meaningful with 2+ connected providers — with a single connected key there
   * is nothing to switch between, so the toggle is a no-op and is hidden.
   */
  showDefaultToggle: boolean;
  /** Provider rollout flag — false greys out actions. */
  enabled: boolean;
  /** This provider's selectable catalog (GET /ai-models). */
  models: AIModelOption[];
  modelsLoading?: boolean;
  /** This provider's chosen model id. */
  selectedModelId: string | null;
  /** Any row action is in flight (locks the card). */
  busy?: boolean;
  /** The default toggle specifically is in flight. */
  activatingBusy?: boolean;
  onToggleDefault: (next: boolean) => void;
  onSelectModel: (modelId: string) => void;
  onConnect: () => void;
  onRevalidate: () => void;
  onChangeKey: () => void;
  onDisconnect: () => void;
  /** Open the per-provider detail screen (usage + billing + settings). */
  onOpenDetail?: () => void;
}

function formatStatus(status: string): string {
  const words = status.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}

function formatValidated(iso: string | null): string {
  if (!iso) return 'Never validated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `Validated ${d.toLocaleDateString()}`;
}

export function ProviderCard({
  provider,
  connection,
  isActive,
  missingLocalKey,
  showDefaultToggle,
  enabled,
  models,
  modelsLoading,
  selectedModelId,
  busy,
  activatingBusy,
  onToggleDefault,
  onSelectModel,
  onConnect,
  onRevalidate,
  onChangeKey,
  onDisconnect,
  onOpenDetail,
}: ProviderCardProps) {
  const colors = useAppColors();
  const meta = PROVIDER_META[provider];
  const connected = !!connection;
  const [expanded, setExpanded] = useState(false);

  const statusColor = useMemo(() => {
    const s = (connection?.status ?? '').toLowerCase();
    if (['invalid', 'error', 'expired', 'revoked'].some((k) => s.includes(k))) return colors.error;
    if (s.includes('needs')) return colors.warning; // needs_reconnect
    // A healthy, connected key ("active" / "valid") reads as green — not the amber
    // warning colour it used to fall through to.
    if (s === 'active' || s.includes('valid')) return colors.success;
    return colors.warning;
  }, [connection?.status, colors.success, colors.error, colors.warning]);

  // Fall back to the flagship (then the default) when no explicit pick yet — or
  // when the stored pick is no longer in this provider's catalog. A retired
  // model id (they are pulled when they misbehave) would otherwise match no
  // option: the row read "Most capable" and NOTHING in the list was ticked,
  // making the card look like it had lost its model.
  const storedIsSelectable = !!selectedModelId && models.some((m) => m.id === selectedModelId);
  const effectiveModelId =
    (storedIsSelectable ? selectedModelId : null) ??
    models.find((m) => m.flagship)?.id ??
    models.find((m) => m.is_default)?.id ??
    null;
  const selectedModel = models.find((m) => m.id === effectiveModelId) ?? null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isActive ? meta.accent : colors.borderColor,
          borderWidth: isActive ? 2 : 1,
        },
      ]}
    >
      {/* Header: mark + label + status/tagline + default toggle (or connect chevron) */}
      <View style={styles.header}>
        <ProviderBrandMark provider={provider} size={44} connected={connected} />
        <Pressable
          style={styles.headerText}
          disabled={!connected || !onOpenDetail}
          onPress={onOpenDetail}
          accessibilityRole={connected && onOpenDetail ? 'button' : undefined}
          accessibilityLabel={connected && onOpenDetail ? `${meta.label} details` : undefined}
          testID={`ai-provider-detail-${provider}`}
        >
          <View style={styles.titleRow}>
            <Typography
              variant="headline"
              weight="semibold"
              color={colors.textPrimary}
              numberOfLines={1}
              style={styles.titleLabel}
            >
              {meta.label}
            </Typography>
            {isActive && showDefaultToggle ? (
              <View style={[styles.activePill, { backgroundColor: meta.accent }]}>
                <Typography variant="caption2" weight="bold" color={colors.white}>
                  DEFAULT
                </Typography>
              </View>
            ) : null}
          </View>
          {connected && missingLocalKey ? (
            <View style={styles.statusLine}>
              <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />
              <Typography variant="caption1" weight="semibold" color={colors.warning}>
                Key not on this device
              </Typography>
              <Typography variant="caption1" color={colors.textTertiary}>
                · tap Change key
              </Typography>
            </View>
          ) : connected ? (
            <View style={styles.statusLine}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Typography variant="caption1" weight="semibold" color={statusColor}>
                {formatStatus(connection!.status)}
              </Typography>
              <Typography variant="caption1" color={colors.textTertiary}>
                · {formatValidated(connection!.lastValidatedAt)}
              </Typography>
            </View>
          ) : (
            <Typography variant="subheadline" color={colors.textSecondary}>
              {meta.tagline}
            </Typography>
          )}
        </Pressable>

        {connected ? (
          showDefaultToggle ? (
            activatingBusy ? (
              <ActivityIndicator color={meta.accent} />
            ) : (
              <Toggle
                value={isActive}
                onValueChange={onToggleDefault}
                activeColor={meta.accent}
                disabled={!enabled || busy}
                accessibilityLabel={`Make ${meta.label} the default provider`}
                testID={`ai-default-toggle-${provider}`}
              />
            )
          ) : null
        ) : (
          <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
        )}
      </View>

      {/* Connected: inline model dropdown */}
      {connected ? (
        <>
          <Pressable
            style={[styles.modelRow, { borderTopColor: colors.divider }]}
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`Change ${meta.label} model`}
            testID={`ai-model-row-${provider}`}
          >
            <Icon name="cube-outline" size={16} color={colors.textSecondary} />
            <View style={styles.modelRowText}>
              <Typography variant="caption1" color={colors.textTertiary}>
                Model
              </Typography>
              <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
                {selectedModel?.display_name ?? (modelsLoading ? 'Loading…' : 'Most capable')}
              </Typography>
            </View>
            <Icon
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>

          {expanded ? (
            <View style={styles.modelList}>
              {modelsLoading ? (
                <ActivityIndicator color={meta.accent} style={styles.modelLoader} />
              ) : (
                models.map((m) => {
                  const isSel = m.id === effectiveModelId;
                  return (
                    <Pressable
                      key={m.id}
                      style={[
                        styles.modelOption,
                        {
                          borderColor: isSel ? meta.accent : colors.borderColor,
                          backgroundColor: isSel ? meta.accent + '14' : 'transparent',
                        },
                      ]}
                      disabled={busy}
                      onPress={() => {
                        onSelectModel(m.id);
                        setExpanded(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSel }}
                      /**
                       * The flagship marker rides ON the label, not just in the
                       * badge below.
                       *
                       * This Pressable is an accessibility element, so its label
                       * REPLACES its children in the tree — the "MOST CAPABLE"
                       * badge is rendered, plainly visible, and completely
                       * absent from the hierarchy. VoiceOver users therefore
                       * never learn which model is the flagship, and
                       * `budget-ai-providers` asserted on text no driver could
                       * ever see (confirmed: no element containing "CAPABLE" in
                       * the dump at the failing step, while the screenshot shows
                       * the badge).
                       */
                      accessibilityLabel={
                        m.flagship ? `${m.display_name} MOST CAPABLE` : m.display_name
                      }
                      testID={`ai-model-option-${provider}-${m.id}`}
                    >
                      <View style={styles.modelOptionText}>
                        <View style={styles.titleRow}>
                          <Typography
                            variant="footnote"
                            weight={isSel ? 'semibold' : 'regular'}
                            color={isSel ? meta.accent : colors.textPrimary}
                          >
                            {m.display_name}
                          </Typography>
                          {m.flagship ? (
                            <View style={[styles.tag, { backgroundColor: meta.accent + '22' }]}>
                              <Typography variant="caption2" weight="bold" color={meta.accent}>
                                MOST CAPABLE
                              </Typography>
                            </View>
                          ) : null}
                        </View>
                        {m.profile_label ? (
                          <Typography variant="caption1" color={colors.textTertiary}>
                            {m.profile_label}
                          </Typography>
                        ) : null}
                      </View>
                      {isSel ? <Icon name="checkmark-circle" size={20} color={meta.accent} /> : null}
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : null}

          {onOpenDetail ? (
            <Pressable
              style={[styles.detailRow, { borderTopColor: colors.divider }]}
              onPress={onOpenDetail}
              accessibilityRole="button"
              accessibilityLabel={`${meta.label} usage and billing`}
              testID={`ai-provider-detail-row-${provider}`}
            >
              <Icon name="stats-chart-outline" size={16} color={colors.textSecondary} />
              <Typography variant="caption1" color={colors.textSecondary} style={styles.detailRowText}>
                Usage & billing
              </Typography>
              <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </>
      ) : null}

      {/* Actions */}
      <View style={[styles.actions, { borderTopColor: colors.divider }]}>
        {connected ? (
          <>
            {/* "Test saved key", not "Test connection".
                It re-validates the key held on the SERVER — a bodyless POST to
                /ai-credentials/:provider/validate. That says nothing about this
                device, which keeps its own copy in the Keychain and may not have
                one. Labelled "Test connection" it read as a verdict on the whole
                provider, so a green result sat directly under "Key not on this
                device" and looked like the warning was stale. Both were true;
                only the label was wrong. */}
            <ActionButton label="Test saved key" color={meta.accent} disabled={busy} onPress={onRevalidate} a11y={`Test the saved ${meta.label} key`} />
            <ActionButton label="Change key" color={colors.textSecondary} disabled={busy || !enabled} onPress={onChangeKey} a11y={`Change ${meta.label} key`} />
            <ActionButton label="Disconnect" color={colors.error} disabled={busy} onPress={onDisconnect} a11y={`Disconnect ${meta.label}`} />
          </>
        ) : (
          <ActionButton
            label={enabled ? 'Connect' : 'Unavailable'}
            color={meta.accent}
            disabled={!enabled || busy}
            onPress={onConnect}
            a11y={`Connect ${meta.label}`}
            fill
          />
        )}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  color,
  onPress,
  disabled,
  a11y,
  fill,
}: {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  a11y: string;
  fill?: boolean;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      style={[
        styles.actionBtn,
        // Border tracks the label colour so each action reads as an outline
        // button in its own intent (accent / neutral / destructive) instead of
        // a faint grey box that barely registers as tappable.
        { borderColor: disabled ? colors.borderColor : color },
        fill && styles.actionFill,
        disabled && styles.actionDisabled,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Typography
        variant="footnote"
        weight="semibold"
        color={color}
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, padding: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleLabel: { flexShrink: 1 },
  activePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, flexShrink: 0 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  modelRowText: { flex: 1 },
  modelList: { gap: 8 },
  modelLoader: { marginVertical: 8 },
  modelOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  modelOptionText: { flex: 1, gap: 2 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  detailRowText: { flex: 1 },
  actions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  actionFill: { flex: 1 },
  actionDisabled: { opacity: 0.5 },
});
