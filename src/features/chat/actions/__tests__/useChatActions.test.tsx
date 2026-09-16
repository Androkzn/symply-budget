/**
 * Who runs the assistant's writes, and how many times.
 *
 * Everything else about this feature degrades gracefully. This does not: a
 * duplicate apply silently adds a second $1,068 material to a household's
 * project, with no error, no notification, and nothing on screen distinguishing
 * it from a member having added it twice on purpose. There are three ways in:
 *
 *  1. **Every member's device gets the AI message.** Only the one whose message
 *     caused it may act on it — `metadata.actor_user_id`.
 *  2. **The same device sees the same message repeatedly** — a socket
 *     reconnect, a re-render, a scroll back. Applied ids are remembered.
 *  3. **A cold start replays the whole history.** The applied ledger is read
 *     from storage BEFORE the auto-apply pass may fire; if it were not, every
 *     action a room ever carried would run again on launch.
 *
 * The fourth case is the inverse and just as bad: a `confirm: true` action must
 * NOT run until a tap, or "remove the oak flooring" deletes it while the member
 * is still reading the sentence.
 */
jest.mock('@api/home-projects', () => ({
  homeProjectKeys: {
    all: (h: string) => ['home-projects', h],
    hub: (p: string) => ['home-project', p],
    activity: (p: string) => ['home-project-activity', p],
  },
  homeProjectsApi: {},
}));

jest.mock('../homeProjectActionRunner', () => ({
  runChatActions: jest.fn(async (_h: string, actions: Array<{ id: string }>) =>
    actions.map((a) => ({ id: a.id, ok: true }))
  ),
}));

const mockStore = new Map<string, string>();
jest.mock('../../../../services/storage', () => ({
  storageHelpers: {
    getString: jest.fn(async (k: string) => mockStore.get(k)),
    setString: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
  },
}));

jest.mock('@tanstack/react-query', () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

import React from 'react';
import { act, create } from 'react-test-renderer';

import { runChatActions } from '../homeProjectActionRunner';
import { useChatActions } from '../useChatActions';

const runMock = runChatActions as jest.Mock;

const ROOM = 'room_1';
const HID = 'hh_1';
const ME = 'user_me';
const THEM = 'user_them';

function aiMessage(
  id: string,
  actor: string,
  actions: Array<Record<string, unknown>>
) {
  return {
    id,
    sender_type: 'ai',
    metadata: { actor_user_id: actor, actions },
  };
}

const addOak = {
  id: 'a1',
  kind: 'add_material',
  project_id: 'proj_1',
  args: { name: 'Oak' },
  summary: 'Add Oak',
  confirm: false,
};

const removeOak = { ...addOak, id: 'a2', kind: 'remove_material', summary: 'Remove Oak', confirm: true };

type Messages = Array<ReturnType<typeof aiMessage>>;

async function renderHook(messages: Messages, userId: string = ME) {
  let captured!: ReturnType<typeof useChatActions>;
  function Probe({ msgs }: { msgs: Messages }) {
    captured = useChatActions(ROOM, HID, userId, msgs);
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<Probe msgs={messages} />);
  });
  return {
    get current() {
      return captured;
    },
    rerender: async (next: Messages = messages) => {
      await act(async () => renderer.update(<Probe msgs={next} />));
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
});

describe('auto-apply', () => {
  it('runs an additive action on the asking member’s device', async () => {
    await renderHook([aiMessage('m1', ME, [addOak])]);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(HID, [expect.objectContaining({ kind: 'add_material' })]);
  });

  it('does NOT run it on any other member’s device', async () => {
    await renderHook([aiMessage('m1', THEM, [addOak])]);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('runs once across re-renders — a reconnect must not re-add the material', async () => {
    const hook = await renderHook([aiMessage('m1', ME, [addOak])]);
    await hook.rerender();
    await hook.rerender();
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it('does not run again after a cold start replays the history', async () => {
    const messages = [aiMessage('m1', ME, [addOak])];
    const first = await renderHook(messages);
    expect(runMock).toHaveBeenCalledTimes(1);
    first.unmount();

    // A fresh mount with the same history, reading the ledger back from storage.
    runMock.mockClear();
    await renderHook(messages);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('waits for a tap on anything the server marked confirm', async () => {
    const hook = await renderHook([aiMessage('m1', ME, [removeOak])]);
    expect(runMock).not.toHaveBeenCalled();
    expect(hook.current.byMessage.m1.states.a2.status).toBe('pending');

    await act(async () => hook.current.confirm('m1'));
    expect(runMock).toHaveBeenCalledWith(HID, [expect.objectContaining({ kind: 'remove_material' })]);
  });

  it('applies the additive half of a mixed reply and holds the rest', async () => {
    await renderHook([aiMessage('m1', ME, [addOak, removeOak])]);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0][1]).toHaveLength(1);
    expect(runMock.mock.calls[0][1][0].kind).toBe('add_material');
  });
});

describe('declining', () => {
  it('runs nothing and does not come back on the next render', async () => {
    const hook = await renderHook([aiMessage('m1', ME, [removeOak])]);
    await act(async () => hook.current.decline('m1'));

    expect(runMock).not.toHaveBeenCalled();
    expect(hook.current.byMessage.m1.states.a2.status).toBe('declined');

    await hook.rerender();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('what each member sees', () => {
  it('reports failures on the device that ran them', async () => {
    runMock.mockResolvedValueOnce([{ id: 'a1', ok: false, error: 'That didn’t save.' }]);
    const hook = await renderHook([aiMessage('m1', ME, [addOak])]);
    expect(hook.current.byMessage.m1.states.a1).toMatchObject({
      status: 'failed',
      error: 'That didn’t save.',
    });
  });

  it('shows a bystander the change without claiming a verdict on it', async () => {
    const hook = await renderHook([aiMessage('m1', THEM, [addOak])]);
    const entry = hook.current.byMessage.m1;
    expect(entry.isActor).toBe(false);
    expect(entry.actions).toHaveLength(1);
  });

  it('is empty for an ordinary reply', async () => {
    const hook = await renderHook([
      { id: 'm1', sender_type: 'ai', metadata: { model: 'x' } } as never,
    ]);
    expect(hook.current.byMessage).toEqual({});
  });
});
