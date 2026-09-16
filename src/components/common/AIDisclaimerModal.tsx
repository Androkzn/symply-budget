import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  Modal,
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';

import { Typography, Button, Card } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useNativeModalPresentation } from '@navigation/presentation';
import { storageHelpers } from '@services/storage';
import { AI_DISCLAIMER, CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

const AI_DISCLAIMER_ACCEPTED_KEY = '@simplehouse/ai_disclaimer_accepted';
const AI_DISCLAIMER_VERSION = '1.0'; // Increment when disclaimer changes significantly

interface AIDisclaimerModalProps {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
  feature: 'report_analysis' | 'contractor_search' | 'cost_estimates';
}

// Built lazily (not at module-load time) because it reads `ENV.APP_NAME`. This
// component is imported through the common barrel during a circular import chain
// where `@config/env` may not have finished initializing yet — evaluating
// `ENV.APP_NAME` at module scope throws "Property 'ENV' doesn't exist".
const getDisclaimerContent = () => ({
  title: 'Important Disclaimer',
  subtitle: 'AI-Generated Content & Limitations',
  sections: [
    {
      icon: 'warning' as keyof typeof Ionicons.glyphMap,
      title: 'Not Professional Advice',
      content: `This feature uses artificial intelligence (AI) to analyze your documents and generate recommendations. The information provided is for INFORMATIONAL PURPOSES ONLY and does NOT constitute:

• Professional home inspection advice
• Licensed contractor recommendations  
• Structural engineering assessments
• Legal or financial advice
• Building code compliance verification

Always consult qualified, licensed professionals before making decisions about your property.`,
    },
    {
      icon: 'hardware-chip' as keyof typeof Ionicons.glyphMap,
      title: 'AI Limitations',
      content: `Artificial intelligence can make errors. You acknowledge that:

• AI may misinterpret, omit, or incorrectly extract information from documents
• Cost estimates are approximations only and may not reflect actual market prices in your area
• Recommendations may not be suitable for your specific situation
• AI cannot physically inspect your property or verify conditions
• Results depend on the quality and completeness of uploaded documents`,
    },
    {
      icon: 'cash' as keyof typeof Ionicons.glyphMap,
      title: 'Cost Estimates Disclaimer',
      content: `All cost estimates are:

• Rough approximations based on general market data
• NOT binding quotes or guarantees
• Subject to significant variation based on location, timing, contractor, materials, and scope
• Potentially outdated or inaccurate

Actual costs may be significantly higher or lower. Always obtain multiple quotes from licensed professionals.`,
    },
    {
      icon: 'construct' as keyof typeof Ionicons.glyphMap,
      title: 'Contractor Information',
      content: `When searching for contractors:

• We do not verify, endorse, or guarantee any contractor
• Reviews and ratings are from third-party sources and may be inaccurate
• You are solely responsible for vetting contractors
• We recommend verifying licenses, insurance, and references
• We are not responsible for any work performed by contractors`,
    },
    {
      icon: 'shield-checkmark' as keyof typeof Ionicons.glyphMap,
      title: 'Limitation of Liability',
      content: `By using this feature, you agree that:

• ${ENV.APP_NAME} is NOT liable for any damages, losses, or injuries resulting from reliance on AI-generated content
• You assume all risk for decisions made based on app information
• You will not hold ${ENV.APP_NAME} responsible for contractor work, cost discrepancies, or property damage
• You have read and agree to our full Terms of Service`,
    },
  ],
  acknowledgment: `By tapping "I Understand & Accept", you acknowledge that you have read, understood, and agree to these limitations. You understand that AI-generated content may contain errors and is not a substitute for professional advice.`,
});

export function AIDisclaimerModal({
  visible,
  onAccept,
  onDecline,
  feature,
}: AIDisclaimerModalProps) {  const colors = useAppColors();
  const disclaimerContent = getDisclaimerContent();
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const modalPresentation = useNativeModalPresentation('pageSheet');

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
    if (isCloseToBottom) {
      setHasScrolledToBottom(true);
    }
  }, []);

  /**
   * A body that already fits counts as "read to the bottom".
   *
   * `hasScrolledToBottom` gates the accept button, and it used to be reachable
   * ONLY through `onScroll`. When the disclaimer fits the viewport there is
   * nothing to scroll, so that event never fires — and the gate never opens.
   * On a tall screen (iPad, and any short-content variant of this modal) that
   * left "I Understand & Accept" permanently disabled, with a banner telling
   * the member to scroll to a bottom they were already looking at. The AI
   * feature behind it could not be reached at all.
   *
   * Comparing content height against viewport height covers the case the scroll
   * handler structurally cannot. Both callbacks feed it because either can
   * arrive first, and the fits-check needs both numbers.
   */
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const settleIfContentFits = useCallback(() => {
    if (viewportHeight.current <= 0 || contentHeight.current <= 0) return;
    if (contentHeight.current <= viewportHeight.current + 1) {
      setHasScrolledToBottom(true);
    }
  }, []);
  const handleScrollLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeight.current = event.nativeEvent.layout.height;
      settleIfContentFits();
    },
    [settleIfContentFits],
  );
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeight.current = height;
      settleIfContentFits();
    },
    [settleIfContentFits],
  );

  const handleAccept = useCallback(async () => {
    try {
      const acceptedData = {
        version: AI_DISCLAIMER_VERSION,
        acceptedAt: new Date().toISOString(),
        feature,
      };
      await storageHelpers.setObject(AI_DISCLAIMER_ACCEPTED_KEY, acceptedData);
      onAccept();
    } catch (error) {
      console.error('Failed to save disclaimer acceptance:', error);
      onAccept();
    }
  }, [feature, onAccept]);

  const handleViewTerms = useCallback(() => {
    Linking.openURL('https://symply.app/terms');
  }, []);

  const canAccept = hasScrolledToBottom && checkboxChecked;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={modalPresentation}
      onRequestClose={onDecline}
    >
      <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
          <View style={styles.headerContent}>
            <Typography variant="title2" weight="bold" align="center">
              {disclaimerContent.title}
            </Typography>
            <Typography 
              variant="subheadline" 
              color={colors.textSecondary} 
              align="center"
              style={styles.subtitle}
            >
              {disclaimerContent.subtitle}
            </Typography>
          </View>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          onLayout={handleScrollLayout}
          onContentSizeChange={handleContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={true}
        >
          {/* Warning Banner */}
          <View
            style={[
              styles.warningBanner,
              { backgroundColor: AI_DISCLAIMER.warningBg, borderColor: AI_DISCLAIMER.warningBorder },
            ]}
          >
            <View style={styles.warningBannerTitleRow}>
              <Icon
                name="warning"
                size={IconSize.md}
                color={AI_DISCLAIMER.warningText}
              />
              <Typography variant="headline" weight="semibold" align="center">
                PLEASE READ CAREFULLY
              </Typography>
            </View>
            <Typography
              variant="footnote"
              color={AI_DISCLAIMER.warningText}
              align="center"
              style={styles.warningText}
            >
              You must scroll to the bottom and check the box to continue
            </Typography>
          </View>

          {/* Disclaimer Sections */}
          {disclaimerContent.sections.map((section, index) => (
            <Card key={index} variant="outlined" style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Icon
                  name={section.icon}
                  size={IconSize.md}
                  color={colors.textPrimary}
                />
                <Typography variant="headline" weight="semibold" style={styles.sectionTitleText}>
                  {section.title}
                </Typography>
              </View>
              <Typography 
                variant="body" 
                color={colors.textSecondary}
                style={styles.sectionContent}
              >
                {section.content}
              </Typography>
            </Card>
          ))}

          {/* Final Acknowledgment */}
          <View style={[styles.acknowledgmentBox, { backgroundColor: colors.backgroundSecondary, borderColor: colors.primary }]}>
            <Typography variant="body" color={colors.textPrimary} style={styles.acknowledgmentText}>
              {disclaimerContent.acknowledgment}
            </Typography>
          </View>

          {/* Checkbox */}
          <TouchableOpacity
            style={styles.checkboxRow}
            onPress={() => setCheckboxChecked(!checkboxChecked)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: colors.primary },
                checkboxChecked && { backgroundColor: colors.primary },
              ]}
            >
              {checkboxChecked && (
                <Icon name="checkmark" size={IconSize.sm} color={colors.white} />
              )}
            </View>
            <Typography variant="subheadline" color={colors.textPrimary} style={styles.checkboxLabel}>
              I have read and understand all of the above disclaimers and limitations
            </Typography>
          </TouchableOpacity>

          {/* Terms Link */}
          <TouchableOpacity onPress={handleViewTerms} style={styles.termsLink}>
            <Typography variant="footnote" color={colors.primary}>
              View Full Terms of Service
            </Typography>
          </TouchableOpacity>

          {/* Scroll Indicator */}
          {!hasScrolledToBottom && (
            <View style={styles.scrollIndicator}>
              <Icon
                name="chevron-down"
                size={IconSize.sm}
                color={colors.textTertiary}
              />
              <Typography variant="caption1" color={colors.textTertiary} align="center">
                Scroll down to continue
              </Typography>
              <Icon
                name="chevron-down"
                size={IconSize.sm}
                color={colors.textTertiary}
              />
            </View>
          )}
        </ScrollView>

        {/* Footer Buttons */}
        <View style={[styles.footer, { borderTopColor: colors.borderColor, backgroundColor: colors.backgroundSecondary }]}>
          <Button
            title="Decline"
            variant="outline"
            onPress={onDecline}
            style={styles.declineButton}
          />
          <Button
            title="I Understand & Accept"
            variant="primary"
            onPress={handleAccept}
            disabled={!canAccept}
            style={[styles.acceptButton, !canAccept && styles.disabledButton]}
          />
        </View>
      </View>
    </Modal>
  );
}

/**
 * Check if user has already accepted the AI disclaimer
 */
export async function hasAcceptedAIDisclaimer(): Promise<boolean> {
  try {
    const data = await storageHelpers.getObject<{ version: string; acceptedAt: string; feature: string }>(AI_DISCLAIMER_ACCEPTED_KEY);
    if (!data) return false;
    
    // Check if the version matches (require re-acceptance if version changes)
    return data.version === AI_DISCLAIMER_VERSION;
  } catch {
    return false;
  }
}

/**
 * Reset the AI disclaimer acceptance (for testing or policy updates)
 */
export async function resetAIDisclaimerAcceptance(): Promise<void> {
  try {
    await storageHelpers.delete(AI_DISCLAIMER_ACCEPTED_KEY);
  } catch (error) {
    console.error('Failed to reset disclaimer acceptance:', error);
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    borderBottomWidth: 1,
  },
  headerContent: {
    alignItems: 'center',
  },
  subtitle: {
    marginTop: Spacing.xs,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl + Spacing.lg,
  },
  warningBanner: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: Spacing.xxs,
    marginBottom: Spacing.lg,
  },
  warningBannerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  warningText: {
    marginTop: Spacing.xs,
  },
  sectionCard: {
    marginBottom: Spacing.base,
    padding: Spacing.base,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitleText: {
    flex: 1,
  },
  sectionContent: {
    lineHeight: 22,
  },
  acknowledgmentBox: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: Spacing.xxs,
    marginTop: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  acknowledgmentText: {
    lineHeight: 22,
    fontStyle: 'italic',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.base,
    paddingHorizontal: Spacing.xs,
  },
  checkbox: {
    width: Spacing.xl,
    height: Spacing.xl,
    borderWidth: Spacing.xxs,
    borderRadius: CornerRadius.xs,
    marginRight: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    flex: 1,
    lineHeight: 22,
  },
  termsLink: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  scrollIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderTopWidth: 1,
    gap: Spacing.md,
  },
  declineButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 2,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
