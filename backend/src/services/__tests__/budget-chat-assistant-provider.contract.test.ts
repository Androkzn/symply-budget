/**
 * BUDGET-BCHAT-039 — assistant replies use provider 'anthropic'.
 */
import { describe, expect, it } from 'vitest';

// The BYOK assistant path now lives in the shared chat core that the Budget
// service instantiates (see chat/chat-room-service-core.ts).
import serviceSource from '../chat/chat-room-service-core.ts?raw';

describe('budget chat assistant provider contract (BUDGET-BCHAT-039)', () => {
  it('routes assistant replies through resolveProviderApiKey(..., "anthropic")', () => {
    expect(serviceSource).toContain("resolveProviderApiKey(this.env, userId, 'anthropic')");
    expect(serviceSource).toMatch(/provider:\s*'anthropic'/);
  });
});
