/**
 * Does the room actually get written?
 *
 * These exist because it did not. `useHomeProjectMutation` returned a fresh
 * `invalidate` closure on every render, which propagated into `save`'s identity
 * and from there into the debounced-autosave effect's dependency list — so the
 * effect tore down and re-armed its 1.2 s timer on every render, and a screen
 * that re-rendered faster than that (a focus refetch is enough) never reached
 * the end of the debounce. Nothing errored. The work simply did not persist.
 *
 * So: creating a room writes immediately, and the debounce restarts on edits
 * rather than on renders.
 */
jest.mock('@api/home-projects', () => ({
  homeProjectsApi: {
    putManualGeometry: jest.fn(async () => ({})),
    cancelGeometry: jest.fn(async () => ({ success: true })),
  },
}));

import React from 'react';
import { act, create } from 'react-test-renderer';

import { homeProjectsApi } from '@api/home-projects';
import {
  buildShapeOutline,
  createRoomSurfaceModel,
  roomShapePreset,
  seedShapeParams,
} from '@features/house/surfaces';
// The document parser lives with the schema it validates, not in the
// `room-surface/` arithmetic barrel the app re-exports.
import { parseRoomSurfaceModel } from '@symply/contracts';

import { useRoomSurfaceModel } from '../useRoomSurfaceModel';

const putManualGeometry = homeProjectsApi.putManualGeometry as jest.Mock;
const cancelGeometry = homeProjectsApi.cancelGeometry as jest.Mock;

function newRoom() {
  const preset = roomShapePreset('rectangle');
  return createRoomSurfaceModel({
    outline: buildShapeOutline(preset, seedShapeParams(preset, 4, 3)),
    wallHeight_m: 2.4,
  });
}

function renderHook(options?: {
  geometryId?: string | null;
  onSaved?: () => void;
}) {
  let captured!: ReturnType<typeof useRoomSurfaceModel>;
  function Probe() {
    captured = useRoomSurfaceModel({
      householdId: 'hh1',
      projectId: 'p1',
      payloadJson: null,
      geometryId: options?.geometryId === undefined ? 'g1' : options.geometryId,
      onSaved: options?.onSaved,
    });
    return null;
  }
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<Probe />);
  });
  return {
    get current() {
      return captured;
    },
    /** Force a re-render without changing anything — what a refetch does. */
    rerender: () => act(() => renderer.update(<Probe />)),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('creating a room', () => {
  it('writes it immediately rather than waiting for the debounce', async () => {
    const hook = renderHook();
    expect(hook.current.model).toBeNull();

    await act(async () => {
      hook.current.start(newRoom());
    });

    expect(putManualGeometry).toHaveBeenCalledTimes(1);
    expect(putManualGeometry.mock.calls[0][0]).toBe('hh1');
    expect(putManualGeometry.mock.calls[0][1]).toBe('p1');
  });

  it('writes a document a reader can parse back', async () => {
    const hook = renderHook();
    await act(async () => {
      hook.current.start(newRoom());
    });

    const parsed = parseRoomSurfaceModel(putManualGeometry.mock.calls[0][2]);
    expect(parsed).not.toBeNull();
    expect(parsed?.schema_version).toBe(2);
    expect(parsed?.surfaces.filter(s => s.kind === 'wall')).toHaveLength(4);
    // The v1 mirror two live readers still depend on.
    expect(parsed?.floor?.area_m2).toBeCloseTo(12, 3);
  });

  it('reports itself clean once the write lands', async () => {
    const hook = renderHook();
    await act(async () => {
      hook.current.start(newRoom());
    });
    expect(hook.current.dirty).toBe(false);
  });

  it('tells the caller to refresh', async () => {
    const onSaved = jest.fn();
    const hook = renderHook({ onSaved });
    await act(async () => {
      hook.current.start(newRoom());
    });
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('the debounce', () => {
  /**
   * The regression. A re-render must not restart the timer, or a screen that
   * re-renders often enough never writes at all.
   */
  it('still fires when the hook re-renders throughout the wait', async () => {
    const hook = renderHook();
    await act(async () => {
      hook.current.start(newRoom());
    });
    putManualGeometry.mockClear();

    act(() => {
      hook.current.update(current => ({
        ...current,
        room: { ...current.room, wallHeight_m: 3 },
      }));
    });

    // Re-render repeatedly across the whole debounce window, as a focus
    // refetch would.
    for (let tick = 0; tick < 6; tick += 1) {
      hook.rerender();
      act(() => {
        jest.advanceTimersByTime(300);
      });
    }
    await act(async () => {});

    expect(putManualGeometry).toHaveBeenCalled();
  });

  it('does not write while nothing has been edited', async () => {
    const hook = renderHook();
    await act(async () => {
      hook.current.start(newRoom());
    });
    putManualGeometry.mockClear();

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    await act(async () => {});

    expect(putManualGeometry).not.toHaveBeenCalled();
  });
});

describe('deleting the room', () => {
  it('removes the stored layout and goes back to no room', async () => {
    const hook = renderHook();
    await act(async () => {
      hook.current.start(newRoom());
    });

    await act(async () => {
      await hook.current.clear();
    });

    expect(cancelGeometry).toHaveBeenCalledWith('hh1', 'p1', 'g1');
    expect(hook.current.model).toBeNull();
    expect(hook.current.dirty).toBe(false);
  });

  /**
   * A layout that was never stored has no row to delete, so the member should
   * still get back to the shape picker rather than an error.
   */
  it('resets locally when there is no stored row', async () => {
    const hook = renderHook({ geometryId: null });
    await act(async () => {
      hook.current.start(newRoom());
    });
    await act(async () => {
      await hook.current.clear();
    });
    expect(cancelGeometry).not.toHaveBeenCalled();
    expect(hook.current.model).toBeNull();
  });
});
