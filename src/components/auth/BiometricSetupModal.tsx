import { BlurView } from 'expo-blur';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Modal,
  View,
  Image,
  StyleSheet,
  Platform,
  Animated,
  TouchableOpacity,
  Dimensions,
} from 'react-native';

import { brand } from '@brand';
import { getLogoSplashForScheme } from '@brand/assets';
import { GradientButton, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { biometricService } from '@services/biometric';
import { useAppStore } from '@stores/appStore';
import { useAuthStore } from '@stores/authStore';
import { useAppColors } from '@theme';
import type { AppColors } from '@theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface BiometricSetupModalProps {
  visible: boolean;
  onComplete: () => void;
}

export function BiometricSetupModal({ visible, onComplete }: BiometricSetupModalProps) {
  const colors = useAppColors();
  const accentScheme = useAppStore((s) => s.accentScheme);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [biometricType, setBiometricType] = useState<string>('Biometrics');
  const [loading, setLoading] = useState(false);

  // Animations
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;

  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const setBiometricEnabled = useAuthStore((state) => state.setBiometricEnabled);
  const setBiometricPromptShown = useAuthStore((state) => state.setBiometricPromptShown);

  useEffect(() => {
    const loadBiometricType = async () => {
      const typeName = await biometricService.getBiometricTypeName();
      setBiometricType(typeName);
    };
    if (visible) {
      loadBiometricType();

      // Animate in
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 65,
          friction: 8,
        }),
      ]).start();

      // Pulse animation for icon
      Animated.loop(
        Animated.sequence([
          Animated.timing(iconPulse, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(iconPulse, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      slideAnim.setValue(SCREEN_HEIGHT);
      fadeAnim.setValue(0);
      scaleAnim.setValue(0.9);
    }
  }, [visible, slideAnim, fadeAnim, scaleAnim, iconPulse]);

  const handleEnable = async () => {
    if (!user || !refreshToken) {
      onComplete();
      return;
    }

    setLoading(true);
    try {
      const success = await biometricService.enableBiometric({
        email: user.email,
        refreshToken: refreshToken,
      });

      if (success) {
        setBiometricEnabled(true);
      }
      setBiometricPromptShown(true);
      onComplete();
    } catch (error) {
      console.error('Error enabling biometric:', error);
      setBiometricPromptShown(true);
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    setBiometricPromptShown(true);
    onComplete();
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.overlay}>
        {/* Blurred backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <BlurView intensity={20} style={StyleSheet.absoluteFill} tint="dark" />
          <View style={styles.backdropOverlay} />
        </Animated.View>

        {/* Bottom Sheet */}
        <Animated.View
          style={[
            styles.sheetContainer,
            {
              transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
            },
          ]}
        >
          <View style={[styles.sheet, { backgroundColor: colors.backgroundSecondary }]}>
            {/* Drag Handle */}
            <View style={styles.dragHandleContainer}>
              <View style={[styles.dragHandle, { backgroundColor: colors.textTertiary }]} />
            </View>

            {/* Brand mark, not a biometric glyph: the kit's `face-id` art is a bare
                brush ring that reads as a smudge at hero size, and the prompt is an
                app-trust moment. `logoSplash` is the 1024² per-brand mark, so it stays
                crisp here and every storefront gets its own logo for free. */}
            <Animated.View style={[styles.iconWrapper, { transform: [{ scale: iconPulse }] }]}>
              <Image
                source={getLogoSplashForScheme(brand.id, accentScheme)}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel={brand.displayName}
              />
            </Animated.View>

            {/* Title */}
            <Typography variant="title1" weight="bold" style={styles.title}>
              Enable {biometricType}?
            </Typography>

            {/* Description */}
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.description}
            >
              Use {biometricType} for quick and secure sign in to the app
            </Typography>

            {/* Benefits */}
            <View style={styles.benefits}>
              {[
                { icon: 'flash', text: 'Instant access to your account' },
                { icon: 'shield-checkmark', text: 'Bank-level security' },
                { icon: 'lock-closed', text: 'Your biometrics never leave this device' },
              ].map((benefit, index) => (
                <View key={index} style={styles.benefitRow}>
                  <View
                    style={[styles.benefitIconContainer, { backgroundColor: colors.success + '15' }]}
                  >
                    <Icon name={benefit.icon} size={18} color={colors.success} />
                  </View>
                  <Typography
                    variant="subheadline"
                    style={styles.benefitText}
                    color={colors.textPrimary}
                  >
                    {benefit.text}
                  </Typography>
                </View>
              ))}
            </View>

            {/* Buttons — Enable uses shared GradientButton (brand primary CTA).
                Text-only: the same `face-id` ring rendered here as a white smudge,
                and the title already names the biometric. */}
            <View style={styles.buttons}>
              <GradientButton
                title={loading ? 'Enabling...' : `Enable ${biometricType}`}
                onPress={handleEnable}
                disabled={loading}
                loading={loading}
                fullWidth
                size="lg"
                testID="auth-biometric-enable"
              />

              <TouchableOpacity
                style={styles.skipButton}
                onPress={handleSkip}
                disabled={loading}
                activeOpacity={0.7}
                testID="auth-biometric-skip"
              >
                <Typography variant="headline" weight="medium" color={colors.textSecondary}>
                  Not Now
                </Typography>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (_colors: AppColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
    },
    backdropOverlay: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    sheetContainer: {
      width: '100%',
    },
    sheet: {
      width: '100%',
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      paddingHorizontal: 24,
      paddingBottom: Platform.OS === 'ios' ? 48 : 32,
      alignItems: 'center',
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.15,
          shadowRadius: 24,
        },
        android: {
          elevation: 16,
        },
      }),
    },
    dragHandleContainer: {
      width: '100%',
      alignItems: 'center',
      paddingTop: 12,
      paddingBottom: 8,
    },
    dragHandle: {
      width: 40,
      height: 5,
      borderRadius: 3,
      opacity: 0.3,
    },
    iconWrapper: {
      marginTop: 16,
      marginBottom: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logo: {
      width: 88,
      height: 88,
    },
    title: {
      textAlign: 'center',
      marginBottom: 8,
    },
    description: {
      textAlign: 'center',
      marginBottom: 28,
      lineHeight: 22,
      paddingHorizontal: 16,
    },
    benefits: {
      width: '100%',
      marginBottom: 32,
      gap: 16,
    },
    benefitRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    benefitIconContainer: {
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 14,
    },
    benefitText: {
      flex: 1,
      lineHeight: 20,
    },
    buttons: {
      width: '100%',
      gap: 12,
    },
    skipButton: {
      width: '100%',
      alignItems: 'center',
      paddingVertical: 16,
    },
  });
