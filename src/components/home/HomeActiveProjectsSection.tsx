import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

import { projectsApi } from '@api/projects';
import { useHouseholdStore } from '@stores/householdStore';
import { useProjectStore } from '@stores/projectStore';
import { useAppColors } from '@theme';

import { EmptyState } from './EmptyState';
import { HomeProjectCard } from './HomeProjectCard';
import { SectionHeader } from './SectionHeader';


interface HomeActiveProjectsSectionProps {
  onSeeAllPress?: () => void;
}

export function HomeActiveProjectsSection({ onSeeAllPress }: HomeActiveProjectsSectionProps) {
  const colors = useAppColors();  const router = useRouter();
  const selectedHousehold = useHouseholdStore((s) => s.households[0]);
  const { activeProjects, setActiveProjects, setLoading, setError } = useProjectStore();

  // Fetch active projects on mount
  useEffect(() => {
    if (!selectedHousehold) return;

    const fetchProjects = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await projectsApi.getActive(selectedHousehold.id);
        setActiveProjects(data.projects);
      } catch (error) {
        console.error('Failed to fetch active projects:', error);
        setError('Failed to load active projects');
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [selectedHousehold?.id, setActiveProjects, setLoading, setError]);

  // Display first 3 projects
  const displayProjects = useMemo(() => activeProjects.slice(0, 3), [activeProjects]);

  const handleSeeAll = () => {
    if (onSeeAllPress) {
      onSeeAllPress();
    } else {
      router.push({ pathname: '/contractors', params: { screen: 'Projects' } });
    }
  };

  const handleProjectPress = (projectId: string) => {
    router.push({
      pathname: '/contractors',
      params: { screen: 'ProjectDetail', projectId },
    });
  };

  const content = (
    <>
      <SectionHeader
        title="Active Projects"
        count={activeProjects.length}
        onSeeAll={activeProjects.length > 0 ? handleSeeAll : undefined}
      />
      {displayProjects.length > 0 ? (
        <>
          {displayProjects.map((project) => (
            <HomeProjectCard key={project.id} project={project} onPress={() => handleProjectPress(project.id)} />
          ))}
        </>
      ) : (
        <EmptyState
          icon="construct"
          title="No Active Projects"
          message="Track ongoing home improvement projects here."
        />
      )}
    </>
  );

  // Use Liquid Glass on iOS 26+
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={styles.sectionGlass} glassEffectStyle="regular" isInteractive>
        {content}
      </GlassView>
    );
  }

  // Fallback for older iOS
  return (
    <View style={[styles.section, { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionGlass: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    ...Platform.select({
      ios: {
        shadowColor: '#FFF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
      },
    }),
  },
  section: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 0.5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
});
