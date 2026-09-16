/**
 * "Who can change this project" — the manage-permissions sheet.
 *
 * Three controls, in the order a member reasons about them:
 *
 *  1. **Visibility.** A draft is private to whoever created it; publishing is
 *     what shares it with the household. It sits at the top because it is the
 *     bigger switch — with a draft, the roles below it apply to nobody.
 *  2. **Everyone else.** The project's `default_role`, i.e. what a household
 *     member with no explicit row gets. This is the control that makes the list
 *     legible: without it, a household of eight would need eight identical rows
 *     to say "view only", and a ninth member joining would silently get the
 *     wrong access.
 *  3. **Per-member overrides.** Only the people who differ from the default are
 *     actually stored; the sheet computes that diff on save.
 *
 * **Nothing is written until Save.** Role edits are held in local state so a
 * member can set three people and commit once — three sequential PATCHes are
 * three chances to leave the project in a state nobody chose, and the backend
 * takes the whole list in one PUT for exactly that reason.
 *
 * The creator's row is rendered and NOT editable. Their `owner` is pinned by
 * `effectiveHomeProjectRole`, so a control that appeared to change it would be
 * lying; and without the pin, "set everyone to viewer" is a one-tap way to make
 * a project nobody in the household can ever edit again.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { homeProjectsApi, useHomeProjectAccess } from '@api/home-projects';
import { Avatar } from '@components/ui/Avatar';
import { BottomSheet } from '@components/ui/BottomSheet';
import { Button } from '@components/ui/Button';
import { Typography } from '@components/ui/Typography';
import type {
  HomeProjectAccessMember,
  HomeProjectRole,
  HomeProjectVisibility,
} from '@symply/contracts';
import { Spacing, useAppColors, type AppColors } from '@theme';

interface ProjectAccessSheetProps {
  visible: boolean;
  onClose: () => void;
  householdId: string | undefined;
  projectId: string;
  /** Project title, so the sheet says what it is about. */
  projectTitle: string;
  /** Called after a successful save so the hub can refetch its own copies. */
  onSaved?: () => void;
}

const ROLE_LABELS: Record<HomeProjectRole, string> = {
  owner: 'Can edit',
  viewer: 'View only',
};

const ROLES: HomeProjectRole[] = ['owner', 'viewer'];

/** Name for a roster row, in the order the member chose it. */
function memberLabel(member: HomeProjectAccessMember): string {
  return member.display_name?.trim() || member.email?.trim() || 'Household member';
}

/** A two-option segmented control. Extracted because it appears N+1 times. */
function RolePicker({
  value,
  onChange,
  disabled,
  colors,
  testID,
}: {
  value: HomeProjectRole;
  onChange: (role: HomeProjectRole) => void;
  disabled?: boolean;
  colors: AppColors;
  testID: string;
}) {
  return (
    <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
      {ROLES.map((role) => {
        const active = role === value;
        return (
          <Pressable
            key={role}
            onPress={() => !disabled && onChange(role)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            accessibilityLabel={ROLE_LABELS[role]}
            testID={`${testID}-${role}`}
            style={[
              styles.segment,
              {
                backgroundColor: active ? colors.primary : 'transparent',
                opacity: disabled ? 0.45 : 1,
              },
            ]}
          >
            <Typography
              variant="caption1"
              weight={active ? 'semibold' : 'regular'}
              color={active ? colors.white : colors.textSecondary}
            >
              {ROLE_LABELS[role]}
            </Typography>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProjectAccessSheet({
  visible,
  onClose,
  householdId,
  projectId,
  projectTitle,
  onSaved,
}: ProjectAccessSheetProps) {
  const colors = useAppColors();
  // Only fetched while the sheet is open: this is the one home-project read that
  // joins the household roster, and the hub has no use for it otherwise.
  const { data: access, isLoading, error } = useHomeProjectAccess(householdId, projectId, visible);

  const [defaultRole, setDefaultRole] = useState<HomeProjectRole>('owner');
  const [visibility, setVisibility] = useState<HomeProjectVisibility>('published');
  /** user_id → role, for every member, seeded from the server's effective view. */
  const [roles, setRoles] = useState<Record<string, HomeProjectRole>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seeded on every fresh fetch rather than only on first open, so reopening
  // the sheet after someone else changed access shows THEIR state, not a stale
  // draft of ours.
  useEffect(() => {
    if (!access) return;
    setDefaultRole(access.default_role);
    setVisibility(access.visibility);
    setRoles(
      Object.fromEntries(access.members.map((m) => [m.user_id, m.role])) as Record<
        string,
        HomeProjectRole
      >
    );
    setSaveError(null);
  }, [access]);

  // Memoised, not a bare `?? []`: a fresh literal every render would make the
  // three `useMemo`s below recompute on every render, which defeats the point
  // of having them.
  const members = useMemo(() => access?.members ?? [], [access]);
  const creatorId = useMemo(
    () => members.find((m) => m.source === 'creator')?.user_id ?? null,
    [members]
  );

  /**
   * Everyone whose role differs from the default — the only rows worth storing.
   *
   * The creator is excluded because their `owner` is pinned by the resolver, so
   * a grant for them would be an override that can never take effect.
   */
  const grants = useMemo(
    () =>
      members
        .filter((m) => m.user_id !== creatorId)
        .map((m) => ({ user_id: m.user_id, role: roles[m.user_id] ?? defaultRole }))
        .filter((g) => g.role !== defaultRole),
    [members, roles, defaultRole, creatorId]
  );

  const dirty = useMemo(() => {
    if (!access) return false;
    if (access.default_role !== defaultRole) return true;
    if (access.visibility !== visibility) return true;
    return members.some((m) => (roles[m.user_id] ?? m.role) !== m.role);
  }, [access, defaultRole, visibility, members, roles]);

  const save = useCallback(async () => {
    if (!householdId) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Visibility first. It is the coarser change, and if the access write then
      // fails the member is left with the publish state they chose rather than
      // roles for a project still marked private.
      if (access && visibility !== access.visibility) {
        await homeProjectsApi.update(householdId, projectId, { visibility });
      }
      await homeProjectsApi.setAccess(householdId, projectId, { defaultRole, grants });
      onSaved?.();
      onClose();
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : 'We could not save those permissions. Try again.'
      );
    } finally {
      setSaving(false);
    }
  }, [householdId, projectId, access, visibility, defaultRole, grants, onSaved, onClose]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      title="Who can change this"
      showCloseButton
    >
      <ScrollView contentContainerStyle={styles.body} testID="project-access-sheet">
        <Typography variant="footnote" color={colors.textSecondary}>
          {projectTitle}
        </Typography>

        {isLoading ? (
          <View style={styles.centered} testID="project-access-loading">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <Typography variant="footnote" color={colors.error} testID="project-access-error">
            We could not load this project’s permissions. Pull to refresh and try again.
          </Typography>
        ) : (
          <>
            <View style={styles.group}>
              <Typography variant="label" weight="semibold" color={colors.textPrimary}>
                Visibility
              </Typography>
              <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
                {(['draft', 'published'] as const).map((option) => {
                  const active = option === visibility;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setVisibility(option)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      testID={`project-access-visibility-${option}`}
                      style={[
                        styles.segment,
                        { backgroundColor: active ? colors.primary : 'transparent' },
                      ]}
                    >
                      <Typography
                        variant="caption1"
                        weight={active ? 'semibold' : 'regular'}
                        color={active ? colors.white : colors.textSecondary}
                      >
                        {option === 'draft' ? 'Draft (only me)' : 'Shared with household'}
                      </Typography>
                    </Pressable>
                  );
                })}
              </View>
              <Typography variant="caption1" color={colors.textTertiary}>
                {visibility === 'draft'
                  ? 'Nobody else in the household can see this project or its photos, and no notifications go out about it.'
                  : 'Everyone in the household can open this project. What they can change is set below.'}
              </Typography>
            </View>

            <View style={styles.group}>
              <Typography variant="label" weight="semibold" color={colors.textPrimary}>
                Everyone else
              </Typography>
              <RolePicker
                value={defaultRole}
                onChange={setDefaultRole}
                colors={colors}
                testID="project-access-default"
              />
              <Typography variant="caption1" color={colors.textTertiary}>
                What a household member gets when you have not set them
                individually — including anyone who joins later.
              </Typography>
            </View>

            <View style={styles.group}>
              <Typography variant="label" weight="semibold" color={colors.textPrimary}>
                Household members
              </Typography>
              {members.length === 0 ? (
                <Typography variant="footnote" color={colors.textSecondary}>
                  No other members yet. Invite someone to your household to share
                  this project with them.
                </Typography>
              ) : (
                members.map((member) => {
                  const isCreator = member.user_id === creatorId;
                  return (
                    <View
                      key={member.user_id}
                      style={[styles.memberRow, { borderColor: colors.borderColor }]}
                      testID={`project-access-member-${member.user_id}`}
                    >
                      <Avatar
                        user={{
                          display_name: member.display_name,
                          avatar_url: member.avatar_url,
                          email: member.email ?? undefined,
                        }}
                        size="md"
                      />
                      <View style={styles.memberText}>
                        <Typography
                          variant="footnote"
                          weight="semibold"
                          color={colors.textPrimary}
                          numberOfLines={1}
                        >
                          {memberLabel(member)}
                        </Typography>
                        <Typography
                          variant="caption2"
                          color={colors.textTertiary}
                          numberOfLines={1}
                        >
                          {isCreator ? 'Created this project' : (member.email ?? '')}
                        </Typography>
                      </View>
                      <RolePicker
                        value={roles[member.user_id] ?? member.role}
                        onChange={(role) =>
                          setRoles((prev) => ({ ...prev, [member.user_id]: role }))
                        }
                        disabled={isCreator}
                        colors={colors}
                        testID={`project-access-role-${member.user_id}`}
                      />
                    </View>
                  );
                })
              )}
            </View>

            {saveError ? (
              <Typography variant="footnote" color={colors.error} testID="project-access-save-error">
                {saveError}
              </Typography>
            ) : null}

            <Button
              title={saving ? 'Saving…' : 'Save permissions'}
              onPress={() => void save()}
              disabled={saving || !dirty}
              testID="project-access-save"
            />
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: Spacing.md, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  centered: { paddingVertical: Spacing.xl, alignItems: 'center' },
  group: { gap: Spacing.sm },
  segmented: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  segment: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memberText: { flex: 1, gap: 2 },
});
