/**
 * Aihousekeeper briefing HTML renderer — plan §B11.
 *
 * Uses Hono's html tagged template helper (escape-by-default). DOMPurify is
 * banned here because it fails on workerd (cloudflare/workerd#5752).
 *
 * ESLint-ban: no 'raw(' in this file — see plan §B11.
 * All user-supplied strings MUST flow through `${}` interpolation so they
 * are escaped. Any future need for pre-escaped HTML must do the escape
 * explicitly via `html\`${userContent}\`` and never reach for `raw()`.
 */

import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

export interface BriefingHtmlInput {
  paragraph: string;
  bullets: string[];
  date: string;
  householdName: string;
}

export function renderBriefingHtml(input: BriefingHtmlInput): string {
  const bullets = input.bullets.map((b) => html`<li>${b}</li>`);
  const rendered = html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${input.householdName} — ${input.date}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
      header { border-bottom: 1px solid #e2e2e2; padding-bottom: 1rem; margin-bottom: 1.5rem; }
      h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
      p.date { color: #666; margin: 0; font-size: 0.9rem; }
      p.paragraph { line-height: 1.6; font-size: 1.05rem; }
      ul { padding-left: 1.2rem; line-height: 1.6; }
      footer { border-top: 1px solid #e2e2e2; margin-top: 2rem; padding-top: 1rem; color: #888; font-size: 0.8rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>${input.householdName}</h1>
      <p class="date">${input.date}</p>
    </header>
    <p class="paragraph">${input.paragraph}</p>
    <ul>${bullets}</ul>
    <footer>Sent by Aihousekeeper, your household assistant.</footer>
  </body>
</html>`;
  // Hono's html tag returns `HtmlEscapedString | Promise<HtmlEscapedString>`.
  // All interpolations above are synchronous (strings + arrays of
  // pre-rendered synchronous html templates), so the Promise branch is
  // unreachable. Narrow with a runtime guard rather than a bare cast so a
  // future refactor that introduces async content fails loudly.
  if (
    typeof rendered === 'object' &&
    rendered !== null &&
    typeof (rendered as { then?: unknown }).then === 'function'
  ) {
    throw new Error(
      'renderBriefingHtml: async interpolation encountered; Aihousekeeper briefing HTML must be synchronous.'
    );
  }
  return (rendered as HtmlEscapedString).toString();
}
