/**
 * The pricing model, pinned as a test.
 *
 * The apps are free. Managed inference is the one running cost that scales with
 * free installs, so a member gets AI in exactly two ways — an Apple subscription
 * or their own provider key — and in no other way. That rule is only real if
 * every endpoint that actually spends inference asks first; one ungated route is
 * a hole in the whole model, and it is the kind of hole that is added by
 * accident, months later, by someone adding "just one more AI endpoint".
 *
 * So: for each route file that reaches a model, assert the gate is present. The
 * inverse matters just as much and is asserted too — the core, non-AI actions
 * beside those endpoints must NOT be gated, because "every main feature works
 * without AI" is the other half of the same promise.
 *
 * These are source-text assertions on purpose. Mounting six routers with a real
 * D1 to prove a middleware is attached would test Hono, not us; what can rot
 * here is a handler being added without the gate, and reading the source catches
 * exactly that.
 */
import { describe, expect, it } from 'vitest';

import chatSource from '../chat.ts?raw';
import contractorSearchSource from '../contractor-search.ts?raw';
import floorPlansSource from '../floor-plans.ts?raw';
import garbageCollectionSource from '../garbage-collection.ts?raw';
import homeFeaturesSource from '../home-features.ts?raw';

/** Every `x.post('/path', …)` declaration with the middleware list it carries. */
function routeDecl(source: string, method: string, path: string): string | null {
  const needle = `.${method}('${path}'`;
  const at = source.indexOf(needle);
  if (at === -1) return null;
  const end = source.indexOf('\n', at);
  return source.slice(at, end === -1 ? source.length : end);
}

describe('AI spend is gated — an endpoint that calls a model requires entitlement', () => {
  it('report Q&A chat (Gemini) is gated', () => {
    // The gate is on the router-level `post('/')`, whose declaration spans lines.
    expect(chatSource).toMatch(/chat\.post\(\s*'\/',[\s\S]{0,200}requireAIEntitlement\(\)/);
  });

  it('contractor search + email generation (Gemini w/ grounding) are gated', () => {
    expect(contractorSearchSource).toContain(
      "contractorSearchRouter.use('/search', requireAIEntitlement())"
    );
    expect(contractorSearchSource).toContain(
      "contractorSearchRouter.use('/generate-email', requireAIEntitlement())"
    );
  });

  it('floor-plan analysis (Claude vision) is gated', () => {
    expect(routeDecl(floorPlansSource, 'post', '/:id/analyze')).toContain(
      'requireAIEntitlement()'
    );
  });

  it('garbage-schedule AI detection is gated', () => {
    expect(routeDecl(garbageCollectionSource, 'post', '/ai-detect')).toContain(
      'requireAIEntitlement()'
    );
  });
});

describe('the other half: core actions beside those endpoints stay open', () => {
  it('sending an email to a contractor is NOT gated — contacting them is core', () => {
    const decl = routeDecl(contractorSearchSource, 'post', '/send-email');
    expect(decl).not.toBeNull();
    expect(decl).not.toContain('requireAIEntitlement');
  });

  it('chat suggestions are NOT gated — they are built from findings rows, no model', () => {
    const decl = routeDecl(chatSource, 'get', '/suggestions');
    expect(decl).not.toBeNull();
    expect(decl).not.toContain('requireAIEntitlement');
  });

  it('uploading / listing / confirming a floor plan is NOT gated', () => {
    for (const [method, path] of [
      ['post', '/upload-url'],
      ['post', '/:id/confirm-upload'],
      ['get', '/'],
      ['get', '/:id'],
    ] as const) {
      const decl = routeDecl(floorPlansSource, method, path);
      expect(decl, `${method} ${path} should exist`).not.toBeNull();
      expect(decl, `${method} ${path} must stay open`).not.toContain('requireAIEntitlement');
    }
  });

  it('creating a garbage schedule by hand is NOT gated — it is the fallback for ai-detect', () => {
    const decl = routeDecl(garbageCollectionSource, 'post', '/');
    expect(decl).not.toBeNull();
    expect(decl).not.toContain('requireAIEntitlement');
  });

  it('maintenance suggestions are NOT gated — they come from templates, not a model', () => {
    for (const path of ['/generate', '/apply']) {
      const decl = routeDecl(homeFeaturesSource, 'post', path);
      expect(decl, `${path} should exist`).not.toBeNull();
      expect(decl, `${path} is template-driven and must stay open`).not.toContain(
        'requireAIEntitlement'
      );
    }
  });
});
