/**
 * Aihousekeeper conservative mode — plan §B13.
 *
 * Greenfield: no auto-flip circuit breaker. Operator toggles
 * `aihousekeeper_conservative_mode=true` manually if needed.
 * OutboundDispatcher.canSend() consults this to bump the severity bar to 5
 * (see §B4 check 3).
 */

import type { Env } from '../../types';

export class ConservativeMode {
  async isActive(env: Env): Promise<boolean> {
    const value = await env.CONFIG_KV.get('aihousekeeper_conservative_mode');
    return value === 'true';
  }
}
