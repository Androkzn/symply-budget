import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Modal, ScrollView } from 'react-native';

import { brandId } from '@brand';
import { SheetHeader } from '@components/common/SheetHeader';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useNativeModalPresentation } from '@navigation/presentation';
import { useAppColors } from '@theme';

import {
  buildPrivacySections,
  buildTermsSections,
  LegalSections,
} from './LegalDocument';

/**
 * Shared "I agree to the Terms of Service and Privacy Policy" control used by
 * every brand's onboarding welcome. Owns the two legal bottom sheets so screens
 * only track the single `agreed` boolean. The legal copy is per-brand — pulled
 * from `@config/brandContent` via the shared LegalDocument builders — so each
 * app shows its own Terms/Privacy through the same UI.
 */
export function LegalAgreement({
  agreed,
  onToggle,
}: {
  agreed: boolean;
  onToggle: () => void;
}) {
  const colors = useAppColors();
  const [showTermsSheet, setShowTermsSheet] = useState(false);
  const [showPrivacySheet, setShowPrivacySheet] = useState(false);
  const modalPresentation = useNativeModalPresentation('pageSheet');

  return (
    <>
      <View style={styles.checkboxRow}>
        {/* Its own touchable, sized to the checkbox glyph — NOT wrapping the
            text below. That text contains the Terms/Privacy links as their
            OWN nested touchables; a single outer touchable spanning the
            whole (wrapping, multi-line) row would center its tap target
            somewhere in that wrapped text rather than on the checkbox,
            since the checkbox itself sits fixed at the top-left while the
            row's bounding box grows with the text. That misrouted a
            `tapOn: id:` (and, for the same reason, a VoiceOver/Switch
            Control activation) into opening a legal sheet instead of
            toggling agreement — and nesting touchables inside an
            accessible element hid the links from VoiceOver entirely. */}
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="onboarding-agree-terms"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
        >
          <View
            style={[
              styles.checkbox,
              {
                backgroundColor: agreed ? colors.primaryDark : 'transparent',
                borderColor: agreed ? colors.primaryDark : colors.textSecondary,
              },
            ]}
          >
            {agreed && <Icon name="checkmark" size={16} color={colors.white} />}
          </View>
        </TouchableOpacity>
        <View style={styles.termsTextContainer}>
          <Typography variant="footnote" color={colors.textSecondary}>
            I agree to the{' '}
          </Typography>
          <TouchableOpacity onPress={() => setShowTermsSheet(true)}>
            <Typography variant="footnote" style={{ color: colors.primaryDark }}>
              Terms of Service
            </Typography>
          </TouchableOpacity>
          <Typography variant="footnote" color={colors.textSecondary}>
            {' '}and{' '}
          </Typography>
          <TouchableOpacity onPress={() => setShowPrivacySheet(true)}>
            <Typography variant="footnote" style={{ color: colors.primaryDark }}>
              Privacy Policy
            </Typography>
          </TouchableOpacity>
        </View>
      </View>

      <LegalSheet
        visible={showTermsSheet}
        title="Terms of Service"
        presentation={modalPresentation}
        onClose={() => setShowTermsSheet(false)}
      >
        <LegalSections sections={buildTermsSections(ENV.APP_NAME, brandId)} />
      </LegalSheet>

      <LegalSheet
        visible={showPrivacySheet}
        title="Privacy Policy"
        presentation={modalPresentation}
        onClose={() => setShowPrivacySheet(false)}
      >
        <LegalSections sections={buildPrivacySections(ENV.APP_NAME, brandId)} />
      </LegalSheet>
    </>
  );
}

function LegalSheet({
  visible,
  title,
  presentation,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  presentation: ReturnType<typeof useNativeModalPresentation>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={presentation}
      onRequestClose={onClose}
    >
      <View style={[styles.sheetContainer, { backgroundColor: colors.backgroundMain }]}>
        <View style={[styles.sheetHeader, { borderBottomColor: colors.borderColor }]}>
          <View style={[styles.sheetHandle, { backgroundColor: colors.borderColor }]} />
          {/* The app's one sheet header — glass ✕ on the left, centred title —
              rather than this sheet's own bold-title-plus-✕ row. */}
          <SheetHeader
            title={title}
            titleLines={2}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="legal-sheet-close"
            leftAccessibilityLabel="Close"
          />
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            align="center"
          >
            Last updated: January 2026
          </Typography>
        </View>
        {/* No `automaticallyAdjustKeyboardInsets` here: this sheet renders the
            Terms and Privacy PROSE and nothing else — every caller passes read-only
            copy, never a field, so there is no keyboard to clear. */}
        <ScrollView
          style={styles.sheetContent}
          contentContainerStyle={styles.sheetScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  termsTextContainer: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  sheetContainer: {
    flex: 1,
  },
  sheetHeader: {
    // No horizontal padding of its own: `SheetHeader` brings the app's, and
    // doubling them would indent the ✕ past every other sheet's.
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetContent: {
    flex: 1,
  },
  sheetScrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
});
