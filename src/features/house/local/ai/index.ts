/**
 * The House P2 BYOK surface (plan §9, DoD H7).
 *
 * Screens and hooks import from here, never from the individual modules, so
 * there is one place to see everything that can reach a provider. In particular
 * `readKey` and the raw provider calls are NOT re-exported: the only way out of
 * this folder is a ladder result or a projected context.
 */
export {
  HOUSE_AI_EGRESS_ALLOWLIST,
  HOUSE_AI_EGRESS_FORBIDDEN_TABLES,
  isTableAllowedForEgress,
  projectAllowedRows,
  redactContext,
  redactForEgress,
  type HouseAiContextRow,
} from './egressAllowlist';

export {
  buildHouseAiContext,
  getHouseAiUnavailableCopy,
  houseAiUnavailable,
  runHouseAiLadder,
  HouseAiUnavailableError,
  type HouseAiContext,
  type HouseAiLadderInput,
  type HouseAiLadderResult,
  type HouseAiStage,
  type HouseAiUnavailableReason,
} from './houseAiLadder';

export {
  assertHouseAiContextIsProjected,
  assertHouseByokUrl,
  buildHouseByokUserMessage,
  generateHouseStructuredByok,
  hasHouseProviderKey,
  houseByokPort,
  resolveHouseByokProvider,
  HouseByokError,
  HOUSE_BYOK_ALLOWLIST,
  HOUSE_BYOK_PROVIDER_ORDER,
  type HouseByokPort,
  type HouseByokRequest,
} from './houseByokClient';

export {
  inferGarbageDay,
  inferGarbageDayStageA,
  normalizeInferredStreams,
  GARBAGE_INFERENCE_DAYS_AHEAD,
  type GarbageDayAnswer,
  type GarbageDayInferenceInput,
  type GarbageLedgerView,
} from './houseGarbageDayInference';

export {
  buildHomeInsights,
  buildHomeInsightsStageA,
  normalizeAssistantInsights,
  DUE_SOON_DAYS,
  END_OF_LIFE_NOTICE_DAYS,
  MAX_HOME_INSIGHTS,
  SERVICE_INTERVAL_DAYS,
  WARRANTY_NOTICE_DAYS,
  type HomeInsight,
  type HomeInsightKind,
  type HomeInsightPriority,
  type HomeInsightsInput,
  type HomeInsightsLedgerView,
} from './houseHomeInsights';
