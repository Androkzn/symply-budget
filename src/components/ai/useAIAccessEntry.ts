/**
 * Single source of truth for the "AI assistance" entry point that every brand's
 * Settings / More screen renders to open the shared AI-access flow.
 *
 * The AI Providers flow (`app/ai-access/*`) and subscription logic are already
 * 100% shared across House / Budget / Kaizen / Language / Health — the only
 * thing that used to diverge was HOW each brand wired the entry row (different
 * destinations, labels, icons, gates). This hook centralises all of that so the
 * entry is identical for every brand: same visibility gate, same destination,
 * same copy, same icon.
 *
 * This row is also the app's ONLY "Manage AI access" affordance: the Profile
 * subscription card used to carry a second one, which meant two entry points
 * with two destinations for one subject. Settings owns it now, so the row is
 * state-aware the way that button was — with a key connected it reads "Manage
 * AI access" and goes straight to the AI Providers screen; otherwise it reads
 * "AI assistance" and opens the hub (managed AI + BYOK). The state, not the
 * brand, picks: every app still resolves the same values from here.
 *
 * Callers render their own row primitive (each screen has its own SettingItem)
 * but MUST use these values verbatim — do not re-derive the route, gate, or copy
 * per brand. See documents/engineering/ai-provider-consent-legal.md and the
 * AI-providers alignment work.
 */

import { Ionicons } from '@expo/vector-icons';

import { providerLabel } from '@components/ai/providerMeta';
import { useAIEntitlement } from '@hooks/useAIEntitlement';

/** Ionicons glyph name — the icon type every brand's row primitive accepts. */
type IoniconName = keyof typeof Ionicons.glyphMap;

/** The canonical destination for every brand's AI entry — the hub. */
export const AI_ACCESS_ROUTE = '/ai-access' as const;

/** Where the entry goes once there is a connected key to manage. */
export const AI_MANAGE_ROUTE = '/ai-access/manage' as const;

export type AIAccessRoute = typeof AI_ACCESS_ROUTE | typeof AI_MANAGE_ROUTE;

export interface AIAccessEntry {
  /** True when the AI entry row should be shown at all (identical gate everywhere). */
  show: boolean;
  /**
   * Canonical destination: the AI Providers screen when a key is connected,
   * otherwise the AI-access hub (managed AI + BYOK). Identical logic everywhere.
   */
  route: AIAccessRoute;
  /** Canonical row title — reflects connection state, identical logic for all brands. */
  title: string;
  /** Canonical row subtitle — reflects connection state, identical logic for all brands. */
  subtitle: string;
  /** Canonical Ionicons name. */
  icon: IoniconName;
}

/**
 * Resolve the shared AI-access entry (visibility gate + destination + copy).
 * Every brand's settings surface consumes this so the entry is byte-identical.
 */
export function useAIAccessEntry(): AIAccessEntry {
  const {
    aiFeaturesEnabled,
    bringYourOwnAIEnabled,
    subscriptionsEnabled,
    source,
    provider,
    byokConnections,
  } = useAIEntitlement();

  const show = Boolean(aiFeaturesEnabled && (bringYourOwnAIEnabled || subscriptionsEnabled));

  const connectionCount = byokConnections?.length ?? 0;
  // A connected key is something to manage, so the row becomes the manage entry
  // — same three-state reading the Profile card used to do, in one place now.
  const hasConnections = connectionCount > 0;
  const subtitle =
    source === 'byok' && provider
      ? `${providerLabel(provider)} active`
      : hasConnections
        ? 'Manage connected AI keys'
        : 'Connect OpenAI, Claude, or Gemini';

  return {
    show,
    route: hasConnections ? AI_MANAGE_ROUTE : AI_ACCESS_ROUTE,
    title: hasConnections ? 'Manage AI access' : 'AI assistance',
    subtitle,
    icon: 'sparkles-outline' as IoniconName,
  };
}
