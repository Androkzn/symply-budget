import { useNavigation, useRoute } from "expo-router/react-navigation";
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';

import { quotesApi } from '@api/quotes';
import type { QuoteWithDetails } from '@api/quotes';
import { tasksApi } from '@api/tasks';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { QuoteCard } from '@components/tasks/QuoteCard';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import type { TasksStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

export function QuoteManagementScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<TasksStackScreenProps<'QuoteManagement'>['navigation']>();
  const route = useRoute<TasksStackScreenProps<'QuoteManagement'>['route']>();
  const { taskId } = route.params;
  const showError = useMemberFacingAlert();

  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>([]);
  const [task, setTask] = useState<any>(null);

  const { currentHousehold } = useHouseholdStore();
  const { setTaskQuotes } = useTaskStore();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!currentHousehold) return;

    try {
      setLoading(true);

      // Load task details
      const taskData = await tasksApi.get(currentHousehold.id, taskId);
      setTask(taskData.task);

      // Load quotes
      const quotesData = await tasksApi.getTaskQuotes(currentHousehold.id, taskId);
      setQuotes(quotesData.quotes);
      setTaskQuotes(taskId, quotesData.quotes);
    } catch (error: any) {
      /**
       * DoD H7, positive half. `getTaskQuotes` is P4 on a local-first build —
       * quotes arrive through servers this household deliberately keeps its
       * data off — and `unsupportedCopy.ts` has a written explanation for
       * exactly that. This used to substitute 'Failed to load quotes', which
       * reads as a bug in a feature that is working as designed.
       *
       * `toMemberFacingError` renders the deliberate copy when there is some,
       * a real server message when there was one, and the sentence below
       * otherwise. It never reaches for `error.method`, so no identifier can
       * land in an Alert (the negative half, locked by the h7-p4 flows).
       */
      console.error('Failed to load quotes:', error);
      showError(error, 'Failed to load quotes');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestQuotes = () => {
    if (!task) return;
    navigation.navigate('ContractorSelection', {
      taskId,
      category: task.contractor_category || task.system_category || 'general',
    });
  };

  const handleCompareQuotes = () => {
    const receivedQuotes = quotes.filter((q) => q.status === 'received' || q.status === 'reviewing');

    if (receivedQuotes.length < 2) {
      Alert.alert('Not Enough Quotes', 'You need at least 2 received quotes to compare.');
      return;
    }

    navigation.navigate('QuoteComparison', {
      taskId,
      quoteIds: receivedQuotes.map((q) => q.id),
    });
  };

  const handleQuotePress = (quote: QuoteWithDetails) => {
    // Navigate to quote detail (could be implemented later)
    Alert.alert('Quote Details', `Quote from ${quote.contractor.name}\n\nAmount: ${quote.amount_cents ? formatMoney(quote.amount_cents, { decimals: 2 }) : 'TBD'}`);
  };

  const handleAcceptQuote = async (quote: QuoteWithDetails) => {
    if (!currentHousehold) return;

    Alert.alert(
      'Accept Quote',
      `Accept quote from ${quote.contractor.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              await quotesApi.accept(currentHousehold.id, quote.id);
              await tasksApi.selectTaskQuote(currentHousehold.id, taskId, {
                quote_id: quote.id,
              });
              Alert.alert('Success', 'Quote accepted!');
              loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to accept quote');
            }
          },
        },
      ]
    );
  };

  const handleDeclineQuote = async (quote: QuoteWithDetails) => {
    if (!currentHousehold) return;

    Alert.alert(
      'Decline Quote',
      `Decline quote from ${quote.contractor.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            try {
              await quotesApi.decline(currentHousehold.id, quote.id);
              Alert.alert('Success', 'Quote declined');
              loadData();
            } catch (error) {
              Alert.alert('Error', 'Failed to decline quote');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View
        style={[styles.loadingContainer, { backgroundColor: colors.backgroundSecondary }]}
        testID="quote-management-screen"
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Typography variant="body" color={colors.textTertiary} style={styles.loadingText}>
          Loading quotes...
        </Typography>
      </View>
    );
  }

  const receivedQuotes = quotes.filter((q) => q.status === 'received' || q.status === 'reviewing');
  const pendingQuotes = quotes.filter((q) => q.status === 'requested');
  const acceptedQuotes = quotes.filter((q) => q.status === 'accepted');

  return (
    <AppBackground>
    <SafeAreaView
      edges={[]}
      style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
      testID="quote-management-screen"
    >
      <ScreenHeader
        title="Manage Quotes"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      <ScrollView
        style={screenScrollViewStyle.scroll}
        contentContainerStyle={styles.scrollContent}
      >
      {task && (
        <Typography variant="body" color={colors.textTertiary} style={styles.subtitle}>
          {task.title}
        </Typography>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.accent }]} onPress={handleRequestQuotes}>
          <Typography variant="body" weight="semibold" color={colors.white} style={styles.buttonTextCenter}>
            Request New Quotes
          </Typography>
        </TouchableOpacity>

        {receivedQuotes.length >= 2 && (
          <TouchableOpacity style={[styles.secondaryButton, { backgroundColor: colors.info }]} onPress={handleCompareQuotes}>
            <Typography variant="body" weight="semibold" color={colors.white} style={styles.buttonTextCenter}>
              Compare with AI
            </Typography>
          </TouchableOpacity>
        )}
      </View>

      {acceptedQuotes.length > 0 && (
        <View style={styles.section}>
          <View style={[styles.sectionTitle, styles.sectionTitleRow]}>
            <Icon name="checkmark-circle" size={18} color={colors.success} />
            <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
              Accepted Quote
            </Typography>
          </View>
          {acceptedQuotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              isSelected
              onPress={() => handleQuotePress(quote)}
            />
          ))}
        </View>
      )}

      {receivedQuotes.length > 0 && (
        <View style={styles.section}>
          <View style={[styles.sectionTitle, styles.sectionTitleRow]}>
            <Icon name="document-text" size={18} color={colors.textPrimary} />
            <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
              Received Quotes ({receivedQuotes.length})
            </Typography>
          </View>
          {receivedQuotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              onPress={() => handleQuotePress(quote)}
              onAccept={() => handleAcceptQuote(quote)}
              onDecline={() => handleDeclineQuote(quote)}
              showActions
            />
          ))}
        </View>
      )}

      {pendingQuotes.length > 0 && (
        <View style={styles.section}>
          <View style={[styles.sectionTitle, styles.sectionTitleRow]}>
            <Icon name="hourglass" size={18} color={colors.warning} />
            <Typography variant="bodyLarge" weight="semibold" color={colors.textPrimary}>
              Pending Quotes ({pendingQuotes.length})
            </Typography>
          </View>
          {pendingQuotes.map((quote) => (
            <QuoteCard
              key={quote.id}
              quote={quote}
              onPress={() => handleQuotePress(quote)}
            />
          ))}
        </View>
      )}

      {quotes.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="document-text" size={64} color={colors.textTertiary} style={styles.emptyIcon} />
          <Typography variant="titleSmall" weight="semibold" color={colors.textPrimary} style={styles.emptyTitle}>
            No Quotes Yet
          </Typography>
          <Typography variant="body" color={colors.textTertiary} style={styles.emptyText}>
            Request quotes from contractors to get started
          </Typography>
          <TouchableOpacity style={[styles.emptyButton, { backgroundColor: colors.accent }]} onPress={handleRequestQuotes}>
            <Typography variant="body" weight="semibold" color={colors.white} style={styles.buttonTextCenter}>
              Request Quotes
            </Typography>
          </TouchableOpacity>
        </View>
      )}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Layout.bottomTabBarClearance,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
  },
  header: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  title: {
    marginBottom: Spacing.xs,
  },
  subtitle: {},
  actionsRow: {
    flexDirection: 'row',
    padding: Spacing.base,
    gap: Spacing.md,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: Spacing.md + Spacing.xxs,
    borderRadius: CornerRadius.sm + Spacing.xxs,
    alignItems: 'center',
  },
  buttonTextCenter: {
    textAlign: 'center',
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: Spacing.md + Spacing.xxs,
    borderRadius: CornerRadius.sm + Spacing.xxs,
    alignItems: 'center',
  },
  section: {
    padding: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl + Spacing.xxl,
    paddingHorizontal: Spacing.xxl + Spacing.sm,
  },
  emptyIcon: {
    marginBottom: Spacing.base,
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
  },
  emptyText: {
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  emptyButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xxl,
    borderRadius: CornerRadius.sm + Spacing.xxs,
  },
});
