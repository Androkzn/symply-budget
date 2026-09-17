import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  TouchableOpacity,
  useWindowDimensions,
  TextInput as RNTextInput,
} from 'react-native';

import { authApi } from '@api/auth';
import { joinedPlatformAuth } from '@api/joined-platform-auth';
import { isJoinedPlatformBrand } from '@api/platform-spine';
import { brandId } from '@brand';
import { getBrandLoginTheme } from '@brand/loginTheme';
import { SocialAuthButton } from '@components/auth/SocialAuthButton';
import { AuthWave, GradientText, HeaderLogo, SafeAreaView, screenScrollViewStyle } from '@components/common';
import { Button, GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { ENV } from '@config/env';
import { useTheme } from '@contexts/ThemeContext';
import { useBiometricLogin } from '@hooks/useBiometricLogin';
import type { AuthStackScreenProps } from '@navigation/types';
import {
  consumeE2ELogin,
  hasPendingE2ELogin,
  subscribeE2ELogin,
  type E2ELoginCredentials,
} from '@services/e2e-autologin';
import {
  portfolioDemoCredentialsFromLocation,
  readPortfolioDemoCredentials,
  requestPortfolioDemo,
} from '@services/portfolio-demo';
import { useAppStore } from '@stores/appStore';
import { useAuthStore } from '@stores/authStore';
import { useAppColors } from '@theme';
import { getApiErrorMessage } from '@utils/apiError';
import { isValidEmail } from '@utils/email';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type PortfolioMessageEvent = {
  data: unknown;
  origin: string;
  source: unknown;
};
type PortfolioWindow = {
  parent: unknown;
  location?: { search?: string };
  addEventListener(type: 'message', listener: (event: PortfolioMessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: PortfolioMessageEvent) => void): void;
};
declare const window: PortfolioWindow;

// Ensures the OAuth popup/redirect completes the auth session on return.
WebBrowser.maybeCompleteAuthSession();

export function LoginScreen({ navigation, route }: AuthStackScreenProps<'Login'>) {
  const { isDark } = useTheme();
  const colors = useAppColors();
  const accentScheme = useAppStore((state) => state.accentScheme);
  const login = useAuthStore((state) => state.login);

  // Get redirect params for invitation flow
  const redirectTo = route.params?.redirectTo;
  const inviteToken = route.params?.inviteToken;

  // Window-aware device info — recomputes on resize/rotation/Stage Manager.
  // Initial values captured once per layout change keep keyboard show/hide from re-rendering.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const smallerDimension = Math.min(windowWidth, windowHeight);
  const isTablet = smallerDimension >= 600;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAuthAvailable, setAppleAuthAvailable] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const emailInvalid = email.trim().length > 0 && !isValidEmail(email);
  const passwordInputRef = useRef<RNTextInput>(null);

  // Skip the biometric auto-prompt when an E2E autologin is driving the screen
  // (declared before the hook so it can consume the ref). Set in applyE2ELogin.
  const skipBiometricAutoLoginRef = useRef(false);

  // Biometric sign-in (Face ID / Touch ID / passcode fallback) via the shared
  // hook — availability probing and credential-backed refresh live there so
  // this screen and the Settings security flow stay in sync.
  //
  // `autoTrigger` is deliberately OFF: firing Face ID unprompted made this
  // screen unreachable after an intentional sign-out — the biometric refresh
  // completed and routed the member straight back in before they could do
  // anything else here (switch accounts, use email/password, sign out for
  // real). The button below already gives one-tap biometric login with the
  // remembered email prefilled; this only removes the invisible auto-fire.
  const {
    canBiometricLogin,
    biometricType,
    biometricLoading,
    rememberedEmail,
    handleBiometricLogin,
  } = useBiometricLogin({
    autoTrigger: false,
    skipAutoTriggerRef: skipBiometricAutoLoginRef,
    onError: setError,
  });

  // Prefill last-used email for "remember last login" (non-secret SecureStore).
  useEffect(() => {
    if (rememberedEmail && !email) {
      setEmail(rememberedEmail);
    }
  }, [rememberedEmail, email]);

  // Check Apple Sign In availability
  useEffect(() => {
    const checkAppleAuth = async () => {
      const available = await AppleAuthentication.isAvailableAsync();
      setAppleAuthAvailable(available);
    };
    checkAppleAuth();
  }, []);

  const handleLoginSuccess = useCallback(
    (user: Parameters<typeof login>[0], accessToken: string, refreshToken: string) => {
      login(user, accessToken, refreshToken);

      // If we have a redirect after login (e.g., from invitation flow)
      if (redirectTo === 'AcceptInvite' && inviteToken) {
        // Navigate to AcceptInvite screen with the token
        // Use a small delay to ensure auth state is updated
        setTimeout(() => {
          navigation.getParent()?.navigate('AcceptInvite', { token: inviteToken });
        }, 100);
      }
      // Otherwise, normal login flow handles navigation via RootNavigator
    },
    [inviteToken, login, navigation, redirectTo]
  );

  const submitLogin = useCallback(
    async (emailValue: string, passwordValue: string, options?: { fromE2E?: boolean }) => {
      if (!emailValue.trim() || !passwordValue.trim()) {
        setError('Please enter your email and password');
        return;
      }

      if (!isValidEmail(emailValue)) {
        setError('Enter a valid email address');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = isJoinedPlatformBrand()
          ? await joinedPlatformAuth.login(emailValue.trim(), passwordValue)
          : await authApi.login({
              email: emailValue.trim(),
              password: passwordValue,
            });
        handleLoginSuccess(response.user, response.access_token, response.refresh_token);
      } catch (err: unknown) {
        const errorMessage = getApiErrorMessage(err, 'Invalid email or password');
        setError(errorMessage);
        if (!options?.fromE2E) {
          Alert.alert('Login Failed', errorMessage);
        }
      } finally {
        setLoading(false);
      }
    },
    [handleLoginSuccess]
  );

  const applyE2ELogin = useCallback(
    (credentials: E2ELoginCredentials) => {
      // Any E2E-driven login suppresses the biometric auto-prompt so the two
      // don't race for the screen.
      skipBiometricAutoLoginRef.current = true;
      setShowEmailForm(true);
      setEmail(credentials.email);
      setPassword(credentials.password);
      if (credentials.autoSubmit) {
        void submitLogin(credentials.email, credentials.password, { fromE2E: true });
      }
    },
    [submitLogin]
  );

  useEffect(() => {
    // If an E2E login is already queued when this screen mounts, suppress the
    // biometric auto-prompt before the hook's delayed trigger fires.
    if (hasPendingE2ELogin()) {
      skipBiometricAutoLoginRef.current = true;
    }
    const pendingCredentials = consumeE2ELogin();
    if (pendingCredentials) {
      applyE2ELogin(pendingCredentials);
    }
    return subscribeE2ELogin(applyE2ELogin);
  }, [applyE2ELogin]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const applyPortfolioDemo = (credentials: { email: string; password: string }) => {
      setShowEmailForm(true);
      setEmail(credentials.email);
      setPassword(credentials.password);
      setError(null);
    };
    const locationCredentials = portfolioDemoCredentialsFromLocation(
      brandId,
      window.location?.search ?? ''
    );
    if (locationCredentials) applyPortfolioDemo(locationCredentials);
    const receivePortfolioDemo = (event: PortfolioMessageEvent) => {
      const credentials = readPortfolioDemoCredentials(event, brandId, window.parent);
      if (!credentials) return;
      applyPortfolioDemo(credentials);
    };
    window.addEventListener('message', receivePortfolioDemo);
    requestPortfolioDemo(brandId);
    return () => window.removeEventListener('message', receivePortfolioDemo);
  }, []);

  const handleLogin = async () => {
    await submitLogin(email, password);
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

      handleLoginSuccess(response.user, response.access_token, response.refresh_token);
    } catch (err: unknown) {
      // Only reached by a backend token-exchange failure.
      const errorMessage = getApiErrorMessage(err, 'Apple Sign In failed. Please try again.');
      setError(errorMessage);
      Alert.alert('Sign In Failed', errorMessage);
    } finally {
      setAppleLoading(false);
    }
  };

  // Google Sign-In via expo-auth-session. The hook prepares a platform-correct
  // OAuth request (iOS/Android/Web client); promptAsync opens the consent UI and
  // the result is handled in the effect below.
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
        handleLoginSuccess(response.user, response.access_token, response.refresh_token);
      } catch (err: unknown) {
        const errorMessage = getApiErrorMessage(err, 'Google Sign In failed. Please try again.');
        setError(errorMessage);
        Alert.alert('Sign In Failed', errorMessage);
      } finally {
        setGoogleLoading(false);
      }
    },
    // handleLoginSuccess is stable for the screen's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
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
      // dismiss / cancel / locked
      setGoogleLoading(false);
    }
  }, [googleResponse, exchangeGoogleToken]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const result = await googlePromptAsync();
      // Non-success results (cancel/dismiss) won't trigger the effect's success
      // branch; reset the spinner here so the button doesn't hang.
      if (result?.type !== 'success') {
        setGoogleLoading(false);
      }
    } catch {
      setGoogleLoading(false);
      setError('Could not start Google Sign In.');
    }
  };

  const loginTheme = getBrandLoginTheme(brandId, accentScheme);

  // iPad-optimized form width
  const formMaxWidth = isTablet ? 440 : undefined;
  const containerPadding = isTablet ? 40 : 24;

  const formContent = (
    <View style={[styles.formContainer, { maxWidth: formMaxWidth }]}>
      {/* Brand lockup — the shared ring + two-tone wordmark component, flat on
          the auth backdrop (no card). Bigger ring for the hero, then the
          optional per-brand slogan and the tagline. */}
      <View style={styles.logoContainer}>
        <HeaderLogo orientation="vertical" height={isTablet ? 132 : 116} />
        {loginTheme.slogan ? (
          <View
            style={styles.kaizenTagline}
            accessible
            accessibilityLabel={loginTheme.slogan}
          >
            <GradientText
              text={loginTheme.slogan}
              colors={isDark ? loginTheme.sloganGradient.dark : loginTheme.sloganGradient.light}
              fontSize={isTablet ? 22 : 18}
              fontWeight="600"
              width={Math.min(windowWidth - 48, 320)}
              gradientId="brandSlogan"
            />
          </View>
        ) : null}
        <Typography
          variant="labelRegular"
          color={colors.textSecondary}
          style={styles.subtitle}
        >
          {loginTheme.subtitle}
        </Typography>
      </View>

      <View style={styles.form}>
        {/* Apple Sign In Button */}
        {appleAuthAvailable && Platform.OS === 'ios' && (
          <View style={styles.appleButtonContainer}>
            <SocialAuthButton
              provider="apple"
              title={appleLoading ? 'Signing in…' : 'Sign in with Apple'}
              onPress={handleAppleSignIn}
              loading={appleLoading}
              disabled={appleLoading}
              testID="auth-sign-in-apple"
            />
          </View>
        )}

        {/* Google Sign In Button (all platforms) */}
        <View style={styles.googleButtonContainer}>
          <SocialAuthButton
            provider="google"
            title={googleLoading ? 'Signing in…' : 'Sign in with Google'}
            onPress={handleGoogleSignIn}
            loading={googleLoading}
            disabled={!googleRequest || googleLoading || loading}
            testID="auth-sign-in-google"
          />
        </View>

        <View style={styles.dividerContainer}>
          <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
          <Typography variant="caption1" color={colors.textTertiary} style={styles.dividerText}>
            or
          </Typography>
          <View style={[styles.divider, { backgroundColor: colors.borderColor }]} />
        </View>

        {/* Face ID / Touch ID / passcode — outside the email form so remember-last-login
            is always one tap away after sign-out (not buried under "Sign in with Email"). */}
        {canBiometricLogin && (
          <TouchableOpacity
            style={[
              styles.biometricButton,
              { borderColor: colors.borderColor, backgroundColor: colors.card },
            ]}
            onPress={() => void handleBiometricLogin()}
            disabled={biometricLoading || loading}
            testID="auth-biometric-login"
            accessibilityLabel={`Sign in with ${biometricType}`}
          >
            <Icon
              name={
                biometricType === 'Face ID' || biometricType === 'Face Recognition'
                  ? 'scan'
                  : 'finger-print'
              }
              size={32}
              color={colors.primary}
            />
            <Typography variant="callout" color={colors.textPrimary} style={styles.biometricText}>
              {biometricLoading ? 'Authenticating...' : `Sign in with ${biometricType}`}
            </Typography>
          </TouchableOpacity>
        )}

        {!showEmailForm ? (
          <GradientButton
            title="Sign in with Email"
            onPress={() => setShowEmailForm(true)}
            fullWidth
            icon={<Icon name="mail-outline" size={20} color={colors.white} />}
            testID="auth-sign-in-email"
            style={styles.emailToggleButton}
          />
        ) : (
          <>
            <TextInput
              label="Email"
              placeholder="Enter your email"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              value={email}
              onChangeText={setEmail}
              error={emailInvalid ? 'Enter a valid email address' : undefined}
              labelColor={colors.textPrimary}
              testID="auth-email-input"
            />

            <TextInput
                ref={passwordInputRef}
                label="Password"
                placeholder="Enter your password"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                // Explicit, not implied by `secureTextEntry`: the eye toggle
                // above turns that off, and an autocorrected password is a
                // failed sign-in the member cannot see.
                autoCorrect={false}
                autoComplete="password"
                // In DEV/E2E force a Latin (ASCII) keyboard so the automated login
                // types the password correctly even when the simulator's active
                // keyboard is a non-Latin layout (e.g. Russian) — otherwise the key
                // POSITIONS map through that layout and `Andrei123!` is entered as
                // `Фтвкуш123!`. Prod keeps the user's own keyboard (undefined default)
                // so non-ASCII passwords still work. The email field is already immune
                // because keyboardType="email-address" forces a Latin layout.
                keyboardType={__DEV__ ? 'ascii-capable' : undefined}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                value={password}
                onChangeText={setPassword}
                labelColor={colors.textPrimary}
                testID="auth-password-input"
              rightIcon={
                <TouchableOpacity
                  style={styles.passwordToggle}
                  onPress={() => setShowPassword((visible) => !visible)}
                  testID="auth-password-toggle"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  accessibilityRole="button"
                >
                  <Icon
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={24}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              }
            />

            {error && (
              <Typography variant="caption1" color={colors.error} style={styles.errorText}>
                {error}
              </Typography>
            )}

            <View style={styles.loginButton}>
              <Button
                title="Sign In"
                onPress={handleLogin}
                loading={loading}
                disabled={loading || biometricLoading || emailInvalid}
                fullWidth
                testID="auth-sign-in-submit"
              />
            </View>

            <View style={styles.forgotButton}>
              <Button
                title="Forgot Password?"
                variant="ghost"
                onPress={() => navigation.navigate('ForgotPassword')}
                textColor={colors.primary}
                testID="auth-forgot-password"
              />
            </View>
          </>
        )}
      </View>

      <View style={styles.footer}>
        <Typography variant="body" color={colors.textSecondary}>
          Don't have an account?{' '}
        </Typography>
        <Button
          title="Sign Up"
          variant="ghost"
          size="sm"
          onPress={() => navigation.navigate('Register')}
          textColor={colors.primary}
          testID="auth-go-register"
        />
      </View>
    </View>
  );

  return (
    <View
      style={[styles.background, { backgroundColor: colors.backgroundMain }]}
      testID="login-screen"
    >
      <AuthWave />
      <SafeAreaView>
        {/* No `KeyboardAvoidingView`: it only SHRINKS the viewport and never
            moves the content inside it, so the field the member just tapped
            stayed put and ended up behind the keypad. `keyboardDismissScrollProps`
            carries `automaticallyAdjustKeyboardInsets`, which is the half that
            actually scrolls the focused field back into view. See `@utils/keyboard`. */}
        <ScrollView
          {...keyboardDismissScrollProps}
          style={screenScrollViewStyle.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: containerPadding },
            isTablet && styles.tabletScrollContent,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {formContent}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  tabletScrollContent: {
    alignItems: 'center',
  },
  formContainer: {
    width: '100%',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 28,
  },
  kaizenTagline: {
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 2,
  },
  subtitle: {
    marginTop: 12,
    textAlign: 'center',
    // Gentle tracking pairs the tagline with the lockup without shouting.
    letterSpacing: 0.4,
  },
  form: {
    marginBottom: 20,
  },
  passwordToggle: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginButton: {
    marginTop: 16,
  },
  forgotButton: {
    marginTop: 8,
    alignSelf: 'center',
  },
  biometricButton: {
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  biometricText: {
    marginTop: 8,
  },
  appleButtonContainer: {
    marginTop: 12,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  divider: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
  },
  googleButtonContainer: {
    marginTop: 8,
  },
  emailToggleButton: {
    marginTop: 4,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    marginTop: 8,
    textAlign: 'center',
  },

});
