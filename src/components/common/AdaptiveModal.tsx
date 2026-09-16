/**
 * AdaptiveModal — picks the iOS/iPadOS-correct presentation style per device.
 *
 * - iPhone & compact iPad windows: `pageSheet` (full-width sheet from bottom).
 * - iPad regular widths (>= 768pt): `formSheet` (centered, ~540pt-wide sheet
 *   that respects the parent window — matches Apple's iPadOS 26 modal HIG).
 *
 * Drop-in replacement for RN's `<Modal>` for the common "ScreenForm" case.
 */
import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Modal, ModalProps, Platform } from 'react-native';

import { useDeviceType } from '@hooks/useDeviceType';

interface AdaptiveModalProps extends Omit<ModalProps, 'presentationStyle' | 'animationType'> {
  visible: boolean;
  onClose: () => void;
  /**
   * Override the presentation style (escape hatch). When omitted, the
   * component picks `formSheet` on iPad regular widths and `pageSheet`
   * elsewhere.
   */
  presentationStyle?: ModalProps['presentationStyle'];
  /** Defaults to 'slide' on phone, 'fade' on iPad form-sheet. */
  animationType?: ModalProps['animationType'];
  /**
   * By default only one AdaptiveModal is presented at a time. This follows
   * Apple's recommendation to avoid stacking multiple centered sheets.
   */
  allowStacking?: boolean;
  children: React.ReactNode;
}

type ModalStackStore = {
  stack: string[];
  listeners: Set<() => void>;
};

const modalStackStore: ModalStackStore = {
  stack: [],
  listeners: new Set(),
};

function emitModalStackChange() {
  modalStackStore.listeners.forEach(listener => listener());
}

function pushModalToTop(id: string) {
  modalStackStore.stack = modalStackStore.stack.filter(item => item !== id);
  modalStackStore.stack.push(id);
  emitModalStackChange();
}

function removeModalFromStack(id: string) {
  const nextStack = modalStackStore.stack.filter(item => item !== id);
  if (nextStack.length === modalStackStore.stack.length) {
    return;
  }

  modalStackStore.stack = nextStack;
  emitModalStackChange();
}

function subscribeModalStack(listener: () => void) {
  modalStackStore.listeners.add(listener);
  return () => {
    modalStackStore.listeners.delete(listener);
  };
}

function getModalStackSnapshot() {
  return modalStackStore.stack;
}

export function AdaptiveModal({
  visible,
  onClose,
  presentationStyle,
  animationType,
  allowStacking = false,
  children,
  ...rest
}: AdaptiveModalProps) {
  const { isIPad, width } = useDeviceType();
  const idRef = useRef<string>(`adaptive-modal-${Math.random().toString(36).slice(2)}`);
  const modalStack = useSyncExternalStore(subscribeModalStack, getModalStackSnapshot, getModalStackSnapshot);

  useEffect(() => {
    if (!visible || allowStacking) {
      removeModalFromStack(idRef.current);
      return;
    }

    pushModalToTop(idRef.current);
    return () => {
      removeModalFromStack(idRef.current);
    };
  }, [allowStacking, visible]);

  useEffect(() => {
    return () => {
      removeModalFromStack(idRef.current);
    };
  }, []);

  // Use centered form sheets on regular-width iPad windows (including portrait)
  // and keep page sheets for phone/compact windows.
  const useFormSheet = Platform.OS === 'ios' && isIPad && width >= 768;
  const resolvedPresentation =
    presentationStyle ?? (useFormSheet ? 'formSheet' : 'pageSheet');
  const resolvedAnimation = animationType ?? (useFormSheet ? 'fade' : 'slide');
  const shouldRender = visible && (allowStacking || modalStack[modalStack.length - 1] === idRef.current);

  if (!shouldRender) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType={resolvedAnimation}
      presentationStyle={resolvedPresentation}
      onRequestClose={onClose}
      {...rest}
    >
      {children}
    </Modal>
  );
}
