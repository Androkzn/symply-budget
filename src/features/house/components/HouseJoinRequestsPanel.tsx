import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { HouseJoinRequests } from '@features/house/local/useHouseJoinRequests';
import { formatEnrolmentSas } from '@symply/local-first';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

/**
 * Somebody is at the door.
 *
 * Rendered ABOVE everything else on whichever screen shows it: a pending request
 * is the only thing in this flow that is WAITING on the person reading it, and
 * it used to sit inside a section they had to know to expand.
 *
 * One banner each rather than one list — two people waiting are two separate
 * decisions, each with its own six digits to read aloud, and merging them into a
 * single card is how the wrong number gets approved.
 *
 * Renders nothing when nobody is waiting, so a caller can place it
 * unconditionally at the top of a screen without leaving an empty frame there.
 */
type Props = HouseJoinRequests & {
  /**
   * The panel's own id, and the approve button's.
   *
   * Overridable because the same panel is the anchor of the two-device suite on
   * the combined Device sync surface, where the ids are a CONTRACT the runner
   * defaults to (`LF_JOIN_REQUESTS_PANEL`, and `lf-invite-approve-request`).
   * Passing them in beats forking the component, which is how the copy on one
   * surface drifts from the copy on the other.
   */
  testID?: string;
  approveTestID?: string;
};

export function HouseJoinRequestsPanel({
  requests,
  sas,
  isApproving,
  approve,
  testID = 'house-settings-join-requests-panel',
  approveTestID = 'house-settings-approve-request',
}: Props) {
  const colors = useAppColors();
  if (!requests || requests.length === 0) return null;

  return (
    <View style={styles.stack} testID={testID}>
      <Typography variant="footnote" weight="semibold">
        Waiting to join
      </Typography>
      {requests.length > 1 ? (
        <Typography variant="caption2" color={colors.textSecondary}>
          {requests.length} devices are waiting — approve them one at a time.
        </Typography>
      ) : null}
      {requests.map((request) => {
        const digits = sas[request.inviteId] ?? null;
        const who = request.claimedByDisplayName ?? request.claimedByEmail ?? 'Unknown account';
        // The email is repeated here only when the headline is a NAME — it is
        // what the owner recognises the account by, and a line that says the
        // same thing twice is worse than one that omits it.
        const detail = [
          request.claimedByDisplayName && request.claimedByEmail ? request.claimedByEmail : null,
          request.claimedDeviceLabel ?? 'Unnamed device',
          `code ${request.shortCode}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Card
            key={request.inviteId}
            style={[styles.banner, { borderColor: colors.primary }]}
            testID={`house-join-request-banner-${request.inviteId}`}
          >
            <View style={styles.head}>
              <Icon name="person-add" forceIonicons size={IconSize.lg} color={colors.primary} />
              <View style={styles.headText}>
                {/* Who, before what. An approval that can only name a code gives
                    the owner nothing to refuse on. */}
                <Typography
                  variant="footnote"
                  weight="semibold"
                  testID={`house-request-who-${request.inviteId}`}
                >
                  {who}
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {detail}
                </Typography>
              </View>
            </View>

            {digits ? (
              <>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Read this number to them. Approve only if their screen shows the same one.
                </Typography>
                <Typography
                  variant="title2"
                  weight="semibold"
                  style={styles.sas}
                  testID={`house-request-sas-${request.inviteId}`}
                >
                  {formatEnrolmentSas(digits)}
                </Typography>
                <GradientButton
                  title="The numbers match — approve"
                  fullWidth
                  disabled={isApproving}
                  onPress={() => approve(request)}
                  testID={approveTestID}
                />
              </>
            ) : (
              // No secret on this device means no number can be derived, and
              // approving without one would be exactly the unchecked tap this
              // flow exists to remove.
              <Typography
                variant="caption1"
                color={colors.warning}
                testID={`house-request-sas-missing-${request.inviteId}`}
              >
                This device cannot check that request — it did not create the invite, or the invite
                has expired. Create a new invite and have them join again.
              </Typography>
            )}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.sm, marginBottom: Spacing.lg },
  banner: { gap: Spacing.sm, borderWidth: 1, borderRadius: CornerRadius.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headText: { flex: 1, gap: 2 },
  sas: { letterSpacing: 4, textAlign: 'center' },
});
