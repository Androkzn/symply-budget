/**
 * AnnotatedConsole — an in-app, theme-aware mock of the provider console screen
 * a given step refers to, with the target control boxed and an accent comment
 * pointing at it (a box + arrow + comment, all in the app accent colour).
 *
 * We render this rather than bundling real console screenshots: a screenshot
 * goes stale the moment a provider redesigns, adds app weight, and carries
 * brand-asset concerns. A mock stays crisp, follows the theme, and reads in the
 * app's own colour on every brand. Which screen renders is chosen by the step's
 * `visual`; the copy comes from the step's `example`.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { AIProviderId } from '@api/aiAccess';
import { Icon, Typography } from '@components/ui';
import { useAppColors } from '@theme';

import { ProviderGlyph } from './ProviderLogo';
import { PROVIDER_META, type ProviderGuideStep } from './providerMeta';

interface AnnotatedConsoleProps {
  provider: AIProviderId;
  visual: ProviderGuideStep['visual'];
  /** The accent comment that points at the highlighted control. */
  comment: string;
}

export function AnnotatedConsole({ provider, visual, comment }: AnnotatedConsoleProps) {
  const colors = useAppColors();
  const meta = PROVIDER_META[provider];

  return (
    <View style={[styles.window, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
      {/* Browser chrome pinned to the provider console */}
      <View style={[styles.chrome, { backgroundColor: colors.backgroundSecondary, borderBottomColor: colors.borderColor }]}>
        <View style={styles.trafficLights}>
          <View style={[styles.dot, { backgroundColor: '#FF5F57' }]} />
          <View style={[styles.dot, { backgroundColor: '#FEBC2E' }]} />
          <View style={[styles.dot, { backgroundColor: '#28C840' }]} />
        </View>
        <View style={[styles.urlPill, { backgroundColor: colors.backgroundMain, borderColor: colors.borderColor }]}>
          <Icon name="lock-closed" size={10} color={colors.textTertiary} />
          <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1} style={styles.flex}>
            {meta.consoleName}
          </Typography>
        </View>
      </View>

      {/* Console body — the mock screen for this step */}
      <View style={[styles.body, { backgroundColor: colors.backgroundMain }]}>
        <View style={styles.brandRow}>
          <View style={[styles.brandChip, { backgroundColor: meta.accent }]}>
            <ProviderGlyph provider={provider} size={13} color={colors.white} />
          </View>
          <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
            {meta.label}
          </Typography>
        </View>

        <ConsoleScreen provider={provider} visual={visual} comment={comment} />
      </View>
    </View>
  );
}

/** The per-step mock screen, with the target wrapped in an accent Highlight. */
function ConsoleScreen({ provider, visual, comment }: AnnotatedConsoleProps) {
  const colors = useAppColors();
  const meta = PROVIDER_META[provider];

  if (visual === 'create') {
    return (
      <View style={styles.screen}>
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
          API keys
        </Typography>
        <FieldRow label="No keys yet" colors={colors} muted />
        <Callout accent={meta.accent} text={comment} />
        <Highlight accent={meta.accent}>
          <MockButton label={meta.createButtonLabel} accent={meta.accent} icon="add" white={colors.white} />
        </Highlight>
      </View>
    );
  }

  if (visual === 'billing') {
    return (
      <View style={styles.screen}>
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
          Plans &amp; Billing
        </Typography>
        <View style={[styles.balanceCard, { borderColor: colors.borderColor, backgroundColor: colors.card }]}>
          <Typography variant="caption2" color={colors.textTertiary}>
            Credit balance
          </Typography>
          <Typography variant="footnote" weight="bold" color={colors.textPrimary}>
            $0.00
          </Typography>
        </View>
        <Callout accent={meta.accent} text={comment} />
        <Highlight accent={meta.accent}>
          <MockButton label="Add credits" accent={meta.accent} icon="card-outline" white={colors.white} />
        </Highlight>
      </View>
    );
  }

  if (visual === 'copy') {
    return (
      <View style={styles.screen}>
        <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
          {meta.keyFormat.split(' ')[0]} key created
        </Typography>
        <Callout accent={meta.accent} text={comment} />
        <Highlight accent={meta.accent}>
          <View style={[styles.keyChip, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
            <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1} style={[styles.flex, styles.mono]}>
              {meta.keyFormat.split(' ')[0]}••••••••••••
            </Typography>
            <View style={[styles.copyBtn, { backgroundColor: meta.accent }]}>
              <Icon name="copy-outline" size={12} color={colors.white} />
              <Typography variant="caption2" weight="semibold" color={colors.white}>
                Copy
              </Typography>
            </View>
          </View>
        </Highlight>
      </View>
    );
  }

  // 'browser' — the sign-in screen
  return (
    <View style={styles.screen}>
      <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
        Sign in
      </Typography>
      <FieldRow label="you@email.com" colors={colors} />
      <Callout accent={meta.accent} text={comment} />
      <Highlight accent={meta.accent}>
        <MockButton label="Continue" accent={meta.accent} icon="arrow-forward" white={colors.white} />
      </Highlight>
    </View>
  );
}

/** Accent comment pill with a downward arrow pointing at the boxed control. */
function Callout({ accent, text }: { accent: string; text: string }) {
  const colors = useAppColors();
  return (
    <View style={styles.calloutWrap}>
      <View style={[styles.calloutPill, { backgroundColor: accent }]}>
        <Icon name="arrow-down" size={13} color={colors.white} />
        <Typography variant="caption2" weight="semibold" color={colors.white} style={styles.flex}>
          {text}
        </Typography>
      </View>
      <View style={[styles.caret, { borderTopColor: accent }]} />
    </View>
  );
}

/** Accent-boxed, tinted wrapper marking the control the user should tap. */
function Highlight({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <View style={[styles.highlight, { borderColor: accent, backgroundColor: accent + '14' }]}>{children}</View>
  );
}

function MockButton({
  label,
  accent,
  icon,
  white,
}: {
  label: string;
  accent: string;
  icon: string;
  white: string;
}) {
  return (
    <View style={[styles.mockButton, { backgroundColor: accent }]}>
      <Icon name={icon} size={13} color={white} />
      <Typography variant="caption1" weight="semibold" color={white}>
        {label}
      </Typography>
    </View>
  );
}

function FieldRow({
  label,
  colors,
  muted,
}: {
  label: string;
  colors: ReturnType<typeof useAppColors>;
  muted?: boolean;
}) {
  return (
    <View style={[styles.field, { backgroundColor: colors.card, borderColor: colors.borderColor }]}>
      <Typography variant="caption2" color={muted ? colors.textTertiary : colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trafficLights: { flexDirection: 'row', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  urlPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  body: { padding: 14, gap: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandChip: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screen: { gap: 8 },
  field: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  balanceCard: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
  },
  calloutWrap: { alignItems: 'flex-start', marginTop: 4 },
  calloutPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  caret: {
    marginLeft: 18,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  highlight: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: 12,
    borderWidth: 2,
    padding: 5,
  },
  mockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  keyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    paddingLeft: 10,
    paddingRight: 5,
    paddingVertical: 5,
    minWidth: 200,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  flex: { flex: 1 },
  mono: { fontFamily: 'Courier' },
});
