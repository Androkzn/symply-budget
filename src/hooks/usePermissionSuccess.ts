import { useEffect, useRef, useState } from 'react';

import type { PermissionState } from '@utils/permissionState';

/** Brief confirmation only for a new grant, never on an already-authorized launch. */
export function usePermissionSuccess(state: PermissionState, durationMs = 3000): boolean {
  const previous = useRef(state);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const newlyGranted = state === 'granted' &&
      (previous.current === 'not-requested' || previous.current === 'denied');
    previous.current = state;
    if (!newlyGranted) {
      if (state !== 'granted') setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(timer);
  }, [state, durationMs]);

  return visible;
}
