import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { homeProjectsApi, useHomeProjects, type HomeProject } from '@api/home-projects';
import {
  AttachmentSourceSheet,
  HeaderActionButton,
  ScreenHeader,
  SettingsGearButton,
} from '@components/common';
import { HomeProjectListCard } from '@components/home-projects/HomeProjectListCard';
import { HomeProjectRenameSheet } from '@components/home-projects/HomeProjectRenameSheet';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { FilterTabs, type FilterTab } from '@components/ui/FilterTabs';
import { useMemberFacingAlert } from '@features/house/local/useMemberFacingAlert';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { HomeProjectsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

type Props = NativeStackScreenProps<HomeProjectsStackParamList, 'HomeProjectsList'>;

export type ProjectTabId = 'active' | 'drafts' | 'archive';

/**
 * Which of the three tabs a project belongs to. Every project lands in exactly
 * one, so the tab counts add up to the whole list and nothing can hide between
 * them.
 *
 * `archived` wins over everything: it is the feature's reversible "delete" (a
 * status flip, never a row removal) and an archived draft is still archived.
 * The rest is work in flight, which is the default tab.
 *
 * **A draft is `visibility === 'draft'` and nothing else.** This used to fall
 * back to `status === 'idea'` as well, because local-first households had no
 * visibility column to read — migration 0163 gave them one, and the fallback
 * became actively wrong the moment it did: `idea` is where the WORK is (a
 * project nobody has committed to yet) while `draft` is who can SEE it, and a
 * published idea landing under a tab that promises privacy is the one mistake
 * this feature must not make. A project shared with the household now stays in
 * Active whatever its status.
 */
export function bucketOf(project: HomeProject): ProjectTabId {
  if (project.status === 'archived') return 'archive';
  if (project.visibility === 'draft') return 'drafts';
  return 'active';
}

const EMPTY_COPY: Record<ProjectTabId, string> = {
  active: 'No projects in flight. Start with a bathroom reno or a blank plan.',
  drafts:
    'No drafts. A draft is yours alone — nobody else in the household sees it until you publish it from the project’s ⋯ menu.',
  archive: 'Nothing archived. Projects you archive from the hub are kept here, not deleted.',
};

/**
 * `styles.list` set no `paddingBottom` at all, so the last project card in the
 * FlatList ended underneath the floating tab bar.
 */
const TAB_BAR_CONTENT_HEIGHT = 64;

export function HomeProjectsListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  /**
   * On iPad the tab bar is a FLOATING leading rail — `position: absolute`,
   * `left: 0`, `zIndex: 9999` — so it draws OVER whatever the screen lays out at
   * x=0 rather than taking width away from it. Every screen therefore has to
   * reserve the rail's width itself; screens wrapped in `AppBackground` get it
   * for free, and this one paints its own background, so it never did.
   *
   * The card is what made it visible: its 124pt cover rail starts at the card's
   * leading edge, so ~85pt of the project photo — and the leading half of the
   * Active tab pill — sat underneath the sidebar glass.
   */
  const { sidebarInset } = useLayoutPadding();
  const showError = useMemberFacingAlert();
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);
  const [activeTab, setActiveTab] = useState<ProjectTabId>('active');
  /** The project whose cover is mid-upload — the row shows a spinner over its rail. */
  const [coverBusyId, setCoverBusyId] = useState<string | null>(null);
  /**
   * The project being renamed. The whole row is held, not just its id: the sheet
   * needs the current title to seed its field, and reading it back out of `data`
   * would blank the field for the one frame the refetch is in flight.
   */
  const [renameTarget, setRenameTarget] = useState<HomeProject | null>(null);
  /**
   * Always the full set, archive included — the tab counts need it, and paying
   * for the archived page once up front is what makes switching tabs instant
   * instead of a refetch per tap.
   */
  const { data, isLoading, isRefetching, refetch } = useHomeProjects(householdId, {
    includeArchived: true,
  });

  const buckets = useMemo(() => {
    const grouped: Record<ProjectTabId, HomeProject[]> = { active: [], drafts: [], archive: [] };
    for (const project of data || []) grouped[bucketOf(project)].push(project);
    return grouped;
  }, [data]);

  const tabs: FilterTab[] = useMemo(
    () => [
      { id: 'active', label: 'Active', count: buckets.active.length },
      { id: 'drafts', label: 'Drafts', count: buckets.drafts.length },
      { id: 'archive', label: 'Archive', count: buckets.archive.length },
    ],
    [buckets]
  );

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  /**
   * Pick → upload → point the project at it. Two calls rather than one composite
   * because both already exist on BOTH backends: `uploadSelectionPhoto` seals the
   * bytes (local-first) or PUTs them to R2 (server-backed), and `update` sets
   * `cover_attachment_id`. A composite would need its own local counterpart to
   * survive the local-first proxy, for no gain.
   *
   * The upload is the half that can fail, and it runs first — so a failure leaves
   * an unreferenced attachment, never a project pointing at bytes that never
   * landed. The Worker and the local facade both reject the latter anyway.
   */
  const pickCover = useCallback(
    async (project: HomeProject, uri: string) => {
      if (!householdId) return;
      setCoverBusyId(project.id);
      try {
        const attachment = await homeProjectsApi.uploadSelectionPhoto(
          householdId,
          project.id,
          uri
        );
        await homeProjectsApi.update(householdId, project.id, {
          coverAttachmentId: attachment.id,
        });
        await refetch();
      } catch (error) {
        showError(error, 'We could not add that photo. Try again in a moment.');
      } finally {
        setCoverBusyId(null);
      }
    },
    [householdId, refetch, showError]
  );

  /**
   * Clears the pointer only. The attachment row and its bytes stay in the hub's
   * photo list — a member removing a cover is choosing a different thumbnail, not
   * asking to destroy the photo, and there is no delete route for one anyway.
   */
  const removeCover = useCallback(
    async (project: HomeProject) => {
      if (!householdId) return;
      setCoverBusyId(project.id);
      try {
        await homeProjectsApi.update(householdId, project.id, { coverAttachmentId: null });
        await refetch();
      } catch (error) {
        showError(
          error,
          'We could not remove that photo. Try again in a moment.'
        );
      } finally {
        setCoverBusyId(null);
      }
    },
    [householdId, refetch, showError]
  );

  /**
   * The title is patchable on both backends — the Worker's `patchProjectSchema`
   * takes it and the local-first facade applies it to the ledger row — so the
   * same `update` the cover uses carries a rename with no new route.
   *
   * Rethrows after alerting: the sheet reads the rejection as "keep what was
   * typed and stay open", which is the only way a member gets a second try
   * without retyping the name.
   */
  const renameProject = useCallback(
    async (project: HomeProject, title: string) => {
      if (!householdId) return;
      try {
        await homeProjectsApi.update(householdId, project.id, { title });
        await refetch();
      } catch (error) {
        showError(
          error,
          'We could not rename that project. Try again in a moment.'
        );
        throw error;
      }
    },
    [householdId, refetch, showError]
  );

  /**
   * The cover chooser, as the app's one photo sheet rather than an `Alert`.
   *
   * The alert offered Take photo and Choose from library. A cover shot that
   * arrived from a builder by email, or one kept in the household's Drive
   * folder, had no route in — so it is now the same Camera · Gallery · File ·
   * Drive list every upload surface shows, with Remove kept underneath.
   */
  const [coverTarget, setCoverTarget] = useState<HomeProject | null>(null);
  const presentCoverActions = useCallback(
    (project: HomeProject) => setCoverTarget(project),
    []
  );
  const coverHasPhoto = !!coverTarget?.cover_blob || !!coverTarget?.cover_url;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.backgroundMain, paddingLeft: sidebarInset },
      ]}
      testID="home-projects-list-screen"
    >
      {/*
        `canGoBack()` bubbles to the parent navigator, so inside the Projects
        TAB it answers "yes — the tab bar has history", and the root of the tab
        drew a back arrow whose `goBack()` just switches tabs. Ask this stack's
        own index instead: 0 means nothing to go back to here.
      */}
      <ScreenHeader
        title="Projects"
        showBackButton={(navigation.getState()?.index ?? 0) > 0}
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        rightElement={
          <>
            <SettingsGearButton />
            <HeaderActionButton
              label="New"
              onPress={() => navigation.navigate('CreateHomeProject')}
              testID="home-projects-create"
            />
          </>
        }
      />

      <View style={styles.tabs}>
        <FilterTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={(tabId) => setActiveTab(tabId as ProjectTabId)}
          showActiveIndicator={false}
          activeColor={colors.primary}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={buckets[activeTab]}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
          }
          contentContainerStyle={[
            styles.list,
            { paddingBottom: 16 + TAB_BAR_CONTENT_HEIGHT + insets.bottom },
          ]}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              {EMPTY_COPY[activeTab]}
            </Text>
          }
          renderItem={({ item }) => (
            <View>
              <HomeProjectListCard
                project={item}
                onPress={() => navigation.navigate('HomeProjectHub', { projectId: item.id })}
                onPressCover={() => presentCoverActions(item)}
                onPressRename={() => setRenameTarget(item)}
              />
              {coverBusyId === item.id ? (
                <View
                  style={[styles.coverBusy, { backgroundColor: colors.cardSubtle }]}
                  testID={`home-project-cover-busy-${item.id}`}
                >
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : null}
            </View>
          )}
        />
      )}

      <HomeProjectRenameSheet
        visible={!!renameTarget}
        value={renameTarget?.title ?? ''}
        onClose={() => setRenameTarget(null)}
        onSave={(title) => (renameTarget ? renameProject(renameTarget, title) : Promise.resolve())}
      />

      <AttachmentSourceSheet
        visible={!!coverTarget}
        onClose={() => setCoverTarget(null)}
        title={coverHasPhoto ? 'Project photo' : 'Add a project photo'}
        help={coverTarget?.title}
        testIDPrefix="project-cover"
        rememberScope="home-project-cover"
        pickerOptions={{
          cropping: true,
          cropperToolbarTitle: 'Crop project photo',
          compressImageQuality: 0.8,
          mediaType: 'photo',
          freeStyleCropEnabled: false,
        }}
        onPicked={([picked]) => {
          const project = coverTarget;
          if (!project || !picked) return;
          void pickCover(project, picked.uri);
        }}
        {...(coverHasPhoto && coverTarget
          ? {
              extraAction: {
                label: 'Remove photo',
                destructive: true,
                onPress: () => void removeCover(coverTarget),
                testID: 'project-cover-remove',
              },
            }
          : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  list: { padding: 16, paddingTop: 0, gap: 12 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 15, lineHeight: 22 },
  // Covers the cover rail only, so the rest of the row stays readable while the
  // photo uploads.
  coverBusy: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 124,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
