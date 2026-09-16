#!/usr/bin/env node
/**
 * One-off helper: migrate `new Date().toISOString()` → now()/nowIso() in backend/src.
 * Skips tests, schema defaults, and special cases (AWS sig dates).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../src');

const SKIP = new Set([
  path.join(ROOT, 'utils/id.ts'),
  path.join(ROOT, 'services/enhanced-pdf-processor.ts'),
]);

const SKIP_DIR_PARTS = ['__tests__', '/db/schema'];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function relImport(fromFile, target = '../utils/id') {
  const fromDir = path.dirname(fromFile);
  const absTarget = path.join(ROOT, 'utils/id.ts');
  let rel = path.relative(fromDir, absTarget).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel.replace(/\.ts$/, '');
}

function ensureImport(content, file) {
  if (/from ['"].*utils\/id['"]/.test(content)) return content;
  const importPath = relImport(file);
  const importLine = `import { now, nowIso } from '${importPath}';\n`;
  const lastImport = content.lastIndexOf('\nimport ');
  if (lastImport === -1) return importLine + content;
  const lineEnd = content.indexOf('\n', lastImport + 1);
  const insertAt = lineEnd === -1 ? content.length : lineEnd + 1;
  return content.slice(0, insertAt) + importLine + content.slice(insertAt);
}

function migrate(content) {
  let next = content;
  next = next.replace(/new Date\(\)\.toISOString\(\)/g, 'nowIso()');
  // Drop unused now import if only nowIso used — eslint may warn; keep both for simplicity.
  return next;
}

const files = walk(ROOT).filter((f) => {
  if (SKIP.has(f)) return false;
  if (SKIP_DIR_PARTS.some((p) => f.includes(p))) return false;
  if (f.includes('.test.ts')) return false;
  return true;
});

const changed = [];
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  if (!before.includes('new Date().toISOString()')) continue;
  let after = migrate(before);
  after = ensureImport(after, file);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed.push(path.relative(ROOT, file));
  }
}

console.log(JSON.stringify(changed, null, 2));
