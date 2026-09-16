import { createKaizenDefaultSeed } from '../defaultSeed';
import { kaizenSeedId } from '../seedId';

describe('createKaizenDefaultSeed', () => {
  const userId = 'user-123';

  it('seeds only an empty profile shell — no demo content', () => {
    const seed = createKaizenDefaultSeed(userId, new Date('2026-07-10T12:00:00.000Z'));

    expect(seed.profile.id).toBe(kaizenSeedId('profile'));
    expect(seed.profile.user_id).toBe(userId);
    expect(seed.profile.onboarding_complete).toBe(0);
    expect(JSON.parse(seed.profile.enabled_systems ?? '[]')).toEqual([]);
    expect(JSON.parse(seed.profile.system_activation_states ?? '{}')).toMatchObject({
      health: 'available',
      career: 'available',
    });

    // The app now starts empty; everything is built through onboarding.
    expect(seed.actions).toEqual([]);
    expect(seed.rotations).toEqual([]);
    expect(seed.skills).toEqual([]);
    expect(seed.questions).toEqual([]);
  });

  it('uses a deterministic profile id for idempotent re-seed', () => {
    const a = createKaizenDefaultSeed(userId);
    const b = createKaizenDefaultSeed(userId);
    expect(a.profile.id).toBe(b.profile.id);
  });

  it('defaults `now` to the current time when omitted', () => {
    const seed = createKaizenDefaultSeed(userId);
    expect(Number.isNaN(Date.parse(seed.profile.created_at))).toBe(false);
  });
});
