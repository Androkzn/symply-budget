/**
 * Per-brand onboarding + legal CONTENT.
 *
 * The onboarding welcome UI (src/components/onboarding/OnboardingWelcome) and
 * the legal screens (Terms/Privacy, in settings and in the onboarding sheets)
 * are SHARED across every brand — only the content here differs. Add a brand by
 * adding an entry; the getters fall back to House so nothing renders empty.
 *
 * The app's display name is NOT baked in here — it comes from `ENV.APP_NAME`
 * (the active brand's display name) at render time, so legal `serviceDescription`
 * strings are written in predicate form ("is a ... application that ...") and the
 * builder prepends the name.
 */
import type { OnboardingWelcomeContent } from '@components/onboarding/OnboardingWelcome';

export const HOUSE_BRAND_ID = 'symply-house';

// ---------------------------------------------------------------------------
// Onboarding welcome content (subtitle + value-prop cards)
// ---------------------------------------------------------------------------

const WELCOME_CONTENT: Record<string, OnboardingWelcomeContent> = {
  'symply-house': {
    subtitle: 'Transform your home inspection reports into actionable insights and maintenance plans',
    features: [
      { brandIcons: ['reports', 'import'], fallbackIcon: 'document-text', title: 'Upload Reports', description: 'Upload your inspection PDF' },
      { brandIcons: ['insights', 'search'], fallbackIcon: 'search', title: 'Get Insights', description: 'AI-powered analysis' },
      { brandIcons: ['tasks', 'complete'], fallbackIcon: 'checkmark-circle', title: 'Track Tasks', description: 'Manage maintenance' },
    ],
  },
  'symply-kaizen': {
    subtitle: 'Small, daily improvements that compound into lasting change. Build systems for the parts of life that matter to you.',
    features: [
      { brandIcons: ['systems', 'today'], fallbackIcon: 'grid', title: 'Build Systems', description: 'Organize the areas of life that matter' },
      { brandIcons: ['tasks', 'complete'], fallbackIcon: 'checkmark-circle', title: 'Track Habits', description: 'Small steps, repeated every day' },
      { brandIcons: ['ai-coach', 'insights'], fallbackIcon: 'sparkles', title: 'Grow With Your Coach', description: 'AI guidance tailored to your goals' },
    ],
  },
  'symply-budget': {
    subtitle: 'Take control of your money. Track spending, plan budgets, and reach your goals — on your own or with your household.',
    features: [
      { brandIcons: ['budget', 'spendings'], fallbackIcon: 'wallet', title: 'Track Spending', description: 'See where your money goes' },
      { brandIcons: ['categories', 'planned'], fallbackIcon: 'pie-chart', title: 'Plan Budgets', description: 'Set limits and stay on track' },
      { brandIcons: ['members'], fallbackIcon: 'people', title: 'Share With Household', description: 'Budget together, transparently' },
    ],
  },
  'symply-health': {
    subtitle: 'Build healthy habits. Log your metrics, spot trends, and stay on top of your wellness goals.',
    features: [
      { brandIcons: ['log-entry', 'today-summary'], fallbackIcon: 'fitness', title: 'Log Your Metrics', description: 'Track weight and daily habits' },
      { brandIcons: ['insights', 'trends'], fallbackIcon: 'trending-up', title: 'See Trends', description: 'Understand your progress over time' },
      { brandIcons: ['goals', 'complete'], fallbackIcon: 'heart', title: 'Stay Motivated', description: 'Keep momentum toward your goals' },
    ],
  },
  'symply-language': {
    subtitle: 'Learn a new language with a personal tutor and a plan that fits you.',
    features: [
      { brandIcons: ['learn', 'book'], fallbackIcon: 'book', title: 'Learn Your Way', description: 'Lessons matched to your level' },
      { brandIcons: ['practice', 'chat'], fallbackIcon: 'chatbubbles', title: 'Practice Speaking', description: 'Real conversations with your tutor' },
      { brandIcons: ['progress', 'complete'], fallbackIcon: 'trending-up', title: 'Track Progress', description: 'Watch your fluency grow' },
    ],
  },
};

export function getWelcomeContent(brandId: string): OnboardingWelcomeContent {
  return WELCOME_CONTENT[brandId] ?? WELCOME_CONTENT[HOUSE_BRAND_ID];
}

// ---------------------------------------------------------------------------
// Legal content (per-brand bits; shared boilerplate lives in the builders)
// ---------------------------------------------------------------------------

export interface BrandLegalContent {
  /**
   * Predicate-form service description — the builder renders it as
   * `${APP_NAME} ${serviceDescription}`. E.g. "is a personal finance app that…".
   */
  serviceDescription: string;
  /** Brand-specific items appended to the "information we collect" list. */
  dataItems: string[];
}

const LEGAL_CONTENT: Record<string, BrandLegalContent> = {
  'symply-house': {
    serviceDescription:
      'is a home maintenance management application that helps you organize, track, and manage home inspection reports and maintenance tasks. The App uses AI technology to analyze uploaded documents and provide insights.',
    dataItems: [
      'Home and property details you enter',
      'Documents you upload (inspection reports, etc.)',
    ],
  },
  'symply-kaizen': {
    serviceDescription:
      'is a personal-development application that helps you build systems and habits across the areas of life that matter to you. The App uses AI technology to provide personalized guidance.',
    dataItems: [
      'Goals, habits, and life systems you set up',
      'Progress and completion data',
    ],
  },
  'symply-budget': {
    serviceDescription:
      'is a personal finance application that helps you track spending, plan budgets, and manage shared household finances. The App uses AI technology to provide personalized insights.',
    dataItems: [
      'Budgets, transactions, and categories you enter',
      'Household and shared-finance details',
    ],
  },
  'symply-health': {
    serviceDescription:
      'is a health and wellness application that helps you log and track personal health metrics such as weight and daily habits.',
    dataItems: [
      'Health metrics you log (such as weight and habits)',
      'Goals and preferences you set',
    ],
  },
  'symply-language': {
    serviceDescription:
      'is a language-learning application that helps you learn and practice a new language with a personal tutor.',
    dataItems: [
      'Your learner profile and language preferences',
      'Practice activity and learning progress',
    ],
  },
};

export function getLegalContent(brandId: string): BrandLegalContent {
  return LEGAL_CONTENT[brandId] ?? LEGAL_CONTENT[HOUSE_BRAND_ID];
}

// ---------------------------------------------------------------------------
// Notification-permission benefit copy (essential-permissions onboarding step)
// ---------------------------------------------------------------------------

const NOTIFICATION_BENEFIT: Record<string, string> = {
  'symply-house': 'Get reminded before maintenance tasks are due, when a report finishes processing, and when your household needs you.',
  'symply-kaizen': 'Get a gentle nudge to keep your habits and daily systems on track.',
  'symply-budget': 'Get alerted to upcoming bills, budget limits, and shared household spending.',
  'symply-health': 'Get reminded to log your metrics and stay on top of your goals.',
  'symply-language': 'Get a nudge to practice, so what you learn actually sticks.',
};

export function getNotificationBenefit(brandId: string): string {
  return NOTIFICATION_BENEFIT[brandId] ?? NOTIFICATION_BENEFIT[HOUSE_BRAND_ID];
}

/**
 * Legal entity + contact. Shared across brands (one company operates the Symply
 * family). TODO(legal): confirm the real registered entity name — "Symply" is a
 * working placeholder for the product family.
 */
export const LEGAL_ENTITY = 'Symply';
export const LEGAL_CONTACT_DOMAIN = 'symply.app';
