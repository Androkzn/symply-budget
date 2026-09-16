import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { Keyboard } from 'react-native';

type DismissCallback = () => void;

interface TapOutsideContextValue {
  register: (cb: DismissCallback) => () => void;
  dismissAll: () => void;
}

const TapOutsideContext = createContext<TapOutsideContextValue>({
  register: () => () => {},
  dismissAll: () => {},
});

export function TapOutsideProvider({ children }: { children: React.ReactNode }) {
  const callbacksRef = useRef<Set<DismissCallback>>(new Set());

  const register = useCallback((cb: DismissCallback) => {
    callbacksRef.current.add(cb);
    return () => {
      callbacksRef.current.delete(cb);
    };
  }, []);

  const dismissAll = useCallback(() => {
    Keyboard.dismiss();
    callbacksRef.current.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        console.warn('[TapOutside] dismiss callback threw:', err);
      }
    });
  }, []);

  const value = useMemo(() => ({ register, dismissAll }), [register, dismissAll]);

  return <TapOutsideContext.Provider value={value}>{children}</TapOutsideContext.Provider>;
}

export function useTapOutsideContext() {
  return useContext(TapOutsideContext);
}
