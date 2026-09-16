import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useState, useCallback, useEffect } from 'react';
import { ScrollView, StyleSheet, View, TextInput, TouchableOpacity, Alert, Linking, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  contractorSearchApi,
  type EmailType,
} from '@api/contractor-search';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Typography, Button, Card } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import type { ContractorsStackParamList } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { scaledFont, useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type ComposeContractorEmailRouteProp = RouteProp<ContractorsStackParamList, 'ComposeContractorEmail'>;
type ComposeContractorEmailNavigationProp = NativeStackNavigationProp<ContractorsStackParamList>;

interface EmailTypeOption {
  id: EmailType;
  label: string;
  icon: IoniconName;
  description: string;
}

const EMAIL_TYPES: EmailTypeOption[] = [
  {
    id: 'quote_request',
    label: 'Request Quote',
    icon: 'cash',
    description: 'Ask for an estimate and availability',
  },
  {
    id: 'question',
    label: 'Ask Question',
    icon: 'help-circle',
    description: 'Ask about their experience with this issue',
  },
  {
    id: 'availability_check',
    label: 'Check Availability',
    icon: 'calendar',
    description: 'Quick inquiry about scheduling',
  },
];

export function ComposeContractorEmailScreen() {
  const navigation = useNavigation<ComposeContractorEmailNavigationProp>();
  const route = useRoute<ComposeContractorEmailRouteProp>();  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { currentHousehold } = useHouseholdStore();
  const { user } = useAuthStore();
  
  const { contractors, problemTitle, problemDescription } = route.params;
  
  const [selectedEmailType, setSelectedEmailType] = useState<EmailType>('quote_request');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [currentContractorIndex, setCurrentContractorIndex] = useState(0);

  const currentContractor = contractors[currentContractorIndex];
  const contractorsWithEmail = contractors.filter((c) => c.email);
  const hasMultiple = contractors.length > 1;

  // Generate email when type changes or on initial load
  const generateEmail = useCallback(async () => {
    if (!currentHousehold || !currentContractor) return;

    setIsGenerating(true);
    try {
      const result = await contractorSearchApi.generateEmail(currentHousehold.id, {
        contractor: currentContractor,
        problem_title: problemTitle,
        problem_description: problemDescription,
        email_type: selectedEmailType,
        user_name: user?.display_name || undefined,
        property_address: currentHousehold.city && currentHousehold.state_province
          ? `${currentHousehold.city}, ${currentHousehold.state_province}`
          : undefined,
      });

      setSubject(result.subject);
      setBody(result.body);
    } catch (error) {
      console.error('Failed to generate email:', error);
      // Set fallback content
      setSubject(`Inquiry: ${problemTitle}`);
      setBody(
        `Hello,\n\nI am reaching out regarding ${problemTitle}.\n\n${problemDescription}\n\nPlease let me know if you can help.\n\nThank you`
      );
    } finally {
      setIsGenerating(false);
    }
  }, [currentHousehold, currentContractor, problemTitle, problemDescription, selectedEmailType, user]);

  useEffect(() => {
    generateEmail();
  }, [selectedEmailType, currentContractorIndex]);

  const handleSendViaEmailApp = useCallback(() => {
    if (!currentContractor.email) {
      Alert.alert('No Email', 'This contractor does not have an email address.');
      return;
    }

    const mailto = `mailto:${currentContractor.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(mailto);

    // If multiple contractors, ask to continue
    if (hasMultiple && currentContractorIndex < contractors.length - 1) {
      Alert.alert(
        'Continue to Next Contractor?',
        `Email opened for ${currentContractor.name}. Would you like to compose an email for the next contractor?`,
        [
          { text: 'Done', style: 'cancel', onPress: () => navigation.goBack() },
          { text: 'Next', onPress: () => setCurrentContractorIndex((prev) => prev + 1) },
        ]
      );
    } else {
      navigation.goBack();
    }
  }, [currentContractor, subject, body, hasMultiple, currentContractorIndex, contractors.length, navigation]);

  const handleSendViaApp = useCallback(async () => {
    if (!currentHousehold || !currentContractor.email) {
      Alert.alert('Cannot Send', 'Contractor does not have an email address.');
      return;
    }

    setIsSending(true);
    try {
      const result = await contractorSearchApi.sendEmail(currentHousehold.id, {
        to_email: currentContractor.email,
        subject,
        body,
        from_name: user?.display_name || 'Simple House User',
        reply_to: user?.email,
      });

      if (result.success) {
        Alert.alert(
          'Email Sent',
          `Successfully sent email to ${currentContractor.name}`,
          [
            {
              text: 'OK',
              onPress: () => {
                if (hasMultiple && currentContractorIndex < contractors.length - 1) {
                  setCurrentContractorIndex((prev) => prev + 1);
                } else {
                  navigation.goBack();
                }
              },
            },
          ]
        );
      } else {
        Alert.alert('Send Failed', result.message);
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      Alert.alert('Error', 'Failed to send email. Please try the email app option.');
    } finally {
      setIsSending(false);
    }
  }, [currentHousehold, currentContractor, subject, body, user, hasMultiple, currentContractorIndex, contractors.length, navigation]);

  const handleSendToAll = useCallback(() => {
    const emails = contractorsWithEmail.map((c) => c.email).join(',');
    const mailto = `mailto:${emails}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    Linking.openURL(mailto);
    navigation.goBack();
  }, [contractorsWithEmail, subject, body, navigation]);

  const handleShareEmail = useCallback(async () => {
    try {
      const shareContent = [
        `📧 Email to: ${currentContractor.name}`,
        currentContractor.email ? `To: ${currentContractor.email}` : '',
        '',
        `Subject: ${subject}`,
        '',
        body,
        '',
        '─'.repeat(30),
        'Composed via Simple House App',
      ].filter(Boolean).join('\n');

      await Share.share({
        message: shareContent,
        title: `Email to ${currentContractor.name}`,
      });
    } catch (error) {
      console.error('Share error:', error);
    }
  }, [currentContractor, subject, body]);

  return (
    <AppBackground>
      <ScreenHeader
        title="Compose Email"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />
      {/* No `KeyboardAvoidingView`: it only shrinks the viewport, leaving the
          focused field behind the keyboard. The ScrollView's
          `automaticallyAdjustKeyboardInsets` is what scrolls it back into view
          — see `src/utils/keyboard.ts`. */}
      <View style={styles.keyboardView} testID="compose-email-screen">
        <AdaptiveContainer>
          <ScrollView
            {...keyboardDismissScrollProps}
            style={[screenScrollViewStyle.scroll, styles.scrollView]}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: insets.bottom + 16 },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {/* Contractor Info */}
            <Card variant="outlined" style={styles.contractorCard}>
              <View style={styles.contractorHeader}>
                <View style={styles.contractorInfo}>
                  <Typography variant="subheadline" weight="semibold">
                    {currentContractor.name}
                  </Typography>
                  {currentContractor.email ? (
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {currentContractor.email}
                    </Typography>
                  ) : (
                    <Typography variant="caption1" color={colors.error}>
                      No email available
                    </Typography>
                  )}
                </View>
                {hasMultiple && (
                  <View style={styles.contractorNav}>
                    <TouchableOpacity
                      onPress={() => setCurrentContractorIndex((prev) => Math.max(0, prev - 1))}
                      disabled={currentContractorIndex === 0}
                      style={[
                        styles.navButton,
                        currentContractorIndex === 0 && styles.navButtonDisabled,
                      ]}
                    >
                      <Icon name="chevron-back" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {currentContractorIndex + 1}/{contractors.length}
                    </Typography>
                    <TouchableOpacity
                      onPress={() => setCurrentContractorIndex((prev) => Math.min(contractors.length - 1, prev + 1))}
                      disabled={currentContractorIndex === contractors.length - 1}
                      style={[
                        styles.navButton,
                        currentContractorIndex === contractors.length - 1 && styles.navButtonDisabled,
                      ]}
                    >
                      <Icon name="chevron-forward" size={18} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </Card>

            {/* Email Type Selector */}
            <View style={styles.section}>
              <Typography variant="subheadline" weight="semibold" style={styles.sectionTitle}>
                Email Type
              </Typography>
              <View style={styles.emailTypeContainer}>
                {EMAIL_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.emailTypeOption,
                      {
                        backgroundColor: selectedEmailType === type.id
                          ? colors.primary + '20'
                          : colors.backgroundSecondary,
                        borderColor: selectedEmailType === type.id
                          ? colors.primary
                          : colors.borderColor,
                      },
                    ]}
                    onPress={() => setSelectedEmailType(type.id)}
                  >
                    <Icon
                      name={type.icon}
                      size={22}
                      color={
                        selectedEmailType === type.id
                          ? colors.primary
                          : colors.textPrimary
                      }
                    />
                    <Typography
                      variant="caption1"
                      weight={selectedEmailType === type.id ? 'semibold' : 'regular'}
                      style={{ textAlign: 'center' }}
                    >
                      {type.label}
                    </Typography>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Subject */}
            <View style={styles.section}>
              <Typography variant="subheadline" weight="semibold" style={styles.sectionTitle}>
                Subject
              </Typography>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: colors.borderColor,
                    color: colors.textPrimary,
                  },
                ]}
                value={subject}
                onChangeText={setSubject}
                placeholder="Email subject..."
                placeholderTextColor={colors.textTertiary}
                editable={!isGenerating}
                testID="compose-email-subject"
              />
            </View>

            {/* Body */}
            <View style={styles.section}>
              <View style={styles.bodyHeader}>
                <Typography variant="subheadline" weight="semibold">
                  Message
                </Typography>
                <TouchableOpacity
                  onPress={generateEmail}
                  disabled={isGenerating}
                  style={styles.regenerateButton}
                >
                  {!isGenerating && (
                    <Icon name="refresh" size={14} color={colors.primary} />
                  )}
                  <Typography variant="caption1" color={colors.primary}>
                    {isGenerating ? 'Generating...' : 'Regenerate'}
                  </Typography>
                </TouchableOpacity>
              </View>
              {isGenerating ? (
                <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundSecondary }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Typography variant="caption1" color={colors.textSecondary} style={styles.loadingText}>
                    AI is writing your email...
                  </Typography>
                </View>
              ) : (
                <TextInput
                  style={[
                    styles.textInputMultiline,
                    {
                      backgroundColor: colors.backgroundSecondary,
                      borderColor: colors.borderColor,
                      color: colors.textPrimary,
                    },
                  ]}
                  value={body}
                  onChangeText={setBody}
                  placeholder="Email body..."
                  placeholderTextColor={colors.textTertiary}
                  multiline
                  numberOfLines={10}
                  textAlignVertical="top"
                  testID="compose-email-body"
                />
              )}
            </View>

            {/* Send Options */}
            <View style={styles.section}>
              <Typography variant="subheadline" weight="semibold" style={styles.sectionTitle}>
                Send Options
              </Typography>
              
              {currentContractor.email && (
                <>
                  <Button
                    title="Open in Email App"
                    leftIcon={<Icon name="mail" size={16} color={colors.white} />}
                    onPress={handleSendViaEmailApp}
                    style={styles.sendButton}
                    disabled={isGenerating || isSending}
                  />

                  <Button
                    title="Send from Simple House"
                    variant="secondary"
                    leftIcon={<Icon name="paper-plane" size={16} color={colors.textPrimary} />}
                    onPress={handleSendViaApp}
                    style={styles.sendButton}
                    disabled={isGenerating || isSending}
                    loading={isSending}
                    testID="compose-email-send"
                  />
                </>
              )}

              {hasMultiple && contractorsWithEmail.length > 1 && (
                <Button
                  title={`Email All ${contractorsWithEmail.length} Contractors`}
                  variant="secondary"
                  leftIcon={<Icon name="mail-open" size={16} color={colors.textPrimary} />}
                  onPress={handleSendToAll}
                  style={styles.sendButton}
                  disabled={isGenerating || isSending}
                />
              )}

              {/* Share Email Button - always visible */}
              <Button
                title="Share Email Draft"
                variant="outline"
                leftIcon={<Icon name="share-outline" size={16} color={colors.primary} />}
                onPress={handleShareEmail}
                style={styles.sendButton}
                disabled={isGenerating || !subject || !body}
              />

              {!currentContractor.email && (
                <View style={styles.noEmailContainer}>
                  <Typography variant="body" color={colors.textSecondary}>
                    This contractor doesn't have an email address. Try calling or visiting their website.
                  </Typography>
                  {currentContractor.phone && (
                    <Button
                      title="Call Instead"
                      variant="secondary"
                      leftIcon={<Icon name="call" size={16} color={colors.textPrimary} />}
                      onPress={() => Linking.openURL(`tel:${currentContractor.phone}`)}
                      style={styles.sendButton}
                    />
                  )}
                  {currentContractor.website && (
                    <Button
                      title="Visit Website"
                      variant="secondary"
                      leftIcon={<Icon name="globe" size={16} color={colors.textPrimary} />}
                      onPress={() => Linking.openURL(currentContractor.website!)}
                      style={styles.sendButton}
                    />
                  )}
                </View>
              )}
            </View>
          </ScrollView>
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  contractorCard: {
    padding: 12,
    marginBottom: 16,
  },
  contractorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contractorInfo: {
    flex: 1,
  },
  contractorNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navButton: {
    padding: 8,
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  emailTypeContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  emailTypeOption: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 4,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    ...scaledFont('body'),
  },
  bodyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  regenerateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  textInputMultiline: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    ...scaledFont('body'),
    minHeight: 200,
  },
  loadingContainer: {
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  loadingText: {
    marginTop: 12,
  },
  sendButton: {
    marginTop: 8,
  },
  noEmailContainer: {
    padding: 16,
    alignItems: 'center',
    gap: 12,
  },
});
