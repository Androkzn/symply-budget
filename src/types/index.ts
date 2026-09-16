// Global type definitions

/**
 * Platform role — NOT the household role (`owner`/`member`), which says nothing
 * about platform privilege. `admin` unlocks staff-only switchboards; today that
 * is Symply Health's per-feature toggle screen.
 *
 * Optional because a token minted before the role shipped, or a cached user
 * rehydrated from an older install, simply has no field — those resolve to a
 * common user (see `isAdminUser`), so the gate fails closed.
 */
export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
  avatar_url: string | null;
  has_password: boolean;
  has_apple: boolean;
  has_google: boolean;
  role?: UserRole;
  terms_accepted_at: string | null;
  has_completed_onboarding: boolean;
  onboarding_household_created: boolean;
  onboarding_report_added: boolean;
  onboarding_garbage_setup: boolean;
  onboarding_floor_plan_added: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

export type { PaginatedResponse } from '@symply/contracts';

// Navigation types
export type RootStackParamList = {
  Main: undefined;
  Auth: undefined;
  Onboarding: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Reports: undefined;
  Tasks: undefined;
  Settings: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

// Theme types
export interface ThemeColors {
  primary: string;
  primaryLight: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceSecondary: string;
  error: string;
  success: string;
  warning: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  disabled: string;
  placeholder: string;
  backdrop: string;
  notification: string;
}

// iOS 26 Pastel Colors
export interface PastelColors {
  skyBlue: string;
  teal: string;
  tealLight: string;
  tealDark: string;
  softWhite: string;
  warmGray: string;
  cloudBlue: string;
  cream: string;
  purple: string;
  green: string;
  orange: string;
}

// Task Status Badge Colors
export interface StatusColors {
  soon: string;
  soonBg: string;
  overdue: string;
  overdueBg: string;
  pastDue: string;
  pastDueBg: string;
  complete: string;
  completeBg: string;
}

// Task Category Colors
export interface CategoryColors {
  hvac: string;
  hvacBg: string;
  cleaning: string;
  cleaningBg: string;
  safety: string;
  safetyBg: string;
  plumbing: string;
  plumbingBg: string;
  electrical: string;
  electricalBg: string;
  exterior: string;
  exteriorBg: string;
  general: string;
  generalBg: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  pastel: PastelColors;
  status: StatusColors;
  category: CategoryColors;
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
  typography: {
    fontFamily: {
      regular: string;
      medium: string;
      bold: string;
    };
    fontSize: {
      xs: number;
      sm: number;
      md: number;
      lg: number;
      xl: number;
      xxl: number;
    };
  };
}
