#!/usr/bin/env node
/**
 * Batch-migrate `theme.colors.*` → `useAppColors()` (Track A / A7).
 * Safe for files that do not also read `theme.pastel` / `theme.spacing`.
 *
 * Usage: node scripts/migrate-theme-colors.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

const COLOR_PROP_MAP = {
  primary: 'primary',
  primaryLight: 'primaryDark',
  secondary: 'accent',
  background: 'backgroundMain',
  surface: 'backgroundSecondary',
  surfaceSecondary: 'groupedListBackground',
  error: 'error',
  success: 'success',
  warning: 'warning',
  text: 'textPrimary',
  textSecondary: 'textSecondary',
  textTertiary: 'textTertiary',
  border: 'borderColor',
  disabled: 'actionDisabled',
  placeholder: 'textTertiary',
  backdrop: 'modalBackdrop',
  notification: 'error',
};

function listTargets() {
  const out = execSync(
    `rg -l 'theme\\.colors' src --glob '*.tsx' --glob '*.ts'`,
    { cwd: ROOT, encoding: 'utf8' }
  );
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('__tests__') && f !== 'src/theme/appColors.ts');
}

function migrateFile(relPath) {
  const abs = path.join(ROOT, relPath);
  let src = fs.readFileSync(abs, 'utf8');
  if (!src.includes('theme.colors')) return { relPath, changed: false };

  let next = src;

  const sortedEntries = Object.entries(COLOR_PROP_MAP).sort(
    ([a], [b]) => b.length - a.length
  );
  for (const [from, to] of sortedEntries) {
    next = next.replaceAll(`theme.colors.${from}`, `colors.${to}`);
  }

  if (next === src) return { relPath, changed: false };

  const usesColors = next.includes('colors.');
  const hasUseAppColors = /useAppColors/.test(next);
  const hasUseTheme = /useTheme/.test(next);

  if (usesColors && !hasUseAppColors) {
    if (/from '@theme'/.test(next)) {
      next = next.replace(
        /from '@theme'/,
        (m) => m.replace("'@theme'", "'@theme'") // no-op anchor
      );
      next = next.replace(
        /import \{([^}]+)\} from '@theme';/,
        (match, inner) => {
          if (inner.includes('useAppColors')) return match;
          return `import {${inner.trim()}, useAppColors } from '@theme';`;
        }
      );
    } else if (/from "@theme"/.test(next)) {
      next = next.replace(
        /import \{([^}]+)\} from "@theme";/,
        (match, inner) => {
          if (inner.includes('useAppColors')) return match;
          return `import {${inner.trim()}, useAppColors } from "@theme";`;
        }
      );
    } else {
      next = `import { useAppColors } from '@theme';\n${next}`;
    }
  }

  if (usesColors) {
    // Inject `useAppColors()` into each function body that references `colors.`
    // but does not already declare it (handles nested sub-components).
    next = next.replace(
      /((?:export )?(?:async )?function \w+\([^)]*\)\s*(?::[^{]+)?\{)([\s\S]*?)(?=\n(?:export )?(?:async )?function |\nexport const |\nconst styles = StyleSheet|$)/g,
      (block, open, body) => {
        if (!/\bcolors\./.test(body) || /const colors = useAppColors\(\)/.test(body)) {
          return block;
        }
        return `${open}\n  const colors = useAppColors();${body}`;
      }
    );
    next = next.replace(
      /((?:export )?const \w+ = \([^)]*\)\s*(?::[^{]+)?=>\s*\{)([\s\S]*?)(?=\n(?:export )?(?:async )?function |\nexport const |\nconst styles = StyleSheet|$)/g,
      (block, open, body) => {
        if (!/\bcolors\./.test(body) || /const colors = useAppColors\(\)/.test(body)) {
          return block;
        }
        return `${open}\n  const colors = useAppColors();${body}`;
      }
    );
  }

  if (hasUseTheme && !/theme\./.test(next.replace(/theme\.colors/g, ''))) {
    next = next.replace(/import \{ useTheme \} from '@contexts\/ThemeContext';\n/, '');
    next = next.replace(/import \{ useTheme \} from "@contexts\/ThemeContext";\n/, '');
    next = next.replace(/\s*const \{ theme \} = useTheme\(\);\n/, '');
    next = next.replace(/\s*const theme = useTheme\(\)\.theme;\n/, '');
  }

  if (next !== src) {
    if (!DRY_RUN) fs.writeFileSync(abs, next);
    return { relPath, changed: true };
  }
  return { relPath, changed: false };
}

const results = listTargets().map(migrateFile);
const changed = results.filter((r) => r.changed);
const skipped = results.filter((r) => r.skipped);

console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}Migrated ${changed.length} files; skipped ${skipped.length} (non-color theme usage)`
);
for (const r of changed) console.log('  ✓', r.relPath);
