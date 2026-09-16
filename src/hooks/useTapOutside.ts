import { useEffect } from 'react';

import { useTapOutsideContext } from '@contexts/TapOutsideContext';

/**
 * Register a callback that fires when the user taps outside any touchable
 * element (empty space, background, non-interactive content).
 *
 * Keyboard.dismiss() is already handled globally by TapOutsideWrapper — use
 * this hook to close pickers, dropdowns, popovers, or any transient UI that
 * should dismiss on an outside tap.
 *
 * @param onDismiss callback fired on outside tap
 * @param active    only register while true (e.g. while the picker is open)
 */
export function useTapOutside(onDismiss: () => void, active: boolean = true) {
  const { register } = useTapOutsideContext();

  useEffect(() => {
    if (!active) return;
    return register(onDismiss);
  }, [active, onDismiss, register]);
}
