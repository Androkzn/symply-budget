import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BottomSheet, GradientButton, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /**
   * The `simplebudget://lf-invite?…` link the code encodes — the SAME string
   * the share sheet sends, so the two paths cannot drift apart.
   *
   * Nullable because the sheet is mounted before an invite exists; it renders
   * nothing rather than an empty square.
   */
  link: string | null;
  shortCode: string;
  secret: string;
  /** Rendered verbatim, e.g. "in about a day" — the screen owns the wording. */
  expiresIn?: string | null;
  /** Address the invite is bound to, if any. */
  boundToEmail?: string | null;
  onShare: () => void;
};

/**
 * The invite as a QR code, with the one button that matters beside it.
 *
 * Why a QR at all, when the invite already had a link and a share sheet: the
 * two people doing this are usually in the same room. Sharing means picking a
 * messenger, finding the person, sending a link that carries the household
 * secret through a third party's servers — for a hand-off that could be one
 * phone pointed at another. The code encodes exactly the same link, so:
 *
 *  - the invitee's Symply Budget can scan it (Join → Scan QR code), and
 *  - so can the **phone camera**, because it is a real URL with a registered
 *    scheme: iOS Camera and Android's scanner both offer to open it, the OS
 *    hands it to the app, and `captureBudgetInviteLink` fills the join form.
 *    That is the whole reason the payload is a link and not our own compact
 *    "CODE secret" pair — a bare pair scans as meaningless text.
 *
 * The code and secret stay printed under it. A QR is unreadable to a human, and
 * this hand-off has to survive a cracked screen, a camera that will not focus,
 * and a person who is not in the room.
 *
 * Verification is unaffected: what travels here is the invite, never the
 * six-digit SAS — that is derived from the claiming device's keys and does not
 * exist yet (see `BudgetInviteScreen`'s header).
 */
export function BudgetInviteQrSheet({
  visible,
  onClose,
  link,
  shortCode,
  secret,
  expiresIn,
  boundToEmail,
  onShare,
}: Props) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const [failed, setFailed] = useState(false);

  // A new invite gets a fresh chance to render: the failure belongs to the
  // payload, not to the sheet.
  useEffect(() => setFailed(false), [link]);

  // Big enough to scan across a table, capped so it does not push the code and
  // secret off a small phone. The plate adds its own quiet zone (see below), so
  // the module grid is what this measures.
  const qrSize = Math.min(240, Math.max(160, width - Spacing.base * 2 - Spacing.lg * 2 - 32));

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="content"
      title="Invite QR code"
      showCloseButton
    >
      <View style={styles.body} testID="budget-invite-qr-sheet">
        {link && !failed ? (
          <>
            {/*
              White plate, always — in every theme.

              A scanner needs dark modules on a light field with a quiet zone
              around them. Rendered on the sheet's own dark background a
              theme-coloured code is a contrast inversion most decoders refuse,
              and it fails at the worst possible moment: pointed at a camera in
              front of the person you are inviting.
            */}
            <View style={styles.plate} testID="budget-invite-qr-plate">
              <QRCode
                value={link}
                size={qrSize}
                color="#000000"
                backgroundColor="#FFFFFF"
                // M tolerates a fingerprint or a glare spot on the glass and
                // still decodes; L would fit a longer payload we do not have.
                ecl="M"
                onError={() => setFailed(true)}
                testID="budget-invite-qr"
              />
            </View>
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              style={styles.centered}
              testID="budget-invite-qr-hint"
            >
              Have them point their camera at this — the phone camera works, or Join → Scan QR code
              in Symply Budget.
            </Typography>
          </>
        ) : (
          // Never a blank square: if the code could not be drawn, the code and
          // secret below are still a complete invite.
          <Typography
            variant="caption1"
            color={colors.warning}
            style={styles.centered}
            testID="budget-invite-qr-error"
          >
            This invite could not be drawn as a QR code. Send it with Share invite, or read out the
            code and secret below.
          </Typography>
        )}

        <GradientButton
          title="Share invite"
          fullWidth
          onPress={onShare}
          testID="budget-invite-qr-share"
        />

        <View style={[styles.values, { borderTopColor: colors.borderColor }]}>
          <View style={styles.valueRow}>
            <Typography variant="caption2" color={colors.textSecondary}>
              Code
            </Typography>
            <Typography variant="footnote" weight="semibold" testID="budget-invite-qr-code">
              {shortCode}
            </Typography>
          </View>
          <View style={styles.valueRow}>
            <Typography variant="caption2" color={colors.textSecondary}>
              Secret
            </Typography>
            <Typography
              variant="caption2"
              style={styles.secret}
              numberOfLines={2}
              testID="budget-invite-qr-secret"
            >
              {secret}
            </Typography>
          </View>
        </View>

        {boundToEmail ? (
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            testID="budget-invite-qr-bound-to"
          >
            Only {boundToEmail} can use this invite.
          </Typography>
        ) : null}
        {expiresIn ? (
          <Typography
            variant="caption2"
            color={colors.textTertiary}
            testID="budget-invite-qr-expiry"
          >
            Expires {expiresIn}.
          </Typography>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.md },
  // `padding` IS the quiet zone: decoders need a clear margin of at least four
  // modules, and a code drawn flush to the edge of a coloured card is one of
  // the more common reasons a valid QR will not scan.
  plate: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  centered: { textAlign: 'center' },
  values: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.md, gap: Spacing.xs },
  valueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  // The secret is long and opaque; let it wrap rather than truncate, since the
  // fallback path is someone reading it out character by character.
  secret: { flex: 1, textAlign: 'right' },
});

export default BudgetInviteQrSheet;
