import { create } from 'zustand';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  /**
   * Makes the whole banner a tap target that takes the member where the
   * message points.
   *
   * A toast that names something only fixable on another screen ("Google Drive
   * needs to be reconnected before backups can run") is a dead end without
   * this: it names the problem, fades after six seconds, and leaves the member
   * to find the screen themselves — most of them never do, and the backups stay
   * off. Tapping dismisses the toast first, so the destination is never opened
   * underneath a banner that is still counting down.
   */
  onPress?: () => void;
  /** Visible affordance for {@link onPress} — without it the tap is invisible. */
  actionLabel?: string;
}

/** Optional extras for a toast that is more than a line of text. */
export interface ToastOptions {
  onPress?: () => void;
  actionLabel?: string;
}

interface ToastStore {
  toasts: Toast[];
  showToast: (
    message: string,
    type: Toast['type'],
    duration?: number,
    options?: ToastOptions
  ) => void;
  hideToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  showToast: (message, type, duration = 3000, options) => {
    const id = `toast-${Date.now()}`;
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id,
          message,
          type,
          duration,
          ...(options?.onPress ? { onPress: options.onPress } : {}),
          ...(options?.actionLabel ? { actionLabel: options.actionLabel } : {}),
        },
      ],
    }));

    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
  },
  hideToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

// Helper function for easy toast access outside of components
export const showToast = (
  type: Toast['type'],
  message: string,
  duration?: number,
  options?: ToastOptions
) => {
  useToastStore.getState().showToast(message, type, duration, options);
};
