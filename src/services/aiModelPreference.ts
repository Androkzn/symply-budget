/**
 * Per-provider model choice, cached ON DEVICE.
 *
 * The durable record lives server-side (`/ai-preferences`.`selected_model_id`),
 * but the local-first BYOK ladders run with no network and cannot read it — they
 * were falling back to a hardcoded DEFAULT_MODEL, so the member's pick in
 * Settings → AI Providers was silently ignored and every local scan ran on a
 * different model than the UI advertised.
 *
 * Scoped brand + env exactly like `aiKeyVault`, so a staging pick cannot leak
 * into a production build (or House's choice into Budget's).
 */
import type { AIProviderId } from '@api/aiAccess';
import { brand } from '@brand';
import { ENV } from '@config/env';
import { storageHelpers } from '@services/storage';

function envSegment(): string {
  return ENV.IS_PRODUCTION ? 'production' : 'staging';
}

function keyFor(provider: AIProviderId): string {
  return `${brand.id}.${envSegment()}.ai.model.${provider}`;
}

function activeProviderKey(): string {
  return `${brand.id}.${envSegment()}.ai.active-provider`;
}

const PROVIDER_IDS: readonly AIProviderId[] = ['anthropic', 'openai', 'gemini'];

/**
 * Remember which provider the member made their default.
 *
 * Same problem as the model: the offline ladders resolved a provider by walking
 * a hardcoded anthropic→openai→gemini order, so a member with two keys who
 * chose Gemini still had every local scan billed to Anthropic.
 */
export async function setPreferredProvider(provider: AIProviderId | null): Promise<void> {
  try {
    await storageHelpers.setString(activeProviderKey(), provider ?? '');
  } catch {
    // Falls back to the hardcoded order — degraded, not broken.
  }
}

export async function getPreferredProvider(): Promise<AIProviderId | null> {
  try {
    const stored = (await storageHelpers.getString(activeProviderKey()))?.trim();
    return stored && PROVIDER_IDS.includes(stored as AIProviderId)
      ? (stored as AIProviderId)
      : null;
  } catch {
    return null;
  }
}

/** Remember the member's model pick. `null` clears it (back to the default). */
export async function setPreferredModel(
  provider: AIProviderId,
  modelId: string | null,
): Promise<void> {
  try {
    await storageHelpers.setString(keyFor(provider), modelId?.trim() ?? '');
  } catch {
    // A cache miss only costs a fallback to the default model — never break the
    // model picker over it.
  }
}

/** The member's model pick, or null when they have not chosen one. */
export async function getPreferredModel(provider: AIProviderId): Promise<string | null> {
  try {
    const stored = await storageHelpers.getString(keyFor(provider));
    return stored?.trim() ? stored.trim() : null;
  } catch {
    return null;
  }
}

export const aiModelPreference = {
  setPreferredModel,
  getPreferredModel,
  setPreferredProvider,
  getPreferredProvider,
};
