/**
 * MarkdownText — lightweight markdown renderer for assistant chat bubbles.
 *
 * Aihousekeeper's prompts emit a small subset of markdown:
 *   - `**bold**`
 *   - `- ` bullet list items
 *   - blank line paragraph breaks
 *
 * A full markdown parser (react-native-markdown-display, etc.) is overkill
 * for this surface and would add ~30 KB + a pod install. This handles the
 * three patterns above and falls back to plain text for everything else,
 * so an unrecognized token (e.g. inline code) renders as the raw chars
 * rather than crashing.
 *
 * Reuses chat typography from `@theme` so font sizing/colors stay in sync
 * with the surrounding bubble.
 */

import React from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { Spacing, useAppColors } from '@theme';

interface Props {
  text: string;
  /** Foreground color (defaults to `useAppColors().textPrimary`). */
  color?: string;
  /** Pass-through font size override (matches Typography variant="body" = 17). */
  fontSize?: number;
}

export function MarkdownText({ text, color, fontSize = 17 }: Props) {
  const colors = useAppColors();
  const fg = color ?? colors.textPrimary;
  const baseStyle: TextStyle = { color: fg, fontSize, lineHeight: fontSize * 1.35 };

  // Split into blocks on blank lines. Each block is either a bullet list
  // (every non-empty line starts with "- ") or a paragraph.
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  return (
    <View>
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        const isBulletList = lines.every((l) => l.trim().startsWith('- '));
        if (isBulletList) {
          return (
            <View key={i} style={i > 0 ? styles.blockSpacing : undefined}>
              {lines.map((line, j) => (
                <View key={j} style={styles.bulletRow}>
                  <Text style={[baseStyle, styles.bullet]}>•</Text>
                  <Text style={[baseStyle, styles.bulletText]}>
                    {renderInline(line.replace(/^-\s+/, ''), baseStyle)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text
            key={i}
            style={[baseStyle, i > 0 ? styles.blockSpacing : undefined]}
          >
            {renderInline(block, baseStyle)}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * Render inline `**bold**` segments. Returns an array of <Text> children
 * suitable for passing directly into a parent <Text>.
 */
function renderInline(line: string, baseStyle: TextStyle): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Match **bold** spans. Non-greedy so adjacent bold groups don't merge.
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    parts.push(
      <Text key={`b${key++}`} style={[baseStyle, styles.bold]}>
        {match[1]}
      </Text>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  // Avoid returning an empty array — a single empty string keeps the
  // parent Text from collapsing in some RN versions.
  return parts.length > 0 ? parts : [line];
}

const styles = StyleSheet.create({
  bold: { fontWeight: '600' },
  blockSpacing: { marginTop: Spacing.sm },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    width: Spacing.base, // 16pt — fixed gutter for bullet glyph
  },
  bulletText: {
    flex: 1,
  },
});

export default MarkdownText;
