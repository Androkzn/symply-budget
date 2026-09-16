import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { contractorsApi, type ContractorVisit, type ContractorDetail } from '@api/contractors';
// Concrete path, not the @components/common barrel: that barrel re-exports
// screens' headers which import from @components/ui, so reaching SheetHeader
// through it closes a ui <-> common circular require and the component
// arrives undefined at render (see the same note in ui/BottomSheet).
import { SheetHeader } from '@components/common/SheetHeader';
import { Typography, GradientButton } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useHouseholdStore } from '@stores/householdStore';
import { IconSize, useAppColors, type AppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

interface ReceiptRequestModalProps {
  visible: boolean;
  visit: ContractorVisit;
  contractor: ContractorDetail;
  householdId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReceiptRequestModal({
  visible,
  visit,
  contractor,
  householdId,
  onClose,
  onSuccess,
}: ReceiptRequestModalProps) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // The sheet is anchored to the bottom edge, so an open keyboard lands on top
  // of the personal-note field at its foot — and on the Send button below it.
  // Lift the sheet by the inset, and cap its height against what is LEFT above
  // the keyboard so a short phone doesn't push it off the top instead.
  const keyboardInset = useKeyboardInset();
  const { currentHousehold } = useHouseholdStore();
  const [sendMethod, setSendMethod] = useState<'email' | 'sms'>('email');
  const [isLoading, setIsLoading] = useState(false);
  const [customMessage, setCustomMessage] = useState('');

  // Format the property address
  const propertyAddress = useMemo(() => {
    if (!currentHousehold) return 'the property';
    const parts = [];
    if (currentHousehold.address_line1) parts.push(currentHousehold.address_line1);
    if (currentHousehold.address_line2) parts.push(currentHousehold.address_line2);
    if (currentHousehold.city) parts.push(currentHousehold.city);
    if (currentHousehold.state_province) parts.push(currentHousehold.state_province);
    if (currentHousehold.postal_code) parts.push(currentHousehold.postal_code);
    return parts.length > 0 ? parts.join(', ') : currentHousehold.name;
  }, [currentHousehold]);

  // Format visit date
  const visitDateFormatted = useMemo(() => {
    return new Date(visit.visit_date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [visit.visit_date]);

  // Generate standard receipt request message
  const standardMessage = useMemo(() => {
    const displayName = contractor.company_name || contractor.name;
    const workDescription = visit.description || 'the services provided';

    return `Dear ${displayName},

I hope this message finds you well. I'm writing to kindly request a receipt for the service visit on ${visitDateFormatted} at ${propertyAddress}.

Work performed: ${workDescription}

Having a receipt for my records would be greatly appreciated for documentation and tax purposes.

Thank you for your excellent service, and I look forward to hearing from you.

Best regards`;
  }, [contractor, visitDateFormatted, propertyAddress, visit.description]);

  // Full message (standard + custom)
  const fullMessage = customMessage ? `${standardMessage}\n\n${customMessage}` : standardMessage;

  const handleSendRequest = async () => {
    if (sendMethod === 'email' && contractor.email) {
      // Open email client
      const subject = encodeURIComponent(`Receipt Request - Visit on ${visitDateFormatted}`);
      const body = encodeURIComponent(fullMessage);
      const emailUrl = `mailto:${contractor.email}?subject=${subject}&body=${body}`;
      
      try {
        const canOpen = await Linking.canOpenURL(emailUrl);
        if (canOpen) {
          await Linking.openURL(emailUrl);
        } else {
          Alert.alert('Error', 'Unable to open email client');
          return;
        }
      } catch (err) {
        Alert.alert('Error', 'Failed to open email client');
        return;
      }
    } else if (sendMethod === 'sms' && contractor.phone) {
      // Open SMS app
      const smsUrl = `sms:${contractor.phone}&body=${encodeURIComponent(fullMessage)}`;
      
      try {
        const canOpen = await Linking.canOpenURL(smsUrl);
        if (canOpen) {
          await Linking.openURL(smsUrl);
        } else {
          Alert.alert('Error', 'Unable to open messaging app');
          return;
        }
      } catch (err) {
        Alert.alert('Error', 'Failed to open messaging app');
        return;
      }
    } else {
      Alert.alert('Missing Contact', `No ${sendMethod === 'email' ? 'email address' : 'phone number'} available for this contractor.`);
      return;
    }

    // Mark receipt as requested in the backend
    setIsLoading(true);
    try {
      await contractorsApi.requestReceipt(householdId, visit.id, {
        method: sendMethod,
        contractor_email: contractor.email || undefined,
        contractor_phone: contractor.phone || undefined,
        property_address: propertyAddress,
        custom_message: customMessage || undefined,
      });
      onSuccess();
    } catch (err) {
      console.error('Error recording receipt request:', err);
      // Still consider it a success since the email/SMS was opened
      onSuccess();
    } finally {
      setIsLoading(false);
    }
  };

  const canSendEmail = !!contractor.email;
  const canSendSms = !!contractor.phone;
  const contentMaxHeight = windowHeight - keyboardInset - insets.top - 24;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.overlay,
          { backgroundColor: colors.modalBackdrop, paddingBottom: keyboardInset },
        ]}
      >
        <View
          style={[
            styles.container,
            {
              backgroundColor: colors.backgroundSecondary,
              maxHeight: contentMaxHeight,
              // The home indicator sits under the sheet only while the keyboard
              // is down; once it is up the keypad owns that strip.
              paddingBottom: keyboardInset > 0 ? 0 : 34,
            },
          ]}
        >
          {/* Header */}
          {/* The app's one sheet header — glass ✕ on the left, centred title,
              hairline rule under it — not a typographic × on the right. */}
          <SheetHeader
            title="Request Receipt"
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="receipt-request-close"
            leftAccessibilityLabel="Close"
            showDivider
          />

          <ScrollView {...keyboardDismissScrollProps} style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Visit Info */}
            <View style={[styles.infoBox, { backgroundColor: colors.backgroundMain }]}>
              <Typography variant="caption1" color={colors.textSecondary}>
                Visit Details
              </Typography>
              <Typography variant="body" weight="medium" style={{ marginTop: 4 }}>
                {contractor.company_name || contractor.name}
              </Typography>
              <Typography variant="subheadline" color={colors.textSecondary}>
                {visitDateFormatted}
              </Typography>
              {visit.description && (
                <Typography variant="caption1" color={colors.textSecondary} style={{ marginTop: 4 }}>
                  {visit.description}
                </Typography>
              )}
            </View>

            {/* Send Method Selection */}
            <Typography variant="subheadline" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>
              Send via
            </Typography>
            <View style={styles.methodButtons}>
              <TouchableOpacity
                style={[
                  styles.methodButton,
                  { 
                    backgroundColor: sendMethod === 'email' ? theme.pastel.teal + '30' : colors.backgroundMain,
                    borderColor: sendMethod === 'email' ? theme.pastel.teal : colors.borderColor,
                    opacity: canSendEmail ? 1 : 0.5,
                  },
                ]}
                onPress={() => canSendEmail && setSendMethod('email')}
                disabled={!canSendEmail}
              >
                <Icon
                  name="mail"
                  size={IconSize.lg}
                  color={sendMethod === 'email' ? theme.pastel.teal : colors.textPrimary}
                />
                <Typography
                  variant="subheadline"
                  weight={sendMethod === 'email' ? 'semibold' : 'regular'}
                  color={sendMethod === 'email' ? theme.pastel.teal : colors.textPrimary}
                  style={{ marginTop: 4 }}
                >
                  Email
                </Typography>
                {!canSendEmail && (
                  <Typography variant="caption2" color={colors.error} style={{ marginTop: 2 }}>
                    No email
                  </Typography>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.methodButton,
                  { 
                    backgroundColor: sendMethod === 'sms' ? theme.pastel.teal + '30' : colors.backgroundMain,
                    borderColor: sendMethod === 'sms' ? theme.pastel.teal : colors.borderColor,
                    opacity: canSendSms ? 1 : 0.5,
                  },
                ]}
                onPress={() => canSendSms && setSendMethod('sms')}
                disabled={!canSendSms}
              >
                <Icon
                  name="chatbubble"
                  size={IconSize.lg}
                  color={sendMethod === 'sms' ? theme.pastel.teal : colors.textPrimary}
                />
                <Typography
                  variant="subheadline"
                  weight={sendMethod === 'sms' ? 'semibold' : 'regular'}
                  color={sendMethod === 'sms' ? theme.pastel.teal : colors.textPrimary}
                  style={{ marginTop: 4 }}
                >
                  Message
                </Typography>
                {!canSendSms && (
                  <Typography variant="caption2" color={colors.error} style={{ marginTop: 2 }}>
                    No phone
                  </Typography>
                )}
              </TouchableOpacity>
            </View>

            {/* Message Preview */}
            <Typography variant="subheadline" weight="semibold" style={{ marginTop: 20, marginBottom: 8 }}>
              Message Preview
            </Typography>
            <View style={[styles.messagePreview, { backgroundColor: colors.backgroundMain }]}>
              <Typography variant="body" color={colors.textSecondary}>
                {standardMessage}
              </Typography>
            </View>

            {/* Custom Message */}
            <Typography variant="subheadline" weight="semibold" style={{ marginTop: 16, marginBottom: 8 }}>
              Add Personal Note (Optional)
            </Typography>
            <TextInput
              style={[
                styles.customInput,
                { 
                  backgroundColor: colors.backgroundMain, 
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                },
              ]}
              placeholder="Add any additional notes..."
              placeholderTextColor={colors.textSecondary}
              value={customMessage}
              onChangeText={setCustomMessage}
              multiline
              numberOfLines={3}
            />
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.cancelButton, { borderColor: colors.borderColor }]}
              onPress={onClose}
            >
              <Typography variant="body" color={colors.textSecondary}>
                Cancel
              </Typography>
            </TouchableOpacity>
            <GradientButton
              title={isLoading ? 'Opening...' : `Send ${sendMethod === 'email' ? 'Email' : 'Message'}`}
              variant="blue"
              onPress={handleSendRequest}
              disabled={isLoading || (!canSendEmail && !canSendSms)}
              style={{ flex: 1, marginLeft: 12 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // `maxHeight` and `paddingBottom` are applied inline — both depend on the
  // live keyboard inset.
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  // `flexShrink` is what lets the scroller give up height to the keyboard: the
  // sheet's `maxHeight` bounds the column, and without this the ScrollView would
  // hold its content height and push the footer below the screen instead.
  content: {
    flexShrink: 1,
    padding: 20,
  },
  infoBox: {
    padding: 16,
    borderRadius: 12,
  },
  methodButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  methodButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
  },
  messagePreview: {
    padding: 16,
    borderRadius: 12,
    maxHeight: 180,
  },
  customInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderColor,
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
