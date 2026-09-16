import { kaizenSeedId } from '../seedId';

import { getFakeDb, resetFakeDb } from './helpers/fakeSqlite';

const mockMeta = new Map<string, string>();

jest.mock('../database', () => ({
  getKaizenDatabase: async () => require('./helpers/fakeSqlite').getFakeDb(),
  getMeta: async (key: string) => (mockMeta.has(key) ? mockMeta.get(key) : null),
  setMeta: async (key: string, value: string) => {
    mockMeta.set(key, value);
  },
}));

import { purgeLegacyDemoSeed } from '../purgeDemoSeed';

const userId = 'user-123';
const ts = { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null };

function seedLegacyRows() {
  const db = getFakeDb();
  db.seed('kaizen_weekly_rotations', [
    { id: kaizenSeedId('rotation.4'), user_id: userId, focus_title: 'AWS', ...ts },
  ]);
  db.seed('kaizen_skill_nodes', [
    { id: kaizenSeedId('skill.AWS'), user_id: userId, name: 'AWS', ...ts },
    { id: kaizenSeedId('skill.React'), user_id: userId, name: 'React', ...ts },
    // A skill the user created themselves — must survive.
    { id: 'user-made-skill', user_id: userId, name: 'Woodworking', ...ts },
  ]);
  db.seed('kaizen_interview_questions', [
    { id: kaizenSeedId('q.aws.1'), user_id: userId, prompt: '...', ...ts },
  ]);
  db.seed('kaizen_actions', [
    { id: kaizenSeedId('action.weight'), user_id: userId, title: 'Weight', ...ts },
  ]);
}

describe('purgeLegacyDemoSeed', () => {
  beforeEach(() => {
    resetFakeDb();
    mockMeta.clear();
  });

  it('soft-deletes only the legacy demo seed rows and marks them dirty', async () => {
    seedLegacyRows();

    const purged = await purgeLegacyDemoSeed(userId);
    expect(purged).toBe(5); // rotation.4 + skill.AWS + skill.React + q.aws.1 + action.weight

    const db = getFakeDb();
    const rotation = db.rows('kaizen_weekly_rotations')[0];
    expect(rotation.deleted_at).not.toBeNull();
    expect(rotation.dirty).toBe(1);

    const skills = db.rows('kaizen_skill_nodes');
    const aws = skills.find(r => r.id === kaizenSeedId('skill.AWS'));
    const userSkill = skills.find(r => r.id === 'user-made-skill');
    expect(aws?.deleted_at).not.toBeNull();
    expect(userSkill?.deleted_at).toBeNull(); // user content untouched
  });

  it('is idempotent — a second run is a no-op guarded by the meta flag', async () => {
    seedLegacyRows();
    await purgeLegacyDemoSeed(userId);
    const second = await purgeLegacyDemoSeed(userId);
    expect(second).toBe(0);
  });
});
