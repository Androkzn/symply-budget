/**
 * Locks the standard editing-screen contract: Save stays disabled until the
 * form diverges from its saved baseline, and a successful save fires a success
 * toast then closes the view. These three rules are wired into every edit
 * screen, so regressions here ripple app-wide.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

import { deepEqual, useUnsavedChanges } from '../useUnsavedChanges';

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

function renderHook<T>(props: Parameters<typeof useUnsavedChanges<T>>[0]) {
  const captured: { current: ReturnType<typeof useUnsavedChanges> } = { current: null as never };
  function Probe() {
    captured.current = useUnsavedChanges(props);
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return captured;
}

describe('deepEqual', () => {
  it('treats structurally equal JSON-ish values as equal', () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(deepEqual(new Date('2026-01-01'), new Date('2026-01-01'))).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});

describe('useUnsavedChanges', () => {
  beforeEach(() => mockShowToast.mockClear());

  it('is not dirty when values match baseline', () => {
    const hook = renderHook({
      values: { name: 'Roof' },
      baseline: { name: 'Roof' },
      onSave: jest.fn(),
      onClose: jest.fn(),
    });
    expect(hook.current.isDirty).toBe(false);
  });

  it('is dirty when values diverge from baseline', () => {
    const hook = renderHook({
      values: { name: 'Roof repair' },
      baseline: { name: 'Roof' },
      onSave: jest.fn(),
      onClose: jest.fn(),
    });
    expect(hook.current.isDirty).toBe(true);
  });

  it('no-ops save when nothing changed', async () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const hook = renderHook({ values: { a: 1 }, baseline: { a: 1 }, onSave, onClose });
    await act(async () => {
      await hook.current.save();
    });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('on a successful save shows a success toast then closes', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const hook = renderHook({
      values: { a: 2 },
      baseline: { a: 1 },
      onSave,
      onClose,
      successMessage: 'Saved!',
    });
    await act(async () => {
      await hook.current.save();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('success', 'Saved!');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast and keeps the view open when save throws', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('boom'));
    const onClose = jest.fn();
    const hook = renderHook({
      values: { a: 2 },
      baseline: { a: 1 },
      onSave,
      onClose,
      errorMessage: 'Nope',
    });
    await act(async () => {
      await hook.current.save();
    });
    expect(mockShowToast).toHaveBeenCalledWith('error', 'Nope');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('aborts quietly (no toast, no close) when onSave returns false', async () => {
    const onSave = jest.fn().mockResolvedValue(false);
    const onClose = jest.fn();
    const hook = renderHook({ values: { a: 2 }, baseline: { a: 1 }, onSave, onClose });
    await act(async () => {
      await hook.current.save();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
