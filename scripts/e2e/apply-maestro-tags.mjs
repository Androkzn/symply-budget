#!/usr/bin/env node
/**
 * Add Maestro tags + TC-ID comments to fleet flows (skips kaizen by default).
 *
 * Usage:
 *   node scripts/e2e/apply-maestro-tags.mjs
 *   INCLUDE_KAIZEN=1 node scripts/e2e/apply-maestro-tags.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAESTRO = path.join(ROOT, 'e2e/maestro');
const includeKaizen = process.env.INCLUDE_KAIZEN === '1';

/** @type {Record<string, { app: string, feature: string, mutation?: boolean, smoke?: boolean, util?: boolean }>} */
const BUDGET_FLOW = {
  'budget-tabs.yaml': { app: 'budget', feature: 'dashboard', smoke: true },
  'budget-dashboard-controls.yaml': { app: 'budget', feature: 'dashboard', smoke: true },
  'check-spendings-layout.yaml': { app: 'budget', feature: 'spend', smoke: true },
  'budget-item-form.yaml': { app: 'budget', feature: 'plan', mutation: true, smoke: true },
  'budget-spent-form.yaml': { app: 'budget', feature: 'spend', mutation: true, smoke: true },
  'budget-settings.yaml': { app: 'budget', feature: 'settings', smoke: true },
  'budget-settings-more.yaml': { app: 'budget', feature: 'settings' },
  'budget-ai-screen.yaml': { app: 'budget', feature: 'plan' },
  'budget-categories.yaml': { app: 'budget', feature: 'plan', mutation: true },
  'budget-category-detail.yaml': { app: 'budget', feature: 'plan' },
  'budget-bills.yaml': { app: 'budget', feature: 'bills', smoke: true },
  'budget-wishes.yaml': { app: 'budget', feature: 'wishes', mutation: true },
  'budget-transfer.yaml': { app: 'budget', feature: 'plan', mutation: true },
  'budget-pension.yaml': { app: 'budget', feature: 'pension', smoke: true },
  'budget-pension-interactions.yaml': { app: 'budget', feature: 'pension', mutation: true },
  'budget-households.yaml': { app: 'budget', feature: 'settings' },
  'budget-chat-rooms.yaml': { app: 'budget', feature: 'budget-chat', smoke: true },
  'budget-chat-message.yaml': { app: 'budget', feature: 'budget-chat', mutation: true },
  'budget-chat-assistant.yaml': { app: 'budget', feature: 'budget-chat' },
  'budget-savings-overview.yaml': { app: 'budget', feature: 'savings', smoke: true },
  'budget-savings-income-entry.yaml': { app: 'budget', feature: 'savings', mutation: true },
  'budget-savings-goal.yaml': {
    app: 'budget',
    feature: 'savings',
    mutation: true,
    smoke: true,
  },
  'budget-savings-recurring.yaml': { app: 'budget', feature: 'savings', mutation: true },
  'budget-savings-import.yaml': { app: 'budget', feature: 'savings', mutation: true },
  'budget-receipt-scan.yaml': { app: 'budget', feature: 'spend' },
  'budget-soft-transfer-import.yaml': { app: 'budget', feature: 'st', smoke: true },
  'budget-soft-transfer-export.yaml': { app: 'budget', feature: 'st', smoke: true },
  'budget-data-sharing.yaml': { app: 'budget', feature: 'st', smoke: true },
};

const HOUSE_DIR_FEATURE = {
  auth: { feature: 'auth', smoke: true },
  onboarding: { feature: 'onboarding' },
  home: { feature: 'home', smoke: true },
  tasks: { feature: 'tasks', smoke: true },
  mira: { feature: 'mira', smoke: true },
  aihousekeeper: { feature: 'aihousekeeper' },
  chat: { feature: 'chat', smoke: true },
  reports: { feature: 'reports', smoke: true },
  notifications: { feature: 'notifications', smoke: true },
  profile: { feature: 'settings' },
  settings: { feature: 'settings', smoke: true },
  'my-home': { feature: 'home' },
  'home-projects': { feature: 'home-projects', smoke: true },
  households: { feature: 'households' },
  spaces: { feature: 'spaces' },
  contractors: { feature: 'contractors' },
  gardening: { feature: 'garden' },
  garden: { feature: 'garden' },
  utilities: { feature: 'utilities', smoke: true },
  scroll: { feature: 'scroll' },
};

const LANG_FLOW = {
  'onboarding.yaml': { app: 'language', feature: 'onboarding', smoke: true },
  'learn-home.yaml': { app: 'language', feature: 'learn', smoke: true },
  'assessment.yaml': { app: 'language', feature: 'assessment' },
  'dialogue.yaml': { app: 'language', feature: 'dialogue' },
  'plan.yaml': { app: 'language', feature: 'plan', smoke: true },
  'review.yaml': { app: 'language', feature: 'review', smoke: true },
  'tutor.yaml': { app: 'language', feature: 'tutor', smoke: true },
  'more-settings.yaml': { app: 'language', feature: 'more', smoke: true },
};

const HEALTH_FLOW = {
  'login-screen-controls.yaml': { app: 'health', feature: 'auth', smoke: true },
  'home-water-note.yaml': {
    app: 'health',
    feature: 'home',
    mutation: true,
    smoke: true,
  },
  'home-empty-and-privacy.yaml': { app: 'health', feature: 'privacy', smoke: true },
  'more-settings-controls.yaml': { app: 'health', feature: 'more', smoke: true },
  'scroll-all-screens.yaml': { app: 'health', feature: 'scroll' },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.yaml') && ent.name !== 'config.yaml') out.push(p);
  }
  return out;
}

function metaFor(file) {
  const rel = path.relative(MAESTRO, file).split(path.sep);
  const top = rel[0];
  const base = path.basename(file);

  if (top === 'kaizen' && !includeKaizen) return null;
  if (top === 'kaizen') {
    return { app: 'kaizen', feature: 'today', util: rel.includes('subflows') };
  }

  if (rel.includes('subflows') || base.includes('subflow')) {
    let app = 'house';
    if (top === 'budget' || base.startsWith('budget-') || base.startsWith('go-budget')) {
      app = 'budget';
    } else if (top === 'language') {
      app = 'language';
    } else if (top === 'health') {
      app = 'health';
    } else if (top === 'kaizen') {
      app = 'kaizen';
    } else if (top === 'subflows') {
      app =
        base.startsWith('budget-') || base.startsWith('go-budget') ? 'budget' : 'house';
    }
    return { app, feature: 'util', util: true };
  }

  if (top === 'budget') {
    return BUDGET_FLOW[base] ?? { app: 'budget', feature: 'dashboard' };
  }
  if (top === 'language') {
    return LANG_FLOW[base] ?? { app: 'language', feature: 'learn' };
  }
  if (top === 'health') {
    return HEALTH_FLOW[base] ?? { app: 'health', feature: 'home' };
  }
  if (HOUSE_DIR_FEATURE[top]) {
    const h = HOUSE_DIR_FEATURE[top];
    const mutation =
      /mutation|add-|create|upload|save|delete|destructive/i.test(base) ||
      /mutations|add-task|upload/.test(base);
    return {
      app: 'house',
      feature: h.feature,
      smoke: h.smoke,
      mutation,
    };
  }
  if (top === 'subflows') {
    const app = base.startsWith('budget-') || base.startsWith('go-budget')
      ? 'budget'
      : 'house';
    return { app, feature: 'util', util: true };
  }
  return null;
}

function buildTags(meta) {
  const tags = [];
  if (meta.util) {
    tags.push('util');
    tags.push(`app:${meta.app}`);
    return tags;
  }
  tags.push(`app:${meta.app}`);
  tags.push(`feature:${meta.feature}`);
  tags.push(meta.mutation ? 'mutation' : 'readonly');
  tags.push('regression');
  if (meta.smoke) tags.push('smoke');
  return tags;
}

function applyTags(file, meta) {
  let text = fs.readFileSync(file, 'utf8');
  if (/^tags:\s*$/m.test(text) || /^tags:\n/m.test(text)) {
    return 'skip-already-tagged';
  }

  const tags = buildTags(meta);
  const tagBlock = ['tags:', ...tags.map((t) => `  - ${t}`)].join('\n');
  const tcHint = meta.util
    ? ''
    : `# Matrix: ${meta.app.toUpperCase()}-${meta.feature} (see documents/engineering/testing/matrices/)\n`;

  // Insert after appId line if present, else at top before ---
  if (/^appId:/m.test(text)) {
    text = text.replace(/^(appId:[^\n]*\n)/m, `$1${tagBlock}\n${tcHint}`);
  } else if (text.startsWith('---')) {
    text = `${tagBlock}\n${tcHint}${text}`;
  } else {
    // config-like or comment-first files: insert before first ---
    const idx = text.indexOf('\n---\n');
    if (idx !== -1) {
      text = `${text.slice(0, idx + 1)}${tagBlock}\n${tcHint}${text.slice(idx + 1)}`;
    } else {
      text = `${tagBlock}\n${tcHint}${text}`;
    }
  }

  fs.writeFileSync(file, text);
  return 'ok';
}

const files = walk(MAESTRO);
let ok = 0;
let skip = 0;
let ignored = 0;

for (const file of files) {
  const meta = metaFor(file);
  if (!meta) {
    ignored += 1;
    continue;
  }
  const result = applyTags(file, meta);
  if (result === 'ok') ok += 1;
  else skip += 1;
}

console.log(
  JSON.stringify(
    { tagged: ok, alreadyTagged: skip, skippedKaizenOrUnknown: ignored, includeKaizen },
    null,
    2
  )
);
