/**
 * Provider metadata — the single source of truth for how each BYOK AI provider
 * is presented across the ecosystem (picker, connect guide, manage/switch hub).
 *
 * Previously this data was duplicated three ways: `PROVIDERS` in providers.tsx,
 * `PROVIDER_GUIDE` in connect.tsx, and `PROVIDER_LABELS` in manage.tsx. They
 * drifted. This module consolidates them so every AI screen renders the same
 * labels, accents, key formats, and "how to get a key" steps.
 *
 * Copy stays brand-neutral for the app name (interpolate `brand.displayName`),
 * but the AI *providers* are named explicitly — "OpenAI", "Anthropic Claude",
 * "Google Gemini" — because a user must recognise them to find the right
 * developer console.
 */

import type { AIProviderId } from '@api/aiAccess';

/** Display order across every AI surface. Claude first (the app's native model family). */
export const PROVIDER_ORDER: AIProviderId[] = ['anthropic', 'openai', 'gemini'];

/**
 * The illustrated, annotated example a step opens when its ⓘ is tapped — a mock
 * of the real console screen with the target control boxed and an accent comment
 * pointing at it. Positions live in the mock renderer; this is just the copy.
 */
export interface StepExample {
  /** Modal header — what this screen is. */
  headline: string;
  /** The accent comment callout that points at the highlighted control. */
  comment: string;
}

/**
 * Version of the per-provider data-sharing disclaimer copy below. Bump this
 * whenever the disclaimer text materially changes — connecting stores this
 * version on the credential, so a bump forces existing users to re-consent on
 * their next connect. See documents/engineering/ai-provider-consent-legal.md.
 */
export const CONSENT_VERSION = '2026-07-21';

/** An official provider policy link surfaced in the connect-time disclaimer. */
export interface LegalLink {
  label: string;
  url: string;
}

/** One visual step in the illustrated "how to get a key" diagram. */
export interface ProviderGuideStep {
  /** Which mock-console illustration to render beside the step. */
  visual: 'browser' | 'create' | 'billing' | 'copy';
  title: string;
  detail?: string;
  /** Annotated example screen opened from the step's ⓘ button. */
  example: StepExample;
}

export interface ProviderMeta {
  id: AIProviderId;
  /** Brand-neutral provider label (never a consumer product name). */
  label: string;
  /** Single-letter monogram for the provider mark. */
  monogram: string;
  /** Recognisable provider accent — legible with white text in light + dark. */
  accent: string;
  /** One-line "what is this" tagline for the picker card. */
  tagline: string;
  /** Human list of the models this provider offers. */
  models: string;
  /** Developer console host shown in the mock browser bar. */
  consoleName: string;
  /** Deep link into the provider's API-key page. */
  consoleUrl: string;
  /** Deep link into the provider's billing / plan page. */
  billingUrl: string;
  /** Deep link into the provider's usage / activity dashboard. */
  usageUrl: string;
  /** Display format of a valid key (also used as the input placeholder). */
  keyFormat: string;
  /** Prefixes a valid developer key starts with (used for a soft client hint). */
  keyPrefixes: string[];
  /** True when the provider has a no-billing free tier to start (Gemini). */
  freeTier: boolean;
  /** Cost / plan clarification — the recurring "consumer plan ≠ API" confusion. */
  cost: string;
  /** Label on this provider's real "create key" button (used in the mock). */
  createButtonLabel: string;
  /** Ordered, illustrated steps to obtain a key. */
  steps: ProviderGuideStep[];
  /**
   * Provider-specific data-sharing disclaimer shown on Connect before any data
   * is sent (Apple App Review Guideline 5.1.2(i)). Plain-language summary of how
   * THIS provider treats API data — kept soft/qualified ("states", "by default")
   * because provider terms change. The authoritative source is `legalLinks`.
   */
  dataDisclaimer: string;
  /** Official provider policy pages (Terms / Usage / Privacy) — opened in-browser. */
  legalLinks: LegalLink[];
  /**
   * Extra warning rendered as a prominent card, for providers whose FREE tier
   * treats data differently (Gemini: Google may train on and human-review free-
   * tier content). Absent → no special warning.
   */
  freeTierWarning?: string;
}

export const PROVIDER_META: Record<AIProviderId, ProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    monogram: 'A',
    accent: '#D97757',
    tagline: 'Claude — thoughtful, great for long documents',
    models: 'Fable · Opus · Sonnet · Haiku',
    consoleName: 'console.anthropic.com',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    billingUrl: 'https://console.anthropic.com/settings/billing',
    usageUrl: 'https://console.anthropic.com/settings/usage',
    keyFormat: 'sk-ant-…',
    keyPrefixes: ['sk-ant-'],
    freeTier: false,
    cost: 'Pay-as-you-go with prepaid credits. A Claude Pro / Max plan does NOT include API access.',
    createButtonLabel: 'Create Key',
    steps: [
      {
        visual: 'browser',
        title: 'Open the Anthropic Console',
        detail: 'Sign in at console.anthropic.com',
        example: {
          headline: 'Sign in to the Anthropic Console',
          comment: 'Tap “Continue” to sign in with your email or Google.',
        },
      },
      {
        visual: 'create',
        title: 'Settings → API Keys → Create Key',
        detail: 'Give it a name you’ll recognise',
        example: {
          headline: 'Settings → API Keys',
          comment: 'Tap “Create Key”, then give it a name you’ll recognise.',
        },
      },
      {
        visual: 'billing',
        title: 'Add a little credit (≈ $5)',
        detail: 'Plans & Billing — pay-as-you-go',
        example: {
          headline: 'Plans & Billing',
          comment: 'Add ~$5 of pay-as-you-go credit so the key can make calls.',
        },
      },
      {
        visual: 'copy',
        title: 'Copy the key and paste it below',
        detail: 'It’s shown only once',
        example: {
          headline: 'Your new API key',
          comment: 'Copy the sk-ant-… key now — it’s shown only once.',
        },
      },
    ],
    dataDisclaimer:
      'Your requests run under your own Anthropic account and are governed by Anthropic’s terms. Anthropic states it does not use API data to train its models by default and deletes API inputs and outputs on a short retention window. You decide what you submit.',
    legalLinks: [
      { label: 'Usage Policy', url: 'https://www.anthropic.com/legal/aup' },
      { label: 'Commercial Terms', url: 'https://www.anthropic.com/legal/commercial-terms' },
      { label: 'Privacy Policy', url: 'https://www.anthropic.com/legal/privacy' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    monogram: 'O',
    accent: '#10A37F',
    tagline: 'GPT — fast, broad general-purpose model family',
    models: 'GPT-5.6 Sol · Terra · Luna',
    consoleName: 'platform.openai.com',
    consoleUrl: 'https://platform.openai.com/api-keys',
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    usageUrl: 'https://platform.openai.com/usage',
    keyFormat: 'sk-… or sk-proj-…',
    keyPrefixes: ['sk-'],
    freeTier: false,
    cost: 'Pay-as-you-go. A ChatGPT Plus / Pro plan does NOT include API access.',
    createButtonLabel: 'Create new secret key',
    steps: [
      {
        visual: 'browser',
        title: 'Open the OpenAI platform',
        detail: 'Sign in at platform.openai.com',
        example: {
          headline: 'Sign in to the OpenAI platform',
          comment: 'Tap “Continue” to sign in with your email or Google.',
        },
      },
      {
        visual: 'create',
        title: 'API keys → Create new secret key',
        detail: 'Give it a name you’ll recognise',
        example: {
          headline: 'API keys',
          comment: 'Tap “Create new secret key”, then name it.',
        },
      },
      {
        visual: 'billing',
        title: 'Add a little credit (≈ $5)',
        detail: 'Settings → Billing',
        example: {
          headline: 'Settings → Billing',
          comment: 'Add ~$5 of credit so the key can make calls.',
        },
      },
      {
        visual: 'copy',
        title: 'Copy the key and paste it below',
        detail: 'It’s shown only once',
        example: {
          headline: 'Your new secret key',
          comment: 'Copy the sk-… key now — it’s shown only once.',
        },
      },
    ],
    dataDisclaimer:
      'Your requests run under your own OpenAI account and are governed by OpenAI’s terms. OpenAI states API data is not used to train its models by default and is retained for up to 30 days for abuse monitoring, then deleted. You decide what you submit.',
    legalLinks: [
      { label: 'How your data is used', url: 'https://developers.openai.com/api/docs/guides/your-data' },
      { label: 'Usage Policies', url: 'https://openai.com/policies/usage-policies/' },
      { label: 'Privacy Policy', url: 'https://openai.com/policies/privacy-policy/' },
    ],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    monogram: 'G',
    accent: '#4285F4',
    tagline: 'Gemini — has a free tier, quick to try',
    models: 'Gemini 3.1 Pro · 3.5 Flash',
    consoleName: 'aistudio.google.com',
    consoleUrl: 'https://aistudio.google.com/apikey',
    billingUrl: 'https://aistudio.google.com/usage',
    usageUrl: 'https://aistudio.google.com/usage',
    keyFormat: 'AQ.… or AIza…',
    keyPrefixes: ['AQ.', 'AIza'],
    freeTier: true,
    cost: 'Has a free tier — no billing needed to start. A Gemini Advanced / Google AI Pro plan does NOT include API access.',
    createButtonLabel: 'Create API key',
    steps: [
      {
        visual: 'browser',
        title: 'Open Google AI Studio',
        detail: 'Sign in at aistudio.google.com/apikey',
        example: {
          headline: 'Sign in to Google AI Studio',
          comment: 'Sign in with your Google account to continue.',
        },
      },
      {
        visual: 'create',
        title: 'Create API key → “in new project”',
        detail: 'AI Studio makes the project for you',
        example: {
          headline: 'Get API key',
          comment: 'Tap “Create API key”, then “in new project”.',
        },
      },
      {
        visual: 'billing',
        title: 'Free tier works to start',
        detail: 'No billing needed for first use',
        example: {
          headline: 'Free tier',
          comment: 'No billing needed — the free tier works to start.',
        },
      },
      {
        visual: 'copy',
        title: 'Copy the key and paste it below',
        detail: 'Keep it private',
        example: {
          headline: 'Your API key',
          comment: 'Copy the key (starts with AQ. or AIza) and keep it private.',
        },
      },
    ],
    dataDisclaimer:
      'Your requests run under your own Google account and are governed by Google’s Gemini API terms. On the paid tier, Google states your prompts and responses are not used to improve its products. You decide what you submit.',
    legalLinks: [
      { label: 'Gemini API Terms', url: 'https://ai.google.dev/gemini-api/terms' },
      { label: 'Prohibited Use', url: 'https://policies.google.com/terms/generative-ai/use-policy' },
      { label: 'Privacy Policy', url: 'https://policies.google.com/privacy' },
    ],
    freeTierWarning:
      'On Google’s free (unpaid) Gemini tier, Google may use your content to improve its products and human reviewers may read it. Google advises not submitting sensitive, confidential, or personal information on the free tier. For household, budget, or financial data, use a paid Gemini key or a different provider.',
  },
};

/** Ordered list of provider metadata for `.map()` in pickers/hubs. */
export const PROVIDERS_ORDERED: ProviderMeta[] = PROVIDER_ORDER.map((id) => PROVIDER_META[id]);

/** Safe accessor — falls back to the raw id label if an unknown provider slips through. */
export function providerLabel(provider: AIProviderId | string): string {
  return (PROVIDER_META as Record<string, ProviderMeta>)[provider]?.label ?? String(provider);
}

/** Type guard for router params etc. */
export function isAIProviderId(value: unknown): value is AIProviderId {
  return value === 'openai' || value === 'anthropic' || value === 'gemini';
}
