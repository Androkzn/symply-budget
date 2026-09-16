/**
 * Static scroll contract — every vertical ScrollView in *Screen.tsx files must
 * use flex: 1 so content scrolls inside header + tab bar layouts on device.
 */

import fs from 'fs';
import path from 'path';

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '__tests__', 'dist'].includes(entry.name)) {
        walk(full, files);
      }
    } else if (/Screen\.tsx$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** Every .tsx under `dir` (the gap rule below applies to components too). */
function walkTsx(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '__tests__', 'dist'].includes(entry.name)) {
        walkTsx(full, files);
      }
    } else if (entry.name.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

function parseStyleSheet(src: string): Record<string, string> {
  const styles: Record<string, string> = {};
  const idx = src.indexOf('StyleSheet.create');
  if (idx < 0) return styles;

  let i = src.indexOf('{', idx);
  let depth = 0;
  let start = -1;

  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      depth++;
      if (depth === 1) start = i + 1;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        const body = src.slice(start, i);
        const keyRe = /(\w+):\s*\{/g;
        let m: RegExpExecArray | null;
        while ((m = keyRe.exec(body))) {
          const name = m[1];
          let j = m.index + m[0].length;
          let d = 1;
          let block = '';
          while (j < body.length && d > 0) {
            const ch = body[j++];
            if (ch === '{') d++;
            else if (ch === '}') d--;
            else if (d === 1) block += ch;
          }
          styles[name] = block;
        }
        break;
      }
    }
  }
  return styles;
}

function styleExprHasFlex1(expr: string | null, styles: Record<string, string>): boolean {
  if (!expr) return false;
  if (/flex\s*:\s*1|kaizenScrollViewStyle|screenScrollViewStyle|styles\.flex\b/.test(expr)) {
    return true;
  }
  const names = [...expr.matchAll(/styles\.(\w+)/g)].map((x) => x[1]);
  return names.some((n) => /flex\s*:\s*1/.test(styles[n] ?? ''));
}

/**
 * A modal picker / bottom-sheet list is sized by its CONTENT under an explicit
 * cap (`maxHeight`, `flexGrow: 0`, `flexShrink`), not by the screen. `flex: 1`
 * is actively wrong there — inside an auto-height modal it collapses the
 * ScrollView to zero height and the sheet renders empty (see the comment on
 * `modalScroll` in SavingsRecurringPaymentsScreen). The rule above is about
 * FULL-SCREEN scrollers, so exempt the capped ones.
 */
function isHeightCappedScroller(expr: string | null, styles: Record<string, string>): boolean {
  if (!expr) return false;
  const capped = /maxHeight|flexGrow\s*:\s*0|flexShrink/;
  if (capped.test(expr)) return true;
  const names = [...expr.matchAll(/styles\.(\w+)/g)].map((x) => x[1]);
  return names.some((n) => capped.test(styles[n] ?? ''));
}

function findScrollViewOpenTags(src: string): string[] {
  const tags: string[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = line.search(/<ScrollView\b/);
    if (start < 0) continue;
    // Skip TS generics such as useRef<ScrollView>(null).
    if (!/^\s*</.test(line.slice(0, start + 1))) continue;

    let tag = line.slice(start);
    while (!/>\s*$/.test(tag) && !/\/>/.test(tag) && i + 1 < lines.length) {
      i++;
      tag += `\n${lines[i]}`;
    }
    tags.push(tag);
  }
  return tags;
}

function findVerticalScrollIssues(src: string): string[] {
  const styles = parseStyleSheet(src);
  const issues: string[] = [];

  findScrollViewOpenTags(src).forEach((tag, index) => {
    if (/horizontal(?:\s|=)/.test(tag)) return;

    const style = tag.match(/style=\{([\s\S]*?)\}/);
    const expr = style ? style[1].trim() : null;
    if (isHeightCappedScroller(expr, styles)) return;
    if (!styleExprHasFlex1(expr, styles)) {
      issues.push(`ScrollView #${index + 1} missing flex: 1 (${expr ?? 'no style'})`);
    }
  });

  return issues;
}

/**
 * A `gap` on a ScrollView's contentContainerStyle only spaces that container's
 * DIRECT children. When the ScrollView wraps everything in one element —
 * `<AdaptiveContainer>`, `<View>` — the gap has a single child to space, so it
 * silently does nothing and every card inside stacks flush. (Arrays from
 * `.map()` and fragments are fine: they flatten into multiple host children.)
 * The fix is always to move the gap onto the wrapper itself.
 */
function findInertGapIssues(src: string): string[] {
  const styles = parseStyleSheet(src);
  const lines = src.split('\n');
  const issues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const openIdx = lines[i].search(/<ScrollView\b/);
    if (openIdx < 0 || !/^\s*</.test(lines[i].slice(0, openIdx + 1))) continue;

    // Collect the whole opening tag.
    let end = i;
    let tag = lines[i];
    while (!/>\s*$/.test(tag.trim()) && end + 1 < lines.length) {
      end++;
      tag += `\n${lines[end]}`;
    }
    if (/\/>\s*$/.test(tag.trim())) continue; // self-closing: no children

    const ccs = tag.match(/contentContainerStyle=\{([\s\S]*?)\}\}?/);
    if (!ccs) continue;
    const gapped = [...ccs[1].matchAll(/styles\.(\w+)/g)]
      .map((m) => m[1])
      .filter((n) => /(^|[\s,])(gap|rowGap)\s*:/.test(styles[n] ?? ''));
    if (!gapped.length) continue;

    // Direct children sit one indent level in from the ScrollView tag.
    const indent = lines[i].length - lines[i].trimStart().length;
    const children: string[] = [];
    for (let j = end + 1; j < lines.length; j++) {
      const text = lines[j].trim();
      const cur = lines[j].length - lines[j].trimStart().length;
      if (text.startsWith('</') && cur <= indent) break;
      if (!text || text.startsWith('{/*')) continue;
      if (cur === indent + 2 && (text.startsWith('{') || /^<[A-Za-z]/.test(text))) {
        children.push(text);
      }
    }
    // One child that is a real element (not an array/fragment expression) means
    // the gap is applied to a container that has nothing to space.
    if (children.length === 1 && /^<[A-Za-z]/.test(children[0])) {
      const wrapper = children[0].match(/^<([A-Za-z]\w*)/)?.[1] ?? 'element';
      issues.push(`gap on styles.${gapped[0]} is inert — its only child is <${wrapper}>`);
    }
  }

  return issues;
}

/**
 * A scroller that CONTAINS a text field must carry `keyboardDismissScrollProps`
 * (i.e. `automaticallyAdjustKeyboardInsets`). Without it the keypad opens on top
 * of the field that summoned it and nothing scrolls it back into view — see the
 * long note in `src/utils/keyboard.ts`. A `KeyboardAvoidingView` wrapper does
 * NOT satisfy this: it shrinks the viewport without moving the content.
 *
 * Deliberately literal: it only looks for a `<TextInput>` written inside the
 * scroller's own subtree. Fields reached through a variable (`{formContent}`)
 * are invisible here, so this under-reports rather than crying wolf.
 */
function findUncoveredKeyboardScrollers(src: string): string[] {
  const issues: string[] = [];
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const openIdx = lines[i].search(/<ScrollView\b/);
    if (openIdx < 0 || !/^\s*</.test(lines[i].slice(0, openIdx + 1))) continue;

    let end = i;
    let tag = lines[i];
    while (!/>\s*$/.test(tag.trim()) && end + 1 < lines.length) {
      end++;
      tag += `\n${lines[end]}`;
    }
    if (/\/>\s*$/.test(tag.trim())) continue;
    if (/horizontal(?:\s|=)/.test(tag)) continue;
    if (/keyboardDismissScrollProps|automaticallyAdjustKeyboardInsets/.test(tag)) continue;

    // An explicit, explained opt-out is a decision, not a defect.
    const preamble = lines.slice(Math.max(0, i - 6), i).join('\n');
    if (/No `automaticallyAdjustKeyboardInsets`/.test(preamble)) continue;

    // Walk to the matching close tag and look for a field inside it.
    let depth = 1;
    let body = '';
    for (let j = end + 1; j < lines.length && depth > 0; j++) {
      if (/<ScrollView\b/.test(lines[j])) depth++;
      if (/<\/ScrollView>/.test(lines[j])) {
        depth--;
        if (depth === 0) break;
      }
      body += `${lines[j]}\n`;
    }
    if (/<(TextInput|RNTextInput|BottomSheetTextInput)\b/.test(body)) {
      issues.push(`ScrollView at line ${i + 1} holds a text field but not keyboardDismissScrollProps`);
    }
    // A shell that scrolls `{children}` cannot know what it was handed. Symply
    // Kaizen's `KaizenScreen` is the case that proved it: seventeen screens put
    // their fields through it, the literal check above saw none of them, and the
    // keypad covered the field on every one.
    if (/\{\s*children\s*\}/.test(body)) {
      issues.push(
        `ScrollView at line ${i + 1} scrolls {children} — a caller's text field would be occluded`
      );
    }
  }

  return issues;
}

/**
 * `numbers-and-punctuation` carries an `ABC` key, so it is never the keypad for
 * a number — that is the Budget savings-goal defect this contract exists for.
 *
 * Only a genuinely mixed string may raise it, and the one in this codebase is an
 * imperial length (`7' 8"`), which reaches a field through `lengthKeyboardType`
 * rather than a literal prop. So a literal is always a mistake.
 */
function findLettersOnANumberKeypad(src: string): string[] {
  const issues: string[] = [];
  src.split('\n').forEach((line, i) => {
    if (/keyboardType=\s*(?:"numbers-and-punctuation"|\{\s*'numbers-and-punctuation'\s*\})/.test(line)) {
      issues.push(`line ${i + 1} raises a letters-capable keypad on a number field`);
    }
  });
  return issues;
}

describe('App scroll contract (static)', () => {
  it('no ScrollView declares a gap that its single wrapper child makes inert', () => {
    const roots = [path.join(process.cwd(), 'src'), path.join(process.cwd(), 'app')];
    const violations: string[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const file of walkTsx(root)) {
        const src = fs.readFileSync(file, 'utf8');
        if (!src.includes('<ScrollView')) continue;
        const issues = findInertGapIssues(src);
        if (issues.length) {
          violations.push(`${path.relative(process.cwd(), file)}: ${issues.join('; ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('every ScrollView containing a text field carries keyboardDismissScrollProps', () => {
    const roots = [path.join(process.cwd(), 'src'), path.join(process.cwd(), 'app')];
    const violations: string[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const file of walkTsx(root)) {
        const src = fs.readFileSync(file, 'utf8');
        if (!src.includes('<ScrollView')) continue;
        const issues = findUncoveredKeyboardScrollers(src);
        if (issues.length) {
          violations.push(`${path.relative(process.cwd(), file)}: ${issues.join('; ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('no field raises a letters-capable keypad for a number', () => {
    const roots = [path.join(process.cwd(), 'src'), path.join(process.cwd(), 'app')];
    const violations: string[] = [];

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const file of walkTsx(root)) {
        const issues = findLettersOnANumberKeypad(fs.readFileSync(file, 'utf8'));
        if (issues.length) {
          violations.push(`${path.relative(process.cwd(), file)}: ${issues.join('; ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('every vertical ScrollView in Screen.tsx files uses flex: 1', () => {
    const root = path.join(process.cwd(), 'src');
    const violations: string[] = [];

    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('<ScrollView')) continue;
      const issues = findVerticalScrollIssues(src);
      if (issues.length) {
        violations.push(`${path.relative(root, file)}: ${issues.join('; ')}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
