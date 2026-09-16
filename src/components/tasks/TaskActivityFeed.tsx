/**
 * TaskActivityFeed — household-visible progress/blocker/resolution notes on a
 * task, with an inline composer. Lets members "see progress" and coordinate
 * (Smart Task Assistant household sharing).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity } from 'react-native';

import { tasksApi, TaskNote } from '@api/tasks';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { showToast } from '@services/toastManager';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';

interface TaskActivityFeedProps {
  householdId: string;
  taskId: string;
  /** Bumped by the parent (e.g. after block/unblock) to force a reload. */
  refreshKey?: number;
}

const KIND_ICON: Record<string, IoniconName> = {
  progress: 'chatbubble-ellipses',
  blocker: 'remove-circle',
  resolution: 'checkmark-circle',
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function TaskActivityFeed({ householdId, taskId, refreshKey }: TaskActivityFeedProps) {  const colors = useAppColors();
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await tasksApi.listNotes(householdId, taskId);
      setNotes(result);
    } catch {
      // Non-fatal: an empty feed is fine.
    } finally {
      setIsLoading(false);
    }
  }, [householdId, taskId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleAdd = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await tasksApi.addNote(householdId, taskId, body);
      setDraft('');
      await load();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View>
      <Typography variant="headline" weight="semibold" color={colors.textPrimary} style={styles.heading}>
        Activity
      </Typography>

      {/* Composer */}
      <View style={[styles.composer, { borderColor: colors.borderColor, backgroundColor: colors.backgroundSecondary }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a progress update…"
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.textPrimary }]}
          editable={!submitting}
          multiline
        />
        <TouchableOpacity
          onPress={handleAdd}
          disabled={!draft.trim() || submitting}
          style={[
            styles.sendButton,
            { backgroundColor: draft.trim() ? colors.primary : colors.borderColor },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Typography variant="footnote" weight="bold" color={colors.white}>
              Post
            </Typography>
          )}
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : notes.length === 0 ? (
        <Typography variant="footnote" color={colors.textSecondary} style={styles.empty}>
          No activity yet. Updates you and your household add will appear here.
        </Typography>
      ) : (
        notes.map((note) => (
          <View key={note.id} style={[styles.noteRow, { borderBottomColor: colors.borderColor }]}>
            <Icon
              name={KIND_ICON[note.kind] ?? 'chatbubble-ellipses'}
              size={16}
              color={
                note.kind === 'blocker'
                  ? colors.error
                  : note.kind === 'resolution'
                  ? colors.success
                  : colors.textSecondary
              }
              style={styles.kindIcon}
            />
            <View style={styles.noteBody}>
              <Typography variant="subheadline" color={colors.textPrimary}>
                {note.body}
              </Typography>
              <Typography variant="caption2" color={colors.textSecondary}>
                {(note.author?.display_name || 'Someone') + ' · ' + timeAgo(note.created_at)}
              </Typography>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginBottom: 10,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 100,
    paddingVertical: 6,
  },
  sendButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginLeft: 6,
  },
  loading: {
    marginVertical: 16,
  },
  empty: {
    paddingVertical: 12,
  },
  noteRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kindIcon: {
    marginRight: 10,
  },
  noteBody: {
    flex: 1,
    gap: 2,
  },
});
