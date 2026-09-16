import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';

import { garbageCollectionApi } from '@api/garbage-collection';
import type { DetectedGarbageSchedule, GarbageScheduleType } from '@api/garbage-collection';
import { screenScrollViewStyle } from '@components/common';
import { Typography, Button, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Icon } from '@components/ui/Icon';
import { toMemberFacingError } from '@features/house/local/memberFacingError';
import { AI_ACCESS_ROUTE } from '@features/house/local/useMemberFacingAlert';
import { useGarbageDayInference } from '@hooks/useGarbageDayInference';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

interface GarbageDetectScreenProps {
  visible: boolean;
  onClose: () => void;
  /** Called after the detected schedule has been saved. */
  onSaved: () => void;
  /**
   * Called when the user switches to manual entry. Passes the current draft (if
   * any) so the manual wizard can be pre-filled with what we detected.
   */
  onManual: (draft: DetectedGarbageSchedule | null) => void;
}

const COLLECTION_ICONS: Record<string, IoniconName> = {
  garbage: 'trash',
  recycling: 'refresh-circle',
  organics: 'leaf',
  yardWaste: 'leaf',
  bulkItem: 'cube',
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Every week',
  biweekly: 'Every other week',
  monthly: 'Monthly',
  seasonal: 'Seasonal',
  'on-request': 'On request',
};

type Status = 'loading' | 'found' | 'empty' | 'error';

/**
 * Read the axios envelope OR the local-first copy.
 *
 * This used to check only `err.response.data.error.message`. Under local-first
 * `aiDetect` throws `HouseLocalUnsupportedError`, which never went near the
 * network and so has no `.response` — the check read `undefined` every time and
 * the member got this screen's generic "couldn't reach the schedule finder"
 * instead of the copy written to explain that photo detection is off in private
 * mode. `toMemberFacingError` puts the deliberate copy first (DoD H7).
 *
 * The TITLE matters as much as the body and is why this returns the whole
 * object: the error state's heading used to be a hardcoded "Something went
 * wrong", which is exactly wrong for a feature that is deliberately off and did
 * not go wrong at all.
 */
const DEFAULT_ERROR_TITLE = 'Something went wrong';

function describeItem(item: GarbageScheduleType): string {
  const freq = FREQUENCY_LABELS[item.frequency] || item.frequency;
  if (item.dayOfWeek !== undefined && DAY_NAMES[item.dayOfWeek]) {
    return `${freq} on ${DAY_NAMES[item.dayOfWeek]}`;
  }
  return freq;
}

export function GarbageDetectScreen({ visible, onClose, onSaved, onManual }: GarbageDetectScreenProps) {  const colors = useAppColors();
  const router = useRouter();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const { ensureCanUseAI } = useRequireAIAccess();
  const inference = useGarbageDayInference();

  const [status, setStatus] = useState<Status>('loading');
  const [draft, setDraft] = useState<DetectedGarbageSchedule | null>(null);
  const [errorTitle, setErrorTitle] = useState<string>(DEFAULT_ERROR_TITLE);
  const [errorMessage, setErrorMessage] = useState<string>('');
  /**
   * Whether connecting a provider is what would fix this.
   *
   * The error state used to offer "Try Again" and "Set Up Manually" for every
   * failure alike — including the one case where neither is the answer, because
   * nothing is wrong: the member has simply not connected an AI provider yet.
   * Retrying that forever is the definition of a dead end.
   */
  const [errorNeedsAiProvider, setErrorNeedsAiProvider] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const showError = useCallback((err: unknown, fallback: string) => {
    const member = toMemberFacingError(err, fallback);
    setErrorTitle(member.title);
    setErrorMessage(member.message);
    setErrorNeedsAiProvider(member.needsAiProvider);
    setStatus('error');
  }, []);

  const runDetect = useCallback(async () => {
    if (!currentHousehold) {
      console.log('[GARBAGE] runDetect: no currentHousehold');
      return;
    }
    /**
     * The entitlement check gates the app's own AI, which the local path does
     * not use: Stage A is arithmetic over rows the member typed, and Stage B
     * spends the member's own provider key. Sending them to a paywall for
     * either would be charging for their own data and their own key, so the
     * check applies only to the server path below.
     */
    if (!inference.enabled && !ensureCanUseAI()) {
      onClose();
      return;
    }
    setStatus('loading');
    setErrorTitle(DEFAULT_ERROR_TITLE);
    setErrorMessage('');
    setErrorNeedsAiProvider(false);
    try {
      // Local-first: the P2 ladder answers from the encrypted ledger. `null`
      // means this build is not local-first — fall through to the Worker.
      const local = await inference.detect(currentHousehold.id);
      if (local) {
        if (local.status === 'unavailable') {
          // Stage C. Deliberate, member-facing, and never a provider error.
          console.log('[GARBAGE] runDetect: ladder unavailable');
          setErrorTitle(local.title);
          setErrorMessage(local.message);
          // `no_key` is not a failure — it is the one rung the member can add
          // themselves, so it gets the route rather than another Try Again.
          setErrorNeedsAiProvider(local.reason === 'no_key');
          setStatus('error');
          return;
        }
        console.log('[GARBAGE] runDetect: ladder answered', local.answer.source);
        setDraft(local.draft);
        setStatus(local.draft.schedules.length > 0 ? 'found' : 'empty');
        return;
      }

      console.log('[GARBAGE] runDetect: calling ai-detect for', currentHousehold.id);
      const { draft: result } = await garbageCollectionApi.aiDetect(currentHousehold.id);
      console.log('[GARBAGE] runDetect: got draft', JSON.stringify(result));
      setDraft(result);
      setStatus(result.schedules.length > 0 ? 'found' : 'empty');
    } catch (err) {
      console.log('[GARBAGE] runDetect: error', err);
      showError(err, 'We couldn’t reach the schedule finder. Please try again.');
    }
  }, [currentHousehold, ensureCanUseAI, inference, onClose, showError]);

  useEffect(() => {
    if (visible) {
      runDetect();
    } else {
      // Reset for next open
      setDraft(null);
      setStatus('loading');
      setIsSaving(false);
    }
  }, [visible, runDetect]);

  const handleSave = async () => {
    if (!currentHousehold || !draft) return;
    try {
      setIsSaving(true);
      console.log('[GARBAGE] handleSave: saving', draft.schedules.length, 'items, source=municipal_api');
      await garbageCollectionApi.createSchedule(currentHousehold.id, {
        municipality: draft.municipality || 'Unknown',
        schedules: draft.schedules,
        set_out_time: draft.setOutTime || undefined,
        source: 'municipal_api',
      });
      console.log('[GARBAGE] handleSave: saved OK');
      onSaved();
    } catch (err) {
      console.log('[GARBAGE] handleSave: error', err);
      showError(err, 'Could not save the schedule. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const confidenceChip = (() => {
    if (!draft) return null;
    const c = draft.confidence;
    if (c >= 0.7) return { label: 'High confidence', color: colors.success };
    if (c >= 0.4) return { label: 'Best guess — please verify', color: colors.warning };
    return { label: 'Low confidence', color: colors.warning };
  })();

  // Common case: we found the streams + frequency but not the pickup day (cities
  // hide it behind an address lookup). Then the user just needs to pick the day.
  const needsDay =
    !!draft &&
    draft.schedules.length > 0 &&
    draft.schedules.some((s) => s.frequency !== 'on-request' && s.dayOfWeek === undefined);

  return (
    <BottomSheet visible={visible} onClose={onClose} height="tall" title="Find My Schedule" showCloseButton>
      <ScrollView
        style={screenScrollViewStyle.scroll}
        showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}
        testID="garbage-detect-screen">
        {status === 'loading' && (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography variant="body" color={colors.textSecondary} style={styles.centeredText} align="center">
              Searching your municipality’s official sources for your collection schedule…
            </Typography>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.centered} testID="garbage-detect-error">
            <Icon name="warning" size={48} color={colors.warning} style={styles.icon} />
            <Typography variant="title3" weight="bold" align="center" testID="garbage-detect-error-title">
              {errorTitle}
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              align="center"
              style={styles.centeredText}
              testID="garbage-detect-error-message">
              {errorMessage}
            </Typography>
            {errorNeedsAiProvider ? (
              <Button
                title="Add AI provider"
                variant="primary"
                size="md"
                onPress={() => router.push(AI_ACCESS_ROUTE)}
                fullWidth
                style={styles.actionBtn}
                testID="garbage-detect-add-ai-provider"
              />
            ) : (
              <Button title="Try Again" variant="primary" size="md" onPress={runDetect} fullWidth style={styles.actionBtn} />
            )}
            <Button title="Set Up Manually" variant="secondary" size="md" onPress={() => onManual(draft)} fullWidth style={styles.actionBtn} testID="garbage-detect-manual" />
          </View>
        )}

        {status === 'empty' && (
          <View style={styles.centered}>
            <Icon name="search" size={48} color={colors.textSecondary} style={styles.icon} />
            <Typography variant="title3" weight="bold" align="center">No schedule found</Typography>
            <Typography variant="body" color={colors.textSecondary} align="center" style={styles.centeredText}>
              {draft?.notes ||
                'We couldn’t find an official collection schedule for your address. You can enter it manually instead.'}
            </Typography>
            <Button title="Set Up Manually" variant="primary" size="md" onPress={() => onManual(draft)} fullWidth style={styles.actionBtn} testID="garbage-detect-manual" />
            <Button title="Try Again" variant="secondary" size="md" onPress={runDetect} fullWidth style={styles.actionBtn} />
          </View>
        )}

        {status === 'found' && draft && (
          <View>
            {draft.municipality && (
              <Typography variant="title3" weight="bold" style={styles.municipality}>
                {draft.municipality}
              </Typography>
            )}

            {confidenceChip && (
              <View style={[styles.chip, { backgroundColor: `${confidenceChip.color}20` }]}>
                <Typography variant="caption1" weight="semibold" color={confidenceChip.color}>
                  {confidenceChip.label}
                </Typography>
              </View>
            )}

            {!draft.addressSpecific && (
              <Typography variant="footnote" color={colors.textSecondary} style={styles.cityWide}>
                This is a city-wide schedule — double-check it matches your street before saving.
              </Typography>
            )}

            <Card variant="filled" style={[styles.listCard, { backgroundColor: colors.backgroundSecondary }]}>
              {draft.schedules.map((item, index) => (
                <View
                  key={`${item.type}-${index}`}
                  style={[styles.row, index < draft.schedules.length - 1 && styles.rowBorder]}
                >
                  <Icon
                    name={COLLECTION_ICONS[item.type] || 'cube'}
                    size={24}
                    color={colors.textPrimary}
                    style={styles.rowIcon}
                  />
                  <View style={styles.rowText}>
                    <Typography variant="headline" weight="semibold" style={styles.rowTitle}>
                      {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {describeItem(item)}
                    </Typography>
                  </View>
                </View>
              ))}
            </Card>

            {draft.notes ? (
              <Typography variant="footnote" color={colors.textSecondary} style={styles.notes}>
                {draft.notes}
              </Typography>
            ) : null}

            {draft.sources.length > 0 && (
              <View style={styles.sources}>
                <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                  SOURCES
                </Typography>
                {draft.sources.map((src, index) => (
                  <TouchableOpacity
                    key={`${src.url}-${index}`}
                    onPress={() => src.url && Linking.openURL(src.url)}
                    disabled={!src.url}
                  >
                    <Typography variant="footnote" color={colors.primary} numberOfLines={1} style={styles.sourceLink}>
                      {src.title || src.url}
                    </Typography>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {needsDay ? (
              <>
                <View style={[styles.dayNote, { backgroundColor: `${colors.warning}15` }]}>
                  <Typography variant="footnote" color={colors.textSecondary} align="center">
                    We found your collection setup, but your city keeps the exact pickup day behind an
                    address lookup. Add the day and you’re done.
                  </Typography>
                </View>
                <Button
                  title="Set the Pickup Day"
                  variant="primary"
                  size="md"
                  onPress={() => onManual(draft)}
                  fullWidth
                  style={styles.actionBtn}
                  rightIcon={<Icon name="chevron-forward" size={16} color={colors.white} />}
                />
              </>
            ) : (
              <>
                <Button
                  title={isSaving ? 'Saving…' : 'Looks Right — Save Schedule'}
                  variant="primary"
                  size="md"
                  onPress={handleSave}
                  disabled={isSaving}
                  fullWidth
                  style={styles.actionBtn}
                />
                <Button
                  title="Adjust Manually"
                  variant="secondary"
                  size="md"
                  onPress={() => onManual(draft)}
                  disabled={isSaving}
                  fullWidth
                  style={styles.actionBtn}
                />
              </>
            )}
          </View>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  centeredText: {
    marginTop: 12,
  },
  icon: {
    marginBottom: 12,
  },
  municipality: {
    marginBottom: 8,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 8,
  },
  cityWide: {
    marginBottom: 12,
  },
  listCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
  },
  rowIcon: {
    marginRight: 12,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    textTransform: 'capitalize',
  },
  notes: {
    marginBottom: 12,
  },
  dayNote: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  sources: {
    marginBottom: 16,
    gap: 4,
  },
  sourceLink: {
    marginTop: 4,
  },
  actionBtn: {
    marginTop: 12,
  },
});

export default GarbageDetectScreen;
