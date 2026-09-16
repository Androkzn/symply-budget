import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GlassCard } from '@features/kaizen/brand';
import {
  AddIcon,
  CompleteIcon,
  InboxIcon,
  InProgressIcon,
  NotesIcon,
  PendingIcon,
  useBrandIconState,
} from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useInvalidateKaizenGtd, useKaizenGtd } from '@features/kaizen/hooks/useKaizenGtd';
import { selectGtdInboxItems } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, KaizenScreen, kaizenStyles } from './common';

/** Section header with a subtle brand icon accent above a glass panel. */
function SectionWithIcon({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      </View>
      <GlassCard padding={0} radius={20}>
        {children}
      </GlassCard>
    </View>
  );
}

/** Text "Add" affordance in the brand primary colour with a leading glyph. */
function AddButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const glyphState = useBrandIconState(false);
  const colors = useAppColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.addButton, { opacity: disabled ? 0.5 : 1 }]}
    >
      <AddIcon size={18} state={glyphState} color={colors.primary} />
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function LearnScreen() {
  const colors = useAppColors();
  const appColors = useAppColors();
  const glyphState = useBrandIconState(false);
  const userId = useAuthStore(state => state.user?.id);
  const knowledge = useKaizenStore(state => state.knowledge);
  const { data: gtd = [] } = useKaizenGtd();
  const invalidateGtd = useInvalidateKaizenGtd();
  const addGtdItem = useKaizenStore(state => state.addGtdItem);
  const addKnowledgeItem = useKaizenStore(state => state.addKnowledgeItem);
  const updateGtdStatus = useKaizenStore(state => state.updateGtdStatus);
  const [title, setTitle] = useState('');
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [knowledgeTags, setKnowledgeTags] = useState('');
  const [paraType, setParaType] = useState('projects');
  const [isAdding, setIsAdding] = useState(false);

  const inboxCount = selectGtdInboxItems(gtd).length;

  const refreshGtd = async () => {
    if (userId) {
      await invalidateGtd(userId);
    }
  };

  const addInboxItem = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setIsAdding(true);
    try {
      await addGtdItem(trimmed);
      setTitle('');
      await refreshGtd();
    } catch {
      // Keep the captured title when add fails.
    } finally {
      setIsAdding(false);
    }
  };

  const addKnowledge = async () => {
    if (!knowledgeTitle.trim()) return;
    try {
      await addKnowledgeItem(
        knowledgeTitle.trim(),
        paraType,
        knowledgeContent.trim(),
        knowledgeTags.trim(),
      );
      setKnowledgeTitle('');
      setKnowledgeContent('');
      setKnowledgeTags('');
    } catch {
      // Keep knowledge fields when add fails.
    }
  };

  /* istanbul ignore next -- every rendered GTD row carries one of the four known statuses, so the '?? inbox' fallback is unreachable */
  const nextStatus = (status: string) =>
    ({ inbox: 'next', next: 'waiting', waiting: 'done', done: 'inbox' }[status] ?? 'inbox');

  const inputStyle = [
    styles.input,
    {
      backgroundColor: appColors.inputFieldBackground,
      borderColor: appColors.glassBorder,
      color: colors.textPrimary,
    },
  ];

  const statusIcon: Record<string, ReactNode> = {
    next: <InProgressIcon size={18} state={glyphState} />,
    waiting: <PendingIcon size={18} state={glyphState} />,
    done: <CompleteIcon size={18} state={glyphState} />,
  };

  return (
    <KaizenScreen variant="root" title="Learn" subtitle="Keep useful knowledge and open loops in one place." screenTestId="kaizen-learn-screen">
      <CommandCenterCard tint={colors.primary}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>CAPTURE</Text>
        <View style={styles.capture}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Capture an open loop"
            placeholderTextColor={colors.textSecondary}
            style={inputStyle}
            onSubmitEditing={() => void addInboxItem()}
          />
          <AddButton
            label={isAdding ? 'Adding' : 'Add'}
            disabled={isAdding || !title.trim()}
            onPress={() => void addInboxItem()}
          />
        </View>
        <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
          {inboxCount} in inbox · {knowledge.length} knowledge items
        </Text>
      </CommandCenterCard>

      <SectionWithIcon icon={<NotesIcon size={18} state={glyphState} />} title="Upload to knowledge">
        <View style={styles.sectionBody}>
          <KaizenImportUploadSection purpose="knowledge" navigateAfterImport={false} />
        </View>
      </SectionWithIcon>

      <SectionWithIcon icon={<NotesIcon size={18} state={glyphState} />} title="Knowledge">
        <View style={styles.sectionBody}>
          <View style={styles.capture}>
            <TextInput
              value={knowledgeTitle}
              onChangeText={setKnowledgeTitle}
              placeholder="Add knowledge item"
              placeholderTextColor={colors.textSecondary}
              style={inputStyle}
            />
            <AddButton label="Add" onPress={() => void addKnowledge()} />
          </View>
          <View style={styles.capture}>
            <TextInput
              value={knowledgeContent}
              onChangeText={setKnowledgeContent}
              placeholder="Notes"
              placeholderTextColor={colors.textSecondary}
              style={inputStyle}
            />
            <TextInput
              value={knowledgeTags}
              onChangeText={setKnowledgeTags}
              placeholder="Tags"
              placeholderTextColor={colors.textSecondary}
              style={inputStyle}
            />
          </View>
          <View style={styles.para}>
            {['projects', 'areas', 'resources', 'archives'].map(type => {
              const active = paraType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => setParaType(type)}
                  style={[
                    styles.pill,
                    {
                      backgroundColor: active ? appColors.surfaceSelected : appColors.pillBackground,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primary : colors.textSecondary,
                      fontWeight: active ? '700' : '500',
                      fontSize: Typography.caption.size,
                      textTransform: 'capitalize',
                    }}
                  >
                    {type}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {knowledge.length === 0 ? (
          <EmptyState>Your PARA knowledge library is empty.</EmptyState>
        ) : (
          knowledge.map(item => (
            <View key={item.id} style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}>
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '500' }}>
                  {item.title}
                </Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {item.para_type}
                </Text>
                {!!item.tags && (
                  <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                    {item.tags}
                  </Text>
                )}
              </View>
            </View>
          ))
        )}
      </SectionWithIcon>

      <SectionWithIcon icon={<InboxIcon size={18} state={glyphState} />} title="GTD inbox">
        {gtd.filter(item => item.status === 'inbox').length === 0 ? (
          <EmptyState>No items in your inbox.</EmptyState>
        ) : (
          gtd
            .filter(item => item.status === 'inbox')
            .map(item => (
              <Pressable
                key={item.id}
                style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}
                onPress={() =>
                  void updateGtdStatus(item.id, nextStatus(item.status))
                    .then(() => refreshGtd())
                    .catch(() => undefined)
                }
              >
                <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>{item.title}</Text>
                <Text style={{ color: colors.textSecondary }}>Next</Text>
              </Pressable>
            ))
        )}
      </SectionWithIcon>

      {(['next', 'waiting', 'done'] as const).map(status => (
        <SectionWithIcon key={status} icon={statusIcon[status]} title={status}>
          {gtd.filter(item => item.status === status).length === 0 ? (
            <EmptyState>No {status} items.</EmptyState>
          ) : (
            gtd
              .filter(item => item.status === status)
              .map(item => (
                <Pressable
                  key={item.id}
                  style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}
                  onPress={() =>
                  void updateGtdStatus(item.id, nextStatus(item.status))
                    .then(() => refreshGtd())
                    .catch(() => undefined)
                }
                >
                  <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>{item.title}</Text>
                  <Text style={{ color: colors.textSecondary }}>{nextStatus(status)}</Text>
                </Pressable>
              ))
          )}
        </SectionWithIcon>
      ))}

      <Pressable
        style={styles.deepWorkLink}
        onPress={() => router.push('/kaizen/deep-work')}
      >
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Add a deep work block →</Text>
      </Pressable>
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
    opacity: 0.9,
  },
  capture: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  input: {
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    flex: 1,
    fontSize: Typography.body.size,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  addButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: Spacing.sm,
  },
  section: { marginTop: Spacing.sm },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  sectionTitle: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionBody: { paddingHorizontal: Spacing.base, paddingTop: Spacing.base },
  para: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  pill: {
    alignItems: 'center',
    borderRadius: CornerRadius.full,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
  },
  deepWorkLink: {
    justifyContent: 'center',
    marginTop: Spacing.md,
    minHeight: 44,
  },
});
