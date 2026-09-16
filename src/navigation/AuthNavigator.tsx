import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';

import { ThemeProvider } from '@contexts/ThemeContext';
import { ForgotPasswordScreen } from '@screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '@screens/auth/LoginScreen';
import { RegisterScreen } from '@screens/auth/RegisterScreen';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    // Login flow uses the same flat, theme-following background as the rest of
    // the app (white in light mode, dark in dark mode).
    <ThemeProvider>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      </Stack.Navigator>
    </ThemeProvider>
  );
}
