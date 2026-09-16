import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  parseDroppedPhases,
  useProjectAsIs,
  usePublishProject,
  useSmartDraft,
  type HomeProjectAsIs,
} from '@api/home-projects';
import { Icon } from '@components/ui/Icon';
import { trackEvent } from '@services/analytics';
import { useAppColors } from '@theme';

interface Props {
  householdId: string | undefined;
  projectId: string;
  /** Only an owner may publish; a viewer sees the banner without the action. */
  canEdit: boolean;
  onPublished?: () => void;
}

/**
 * The review gate for a Smart Project draft.
 *
 * See `documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md`.
 *
 * ## Why this is a banner and not a screen
 *
 * The member reviews the draft in the real hub — the same phase list, the same
 * Surface Studio, the same material cards they will keep using. A dedicated
 * preview screen would drift from those the moment either changed, and what
 * they approved would quietly stop being what they got. So the only thing this
 * adds is the frame: what the draft is, what it skipped, and the one button
 * that shares it.
 *
 * ## What it says out loud
 *
 * Three things the member cannot see by scrolling:
 *
 *  1. **Nobody else can see this yet.** The strongest reassurance available,
 *     and the reason it is safe for a model to have written these rows.
 *  2. **What was skipped, and why.** A draft that quietly omitted roofing is
 *     indistinguishable from one that forgot it. Naming the reason is what
 *     lets the member tell "it understood me" from "it missed something".
 *  3. **This is a starting point.** A generated plan that looks finished
 *     discourages the checking it most needs.
 */
export function SmartDraftReviewBanner({
  householdId,
  projectId,
  canEdit,
  onPublished,
}: Props) {
  const colors = useAppColors();
  const [expanded, setExpanded] = useState(false);
  const { data: draft } = useSmartDraft(householdId, projectId);
  const { data: asIs } = useProjectAsIs(householdId, projectId, !!draft);
  const publish = usePublishProject(householdId, projectId);

  const dropped = useMemo(() => parseDroppedPhases(draft ?? null), [draft]);

  const present = useMemo(
    () => (asIs ?? []).filter((a: HomeProjectAsIs) => a.state === 'present'),
    [asIs],
  );

  /**
   * Renders for ANY draft project, not only ones with a generation record.
   *
   * It used to bail on `!draft`, where `draft` was a `home_project_smart_drafts`
   * row. That row no longer exists: the server generates and the CLIENT saves
   * the project, so nothing writes a draft record any more. The banner
   * therefore never rendered — a drafted project opened with no "only you can
   * see this", and no way to publish it.
   *
   * Keying off the project's own draft state is also simply more correct. The
   * banner's job is to frame *being a draft* — private until shared, with the
   * button that shares it — and that is true however the project was made. The
   * caller already gates on `visibility === 'draft'`.
   *
   * The generation-specific sections (what was skipped, what it assumed) stay
   * conditional on a record existing, so they degrade instead of disappearing.
   */
  const generating = draft?.status === 'generating';
  const failed = draft?.status === 'failed';

  const onPublish = () => {
    Alert.alert(
      'Share with your household?',
      'Everyone in your household will see this project, and its tasks will be added to your shared list.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Share',
          onPress: async () => {
            try {
              await publish.mutateAsync();
              trackEvent('home_project_published', { project_id: projectId });
              onPublished?.();
            } catch (err) {
              Alert.alert('Could not share', (err as Error).message || 'Try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.primary },
      ]}
      accessibilityRole="summary"
      testID="smart-draft-banner"
    >
      <View style={styles.headerRow}>
        <Icon
          name={failed ? 'alert-circle-outline' : 'sparkles-outline'}
          size={20}
          color={failed ? colors.error : colors.primary}
        />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {generating
            ? 'Drafting…'
            : failed
              ? 'Draft failed'
              : 'Draft — only you can see this'}
        </Text>
        {generating && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {!generating && !failed && (
        <>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            A starting point drafted from what you told us — not a scope of work.
            Check every line, change anything, then share it when it looks right.
          </Text>

          {/* The gap-namer. Without this a member cannot tell whether the model
              understood that the roof was done or simply forgot roofing. */}
          {dropped.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
                Skipped, because you said it is already done
              </Text>
              {dropped.map(d => (
                <Text
                  key={d.title}
                  style={[styles.line, { color: colors.textSecondary }]}
                >
                  • {d.title} — {d.because.replace(/_/g, ' ')}
                </Text>
              ))}
            </View>
          )}

          {expanded && present.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>
                What we understood you already have
              </Text>
              {present.map(a => (
                <Text
                  key={a.id}
                  style={[styles.line, { color: colors.textSecondary }]}
                >
                  • {a.element.replace(/_/g, ' ')}
                  {a.evidence ? ` — “${a.evidence}”` : ''}
                </Text>
              ))}
            </View>
          )}

          {present.length > 0 && (
            <Pressable
              onPress={() => setExpanded(v => !v)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={[styles.toggle, { color: colors.primary }]}>
                {expanded ? 'Hide details' : 'What did it assume?'}
              </Text>
            </Pressable>
          )}

          {canEdit && (
            <Pressable
              style={[styles.publish, { backgroundColor: colors.primary }]}
              onPress={onPublish}
              disabled={publish.isPending}
              accessibilityRole="button"
              accessibilityLabel="Share this project with your household"
              testID="smart-draft-publish"
            >
              <Text style={styles.publishText}>
                {publish.isPending ? 'Sharing…' : 'Share with household'}
              </Text>
            </Pressable>
          )}
        </>
      )}

      {generating && (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We are drafting the phases, surfaces and materials. This page will fill
          in as soon as it is ready.
        </Text>
      )}

      {failed && (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          We could not draft this one. The project is still here and still
          yours — add what you need by hand, or start again from a template.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  body: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  section: { marginTop: 12 },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  line: { fontSize: 13, lineHeight: 19 },
  toggle: { fontSize: 13, fontWeight: '600', marginTop: 10 },
  publish: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  publishText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
