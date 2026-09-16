import { syncKaizen } from '../../api/kaizen';
import { createKaizenDefaultSeed } from '../defaultSeed';
import { purgeLegacyDemoSeed } from '../purgeDemoSeed';
import {
  applyServerChanges,
  clearDirtyFlags,
  getDirtyChanges,
  getLastSyncAt,
  getProfile,
  setLastSyncAt,
  upsertLocal,
} from '../repository';
import { runKaizenSync } from '../sync';

jest.mock('../../api/kaizen', () => ({ syncKaizen: jest.fn() }));
jest.mock('../defaultSeed', () => ({ createKaizenDefaultSeed: jest.fn() }));
jest.mock('../purgeDemoSeed', () => ({ purgeLegacyDemoSeed: jest.fn().mockResolvedValue(0) }));
jest.mock('../repository', () => ({
  applyServerChanges: jest.fn().mockResolvedValue(undefined),
  clearDirtyFlags: jest.fn().mockResolvedValue(undefined),
  getDirtyChanges: jest.fn().mockResolvedValue({}),
  getLastSyncAt: jest.fn().mockResolvedValue(null),
  getProfile: jest.fn(),
  setLastSyncAt: jest.fn().mockResolvedValue(undefined),
  upsertLocal: jest.fn().mockResolvedValue(undefined),
}));

const mockSync = syncKaizen as jest.Mock;
const mockSeed = createKaizenDefaultSeed as jest.Mock;
const mockGetProfile = getProfile as jest.Mock;

function defaultResponse() {
  return {
    server_time: '2026-07-12T10:00:00.000Z',
    changes: { kaizen_actions: [{ id: 'srv-a1' }] },
  };
}

describe('runKaizenSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getDirtyChanges as jest.Mock).mockResolvedValue({});
    (getLastSyncAt as jest.Mock).mockResolvedValue(null);
    mockSync.mockResolvedValue(defaultResponse());
  });

  it('seeds defaults when no profile exists, then pushes and applies the round-trip', async () => {
    mockGetProfile.mockResolvedValue(null);
    mockSeed.mockReturnValue({
      profile: { id: 'p1' },
      actions: [{ id: 'a1' }, { id: 'a2' }],
      rotations: [{ id: 'r1' }],
      skills: [{ id: 's1' }],
      questions: [{ id: 'q1' }],
    });

    await runKaizenSync('u1');

    expect(mockSeed).toHaveBeenCalledWith('u1');
    expect(upsertLocal).toHaveBeenCalledWith('kaizen_profiles', { id: 'p1' }, { dirty: true });
    expect(upsertLocal).toHaveBeenCalledWith('kaizen_actions', { id: 'a1' }, { dirty: true });
    expect(upsertLocal).toHaveBeenCalledWith('kaizen_weekly_rotations', { id: 'r1' }, { dirty: true });
    expect(upsertLocal).toHaveBeenCalledWith('kaizen_skill_nodes', { id: 's1' }, { dirty: true });
    expect(upsertLocal).toHaveBeenCalledWith('kaizen_interview_questions', { id: 'q1' }, { dirty: true });
    // 1 profile + 2 actions + 1 rotation + 1 skill + 1 question
    expect(upsertLocal).toHaveBeenCalledTimes(6);

    expect(mockSync).toHaveBeenCalledWith({ last_sync_at: null, changes: {} });
    expect(applyServerChanges).toHaveBeenCalledWith(defaultResponse().changes);
    expect(clearDirtyFlags).toHaveBeenCalledWith('u1');
    expect(setLastSyncAt).toHaveBeenCalledWith('2026-07-12T10:00:00.000Z');
  });

  it('skips seeding when a profile already exists', async () => {
    mockGetProfile.mockResolvedValue({ id: 'existing' });

    await runKaizenSync('u1');

    expect(mockSeed).not.toHaveBeenCalled();
    expect(upsertLocal).not.toHaveBeenCalled();
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('purges the legacy demo seed before each sync round', async () => {
    mockGetProfile.mockResolvedValue({ id: 'existing' });

    await runKaizenSync('u1');

    expect(purgeLegacyDemoSeed).toHaveBeenCalledWith('u1');
  });

  it('forwards the stored cursor and collected dirty changes to the server', async () => {
    mockGetProfile.mockResolvedValue({ id: 'existing' });
    (getLastSyncAt as jest.Mock).mockResolvedValue('2026-07-01T00:00:00.000Z');
    (getDirtyChanges as jest.Mock).mockResolvedValue({ kaizen_actions: [{ id: 'dirty1' }] });

    await runKaizenSync('u1');

    expect(mockSync).toHaveBeenCalledWith({
      last_sync_at: '2026-07-01T00:00:00.000Z',
      changes: { kaizen_actions: [{ id: 'dirty1' }] },
    });
  });

  it('is single-flight: concurrent callers share one in-flight sync', async () => {
    mockGetProfile.mockResolvedValue({ id: 'existing' });
    let resolveSync: (value: unknown) => void = () => {};
    mockSync.mockReturnValue(new Promise(resolve => {
      resolveSync = resolve;
    }));

    const first = runKaizenSync('u1');
    // Second concurrent call must reuse the in-flight run, not start a new one.
    const second = runKaizenSync('u1');

    resolveSync(defaultResponse());
    await Promise.all([first, second]);
    expect(mockSync).toHaveBeenCalledTimes(1);

    // After settling, a fresh call runs again.
    mockSync.mockResolvedValue(defaultResponse());
    await runKaizenSync('u1');
    expect(mockSync).toHaveBeenCalledTimes(2);
  });
});
