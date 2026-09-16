#!/usr/bin/env node
/**
 * Route every `<Ionicons …>` JSX site through the shared `<Icon>` primitive.
 * `<Icon>` decides per-call whether to render the branded PNG (brand/neutral
 * colors) or keep the tinted Ionicons glyph (white / semantic / unmapped), so
 * this swap is visually safe.
 *
 *   node scripts/codemod-ionicons-to-icon.mjs [--dry]
 *
 * Excludes the icon-system internals (Icon.tsx, BrandSymbol.tsx). Keeps the
 * `Ionicons` import where the file still uses it in non-JSX ways
 * (`typeof Ionicons`, `Ionicons.glyphMap`, …).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'src');
const DRY = process.argv.includes('--dry');

const EXCLUDE = new Set([
  path.join(SRC, 'components/ui/Icon.tsx'),
  path.join(SRC, 'components/common/BrandSymbol.tsx'),
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

function removeIoniconsSpecifier(src) {
  const re = /import\s*{([^}]*)}\s*from\s*(['"])@expo\/vector-icons\2\s*;?/;
  const m = src.match(re);
  if (!m) return { src, vectorLine: null };
  const specifiers = m[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s !== 'Ionicons');
  const vectorLine = specifiers.length
    ? `import { ${specifiers.join(', ')} } from '@expo/vector-icons';`
    : '';
  return { src, vectorLine, matched: m[0], re };
}

let changed = 0;
let skipped = 0;
const touched = [];

for (const file of walk(SRC)) {
  if (EXCLUDE.has(file)) {
    skipped++;
    continue;
  }
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes('<Ionicons')) continue;

  // 1) Swap the JSX tags.
  src = src.replace(/<Ionicons\b/g, '<Icon').replace(/<\/Ionicons>/g, '</Icon>');

  // 2) Does the file still reference `Ionicons` outside import lines?
  const nonImport = src
    .split('\n')
    .filter(l => !/^\s*import\b/.test(l))
    .join('\n');
  const stillUsesIonicons = /\bIonicons\b/.test(nonImport);

  // 3) Fix the @expo/vector-icons import.
  const { vectorLine, matched, re } = removeIoniconsSpecifier(src);
  const alreadyImportsIcon =
    /import\s*{[^}]*\bIcon\b[^}]*}\s*from\s*(['"])@components\/ui(\/Icon)?\1/.test(
      src,
    );
  const iconImport = alreadyImportsIcon
    ? ''
    : "import { Icon } from '@components/ui/Icon';";

  if (matched != null && !stillUsesIonicons) {
    // Replace the vector-icons import line with (kept specifiers) + Icon import.
    const replacement = [vectorLine, iconImport].filter(Boolean).join('\n');
    src = src.replace(re, replacement);
  } else if (iconImport) {
    // Keep Ionicons import; just add the Icon import right after the vector line
    // (or after the first import if the vector line wasn't a simple match).
    if (matched != null) {
      src = src.replace(re, `${matched.replace(/;?$/, ';')}\n${iconImport}`);
    } else {
      src = src.replace(/(^import[^\n]*\n)/m, `$1${iconImport}\n`);
    }
  }

  if (!DRY) fs.writeFileSync(file, src);
  changed++;
  touched.push(path.relative(REPO, file));
}

console.log(
  `${DRY ? '[dry] ' : ''}rewrote ${changed} files, skipped ${skipped} excluded.`,
);
if (DRY) touched.slice(0, 12).forEach(f => console.log('  ' + f));
