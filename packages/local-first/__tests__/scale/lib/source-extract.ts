/**
 * Brace-matched extraction of a named function from TypeScript source, used by
 * mirror-guard.test.ts to pin the product functions lib/mirror.ts copies.
 *
 * String literals and comments are skipped so a `{` inside `'…'` or `/* … *\/`
 * cannot end the body early. Template-literal interpolation is NOT parsed
 * (none of the five mirrored functions uses one); if a future mirror target
 * does, this needs extending rather than trusting.
 */
export function extractFunctionSource(source: string, name: string): string {
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`extractFunctionSource: no declaration of '${name}'`);

  const declStart = match.index + match[0].indexOf('function');
  const bodyStart = indexOfBodyBrace(source, declStart);
  const bodyEnd = matchBrace(source, bodyStart);
  return source.slice(declStart, bodyEnd + 1);
}

/** First `{` after the signature, skipping any inside the parameter list. */
function indexOfBodyBrace(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '{' && depth === 0) return i;
  }
  throw new Error('extractFunctionSource: no function body found');
}

function matchBrace(source: string, openAt: number): number {
  let depth = 0;
  let i = openAt;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i, ch);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new Error('extractFunctionSource: unbalanced braces');
}

function skipString(source: string, openAt: number, quote: string): number {
  let i = openAt + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  throw new Error('extractFunctionSource: unterminated string literal');
}

/**
 * Whitespace- and comment-insensitive form. Reformatting or a reworded comment
 * must not fire the guard; a changed statement must.
 */
export function normalizeSource(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}
