import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useToastStore } from '@services/toastManager';

import { Toast } from './Toast';

export function ToastContainer() {
  const { toasts, hideToast } = useToastStore();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="box-none">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onDismiss={() => hideToast(toast.id)}
          {...(toast.onPress ? { onPress: toast.onPress } : {})}
          {...(toast.onPress && toast.actionLabel
            ? { action: { label: toast.actionLabel, onPress: toast.onPress } }
            : {})}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Full-screen, not the zero-height strip this used to be.
   *
   * Every toast inside is absolutely positioned ~60pt down, so with no height
   * the banners rendered ENTIRELY outside their parent's bounds. iOS still
   * hit-tests there (RCTView only clips hit testing when `clipsToBounds` is
   * set, which RN leaves off), but Android clips touch dispatch to the parent
   * rect unconditionally — a tappable toast would simply not respond there.
   *
   * `box-none` keeps the sheet itself transparent to touches, and each Toast
   * turns its own `pointerEvents` off unless it actually has somewhere to go,
   * so a plain message still cannot steal a tap from the screen underneath.
   */
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
});
