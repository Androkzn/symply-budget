import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { authApi } from '@api/auth';
import { joinedPlatformAuth } from '@api/joined-platform-auth';
import { isJoinedPlatformBrand } from '@api/platform-spine';
import { brand } from '@brand';
import { SocialAuthButton } from '@components/auth/SocialAuthButton';
import { AppBackground, AuthWave, SafeAreaView, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Button, TextInput, Typography } from '@components/ui';
import { ENV } from '@config/env';
import { useTheme } from '@contexts/ThemeContext';
import type { AuthStackScreenProps } from '@navigation/types';
import { trackEvent, AnalyticsEvent } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';
import { useAppColors } from '@theme';
import { getApiErrorMessage } from '@utils/apiError';
import { isValidEmail } from '@utils/email';
import { keyboardDismissScrollProps } from '@utils/keyboard';

// Ensures the OAuth redirect completes the auth session on return.
WebBrowser.maybeCompleteAuthSession();

export function RegisterScreen({ navigation }: AuthStackScreenProps<'Register'>) {
  const { isDark } = useTheme();
  const colors = useAppColors();
  const login = useAuthStore((state) => state.login);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);

  // Check Apple Sign In availability
  useEffect(() => {
    const checkAppleAuth = async () => {
      const available = await AppleAuthentication.isAvailableAsync();
      setAppleAuthAvailable(available);
    };
    checkAppleAuth();
  }, []);

  const emailInvalid = email.trim().length > 0 && !isValidEmail(email);

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (!/\d/.test(pwd)) {
      return 'Password must contain at least one number';
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) {
      return 'Password must contain at least one special character';
    }
    return null;
  };

  const handleRegister = async () => {
    // Validation
    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Enter a valid email address');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = isJoinedPlatformBrand()
        ? await joinedPlatformAuth.register(email.trim(), password, name.trim())
        : await authApi.register({
            email: email.trim(),
            password,
            display_name: name.trim(),
          });

      trackEvent(AnalyticsEvent.SIGNED_UP, { method: 'email' });
      login(response.user, response.access_token, response.refresh_token);

      Alert.alert(
        'Account Created',
        'A verification email has been sent to your email address. Please verify your email to access all features.',
        [{ text: 'OK' }]
      );
    } catch (err: unknown) {
      const errorMessage = getApiErrorMessage(err, 'Registration failed. Please try again.');
      setError(errorMessage);
      Alert.alert('Registration Failed', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    setError(null);

    try {
      // Step 1 — native Apple sheet. ANY failure here (user tapped Cancel/Close,
      // dismissed the sheet, or has no Apple Account signed in) is NOT an error we
      // surface: the user simply didn't complete Apple sign-in. iOS reports these
      // under different codes across versions (ERR_REQUEST_CANCELED / _UNKNOWN /
      // _NOT_HANDLED …), so we suppress by structure — not by matching codes.
      let credential: AppleAuthentication.AppleAuthenticationCredential;
      try {
        credential = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
        });
      } catch {
        return; // cancelled / dismissed / no Apple Account — quietly abort, no alert
      }

      if (!credential.identityToken || !credential.authorizationCode) {
        return; // native returned without usable credentials — incomplete, not a failure
      }

      // Step 2 — exchange the credential with our backend. A failure HERE is a
      // real sign-in error and is the only path that surfaces an alert.
      const response = isJoinedPlatformBrand()
        ? await joinedPlatformAuth.appleAuth({
            identity_token: credential.identityToken,
            authorization_code: credential.authorizationCode,
            user: {
              email: credential.email ?? undefined,
              name: {
                firstName: credential.fullName?.givenName ?? undefined,
                lastName: credential.fullName?.familyName ?? undefined,
              },
            },
          })
        : await authApi.appleAuth({
            identity_token: credential.identityToken,
            authorization_code: credential.authorizationCode,
            user: {
              email: credential.email ?? undefined,
              name: {
                firstName: credential.fullName?.givenName ?? undefined,
                lastName: credential.fullName?.familyName ?? undefined,
              },
            },
          });

      login(response.user, response.access_token, response.refresh_token);

      if (response.is_new_user) {
        Alert.alert(
          'Welcome!',
          'Your account has been created successfully.',
          [{ text: 'OK' }]
        );
      }
    } catch (err: unknown) {
      // Only reached by a backend token-exchange failure.
      const errorMessage = getApiErrorMessage(err, 'Apple Sign In failed. Please try again.');
      setError(errorMessage);
      Alert.alert('Sign In Failed', errorMessage);
    } finally {
      setAppleLoading(false);
    }
  };

  // Google Sign-Up via expo-auth-session (same flow as sign-in; the backend
  // creates the account if it doesn't exist).
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: ENV.GOOGLE_AUTH.IOS_CLIENT_ID,
    androidClientId: ENV.GOOGLE_AUTH.ANDROID_CLIENT_ID,
    webClientId: ENV.GOOGLE_AUTH.WEB_CLIENT_ID,
  });

  const exchangeGoogleToken = useCallback(
    async (idToken: string) => {
      try {
        const response = isJoinedPlatformBrand()
          ? await joinedPlatformAuth.googleAuth({ id_token: idToken })
          : await authApi.googleAuth({ id_token: idToken });
        login(response.user, response.access_token, response.refresh_token);
        if (response.is_new_user) {
          Alert.alert('Welcome!', 'Your account has been created successfully.', [{ text: 'OK' }]);
        }
      } catch (err: unknown) {
        const errorMessage = getApiErrorMessage(err, 'Google Sign In failed. Please try again.');
        setError(errorMessage);
        Alert.alert('Sign In Failed', errorMessage);
      } finally {
        setGoogleLoading(false);
      }
    },
    [login]
  );

  useEffect(() => {
    if (!googleResponse) return;
    if (googleResponse.type === 'success') {
      const idToken = googleResponse.params?.id_token;
      if (idToken) {
        exchangeGoogleToken(idToken);
      } else {
        setGoogleLoading(false);
        setError('Google did not return an ID token. Please try again.');
      }
    } else if (googleResponse.type === 'error') {
      setGoogleLoading(false);
      setError('Google Sign In failed. Please try again.');
    } else {
      setGoogleLoading(false);
    }
  }, [googleResponse, exchangeGoogleToken]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const result = await googlePromptAsync();
      if (result?.type !== 'success') {
        setGoogleLoading(false);
      }
    } catch {
      setGoogleLoading(false);
      setError('Could not start Google Sign In.');
    }
  };

  return (
    <AppBackground>
      <AuthWave />
      <SafeAreaView>
        <AdaptiveContainer width="reading" padding={0}>
          {/* No `KeyboardAvoidingView`: it only SHRINKS the viewport and never
              moves the content inside it, so a mid-form field (Password,
              Confirm Password) stayed put behind the keypad.
              `keyboardDismissScrollProps` carries
              `automaticallyAdjustKeyboardInsets`, the half that actually
              scrolls the focused field back into view. See `@utils/keyboard`. */}
          <ScrollView
            {...keyboardDismissScrollProps}
            style={screenScrollViewStyle.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.backButton}>
              <Button
                title="Back to Sign In"
                variant="ghost"
                size="sm"
                onPress={() => navigation.goBack()}
                textColor={colors.primary}
                testID="auth-register-back"
              />
            </View>

            <View style={styles.header}>
              <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
                Create Account
              </Typography>
              <Typography
                variant="body"
                color={colors.textSecondary}
                style={styles.subtitle}
              >
                Join {brand.displayName} today
              </Typography>
            </View>

            <View style={styles.form}>
              <TextInput
                label="Full Name"
                placeholder="Enter your full name"
                autoCapitalize="words"
                autoComplete="name"
                value={name}
                onChangeText={setName}
                labelColor={colors.textPrimary}
              />

              <TextInput
                label="Email"
                placeholder="Enter your email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
                error={emailInvalid ? 'Enter a valid email address' : undefined}
                labelColor={colors.textPrimary}
              />

              <TextInput
                label="Password"
                placeholder="Create a password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                value={password}
                onChangeText={setPassword}
                helperText="8+ characters with number and special character"
                labelColor={colors.textPrimary}
                helperTextColor={colors.textSecondary}
              />

              <TextInput
                label="Confirm Password"
                placeholder="Confirm your password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                error={
                  confirmPassword && password !== confirmPassword
                    ? 'Passwords do not match'
                    : undefined
                }
                labelColor={colors.textPrimary}
              />

              {error && (
                <Typography variant="caption1" color={colors.error} style={styles.errorText}>
                  {error}
                </Typography>
              )}

              <View style={styles.registerButton}>
                <Button
                  title="Create Account"
                  onPress={handleRegister}
                  loading={loading}
                  disabled={loading || appleLoading || emailInvalid}
                  fullWidth
                  testID="auth-register-submit"
                />
              </View>

              {/* Apple Sign In Button */}
              {appleAuthAvailable && Platform.OS === 'ios' && (
                <View style={styles.appleButtonContainer}>
                  <View style={styles.dividerContainer}>
                    <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
                    <Typography variant="caption1" color={colors.textTertiary} style={styles.dividerText}>
                      or
                    </Typography>
                    <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
                  </View>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                    buttonStyle={
                      isDark
                        ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                        : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                    }
                    cornerRadius={12}
                    style={styles.appleButton}
                    onPress={handleAppleSignIn}
                  />
                  {appleLoading && (
                    <Typography variant="caption1" color={colors.textSecondary} style={styles.appleLoadingText}>
                      Signing up with Apple...
                    </Typography>
                  )}
                </View>
              )}

              {/* Google Sign Up Button (all platforms) */}
              <View style={styles.googleButtonContainer}>
                {!(appleAuthAvailable && Platform.OS === 'ios') && (
                  <View style={styles.dividerContainer}>
                    <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
                    <Typography variant="caption1" color={colors.textTertiary} style={styles.dividerText}>
                      or
                    </Typography>
                    <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
                  </View>
                )}
                <SocialAuthButton
                  provider="google"
                  title={googleLoading ? 'Signing up…' : 'Sign up with Google'}
                  onPress={handleGoogleSignIn}
                  loading={googleLoading}
                  disabled={!googleRequest || googleLoading || loading}
                  testID="auth-sign-up-google"
                />
              </View>
            </View>

            <View style={styles.footer}>
              <Typography variant="body" color={colors.textSecondary}>
                Already have an account?{' '}
              </Typography>
              <Button
                title="Sign In"
                variant="ghost"
                size="sm"
                onPress={() => navigation.goBack()}
                textColor={colors.primary}
              />
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
    paddingTop: 40,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 20,
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
  registerButton: {
    marginTop: 8,
  },
  appleButtonContainer: {
    marginTop: 16,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  divider: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
  },
  appleButton: {
    width: '100%',
    height: 50,
  },
  appleLoadingText: {
    textAlign: 'center',
    marginTop: 8,
  },
  googleButtonContainer: {
    marginTop: 12,
  },
  errorText: {
    marginTop: 8,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
});
