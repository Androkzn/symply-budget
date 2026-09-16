/**
 * Symply Life (brand `symply-kaizen`) — useAvatarPicker interim stub tests.
 *
 * The hook holds no React state (it returns a fresh action object), so it is
 * exercised by calling it directly. Both actions are documented no-ops that
 * resolve to `null` (user-cancelled) until wired to the ecosystem image pipeline.
 */
import { useAvatarPicker } from '../useAvatarPicker';

describe('useAvatarPicker', () => {
  it('exposes takePhoto and pickFromLibrary actions', () => {
    const picker = useAvatarPicker();
    expect(typeof picker.takePhoto).toBe('function');
    expect(typeof picker.pickFromLibrary).toBe('function');
  });

  it('takePhoto resolves to null (interim no-op / cancel)', async () => {
    const { takePhoto } = useAvatarPicker();
    await expect(takePhoto()).resolves.toBeNull();
  });

  it('pickFromLibrary resolves to null (interim no-op / cancel)', async () => {
    const { pickFromLibrary } = useAvatarPicker();
    await expect(pickFromLibrary()).resolves.toBeNull();
  });
});
