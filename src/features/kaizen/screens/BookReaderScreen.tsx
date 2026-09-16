import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ScreenFooterGlass } from '@components/common';
import { Button } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useTheme } from '@contexts/ThemeContext';
import { NotesIcon, SkippedIcon } from '@features/kaizen/brand/iconset';
import { CommandCenterCard } from '@features/kaizen/components/CommandCenter';
import { useKaizenBooks } from '@features/kaizen/hooks/useKaizenBooks';
import { selectBookById } from '@features/kaizen/stores/kaizenSelectors';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import {
  CornerRadius,
  Spacing,
  Typography,
} from '@features/kaizen/theme/designTokens';
import type { KaizenBookHighlightEntry } from '@features/kaizen/types';
import { useLayoutPadding } from '@hooks/useLayoutPadding';

import { EmptyState, KaizenScreen, Section } from './common';

/** Default highlighter color applied to new highlights. */
const HIGHLIGHT_COLOR = '#FFD54A';

function firstParam(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

/** Escape user/book text for safe embedding into the reader HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Parse a highlight anchor (`{"start":n,"end":n}`) into char offsets, if valid. */
function parseAnchor(
  raw: string | null,
): { start: number; end: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { start?: unknown; end?: unknown };
    if (
      typeof parsed.start === 'number' &&
      typeof parsed.end === 'number' &&
      parsed.end > parsed.start
    ) {
      return { start: parsed.start, end: parsed.end };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a self-contained, theme-aware reflowable reader page. The injected
 * script (a) posts the selected text + character offsets on selection, and
 * (b) re-wraps existing highlight ranges in `<mark>` on load. Offsets are
 * character positions into the concatenation of the reader's text nodes, kept
 * self-consistent between the select-time and re-apply-time DOM walks.
 */
function buildReaderHtml(
  text: string,
  highlights: KaizenBookHighlightEntry[],
  colors: { background: string; text: string; accent: string; isDark: boolean },
): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(block => block.length > 0)
    .map(block => `<p>${escapeHtml(block).replace(/\n+/g, ' ')}</p>`)
    .join('');

  const marks = highlights
    .map(entry => {
      const anchor = parseAnchor(entry.anchor);
      if (!anchor) return null;
      return {
        start: anchor.start,
        end: anchor.end,
        color: entry.color || colors.accent,
      };
    })
    .filter(
      (mark): mark is { start: number; end: number; color: string } =>
        mark !== null,
    );

  const marksJson = JSON.stringify(marks).replace(/</g, '\\u003c');
  const accentJson = JSON.stringify(colors.accent);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  :root { color-scheme: ${colors.isDark ? 'dark' : 'light'}; }
  html, body { margin: 0; padding: 0; }
  body {
    background: ${colors.background};
    color: ${colors.text};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 18px;
    line-height: 1.72;
    -webkit-text-size-adjust: 100%;
    -webkit-tap-highlight-color: transparent;
  }
  .reader { max-width: 40rem; margin: 0 auto; padding: 20px 20px 64px; }
  p { margin: 0 0 1.1em; }
  mark.hl {
    color: inherit;
    border-radius: 3px;
    padding: 0 1px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  ::selection { background: ${colors.accent}66; }
</style>
</head>
<body>
<div class="reader" id="reader">${paragraphs}</div>
<script>
(function () {
  var HIGHLIGHTS = ${marksJson};
  var DEFAULT_COLOR = ${accentJson};
  var root = document.getElementById('reader');
  function post(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }
  function textNodes() {
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) { nodes.push(node); }
    return nodes;
  }
  function offsetOf(node, offset) {
    var range = document.createRange();
    range.selectNodeContents(root);
    try { range.setEnd(node, offset); } catch (e) { return 0; }
    return range.toString().length;
  }
  function applyHighlight(start, end, color) {
    if (typeof start !== 'number' || typeof end !== 'number' || end <= start) return;
    var nodes = textNodes();
    var pos = 0;
    var segs = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var len = node.nodeValue.length;
      var nodeStart = pos;
      var nodeEnd = pos + len;
      pos = nodeEnd;
      if (nodeEnd <= start || nodeStart >= end) continue;
      if (node.parentNode && node.parentNode.nodeName === 'MARK') continue;
      segs.push({
        node: node,
        s: Math.max(start, nodeStart) - nodeStart,
        e: Math.min(end, nodeEnd) - nodeStart,
      });
    }
    for (var j = 0; j < segs.length; j++) {
      var seg = segs[j];
      try {
        var wrap = document.createRange();
        wrap.setStart(seg.node, seg.s);
        wrap.setEnd(seg.node, seg.e);
        var mark = document.createElement('mark');
        mark.className = 'hl';
        mark.style.backgroundColor = color || DEFAULT_COLOR;
        wrap.surroundContents(mark);
      } catch (err) {}
    }
  }
  function renderHighlights() {
    for (var i = 0; i < HIGHLIGHTS.length; i++) {
      applyHighlight(HIGHLIGHTS[i].start, HIGHLIGHTS[i].end, HIGHLIGHTS[i].color);
    }
  }
  var lastSent = '';
  function onSelect() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var str = sel.toString();
    if (!str || !str.trim()) return;
    var range = sel.getRangeAt(0);
    var start = offsetOf(range.startContainer, range.startOffset);
    var end = offsetOf(range.endContainer, range.endOffset);
    if (end < start) { var swap = start; start = end; end = swap; }
    var key = start + ':' + end;
    if (key === lastSent) return;
    lastSent = key;
    post({ type: 'select', text: str, start: start, end: end });
  }
  document.addEventListener('selectionchange', function () { setTimeout(onSelect, 10); });
  document.addEventListener('touchend', function () { setTimeout(onSelect, 10); });
  renderHighlights();
})();
</script>
</body>
</html>`;
}

type PendingSelection = { text: string; start: number; end: number };

export function BookReaderScreen() {
  const colors = useAppColors();
  const { content: containerPadding } = useLayoutPadding();
  const params = useLocalSearchParams<{ chapterId?: string }>();
  const chapterId = firstParam(params.chapterId);
  const { isDark } = useTheme();
  const appColors = useAppColors();
  const { height: windowHeight } = useWindowDimensions();

  const { data: books = [] } = useKaizenBooks();
  const chapter = useKaizenStore(state =>
    state.bookChapters.find(c => c.id === chapterId),
  );
  const bookId = chapter?.book_id ?? '';
  const book = selectBookById(books, bookId);
  const allHighlights = useKaizenStore(state => state.bookHighlights);
  const readChapterText = useKaizenStore(state => state.readChapterText);
  const addBookHighlight = useKaizenStore(state => state.addBookHighlight);
  const deleteBookHighlight = useKaizenStore(
    state => state.deleteBookHighlight,
  );
  const generateQuestions = useKaizenStore(
    state => state.generateBookChapterQuestions,
  );

  const highlights = useMemo(
    () =>
      allHighlights
        .filter(h => h.chapter_id === chapterId && !h.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [allHighlights, chapterId],
  );

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [quizzing, setQuizzing] = useState(false);

  useEffect(() => {
    if (!chapterId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    readChapterText(chapterId)
      .then(result => {
        if (active) setText(result);
      })
      .catch(() => {
        if (active) setText('');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chapterId, readChapterText]);

  const html = useMemo(
    () =>
      buildReaderHtml(text, highlights, {
        background: colors.backgroundMain,
        text: colors.textPrimary,
        accent: colors.primary,
        isDark,
      }),
    [
      text,
      highlights,
      colors.backgroundMain,
      colors.textPrimary,
      colors.primary,
      isDark,
    ],
  );

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        text?: string;
        start?: number;
        end?: number;
      };
      if (
        msg.type === 'select' &&
        msg.text &&
        typeof msg.start === 'number' &&
        typeof msg.end === 'number'
      ) {
        setPending({ text: msg.text, start: msg.start, end: msg.end });
      }
    } catch {
      // Ignore malformed bridge messages.
    }
  };

  const onHighlight = async () => {
    if (!pending || !bookId) return;
    setSaving(true);
    try {
      await addBookHighlight({
        bookId,
        chapterId,
        text: pending.text,
        anchor: JSON.stringify({ start: pending.start, end: pending.end }),
        color: HIGHLIGHT_COLOR,
      });
      setPending(null);
    } catch {
      Alert.alert('Could not save', 'Please try highlighting again.');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteHighlight = (id: string) => {
    void deleteBookHighlight(id);
  };

  const onQuizHighlights = async () => {
    if (highlights.length === 0) {
      Alert.alert(
        'No highlights yet',
        'Highlight a few passages first, then quiz yourself on them.',
      );
      return;
    }
    setQuizzing(true);
    try {
      const n = await generateQuestions(chapterId, {
        types: ['mcq', 'open'],
        count: 6,
        highlightIds: highlights.map(h => h.id),
      });
      if (n > 0) {
        router.push({ pathname: '/kaizen/book-quiz', params: { chapterId } });
      } else {
        Alert.alert(
          'No questions',
          'Could not build a quiz from these highlights. Try again.',
        );
      }
    } catch {
      Alert.alert(
        'Generation failed',
        'Please check your connection and try again.',
      );
    } finally {
      setQuizzing(false);
    }
  };

  if (!chapter) {
    return (
      <KaizenScreen title="Reader" showBackButton>
        <EmptyState>This chapter is no longer available.</EmptyState>
      </KaizenScreen>
    );
  }

  const readerHeight = Math.max(340, Math.round(windowHeight * 0.6));

  return (
    <KaizenScreen
      title={book?.title ?? 'Reader'}
      subtitle={`${chapter.chapter_index + 1}. ${chapter.title}`}
      showBackButton
    >
      <CommandCenterCard>
        <View style={styles.actionRow}>
          <Button
            title={`My highlights (${highlights.length})`}
            variant="secondary"
            onPress={() => setShowHighlights(v => !v)}
            style={styles.actionBtn}
          />
          <Button
            title="Quiz me on my highlights"
            loading={quizzing}
            disabled={highlights.length === 0}
            onPress={() => void onQuizHighlights()}
            style={styles.actionBtn}
          />
        </View>
      </CommandCenterCard>

      {showHighlights ? (
        <Section title={`Highlights · ${highlights.length}`}>
          {highlights.length === 0 ? (
            <EmptyState>
              Select text in the reader below to save a highlight.
            </EmptyState>
          ) : (
            highlights.map(entry => (
              <View
                key={entry.id}
                style={[
                  styles.highlightRow,
                  { borderBottomColor: colors.borderColor },
                ]}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: entry.color || HIGHLIGHT_COLOR },
                  ]}
                />
                <Text
                  style={[styles.highlightText, { color: colors.textPrimary }]}
                  numberOfLines={3}
                >
                  {entry.text}
                </Text>
                <Pressable
                  onPress={() => onDeleteHighlight(entry.id)}
                  hitSlop={8}
                >
                  <SkippedIcon size={20} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))
          )}
        </Section>
      ) : null}

      {loading ? (
        <CommandCenterCard>
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text
              style={[
                styles.centeredText,
                { color: colors.textSecondary },
              ]}
            >
              Loading chapter…
            </Text>
          </View>
        </CommandCenterCard>
      ) : text.length === 0 ? (
        <EmptyState>
          No readable text yet — attach a PDF to this book to read it here.
        </EmptyState>
      ) : (
        <View
          style={[
            styles.readerContainer,
            {
              height: readerHeight,
              borderColor: appColors.glassBorder,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        >
          <WebView
            key={`${chapterId}:${highlights.length}`}
            originWhitelist={['*']}
            source={{ html }}
            onMessage={onMessage}
            style={styles.webview}
            showsVerticalScrollIndicator
          />
          {pending ? (
            <View
              style={[
                styles.selectionBar,
                { left: containerPadding, right: containerPadding },
              ]}
            >
              <ScreenFooterGlass />
              <View style={styles.selectionPreview}>
                <NotesIcon size={14} color={colors.primary} />
                <Text
                  style={[
                    styles.selectionText,
                    { color: colors.textSecondary },
                  ]}
                  numberOfLines={1}
                >
                  {pending.text}
                </Text>
              </View>
              <View style={styles.selectionActions}>
                <Button
                  title="Highlight"
                  loading={saving}
                  onPress={() => void onHighlight()}
                  style={styles.selectionBtn}
                />
                <Button
                  title="Cancel"
                  variant="secondary"
                  disabled={saving}
                  onPress={() => setPending(null)}
                  style={styles.selectionBtn}
                />
              </View>
            </View>
          ) : null}
        </View>
      )}
    </KaizenScreen>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1 },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.smd,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  highlightText: { flex: 1, fontSize: Typography.body.size, lineHeight: 20 },
  centered: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  centeredText: { fontSize: Typography.caption.size },
  readerContainer: {
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
    overflow: 'hidden',
    marginTop: Spacing.sm,
  },
  webview: { flex: 1, backgroundColor: 'transparent' },
  selectionBar: {
    position: 'absolute',
    bottom: Spacing.md,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    overflow: 'hidden',
  },
  selectionPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  selectionText: { flex: 1, fontSize: Typography.caption.size },
  selectionActions: { flexDirection: 'row', gap: Spacing.sm },
  selectionBtn: { flex: 1 },
});
