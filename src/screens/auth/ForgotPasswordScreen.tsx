import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { authApi } from '@api/auth';
import { AppBackground, AuthWave, SafeAreaView, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { AuthStackScreenProps } from '@navigation/types';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

export function ForgotPasswordScreen({ navigation }: AuthStackScreenProps<'ForgotPassword'>) {  const colors = useAppColors();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await authApi.forgotPassword(email.trim());
      setSubmitted(true);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Failed to send reset email. Please try again.';
      setError(errorMessage);
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <AppBackground>
        <AuthWave />
        <SafeAreaView>
          <AdaptiveContainer width="reading" padding={0}>
            <View style={styles.successContainer}>
              <View style={styles.successIcon}>
                <Icon name="mail" size={40} color={colors.textPrimary} />
              </View>
              <Typography variant="title1" weight="bold" align="center" color={colors.textPrimary}>
                Check Your Email
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                align="center"
                style={styles.successText}
              >
                If an account exists with {email}, we've sent password reset instructions.
              </Typography>
              <View style={styles.backButton}>
                <Button
                  title="Back to Sign In"
                  variant="ghost"
                  onPress={() => navigation.navigate('Login')}
                  textColor={colors.primary}
                  fullWidth
                />
              </View>
            </View>
          </AdaptiveContainer>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
        <AuthWave />
      <SafeAreaView>
        <AdaptiveContainer width="reading" padding={0}>
          {/* No `KeyboardAvoidingView`: it only SHRINKS the viewport and never
              moves the content inside it, so the vertically-centred email field
              stayed put behind the keypad. `keyboardDismissScrollProps` carries
              `automaticallyAdjustKeyboardInsets`, the half that actually scrolls
              the focused field back into view. See `@utils/keyboard`. */}
          <ScrollView
            {...keyboardDismissScrollProps}
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
                Reset Password
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.subtitle}
              >
                Enter your email address and we'll send you instructions to reset
                your password.
              </Typography>
            </View>

            <View style={styles.form}>
              <TextInput
                label="Email"
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                labelColor={colors.textPrimary}
                testID="auth-forgot-email-input"
              />

              {error && (
                <Typography variant="caption1" color={colors.error} style={styles.errorText}>
                  {error}
                </Typography>
              )}

              <View style={styles.submitButton}>
                <Button
                  title="Send Reset Link"
                  onPress={handleSubmit}
                  loading={loading}
                  disabled={loading || !email.trim()}
                  fullWidth
                  testID="auth-forgot-submit"
                />
              </View>

              <View style={styles.backLink}>
                <Button
                  title="Back to Sign In"
                  variant="ghost"
                  onPress={() => navigation.goBack()}
                  textColor={colors.primary}
                />
              </View>
            </View>
            </ScrollView>
        </AdaptiveContainer>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 40,
  },
  subtitle: {
    marginTop: 8,
  },
  form: {
    marginBottom: 24,
  },
  submitButton: {
    marginTop: 8,
  },
  backLink: {
    marginTop: 16,
    alignSelf: 'center',
  },
  errorText: {
    marginTop: 8,
    textAlign: 'center',
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  successIcon: {
    marginBottom: 24,
  },
  successText: {
    marginTop: 12,
    marginBottom: 32,
  },
  backButton: {
    marginTop: 16,
    width: '100%',
  },
});
