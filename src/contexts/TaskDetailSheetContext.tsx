import { createContext, useContext } from 'react';

/**
 * When TaskDetailScreen is shown inside the bottom sheet (e.g. from Home), this provides
 * the close callback. Keeps navigation params serializable.
 */
export const TaskDetailSheetOnBackContext = createContext<(() => void) | null>(null);

export function useTaskDetailSheetOnBack(): (() => void) | null {
  return useContext(TaskDetailSheetOnBackContext);
}
