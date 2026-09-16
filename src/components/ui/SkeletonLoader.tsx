import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

import { useAppColors } from '@theme';

interface SkeletonLoaderProps {
  type: 'member' | 'message' | 'task' | 'image' | 'text';
  count?: number;
  width?: number | string;
  height?: number;
}

function SkeletonItem({ width, height }: { width?: number | string; height?: number }) {
  const colors = useAppColors();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();

    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width: width as number | `${number}%` | undefined ?? '100%',
          height: height || 16,
          backgroundColor: colors.groupedListBackground,
          opacity,
        },
      ]}
    />
  );
}

function MemberSkeleton() {
  return (
    <View style={styles.memberContainer}>
      <SkeletonItem width={48} height={48} />
      <View style={styles.memberInfo}>
        <SkeletonItem width="60%" height={16} />
        <View style={styles.spacing} />
        <SkeletonItem width="40%" height={12} />
      </View>
    </View>
  );
}

function MessageSkeleton() {
  return (
    <View style={styles.messageContainer}>
      <SkeletonItem width={32} height={32} />
      <View style={styles.messageBubble}>
        <SkeletonItem width="80%" height={14} />
        <View style={styles.smallSpacing} />
        <SkeletonItem width="60%" height={14} />
      </View>
    </View>
  );
}

function TaskSkeleton() {
  return (
    <View style={styles.taskContainer}>
      <SkeletonItem width="70%" height={16} />
      <View style={styles.spacing} />
      <SkeletonItem width="50%" height={12} />
      <View style={styles.spacing} />
      <SkeletonItem width="30%" height={12} />
    </View>
  );
}

export function SkeletonLoader({ type, count = 1, width, height }: SkeletonLoaderProps) {
  const renderSkeleton = () => {
    switch (type) {
      case 'member':
        return <MemberSkeleton />;
      case 'message':
        return <MessageSkeleton />;
      case 'task':
        return <TaskSkeleton />;
      case 'image':
        return <SkeletonItem width={width || '100%'} height={height || 200} />;
      case 'text':
        return <SkeletonItem width={width || '100%'} height={height || 16} />;
      default:
        return <SkeletonItem width={width || '100%'} height={height || 16} />;
    }
  };

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.item}>
          {renderSkeleton()}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    borderRadius: 8,
  },
  item: {
    marginBottom: 12,
  },
  memberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
  },
  memberInfo: {
    marginLeft: 12,
    flex: 1,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
  },
  messageBubble: {
    marginLeft: 8,
    flex: 1,
    padding: 12,
    borderRadius: 16,
  },
  taskContainer: {
    padding: 16,
    borderRadius: 12,
  },
  spacing: {
    height: 8,
  },
  smallSpacing: {
    height: 4,
  },
});
