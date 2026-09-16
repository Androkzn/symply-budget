import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui';
import {
  CompleteIcon,
  LibraryIcon,
  NotesIcon,
} from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import {
  useInvalidateKaizenBookChapters,
  useKaizenBookChapters,
} from '@features/kaizen/hooks/useKaizenBookChapters';
import {
  useInvalidateKaizenBooks,
  useKaizenBooks,
} from '@features/kaizen/hooks/useKaizenBooks';
import {
  selectBookById,
  selectBookQuestionCountForChapter,
} from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import {
  CornerRadius,
  Spacing,
  Typography,
} from '@features/kaizen/theme/designTokens';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useRequireAIAccess } from '@hooks/useRequireAIAccess';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export function BookDetailScreen() {
  const colors = useAppColors();
  const params = useLocalSearchParams<{ bookId?: string }>();
  const bookId = firstParam(params.bookId);
  const appColors = useAppColors();

  const userId = useAuthStore(state => state.user?.id);
  const { data: books = [] } = useKaizenBooks();
  const { data: chapters = [] } = useKaizenBookChapters(bookId);
  const invalidateChapters = useInvalidateKaizenBookChapters();
  const invalidateBooks = useInvalidateKaizenBooks();
  const bookQuestions = useKaizenStore(state => state.bookQuestions);
  const book = selectBookById(books, bookId);
  const generateQuestions = useKaizenStore(
    state => state.generateBookChapterQuestions,
  );
  const markRead = useKaizenStore(state => state.markBookChapterRead);
  const deleteBook = useKaizenStore(state => state.deleteBook);
  const { ensureCanUseAI } = useRequireAIAccess();

  const [generatingId, setGeneratingId] = useState<string | null>(null);

  if (!book) {
    return (
      <KaizenScreen title="Book" showBackButton>
        <EmptyState>This book is no longer available.</EmptyState>
      </KaizenScreen>
    );
  }

  const questionCountFor = (chapterId: string) =>
    selectBookQuestionCountForChapter(bookQuestions, chapterId);

  const onGenerate = async (chapterId: string) => {
    // Reading, marking chapters read, and reviewing existing questions all work
    // without AI. Only GENERATING questions spends a model call, so it is the
    // one action that checks entitlement first — routing to the unlock hub
    // rather than showing "Generation failed" for what is really a denial.
    if (!ensureCanUseAI()) return;
    setGeneratingId(chapterId);
    try {
      const n = await generateQuestions(chapterId, {
        types: ['mcq', 'open', 'spoken'],
        count: 6,
      });
      if (userId) await invalidateChapters(userId, bookId);
      if (n > 0) {
        router.push({ pathname: '/kaizen/book-quiz', params: { chapterId } });
      } else {
        Alert.alert(
          'No questions',
          'Could not generate questions for this chapter. Try again.',
        );
      }
    } catch {
      Alert.alert(
        'Generation failed',
        'Please check your connection and try again.',
      );
    } finally {
      setGeneratingId(null);
    }
  };

  const onMarkRead = async (chapterId: string) => {
    try {
      await markRead(chapterId);
      if (userId) await invalidateChapters(userId, bookId);
    } catch {
      // store surfaces errors; ignore here
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete book', `Remove "${book.title}" and its questions?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteBook(book.id)
            .then(async () => {
              if (userId) {
                await invalidateBooks(userId);
                await invalidateChapters(userId, book.id);
              }
              router.back();
            })
            .catch(() => undefined);
        },
      },
    ]);
  };

  return (
    <KaizenScreen
      title={book.title}
      subtitle={book.author ?? undefined}
      showBackButton
    >
      <CommandCenterCard tint={colors.primary}>
        <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>
          {chapters.length} chapter{chapters.length === 1 ? '' : 's'}
        </Text>
        <Text style={[styles.heroMeta, { color: colors.textSecondary }]}>
          Read a chapter, then generate a comprehension check to see if it
          settled.
        </Text>
      </CommandCenterCard>

      <CommandCenterCard>
        {book.source_type === 'pdf' && book.file_object_key ? (
          <Text style={{ color: colors.textSecondary }}>
            📄 PDF attached{book.file_name ? `: ${book.file_name}` : ''}.
            Chapters are grounded in the real text.
          </Text>
        ) : (
          <>
            <Text style={[styles.sourceTitle, { color: colors.textPrimary }]}>
              Attach the book PDF (optional)
            </Text>
            <Text
              style={{
                color: colors.textSecondary,
                marginTop: 4,
                marginBottom: Spacing.md,
              }}
            >
              Questions get grounded in the real chapter text instead of the
              title alone.
            </Text>
            <KaizenImportUploadSection
              purpose="book"
              bookId={bookId}
              navigateAfterImport={false}
            />
          </>
        )}
      </CommandCenterCard>

      <Section title="Chapters">
        {chapters.length === 0 ? (
          <EmptyState>This book has no chapters yet.</EmptyState>
        ) : (
          chapters.map(chapter => {
            const count = questionCountFor(chapter.id);
            const isRead = Boolean(chapter.read_at);
            const busy = generatingId === chapter.id;
            return (
              <View
                key={chapter.id}
                style={[
                  styles.chapterRow,
                  { borderBottomColor: colors.borderColor },
                ]}
              >
                <Pressable
                  onPress={() => void onMarkRead(chapter.id)}
                  hitSlop={8}
                  style={styles.readToggle}
                >
                  <CompleteIcon
                    size={22}
                    color={
                      isRead ? colors.primary : colors.textSecondary
                    }
                  />
                </Pressable>
                <View style={styles.chapterText}>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 16,
                      fontWeight: '500',
                    }}
                  >
                    {chapter.chapter_index + 1}. {chapter.title}
                  </Text>
                  <Text
                    style={[
                      kaizenStyles.detail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {count > 0 ? `${count} questions` : 'No questions yet'}
                    {isRead ? ' · read' : ''}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/kaizen/book-reader',
                        params: { chapterId: chapter.id },
                      })
                    }
                    style={[
                      styles.actionPill,
                      { backgroundColor: appColors.pillBackground },
                    ]}
                  >
                    <LibraryIcon size={16} color={colors.primary} />
                    <Text
                      style={{ color: colors.primary, fontWeight: '700' }}
                    >
                      Read
                    </Text>
                  </Pressable>
                  {count > 0 ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/kaizen/book-quiz',
                          params: { chapterId: chapter.id },
                        })
                      }
                      style={[
                        styles.actionPill,
                        { backgroundColor: appColors.surfaceSelected },
                      ]}
                    >
                      <NotesIcon size={16} color={colors.primary} />
                      <Text
                        style={{
                          color: colors.primary,
                          fontWeight: '700',
                        }}
                      >
                        Check
                      </Text>
                    </Pressable>
                  ) : (
                    <Button
                      title={busy ? '' : 'Generate'}
                      loading={busy}
                      variant="secondary"
                      onPress={() => void onGenerate(chapter.id)}
                      style={styles.generateBtn}
                    />
                  )}
                </View>
              </View>
            );
          })
        )}
      </Section>

      <Pressable onPress={confirmDelete} style={styles.deleteLink} hitSlop={8}>
        <Text style={{ color: colors.error, fontWeight: '600' }}>
          Delete book
        </Text>
      </Pressable>

    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  heroTitle: { fontSize: 17, fontWeight: '700' },
  heroMeta: { marginTop: 4, fontSize: Typography.caption.size },
  sourceTitle: { fontSize: 15, fontWeight: '700' },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 62,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  readToggle: { paddingVertical: Spacing.xs },
  chapterText: { flex: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
    minHeight: 40,
  },
  generateBtn: { minWidth: 108 },
  deleteLink: {
    alignItems: 'center',
    paddingVertical: Spacing.base,
    marginTop: Spacing.sm,
  },
});
