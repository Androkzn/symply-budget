import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import type { TaskWorkflowStage } from '@api/tasks';
import { Icon } from '@components/ui/Icon';
import { useAppColors, type AppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

interface WorkflowStageIndicatorProps {
  currentStage: TaskWorkflowStage;
  onStagePress?: (stage: TaskWorkflowStage) => void;
}

const WORKFLOW_STAGES: { stage: TaskWorkflowStage; label: string; icon: IoniconName }[] = [
  { stage: 'planning', label: 'Planning', icon: 'create' },
  { stage: 'getting_quotes', label: 'Getting Quotes', icon: 'document-text' },
  { stage: 'comparing_quotes', label: 'Comparing', icon: 'git-compare' },
  { stage: 'quote_selected', label: 'Quote Selected', icon: 'checkmark-circle' },
  { stage: 'scheduled', label: 'Scheduled', icon: 'calendar' },
  { stage: 'in_progress', label: 'In Progress', icon: 'construct' },
  { stage: 'completed', label: 'Completed', icon: 'checkmark-done' },
];

const getStageColor = (colors: AppColors, stage: TaskWorkflowStage): string => {
  switch (stage) {
    case 'planning':
      return colors.textSecondary;
    case 'getting_quotes':
    case 'in_progress':
      return colors.warning;
    case 'comparing_quotes':
      return colors.info;
    case 'quote_selected':
    case 'completed':
      return colors.success;
    case 'scheduled':
      return colors.accent;
    case 'cancelled':
      return colors.error;
    default:
      return colors.textSecondary;
  }
};

export function WorkflowStageIndicator({ currentStage, onStagePress }: WorkflowStageIndicatorProps) {
  const colors = useAppColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentIndex = WORKFLOW_STAGES.findIndex((s) => s.stage === currentStage);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Workflow Progress</Text>
      <View style={styles.stagesContainer}>
        {WORKFLOW_STAGES.map((stage, index) => {
          const isActive = stage.stage === currentStage;
          const isCompleted = index < currentIndex;
          const isPending = index > currentIndex;

          return (
            <TouchableOpacity
              key={stage.stage}
              style={styles.stageWrapper}
              onPress={() => onStagePress?.(stage.stage)}
              disabled={!onStagePress}
            >
              <View
                style={[
                  styles.stageIndicator,
                  isActive && styles.stageActive,
                  isCompleted && styles.stageCompleted,
                  isPending && styles.stagePending,
                  { backgroundColor: isActive ? getStageColor(colors, stage.stage) : undefined },
                ]}
              >
                <Icon
                  name={stage.icon}
                  size={20}
                  color={isActive || isCompleted ? colors.white : colors.textSecondary}
                />
              </View>
              <Text style={[styles.stageLabel, isActive && styles.stageLabelActive]}>{stage.label}</Text>
              {index < WORKFLOW_STAGES.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    isCompleted && styles.connectorCompleted,
                    (isActive || isPending) && styles.connectorPending,
                  ]}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  container: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  stagesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageWrapper: {
    alignItems: 'center',
    flex: 1,
    position: 'relative',
  },
  stageIndicator: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.borderColor,
    backgroundColor: colors.cardBackground,
  },
  stageActive: {
    borderColor: 'transparent',
    borderWidth: 0,
  },
  stageCompleted: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  stagePending: {
    backgroundColor: colors.cardBackground,
    borderColor: colors.borderColor,
  },
  stageLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  stageLabelActive: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
  connector: {
    position: 'absolute',
    top: 20,
    left: '50%',
    right: '-50%',
    height: 2,
    zIndex: -1,
  },
  connectorCompleted: {
    backgroundColor: colors.success,
  },
  connectorPending: {
    backgroundColor: colors.divider,
  },
});
