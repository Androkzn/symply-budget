import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, View } from 'react-native';

import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Card, GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { BudgetInviteQrSheet } from '@features/budget/components/BudgetInviteQrSheet';
import { BudgetJoinRequestsPanel } from '@features/budget/components/BudgetJoinRequestsPanel';
import {
  buildBudgetInviteLink,
  createLocalFirstInvite,
  listOutstandingInvites,
  revokeLocalFirstInvite,
  type CreatedInvite,
  type OutstandingInvite,
} from '@features/budget/local/controlPlaneClient';
import { isLocalBudgetSessionOpen } from '@features/budget/local/engine';
import { useBudgetEnrolmentSignal } from '@features/budget/local/enrolmentSignal';
import {
  BudgetInviteAlreadyApprovedError,
  BudgetInviteGoneError,
} from '@features/budget/local/errors';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import {
  buildBudgetInviteShareText,
  describeInviteExpiry,
} from '@features/budget/local/inviteCopy';
import { useBudgetJoinRequests } from '@features/budget/local/useBudgetJoinRequests';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { getApiErrorMessage } from '@utils/apiError';
import { keyboardDismissScrollProps } from '@utils/keyboard';

/**
 * Budget → Invite & Household → **Invite**. The owner's half of the hand-off,
 * on a screen of its own.
 *
 * It used to be one of two collapsible sections stacked on the hub, alongside
 * the invitee's half. That put the whole flow — an email field, a mint button,
 * a code card, a list of outstanding invites and an approval control — behind a
 * disclosure triangle the owner had to know to tap, on a screen that also
 * carried the entirely unrelated Join form. Pushing it makes it what it is: one
 * task, with a back button, arrived at deliberately.
 *
 * The people waiting to be approved are shown HERE as well as on the hub, and
 * that is the point of the shared panel rather than a duplicate: minting a code
 * and approving the device that claims it are two halves of one act performed
 * minutes apart, and an owner standing next to the other person should not have
 * to go back a screen to finish.
 */
export function BudgetInviteCreateScreen() {
  const colors = useAppColors();
  const navigation = useNavigation();

  const [inviteeEmailDraft, setInviteeEmailDraft] = useState('');
  // The invite this owner just created, shown in place. It used to be an Alert
  // that dumped everything on the clipboard and then vanished — so the code was
  // gone the moment anything else was copied, and nobody could look at it twice.
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  // The note carries its own outcome rather than being parsed back out of the
  // string: a failed copy and a successful one must not look alike.
  const [copyNote, setCopyNote] = useState<{ text: string; ok: boolean } | null>(null);

  // Codes this household has out in the world — including ones minted on a
  // previous run of the app, which used to be unreachable and un-cancellable.
  const [outstanding, setOutstanding] = useState<OutstandingInvite[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState<{ text: string; ok: boolean } | null>(null);

  const refreshOutstanding = useCallback(async () => {
    if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return;
    try {
      setOutstanding(await listOutstandingInvites());
    } catch (error) {
      console.warn('[budget-invite] could not list outstanding invites', error);
      // Left as null rather than empty: "we could not look" and "there are
      // none" are different answers, and only one of them means the owner has
      // nothing to cancel.
    }
  }, []);

  // Approving SPENDS the invite — the control plane stops listing it as
  // outstanding — so the list below is wrong the instant an approval returns.
  // Left unrefreshed it kept showing the approved code as "…waiting to be
  // approved", with a Cancel button that could only ever be refused (409).
  const joinRequests = useBudgetJoinRequests({ onApproved: () => void refreshOutstanding() });

  /**
   * The list is this screen's subject, so arriving is the ask — and so is an
   * invite notification landing while it is open, because somebody claiming a
   * code changes what "outstanding" means.
   *
   * ONE effect covering both. Two of them (one for focus, one keyed on the
   * revision) fire twice on every mount, which is a duplicate round trip per
   * open and, more subtly, makes the screen's read of a changing list
   * order-dependent — the second answer silently wins.
   */
  const enrolmentRevision = useBudgetEnrolmentSignal((state) => state.revision);
  useFocusEffect(
    useCallback(() => {
      void refreshOutstanding();
      // `enrolmentRevision` is a dependency, not a read: re-running on a bump is
      // the point.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshOutstanding, enrolmentRevision]),
  );

  const handleCreateInvite = () => {
    setCopyNote(null);
    setIsCreating(true);
    void (async () => {
      try {
        const created = await createLocalFirstInvite({
          inviteeEmail: inviteeEmailDraft.trim() || null,
        });
        if (__DEV__) {
          // The two-simulator E2E run plays the human messenger: it scrapes
          // this line off the Metro log and types the code into the other
          // device's Join screen, so the UI path under test stays the real one.
          // No SAS here — it does not exist until the other device has claimed.
          console.log(`[E2E-INVITE] code=${created.shortCode} secret=${created.secret}`);
        }
        // Nothing is copied automatically. A silent clipboard write is a
        // promise the app cannot keep — one copy anywhere else and the invite
        // is gone — and it took the out-of-band answer along with it.
        setInvite(created);
        // Straight to the code. The button says "Generate QR code", so landing
        // on anything else would be a bait and switch — and the sheet is the
        // fastest hand-off there is when both people are in the room.
        setQrVisible(true);
        void refreshOutstanding();
      } catch (error) {
        console.error('Create invite failed', error);
        setInvite(null);
        // The backend already says WHY — "Owner required" (403), "Invite
        // conflict" (409), a rate limit. Replacing all of that with "check you
        // are online" told a member on a working connection to check their
        // connection, and cost a long diagnosis on 2026-09-04 when the real
        // answer was in the response the whole time. `getApiErrorMessage`
        // surfaces the backend's own words, filters SQL/technical noise, and
        // falls back to the connectivity line ONLY when nothing came back —
        // which is the one case where that line is true.
        Alert.alert(
          'Could not create invite',
          getApiErrorMessage(error, 'Could not create invite. Check you are online.')
        );
      } finally {
        setIsCreating(false);
      }
    })();
  };

  const inviteLink = invite
    ? buildBudgetInviteLink({
        inviteId: invite.inviteId,
        shortCode: invite.shortCode,
        secret: invite.secret,
      })
    : null;

  const handleCopy = useCallback((label: string, value: string) => {
    void (async () => {
      try {
        await Clipboard.setStringAsync(value);
        setCopyNote({ text: `${label} copied to clipboard`, ok: true });
      } catch {
        setCopyNote({
          text: `Could not copy the ${label.toLowerCase()} — read it out instead.`,
          ok: false,
        });
      }
    })();
  }, []);

  /**
   * Hand the invite to whatever the owner already uses to talk to this person.
   *
   * `Share` is the OS sheet on both platforms, so this is Messages, WhatsApp,
   * Signal, email — one tap, no clipboard round-trip, and the invitee gets a
   * link they can tap rather than two strings to transcribe.
   */
  const handleShareInvite = useCallback(() => {
    if (!invite || !inviteLink) return;
    setCopyNote(null);
    void (async () => {
      try {
        await Share.share({
          message: buildBudgetInviteShareText({
            shortCode: invite.shortCode,
            secret: invite.secret,
            link: inviteLink,
          }),
        });
      } catch (error) {
        console.warn('[budget-invite] share failed', error);
        setCopyNote({
          text: 'Could not open the share sheet — copy the code and secret instead.',
          ok: false,
        });
      }
    })();
  }, [invite, inviteLink]);

  const handleRevokeInvite = useCallback(
    (target: OutstandingInvite) => {
      setRevokingId(target.inviteId);
      setInviteNote(null);
      void (async () => {
        try {
          await revokeLocalFirstInvite(target.inviteId);
          setOutstanding(
            (current) => current?.filter((row) => row.inviteId !== target.inviteId) ?? null,
          );
          // The card above is about one specific invite; if that is the one
          // just killed, it must stop offering a QR code that opens nothing.
          setInvite((current) => (current?.inviteId === target.inviteId ? null : current));
          setInviteNote({
            text:
              target.status === 'claimed'
                ? `Invite ${target.shortCode} cancelled. The device waiting on it has been told.`
                : `Invite ${target.shortCode} cancelled. The code no longer works.`,
            ok: true,
          });
        } catch (error) {
          // Two of the failures are not failures of the network but of this
          // list: the row describes an invite that stopped being cancellable
          // while it sat on screen. Both take the row away — it can never be
          // acted on again — and both must say which one it was, because
          // "check you are online" is a lie that keeps the owner tapping.
          const stale =
            error instanceof BudgetInviteAlreadyApprovedError ||
            error instanceof BudgetInviteGoneError;
          if (stale) {
            setOutstanding(
              (current) => current?.filter((row) => row.inviteId !== target.inviteId) ?? null,
            );
            setInvite((current) => (current?.inviteId === target.inviteId ? null : current));
            setInviteNote(
              error instanceof BudgetInviteAlreadyApprovedError
                ? {
                    // Named where it can actually be undone. Cancelling the
                    // invite would not un-enrol the device even if it worked.
                    text: `Invite ${target.shortCode} was already approved — that device is a member now. Remove it from Device Sync instead.`,
                    ok: false,
                  }
                : {
                    text: `Invite ${target.shortCode} was already cancelled or has expired. The code no longer works.`,
                    ok: true,
                  },
            );
            // …and the rest of the list is just as old as the row that went
            // stale, so it is re-read rather than trusted.
            void refreshOutstanding();
            return;
          }
          console.error('Revoke invite failed', error);
          setInviteNote({
            text: `Could not cancel invite ${target.shortCode}. Check you are online and try again.`,
            ok: false,
          });
        } finally {
          setRevokingId(null);
        }
      })();
    },
    [refreshOutstanding],
  );

  return (
    <AppBackground>
      <SafeAreaView edges={[]} testID="budget-invite-create-screen">
        <ScreenHeader
          title="Invite"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
          showPropertySwitcher={false}
        />

        <ScrollView
          {...keyboardDismissScrollProps}
          style={styles.flex}
          contentContainerStyle={styles.content}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
        >
          {/* Anyone at the door, above everything else — including the form
              that put them there. */}
          <BudgetJoinRequestsPanel {...joinRequests} />

          <Typography variant="caption1" color={colors.textSecondary} style={styles.intro}>
            Mint a code, show it or send it, then approve their device against six digits you read
            to each other. They see nothing until you do.
          </Typography>

          {/* Binding the invite to an address is what makes a forwarded or
              screenshotted link useless to anyone else. Optional, because an
              owner handing a phone across the table has no address to type —
              and the hint says which of the two they are getting. */}
          <TextInput
            label="Their email (recommended)"
            placeholder="them@example.com"
            value={inviteeEmailDraft}
            onChangeText={setInviteeEmailDraft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="budget-invite-invitee-email"
          />
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            style={styles.hint}
            testID="budget-invite-binding-hint"
          >
            {inviteeEmailDraft.trim()
              ? 'Only this account will be able to use the invite.'
              : 'Without an email, anyone who gets the link can use it — you will still verify them by number before they see anything.'}
          </Typography>

          {/* One button, and it says what you get: an invite is minted and the
              code is on screen in the same tap. */}
          <GradientButton
            title={isCreating ? 'Creating…' : invite ? 'Generate a new QR code' : 'Generate QR code'}
            disabled={isCreating}
            fullWidth
            onPress={handleCreateInvite}
            testID="budget-settings-create-invite"
          />

          {invite ? (
            <Card style={styles.card} testID="budget-invite-created-panel">
              <Typography variant="footnote" weight="semibold" testID="budget-invite-created-title">
                Invite created
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary}>
                Show them the QR code, or send it. When their device claims the invite, their
                request appears at the top of this screen with six digits to compare.
              </Typography>

              {/* The code first: it is the path that needs no messenger, no
                  address and no transcription — the two phones are usually in
                  the same room. The sheet was dismissed to get here, so this is
                  how it comes back. */}
              <GradientButton
                title="Show QR code"
                fullWidth
                onPress={() => setQrVisible(true)}
                testID="budget-invite-show-qr"
              />

              {/* Then sharing, for the person who is not: the OS sheet hands
                  the message to Messages / WhatsApp / mail, and the link inside
                  it fills their form for them. */}
              <GradientButton
                title="Share invite"
                variant="secondary"
                fullWidth
                onPress={handleShareInvite}
                testID="budget-invite-share"
              />

              {/* And the two values on their own, for reading out loud or
                  copying one at a time. */}
              <View style={styles.valueRow}>
                <View style={styles.valueText}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Code
                  </Typography>
                  <Typography variant="title3" weight="semibold" testID="budget-invite-code">
                    {invite.shortCode}
                  </Typography>
                </View>
                <GradientButton
                  title="Copy"
                  variant="secondary"
                  size="sm"
                  onPress={() => handleCopy('Code', invite.shortCode)}
                  testID="budget-invite-copy-code"
                />
              </View>

              <View style={styles.valueRow}>
                <View style={styles.valueText}>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Secret
                  </Typography>
                  <Typography variant="footnote" testID="budget-invite-secret">
                    {invite.secret}
                  </Typography>
                </View>
                <GradientButton
                  title="Copy"
                  variant="secondary"
                  size="sm"
                  onPress={() => handleCopy('Secret', invite.secret)}
                  testID="budget-invite-copy-secret"
                />
              </View>

              {copyNote ? (
                <View style={styles.noteRow}>
                  <Icon
                    name={copyNote.ok ? 'checkmark-circle' : 'alert-circle'}
                    forceIonicons
                    size={IconSize.sm}
                    color={copyNote.ok ? colors.success : colors.error}
                  />
                  <Typography
                    variant="caption2"
                    color={copyNote.ok ? colors.success : colors.textSecondary}
                    style={styles.noteText}
                    testID="budget-invite-copy-note"
                  >
                    {copyNote.text}
                  </Typography>
                </View>
              ) : null}

              {invite.inviteeEmail ? (
                <Typography
                  variant="caption2"
                  color={colors.textSecondary}
                  testID="budget-invite-bound-to"
                >
                  Only {invite.inviteeEmail} can use this invite.
                </Typography>
              ) : null}
              <Typography
                variant="caption2"
                color={colors.textTertiary}
                testID="budget-invite-expiry"
              >
                Expires {describeInviteExpiry(invite.expiresAt)}.
              </Typography>
            </Card>
          ) : (
            <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
              You get a QR code to show, plus the same invite as a code and a secret — nothing is
              copied or sent for you.
            </Typography>
          )}

          {/* Codes still out in the world.

              The list exists so revoking is possible at all: an invite minted
              on a previous run of the app had no representation anywhere in
              the UI, so a code sent to the wrong person, or screenshotted into
              a group chat, stayed live until it expired. */}
          {outstanding && outstanding.length > 0 ? (
            <>
              <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
                INVITES YOU HAVE SENT
              </Typography>
              <Card style={styles.card} testID="budget-invite-outstanding-panel">
                {outstanding.map((row) => (
                  <View key={row.inviteId} style={styles.valueRow}>
                    <View style={styles.valueText}>
                      <Typography
                        variant="footnote"
                        weight="semibold"
                        testID={`budget-invite-outstanding-code-${row.shortCode}`}
                      >
                        {row.shortCode}
                      </Typography>
                      <Typography variant="caption2" color={colors.textSecondary}>
                        {row.status === 'claimed'
                          ? `${row.claimedByEmail ?? row.claimedByDisplayName ?? 'Someone'} is waiting to be approved`
                          : row.inviteeEmail
                            ? `Waiting for ${row.inviteeEmail} · expires ${describeInviteExpiry(row.expiresAt)}`
                            : `Nobody has used it yet · expires ${describeInviteExpiry(row.expiresAt)}`}
                      </Typography>
                    </View>
                    <GradientButton
                      title={revokingId === row.inviteId ? 'Cancelling…' : 'Cancel'}
                      variant="secondary"
                      size="sm"
                      disabled={revokingId !== null}
                      onPress={() => handleRevokeInvite(row)}
                      testID={`budget-invite-revoke-${row.shortCode}`}
                    />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {inviteNote ? (
            <View style={styles.noteRow}>
              <Icon
                name={inviteNote.ok ? 'checkmark-circle' : 'alert-circle'}
                forceIonicons
                size={IconSize.sm}
                color={inviteNote.ok ? colors.success : colors.error}
              />
              <Typography
                variant="caption2"
                color={inviteNote.ok ? colors.success : colors.textSecondary}
                style={styles.noteText}
                testID="budget-invite-revoke-note"
              >
                {inviteNote.text}
              </Typography>
            </View>
          ) : null}

          {/* The manual re-ask, for the case the automatic one could not
              answer: the phone was offline when the screen opened, or the claim
              landed in the seconds since. */}
          <Typography variant="caption1" weight="semibold" style={styles.groupLabel}>
            APPROVE A DEVICE
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary} style={styles.hint}>
            {joinRequests.requests && joinRequests.requests.length > 0
              ? 'Anyone waiting is shown at the top of this screen with their six digits.'
              : 'This screen checks on its own — anyone waiting appears at the top. Check again if you have just been told somebody claimed your invite.'}
          </Typography>
          <GradientButton
            title={joinRequests.isChecking ? 'Checking…' : 'Check for join requests'}
            variant="secondary"
            fullWidth
            onPress={() => void joinRequests.refresh({ announce: true })}
            testID="budget-settings-join-requests"
          />
        </ScrollView>

        {/* Outside the ScrollView: it is a Modal, and a modal mounted inside a
            scrolling, keyboard-adjusting container inherits its insets on iOS. */}
        <BudgetInviteQrSheet
          visible={qrVisible && invite !== null}
          onClose={() => setQrVisible(false)}
          link={inviteLink}
          shortCode={invite?.shortCode ?? ''}
          secret={invite?.secret ?? ''}
          expiresIn={invite ? describeInviteExpiry(invite.expiresAt) : null}
          boundToEmail={invite?.inviteeEmail ?? null}
          onShare={handleShareInvite}
        />
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.base, paddingBottom: Layout.bottomTabBarClearance + 48 },
  intro: { marginBottom: Spacing.lg },
  hint: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
  card: { gap: Spacing.sm, marginTop: Spacing.base, borderRadius: CornerRadius.lg },
  groupLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    letterSpacing: 0.6,
    opacity: 0.6,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  valueText: { flex: 1, gap: 2 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  noteText: { flex: 1 },
});
