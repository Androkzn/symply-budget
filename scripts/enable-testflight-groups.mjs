#!/usr/bin/env node
/**
 * Enable TestFlight beta groups for all 5 Symply apps via ASC API.
 * - Ensures Internal (auto all builds) + External groups
 * - Attaches latest VALID build to External
 * - Fills Beta App Description + review contact + What to Test
 * - Submits for Beta App Review (external)
 *
 * env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH
 * optional: ASC_CONTACT_PHONE (E.164, e.g. +14155552671)
 * flags: --dry-run
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const DRY = process.argv.includes('--dry-run');
const API = 'https://api.appstoreconnect.apple.com';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH } = process.env;
for (const [k, v] of Object.entries({ ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH })) {
  if (!v) {
    console.error(`FATAL: missing env ${k}`);
    process.exit(2);
  }
}

function b64url(i) {
  return Buffer.from(i).toString('base64url');
}
function mintToken() {
  const header = { alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ASC_ISSUER_ID,
    iat: now,
    exp: now + 15 * 60,
    aud: 'appstoreconnect-v1',
  };
  const si = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = fs.readFileSync(ASC_KEY_PATH, 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(si), {
    key,
    dsaEncoding: 'ieee-p1363',
  });
  return `${si}.${sig.toString('base64url')}`;
}

const TOKEN = mintToken();

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
  }
  return { status: res.status, ok: res.ok, json };
}

const errStr = (j) =>
  j?.errors?.length
    ? j.errors.map((e) => `${e.status} ${e.code}: ${e.detail || e.title}`).join(' | ')
    : j?.raw || JSON.stringify(j);

const CONTACT = {
  firstName: 'Andrei',
  lastName: 'Tekhtelev',
  email: 'andreitekhtelev@gmail.com',
  // ASC requires a plausible E.164; override with ASC_CONTACT_PHONE if needed.
  phone: process.env.ASC_CONTACT_PHONE || '+14255550100',
};

const APPS = [
  {
    key: 'house',
    appId: '6790505308',
    brand: 'Symply House',
    description:
      'Symply House helps households manage home maintenance, tasks, reports, and AI home assistance. POC TestFlight build for smoke testing.',
  },
  {
    key: 'budget',
    appId: '6790505414',
    brand: 'Symply Budget',
    description:
      'Symply Budget tracks household spending, savings, and transfers. POC TestFlight build for smoke testing.',
  },
  {
    key: 'kaizen',
    appId: '6790505368',
    brand: 'Symply Kaizen',
    description:
      'Symply Kaizen supports career learning, interview practice, and daily systems. POC TestFlight build for smoke testing.',
  },
  {
    key: 'language',
    appId: '6790505445',
    brand: 'Symply Language',
    description:
      'Symply Language helps learners practice languages with lessons and progress tracking. POC TestFlight build for smoke testing.',
  },
  {
    key: 'health',
    appId: '6790505448',
    brand: 'Symply Health',
    description:
      'Symply Health supports personal health check-ins and goals. POC TestFlight build for smoke testing.',
  },
];

const INTERNAL_NAME = 'Symply Internal';
const EXTERNAL_NAME = 'Symply External POC';
const WHAT_TO_TEST =
  'POC build — smoke login, main tabs, and core flows. Report crashes via TestFlight.';
const PRIVACY = 'https://symply.app/privacy';
const MARKETING = 'https://symply.app';

async function listGroups(appId) {
  const res = await api(
    'GET',
    `/v1/apps/${appId}/betaGroups?limit=50&fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds`
  );
  if (!res.ok) throw new Error(`list betaGroups: ${errStr(res.json)}`);
  return res.json.data || [];
}

async function ensureGroup(app, { name, isInternal }) {
  const groups = await listGroups(app.appId);
  const found = groups.find(
    (g) => g.attributes.name === name && Boolean(g.attributes.isInternalGroup) === isInternal
  );
  if (found) {
    console.log(`    = ${isInternal ? 'internal' : 'external'} group "${name}" (${found.id})`);
    return found;
  }
  if (DRY) {
    console.log(`    + [dry] create ${isInternal ? 'internal' : 'external'} group "${name}"`);
    return { id: 'DRY', attributes: { name, isInternalGroup: isInternal } };
  }
  const res = await api('POST', '/v1/betaGroups', {
    data: {
      type: 'betaGroups',
      attributes: {
        name,
        isInternalGroup: isInternal,
        hasAccessToAllBuilds: isInternal,
        feedbackEnabled: true,
      },
      relationships: {
        app: { data: { type: 'apps', id: app.appId } },
      },
    },
  });
  if (!res.ok) throw new Error(`create betaGroup "${name}": ${errStr(res.json)}`);
  console.log(
    `    + created ${isInternal ? 'internal' : 'external'} group "${name}" (${res.json.data.id})`
  );
  return res.json.data;
}

async function latestBuild(appId) {
  const res = await api(
    'GET',
    `/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=20&fields[builds]=version,uploadedDate,processingState,expired`
  );
  if (!res.ok) throw new Error(`list builds: ${errStr(res.json)}`);
  const builds = (res.json.data || []).filter((b) => !b.attributes.expired);
  if (!builds.length) return null;
  const rank = (s) =>
    ({ VALID: 0, PROCESSING: 1, IN_REVIEW: 2, WAITING_FOR_REVIEW: 3, FAILED: 9 }[s] ?? 5);
  builds.sort((a, b) => {
    const rd = rank(a.attributes.processingState) - rank(b.attributes.processingState);
    if (rd !== 0) return rd;
    return (
      new Date(b.attributes.uploadedDate).getTime() -
      new Date(a.attributes.uploadedDate).getTime()
    );
  });
  return builds[0];
}

async function ensureBuildLocalizations(buildId) {
  const list = await api(
    'GET',
    `/v1/builds/${buildId}/betaBuildLocalizations?limit=20&fields[betaBuildLocalizations]=locale,whatsNew`
  );
  if (!list.ok) {
    console.log(`      ! list build locs: ${errStr(list.json)}`);
    return;
  }
  const en = (list.json.data || []).find((l) => l.attributes.locale === 'en-US');
  if (en?.attributes?.whatsNew?.trim()) {
    console.log('      = What to Test (en-US) present');
    return;
  }
  if (DRY) {
    console.log('      + [dry] set What to Test (en-US)');
    return;
  }
  if (en) {
    const patch = await api('PATCH', `/v1/betaBuildLocalizations/${en.id}`, {
      data: {
        type: 'betaBuildLocalizations',
        id: en.id,
        attributes: { whatsNew: WHAT_TO_TEST },
      },
    });
    if (!patch.ok) console.log(`      ! patch What to Test: ${errStr(patch.json)}`);
    else console.log('      + updated What to Test (en-US)');
    return;
  }
  const create = await api('POST', '/v1/betaBuildLocalizations', {
    data: {
      type: 'betaBuildLocalizations',
      attributes: { locale: 'en-US', whatsNew: WHAT_TO_TEST },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    },
  });
  if (!create.ok) console.log(`      ! create What to Test: ${errStr(create.json)}`);
  else console.log('      + created What to Test (en-US)');
}

async function ensureBetaAppLocalization(app) {
  const list = await api(
    'GET',
    `/v1/apps/${app.appId}/betaAppLocalizations?limit=20`
  );
  if (!list.ok) {
    console.log(`    ! list betaAppLocalizations: ${errStr(list.json)}`);
    return;
  }
  const en = (list.json.data || []).find((l) => l.attributes.locale === 'en-US');
  const attrs = {
    feedbackEmail: CONTACT.email,
    description: app.description,
    marketingUrl: MARKETING,
    privacyPolicyUrl: PRIVACY,
    tvOsPrivacyPolicy: undefined,
  };
  if (DRY) {
    console.log(`    + [dry] ${en ? 'patch' : 'create'} Beta App Description (en-US)`);
    return;
  }
  if (en) {
    const patch = await api('PATCH', `/v1/betaAppLocalizations/${en.id}`, {
      data: {
        type: 'betaAppLocalizations',
        id: en.id,
        attributes: {
          feedbackEmail: attrs.feedbackEmail,
          description: attrs.description,
          marketingUrl: attrs.marketingUrl,
          privacyPolicyUrl: attrs.privacyPolicyUrl,
        },
      },
    });
    if (!patch.ok) console.log(`    ! patch betaAppLocalization: ${errStr(patch.json)}`);
    else console.log('    + Beta App Description updated (en-US)');
    return;
  }
  const create = await api('POST', '/v1/betaAppLocalizations', {
    data: {
      type: 'betaAppLocalizations',
      attributes: {
        locale: 'en-US',
        feedbackEmail: attrs.feedbackEmail,
        description: attrs.description,
        marketingUrl: attrs.marketingUrl,
        privacyPolicyUrl: attrs.privacyPolicyUrl,
      },
      relationships: { app: { data: { type: 'apps', id: app.appId } } },
    },
  });
  if (!create.ok) console.log(`    ! create betaAppLocalization: ${errStr(create.json)}`);
  else console.log('    + Beta App Description created (en-US)');
}

async function ensureBetaAppReviewDetail(appId) {
  const get = await api('GET', `/v1/apps/${appId}/betaAppReviewDetail`);
  if (!get.ok) {
    console.log(`    ! betaAppReviewDetail: ${errStr(get.json)}`);
    return;
  }
  const detail = get.json.data;
  if (!detail) {
    console.log('    ! no betaAppReviewDetail resource');
    return;
  }
  const a = detail.attributes || {};
  const needs =
    !a.contactEmail || !a.contactFirstName || !a.contactLastName || !a.contactPhone;
  if (!needs) {
    console.log('    = beta App Review contact present');
    return;
  }
  if (DRY) {
    console.log('    + [dry] patch beta App Review contact');
    return;
  }
  const patch = await api('PATCH', `/v1/betaAppReviewDetails/${detail.id}`, {
    data: {
      type: 'betaAppReviewDetails',
      id: detail.id,
      attributes: {
        contactEmail: a.contactEmail || CONTACT.email,
        contactFirstName: a.contactFirstName || CONTACT.firstName,
        contactLastName: a.contactLastName || CONTACT.lastName,
        contactPhone: a.contactPhone || CONTACT.phone,
        demoAccountRequired: false,
        notes: a.notes || 'POC TestFlight — internal/external smoke testing.',
      },
    },
  });
  if (!patch.ok) console.log(`    ! patch review detail: ${errStr(patch.json)}`);
  else console.log('    + beta App Review contact filled');
}

async function attachBuildToExternal(buildId, groupId) {
  if (DRY || groupId === 'DRY') {
    console.log(`      + [dry] attach build → ${EXTERNAL_NAME}`);
    return true;
  }
  const res = await api('POST', `/v1/builds/${buildId}/relationships/betaGroups`, {
    data: [{ type: 'betaGroups', id: groupId }],
  });
  if (res.ok || res.status === 204 || res.status === 409) {
    console.log(
      res.status === 409
        ? `      = build already on ${EXTERNAL_NAME}`
        : `      + attached build → ${EXTERNAL_NAME}`
    );
    return true;
  }
  const alt = await api('POST', `/v1/betaGroups/${groupId}/relationships/builds`, {
    data: [{ type: 'builds', id: buildId }],
  });
  if (alt.ok || alt.status === 204 || alt.status === 409) {
    console.log(
      alt.status === 409
        ? `      = build already on ${EXTERNAL_NAME}`
        : `      + attached build → ${EXTERNAL_NAME} (via group)`
    );
    return true;
  }
  console.log(`      ! attach external: ${errStr(res.json)} || ${errStr(alt.json)}`);
  return false;
}

async function submitExternalReview(buildId) {
  if (DRY) {
    console.log('      + [dry] submit for Beta App Review');
    return;
  }
  const res = await api('POST', '/v1/betaAppReviewSubmissions', {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: {
        build: { data: { type: 'builds', id: buildId } },
      },
    },
  });
  if (res.ok) {
    console.log(`      + submitted for Beta App Review (${res.json.data?.id || 'ok'})`);
    return;
  }
  console.log(`      = Beta App Review: ${errStr(res.json)}`);
}

async function processApp(app) {
  console.log(`\n▸ ${app.brand} (${app.appId})`);
  await ensureBetaAppLocalization(app);
  await ensureBetaAppReviewDetail(app.appId);

  const internal = await ensureGroup(app, { name: INTERNAL_NAME, isInternal: true });
  const external = await ensureGroup(app, { name: EXTERNAL_NAME, isInternal: false });
  console.log(
    `    = Internal hasAccessToAllBuilds=${internal.attributes?.hasAccessToAllBuilds} (auto; no manual attach)`
  );

  const build = await latestBuild(app.appId);
  if (!build) {
    console.log('    ! no non-expired builds — upload IPA first');
    return { app: app.key, ok: false, reason: 'no-build' };
  }
  console.log(
    `    = latest build ${build.attributes.version} state=${build.attributes.processingState} id=${build.id}`
  );

  await ensureBuildLocalizations(build.id);
  const attached = await attachBuildToExternal(build.id, external.id);
  if (attached && build.attributes.processingState === 'VALID') {
    await submitExternalReview(build.id);
  }

  return {
    app: app.key,
    ok: true,
    build: build.attributes.version,
    state: build.attributes.processingState,
    internalGroup: internal.id,
    externalGroup: external.id,
  };
}

/**
 * `--only house,budget` — restrict the run to named apps.
 *
 * The last step here SUBMITS FOR BETA APP REVIEW, which puts a build in front of
 * Apple and then the external testers. Shipping one app should not oblige the
 * other four to go out with it: their latest VALID build is whatever happened to
 * be uploaded last, which may be older than the work being released, and an
 * external submission is not something to make by omission. Default stays all
 * five so existing invocations are unchanged.
 */
const ONLY = (() => {
  const flag = process.argv.find((a) => a.startsWith('--only'));
  if (!flag) return null;
  const raw = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : process.argv[process.argv.indexOf(flag) + 1];
  const keys = (raw || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) {
    console.error('FATAL: --only needs at least one app key');
    process.exit(2);
  }
  const known = new Set(APPS.map((a) => a.key));
  const bad = keys.filter((k) => !known.has(k));
  if (bad.length) {
    console.error(`FATAL: unknown app key(s): ${bad.join(', ')} — known: ${[...known].join(', ')}`);
    process.exit(2);
  }
  return new Set(keys);
})();

async function main() {
  const selected = ONLY ? APPS.filter((a) => ONLY.has(a.key)) : APPS;
  console.log(`ASC TestFlight group enablement${DRY ? ' (DRY RUN)' : ''}`);
  console.log(`apps: ${selected.map((a) => a.key).join(', ')}${ONLY ? ' (--only)' : ' (all)'}`);
  const results = [];
  for (const app of selected) {
    try {
      results.push(await processApp(app));
    } catch (e) {
      console.error(`    ✗ ${app.brand}: ${e.message}`);
      results.push({ app: app.key, ok: false, reason: e.message });
    }
  }
  console.log('\n══ Summary ══');
  for (const r of results) {
    if (r.ok) {
      console.log(
        `✅ ${r.app}: build ${r.build} (${r.state}) — Internal auto + External POC`
      );
    } else {
      console.log(`❌ ${r.app}: ${r.reason}`);
    }
  }
  console.log(
    '\nDone via ASC API: Symply Internal (auto builds) + Symply External POC (public link + Beta App Review). Re-run to sync new VALID builds.'
  );
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
