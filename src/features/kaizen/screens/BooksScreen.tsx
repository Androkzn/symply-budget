import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@components/ui';
import { LibraryIcon, LearningIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useInvalidateKaizenBooks, useKaizenBooks } from '@features/kaizen/hooks/useKaizenBooks';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { CornerRadius, Spacing, Typography } from '@features/kaizen/theme/designTokens';
import { KaizenImportUploadSection } from '@features/kaizen/upload/KaizenImportUploadSection';
import { useAuthStore } from '@stores/authStore';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

/** Languages offered for the per-book reading/answer language. */
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];

/** Parse a pasted table of contents into chapters — one non-empty line each. */
function parseToc(raw: string): Array<{ title: string }> {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(title => ({ title }));
}

export function BooksScreen() {
  const colors = useAppColors();  const appColors = useAppColors();
  const userId = useAuthStore(state => state.user?.id);
  const { data: activeBooks = [] } = useKaizenBooks();
  const invalidateBooks = useInvalidateKaizenBooks();
  const addBook = useKaizenStore(state => state.addBook);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('en');
  const [toc, setToc] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const heroIconState = useBrandIconState(true);

  const add = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const chapters = parseToc(toc);
      const bookId = await addBook({
        title: title.trim(),
        author: author.trim() || undefined,
        language,
        sourceType: 'toc_only',
        chapters,
      });
      if (userId) {
        await invalidateBooks(userId);
      }
      setTitle('');
      setAuthor('');
      setToc('');
      setShowForm(false);
      router.push({ pathname: '/kaizen/book', params: { bookId } });
    } catch {
      // Keep the register form open when add fails.
    } finally {
      setSaving(false);
    }
  };

  return (
    <KaizenScreen
      title="Books"
      subtitle="Register a book, then check that each chapter really settled."
      showBackButton
    >
      <CommandCenterCard tint={colors.primary}>
        <View style={styles.heroRow}>
          <LibraryIcon size={26} state={heroIconState} />
          <View style={styles.heroText}>
            <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>Your library</Text>
            <Text style={[styles.heroMeta, { color: colors.textSecondary }]}>
              {activeBooks.length} book{activeBooks.length === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
        <Button
          title={showForm ? 'Cancel' : 'Add a book'}
          variant={showForm ? 'secondary' : 'primary'}
          onPress={() => setShowForm(v => !v)}
          style={styles.heroCta}
        />
      </CommandCenterCard>

      <Section title="Upload book PDF">
        <KaizenImportUploadSection purpose="book" navigateAfterImport={false} />
      </Section>

      {showForm ? (
        <CommandCenterCard>
          <Text style={[styles.label, { color: colors.textSecondary }]}>NEW BOOK</Text>
          <View style={styles.form}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Book title"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, inputStyle(appColors)]}
            />
            <TextInput
              value={author}
              onChangeText={setAuthor}
              placeholder="Author (optional)"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, inputStyle(appColors)]}
            />
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Language</Text>
            <View style={styles.langRow}>
              {LANGUAGES.map(l => (
                <Pressable
                  key={l.code}
                  onPress={() => setLanguage(l.code)}
                  style={[
                    styles.langPill,
                    {
                      backgroundColor:
                        language === l.code ? appColors.surfaceSelected : appColors.pillBackground,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: language === l.code ? colors.primary : colors.textSecondary,
                      fontWeight: '600',
                      fontSize: Typography.caption.size,
                    }}
                  >
                    {l.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Table of contents (one chapter per line)
            </Text>
            <TextInput
              value={toc}
              onChangeText={setToc}
              placeholder={'1. Introduction\n2. The First Principle\n3. ...'}
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[styles.input, styles.textarea, inputStyle(appColors)]}
            />
            <Button
              title="Add book"
              loading={saving}
              disabled={!title.trim()}
              onPress={() => void add()}
            />
          </View>
        </CommandCenterCard>
      ) : null}

      <Section title="Library">
        {activeBooks.length === 0 ? (
          <EmptyState>Add a book to start checking your comprehension.</EmptyState>
        ) : (
          activeBooks.map(book => (
            <Pressable
              key={book.id}
              style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}
              onPress={() => router.push({ pathname: '/kaizen/book', params: { bookId: book.id } })}
            >
              <LearningIcon size={22} color={colors.primary} />
              <View style={kaizenStyles.rowText}>
                <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '500' }}>
                  {book.cover_emoji ? `${book.cover_emoji}  ` : ''}
                  {book.title}
                </Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {book.author ? `${book.author} · ` : ''}
                  {(LANGUAGES.find(l => l.code === book.language)?.label ?? book.language)}
                </Text>
              </View>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Open</Text>
            </Pressable>
          ))
        )}
      </Section>
    </KaizenScreen>
  );
}

function inputStyle(appColors: ReturnType<typeof useAppColors>) {
  return {
    color: appColors.textPrimary,
    borderColor: appColors.glassBorder,
    backgroundColor: appColors.inputFieldBackground,
  };
}

const styles = StyleSheet.create({
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroText: { flex: 1 },
  heroTitle: { fontSize: 17, fontWeight: '700' },
  heroMeta: { marginTop: 2, fontSize: Typography.caption.size },
  heroCta: { marginTop: Spacing.base },
  label: {
    fontSize: Typography.caption.size,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
  },
  fieldLabel: { fontSize: Typography.caption.size, fontWeight: '600', marginBottom: -Spacing.xs },
  form: { gap: Spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    fontSize: Typography.body.size,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  textarea: { minHeight: 120, textAlignVertical: 'top' },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  langPill: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.md,
  },
});
