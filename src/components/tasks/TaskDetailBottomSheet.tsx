import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';

import { BottomSheet, Typography } from '@components/ui';
import { TaskDetailSheetOnBackContext } from '@contexts/index';
import { TaskDetailStackHost } from '@navigation/TaskDetailStackHost';
import { Layout, useAppColors, type AppColors } from '@theme';

interface TaskDetailBottomSheetProps {
  visible: boolean;
  taskId: string | null;
  householdId?: string | null;
  onClose: () => void;
}

class SheetErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void; colors: AppColors },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError = () => ({ hasError: true });
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[TaskDetailBottomSheet] Error:', error, errorInfo);
  }

  render() {
    const { colors } = this.props;
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Typography
            variant="body"
            color={colors.textSecondary}
            style={{ marginBottom: 16, textAlign: 'center' }}
          >
            Something went wrong loading this task
          </Typography>
          <TouchableOpacity
            onPress={this.props.onClose}
            style={[styles.errorButton, { backgroundColor: colors.accent }]}
          >
            <Typography variant="subheadline" color={colors.white}>Close</Typography>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

/**
 * Presents task detail in a full-height bottom sheet (e.g. from Home tab).
 * Uses an isolated nested TaskDetailStack so edit is an in-stack push.
 */
export function TaskDetailBottomSheet({ visible, taskId, householdId, onClose }: TaskDetailBottomSheetProps) {  const colors = useAppColors();
  if (!taskId) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="full"
      presentation="bottom"
      showHandle={false}
      // Hosts its own navigation stack, which draws its own back/close chrome —
      // the sheet's standard ✕ (on by default everywhere else) would be a
      // second, competing dismiss control stacked on top of it.
      showCloseButton={false}
      noPadding={true}
      disableSwipe={true}
      sheetMaxWidth={Layout.readingMaxWidth}
    >
      <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
        <SheetErrorBoundary onClose={onClose} colors={colors}>
          <TaskDetailSheetOnBackContext.Provider value={onClose}>
            <TaskDetailStackHost initialTask={{ taskId, householdId: householdId ?? undefined }} />
          </TaskDetailSheetOnBackContext.Provider>
        </SheetErrorBoundary>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
});
