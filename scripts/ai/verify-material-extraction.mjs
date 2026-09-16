#!/usr/bin/env node
/**
 * Which provider actually READS this material correctly?
 *
 * `backend/src/ai/prompts/__tests__/materialExtractionProviderParity.test.ts`
 * proves the parsing: whatever shape Anthropic, OpenAI or Gemini writes a
 * reading down in, one identical material comes out. It cannot prove the
 * reading. Whether Gemini sees "Trade Price $4.28" on a glary shelf tag and
 * correctly declines to call it a sale is not a question a fixture can answer —
 * it needs the real photo, the real model, and real money.
 *
 * That is this script. It is run BY HAND, it spends from whichever key it
 * finds, and it is deliberately not in CI.
 *
 * ## Why it refuses to run without `--live`
 *
 * A verification script that costs money is one stray `npm run` away from being
 * a recurring bill nobody attributed. So the default is a plan: which providers,
 * which models, which prompt, and an upper bound on the spend — printed before
 * a single byte leaves. `--live` is the only thing that sends anything.
 *
 * ## What it checks, beyond printing answers side by side
 *
 * Three different things, kept apart because they fail differently:
 *
 *  1. **Disagreement** — the three read the same tag differently. Shown in the
 *     table, marked. Not an error: it is the finding you ran this for.
 *  2. **Absorbed divergence** — a provider omitted a key, sent `""`, or quoted a
 *     number, and the normalizers took it anyway. Reported, exit 0. This is what
 *     turns the parity test's simulated dialects into measured ones.
 *  3. **Rejected** — a provider stated a value the normalizers then dropped:
 *     a hex that failed validation, a size that never became millimetres, a
 *     stated percentage that was never read. Exit 1. Nothing surfaces this in
 *     production, because the request succeeded — the member just gets a card
 *     with a hole in it.
 *
 * ## Why it bundles the repo's own code instead of reimplementing it
 *
 * The schema, the system prompt, the Gemini schema translation and all four
 * normalizers are imported from source at run time (via esbuild, in memory).
 * A script that carried its own copy of `normalizeMaterialSaleOffer` would
 * certify its own copy — the exact failure mode where a local mirror asserts
 * its own encoding and pronounces the bug correct. The request bodies mirror
 * `src/features/house/local/ai/houseByokClient.ts:275-380` field for field, so
 * what is measured here is what the app actually sends.
 *
 * ## Keys
 *
 * `scripts/secrets/export-env.sh` does NOT emit AI provider keys — read it: it
 * covers Cloudflare, Sentry, Expo, Resend, AWS and the Data Bridge. So this
 * reads the environment first and falls back to the repo's own Keychain
 * accessor, `scripts/secrets/get.sh`, on the same `symply.<system>.<name>`
 * services the fleet already uses (`scripts/secrets/sync-child-worker-secrets.sh:63-67`).
 * No key is ever printed, written to a file, or included in a `--json` payload,
 * and every provider error is scrubbed of the key before it is shown.
 *
 * ## Usage
 *
 *   node scripts/ai/verify-material-extraction.mjs --url <product-url>
 *   node scripts/ai/verify-material-extraction.mjs --image ~/Desktop/tag-a.jpg
 *   node scripts/ai/verify-material-extraction.mjs --url <u> --provider all --live
 *
 * See documents/engineering/material-extraction-providers.md.
 */
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Exit codes, so a wrapper can tell a finding from a mistake. */
const EXIT_OK = 0;
const EXIT_REJECTED = 1; // a provider returned something the normalizers dropped
const EXIT_USAGE = 2; // bad arguments, missing key, nothing to read

const ALL_PROVIDERS = ['anthropic', 'openai', 'gemini'];

/**
 * The same three hosts `houseByokClient.ts:78-82` allows, and no fourth.
 * Full bases including the path, so `startsWith` cannot be fooled by
 * `api.openai.com.example.net`.
 */
const ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
};

/** Mirrors `houseByokClient.ts:85-89` — the model the device would use. */
const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-luna',
  gemini: 'gemini-3.5-flash',
};

/**
 * Where a key comes from. Environment first (a shell that already exported one
 * wins), then Keychain via the repo's own accessor.
 */
const KEY_SOURCES = {
  anthropic: { env: 'ANTHROPIC_API_KEY', keychain: ['symply.test.anthropic'] },
  openai: { env: 'OPENAI_API_KEY', keychain: ['symply.test.openai'] },
  gemini: {
    env: 'GEMINI_API_KEY',
    keychain: ['symply.gemini.api_key', 'symply.gemini.managed'],
  },
};

/** Matches the `maxTokens: 2000` both real call sites use. */
const DEFAULT_MAX_TOKENS = 2000;

/**
 * A flat per-image estimate for the PLAN only.
 *
 * All three vendors bill an image as a token count derived from its pixel
 * dimensions, and decoding a JPEG here to get them would be a dependency for a
 * number that is superseded the moment the response arrives. The plan says
 * "upper bound"; the run reports what was actually billed.
 */
const ESTIMATED_IMAGE_TOKENS = 1600;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function usage() {
  return `
Verify material extraction across AI providers, on real keys.

  --url <product-url>       A shop product page to read (the link path).
  --image <path>            A shelf-tag photograph to read (the photo path).
                            Both may be given; each is run separately.
  --hint "<text>"           The member's note about WHICH label to read, passed
                            through to buildExtractShelfTagUserPrompt. Photo only.
  --provider <p>            anthropic | openai | gemini | all   (default: all)
  --model <p>=<id>          Override one provider's model. Repeatable.
                            e.g. --model gemini=gemini-3.1-pro-preview
  --max-tokens <n>          Output ceiling per call (default: ${DEFAULT_MAX_TOKENS}).
  --live                    Actually send the requests. Without it, nothing is
                            sent and only the plan is printed.
  --json                    Machine-readable result on stdout (never a key).
  --help                    This.

Exit: 0 clean, 1 a provider returned something the normalizers reject,
      2 usage / no key / nothing to read.
`.trimStart();
}

function parseArgs(argv) {
  const out = {
    url: null,
    image: null,
    hint: null,
    providers: [...ALL_PROVIDERS],
    models: {},
    maxTokens: DEFAULT_MAX_TOKENS,
    live: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value == null || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--url':
        out.url = next();
        break;
      case '--image':
        out.image = next();
        break;
      case '--hint':
        out.hint = next();
        break;
      case '--provider': {
        const value = next();
        if (value === 'all') out.providers = [...ALL_PROVIDERS];
        else if (ALL_PROVIDERS.includes(value)) out.providers = [value];
        else throw new Error(`unknown provider "${value}"`);
        break;
      }
      case '--model': {
        const [provider, ...rest] = next().split('=');
        const model = rest.join('=');
        if (!ALL_PROVIDERS.includes(provider) || !model) {
          throw new Error('--model expects <provider>=<model-id>');
        }
        out.models[provider] = model;
        break;
      }
      case '--max-tokens': {
        const n = Number(next());
        if (!Number.isInteger(n) || n <= 0) throw new Error('--max-tokens expects a positive integer');
        out.maxTokens = n;
        break;
      }
      case '--live':
        out.live = true;
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        throw new Error(`unknown argument "${arg}"`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The repo's own code, loaded from source
// ---------------------------------------------------------------------------

/**
 * esbuild lives in `backend/node_modules` in this repo. Resolved rather than
 * assumed, with the install that provides it named in the failure — a script
 * that dies with MODULE_NOT_FOUND teaches nobody anything.
 */
function loadEsbuild() {
  const candidates = [
    path.join(REPO_ROOT, 'backend', 'package.json'),
    path.join(REPO_ROOT, 'package.json'),
  ];
  for (const from of candidates) {
    try {
      return createRequire(from)('esbuild');
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    'esbuild not found. Run `npm install` in backend/ — this script bundles the ' +
      "repo's real schema and normalizers rather than carrying a copy of them."
  );
}

/**
 * Bundle the modules this script must NOT reimplement, and import them.
 *
 * In memory, via a data: URL — nothing is written to disk. `optional` entries
 * are included only when the file exists, which is how the shelf-tag prompt
 * drops in with no edit here the day it lands.
 */
async function loadRepoModules() {
  const esbuild = loadEsbuild();

  const shelfTagModule = await firstExisting([
    'packages/contracts/src/shelf-tag-prompt.ts',
    'packages/contracts/src/material-shelf-tag-prompt.ts',
    'backend/src/ai/prompts/extract-shelf-tag.ts',
  ]);

  const entry = [
    "export {",
    "  EXTRACT_MATERIAL_LISTING_SCHEMA,",
    "  EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,",
    "  buildExtractMaterialListingUserPrompt,",
    "} from './packages/contracts/src/material-listing-prompt';",
    "export {",
    "  normalizeMaterialAppearance,",
    "  normalizeMaterialSaleOffer,",
    "  normalizeMaterialListingExtras,",
    "  normalizeHexColor,",
    "  toMillimetres,",
    "  hasSaleOffer,",
    "} from './packages/contracts/src/home-project-material';",
    "export { mergeListingIntoDraft, hostnameOf, compactRecord } from './packages/contracts/src/material-listing-merge';",
    "export {",
    "  parseOpenGraph,",
    "  parseJsonLd,",
    "  extractReadableText,",
    "  parsePriceToCents,",
    "} from './packages/contracts/src/link-extraction';",
    "export { toGeminiResponseSchema } from './src/utils/geminiSchema';",
    "export { resolveModelPrice, PRICING_VERSION } from './backend/src/ai/model-pricing';",
    shelfTagModule
      ? `export * as shelfTag from './${shelfTagModule.replace(/\.ts$/, '')}';`
      : 'export const shelfTag = null;',
  ].join('\n');

  const built = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: REPO_ROOT,
      sourcefile: 'verify-material-extraction-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'node20',
    write: false,
    logLevel: 'silent',
  });

  const code = built.outputFiles[0].text;
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`
  );
  return { ...mod, shelfTagPath: shelfTagModule };
}

async function firstExisting(relativePaths) {
  for (const rel of relativePaths) {
    try {
      await stat(path.join(REPO_ROOT, rel));
      return rel;
    } catch {
      /* next */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * A key for one provider, or null.
 *
 * Never logged, never returned to anything that prints. The Keychain read goes
 * through `scripts/secrets/get.sh` so the account convention
 * (`SYMPLY_SECRETS_ACCOUNT:-$USER`) lives in exactly one place.
 */
function resolveKey(provider) {
  const source = KEY_SOURCES[provider];
  const fromEnv = process.env[source.env]?.trim();
  if (fromEnv) return { key: fromEnv, from: `$${source.env}` };

  const get = path.join(REPO_ROOT, 'scripts', 'secrets', 'get.sh');
  for (const service of source.keychain) {
    try {
      const value = execFileSync(get, [service], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (value) return { key: value, from: `Keychain ${service}` };
    } catch {
      /* not in the Keychain; try the next service */
    }
  }
  return null;
}

/** Remove a key from anything about to be printed. Belt and braces. */
function scrub(text, keys) {
  let out = String(text ?? '');
  for (const key of keys) {
    if (key && key.length > 8) out = out.split(key).join('«key»');
  }
  // Anything that still looks like a credential, whatever its shape.
  return out
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '«key»')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '«key»');
}

// ---------------------------------------------------------------------------
// Building the request
// ---------------------------------------------------------------------------

/** Rough token count. Only ever used for the pre-flight estimate. */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function loadImage(imagePath) {
  const resolved = path.resolve(process.cwd(), imagePath);
  const mime = IMAGE_MIME[path.extname(resolved).toLowerCase()];
  if (!mime) {
    throw new Error(
      `unsupported image type "${path.extname(resolved)}" — jpg, png, webp or gif`
    );
  }
  const bytes = await readFile(resolved);
  return { base64: bytes.toString('base64'), mime, bytes: bytes.length, path: resolved };
}

/**
 * The link path's prompt, assembled exactly as the Worker and the device
 * assemble it: JSON-LD first (the retailer's own machine-readable statement),
 * OpenGraph second, stripped body text last.
 */
async function buildLinkTask(repo, url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // The same honesty the Worker's fetcher uses: a real UA, because a page
      // served to a bot is a different page and would make the comparison a
      // comparison of two anti-bot walls.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`fetching ${url} returned HTTP ${res.status}`);
  const html = await res.text();
  const finalUrl = res.url || url;

  return {
    kind: 'link',
    label: `link · ${repo.hostnameOf(finalUrl) ?? finalUrl}`,
    systemPrompt: repo.EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
    userPrompt: repo.buildExtractMaterialListingUserPrompt({
      url: finalUrl,
      jsonLd: repo.parseJsonLd(html),
      openGraph: repo.compactRecord(repo.parseOpenGraph(html)),
      bodyText: repo.extractReadableText(html),
    }),
    schema: repo.EXTRACT_MATERIAL_LISTING_SCHEMA,
    image: null,
    // Said out loud because the page fetch happens BEFORE --live is checked: a
    // prompt cannot be sized without it, and an estimate computed from a guessed
    // page length is not an estimate. It costs nothing and calls no provider,
    // but it is a request to a third party and the plan should not hide it.
    promptNote: `page fetched to size the prompt (${html.length.toLocaleString()} bytes) — no provider called yet`,
  };
}

/**
 * The photo path.
 *
 * When `extract-shelf-tag` is on disk its own schema and system prompt are
 * used. Until then this falls back to the listing prompt with the tag framed as
 * the page — and SAYS SO, loudly and in the output, because a green run against
 * a stand-in prompt that is read as verification of the real one is worse than
 * no run at all.
 */
async function buildImageTask(repo, imagePath, hint) {
  const image = await loadImage(imagePath);
  const real = repo.shelfTag ?? null;

  // The module EXISTING is not the same as it exporting what this needs. A
  // rename upstream must degrade to the stand-in loudly, not silently claim a
  // verification it did not perform.
  const usingReal = Boolean(
    real?.EXTRACT_SHELF_TAG_SYSTEM_PROMPT && real?.EXTRACT_SHELF_TAG_SCHEMA
  );
  const systemPrompt = usingReal
    ? real.EXTRACT_SHELF_TAG_SYSTEM_PROMPT
    : repo.EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT;
  const schema = usingReal
    ? real.EXTRACT_SHELF_TAG_SCHEMA
    : repo.EXTRACT_MATERIAL_LISTING_SCHEMA;

  const userPrompt = usingReal && real.buildExtractShelfTagUserPrompt
    ? real.buildExtractShelfTagUserPrompt({ hint: hint ?? null })
    : [
        'The attached photograph is a printed shelf tag from a tile shop, not a web page.',
        'Read it as you would a product page: the size is usually inside the product NAME',
        '("12X24" means 12 x 24 inches), and prices are typically per SQUARE FOOT.',
        '',
        'A second, lower price is only a sale when the tag presents it as one. A "Trade Price"',
        'is the rate a contractor with an account pays — it is not a discount, and reporting it',
        'as one prices an estimate the member cannot actually buy at.',
        '',
        'Return the listing. Use null for every field the tag does not state.',
      ].join('\n');

  return {
    kind: 'shelf_tag',
    label: `photo · ${path.basename(image.path)}`,
    systemPrompt,
    userPrompt,
    schema,
    image,
    promptNote: usingReal
      ? `using the shipped shelf-tag prompt (${repo.shelfTagPath})`
      : 'NO usable shelf-tag prompt found — using the listing prompt as a STAND-IN. ' +
        'This measures provider behaviour, NOT the shipped shelf-tag prompt.',
  };
}

// ---------------------------------------------------------------------------
// The three calls — mirroring houseByokClient.ts field for field
// ---------------------------------------------------------------------------

function assertAllowedUrl(url, provider) {
  if (!url.startsWith(ENDPOINTS[provider])) {
    throw new Error(`refusing to call ${provider} at an unexpected host`);
  }
}

async function callAnthropic({ key, model, task, maxTokens }) {
  const url = ENDPOINTS.anthropic;
  assertAllowedUrl(url, 'anthropic');

  const content = [];
  if (task.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: task.image.mime, data: task.image.base64 },
    });
  }
  content.push({ type: 'text', text: task.userPrompt });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: task.systemPrompt,
      messages: [{ role: 'user', content }],
      tools: [
        {
          name: 'structured_output',
          description: 'Return the structured answer',
          input_schema: task.schema,
        },
      ],
      tool_choice: { type: 'tool', name: 'structured_output' },
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 400)}`);

  const block = body?.content?.find(b => b.type === 'tool_use');
  if (!block?.input) throw new Error('anthropic returned no structured output');
  return {
    raw: block.input,
    usage: {
      input: body?.usage?.input_tokens ?? 0,
      output: body?.usage?.output_tokens ?? 0,
    },
    servedModel: body?.model ?? model,
  };
}

async function callOpenAi({ key, model, task, maxTokens }) {
  const url = ENDPOINTS.openai;
  assertAllowedUrl(url, 'openai');

  const content = [{ type: 'text', text: task.userPrompt }];
  if (task.image) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${task.image.mime};base64,${task.image.base64}` },
    });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: task.systemPrompt },
        { role: 'user', content: task.image ? content : task.userPrompt },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'structured_output',
            description: 'Return the structured answer',
            parameters: task.schema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'structured_output' } },
      max_completion_tokens: maxTokens,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`openai HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 400)}`);

  const args = body?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error('openai returned no structured output');
  return {
    raw: JSON.parse(args),
    usage: {
      input: body?.usage?.prompt_tokens ?? 0,
      output: body?.usage?.completion_tokens ?? 0,
    },
    servedModel: body?.model ?? model,
  };
}

async function callGemini({ key, model, task, maxTokens, toGeminiResponseSchema }) {
  const url = `${ENDPOINTS.gemini}/${model}:generateContent`;
  assertAllowedUrl(url, 'gemini');

  const parts = [{ text: task.userPrompt }];
  if (task.image) {
    parts.push({ inlineData: { mimeType: task.image.mime, data: task.image.base64 } });
  }

  const res = await fetch(url, {
    method: 'POST',
    // Header auth, not `?key=` — a secret in a URL ends up in error strings,
    // Referer headers and any log that records a request line.
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: task.systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        // OpenAPI subset, not JSON Schema — translated before it leaves, by the
        // same function the device uses.
        responseSchema: toGeminiResponseSchema(task.schema),
        maxOutputTokens: maxTokens,
      },
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${JSON.stringify(body)?.slice(0, 400)}`);

  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini returned no structured output');
  return {
    raw: JSON.parse(text),
    usage: {
      input: body?.usageMetadata?.promptTokenCount ?? 0,
      output:
        (body?.usageMetadata?.candidatesTokenCount ?? 0) +
        (body?.usageMetadata?.thoughtsTokenCount ?? 0),
    },
    servedModel: body?.modelVersion ?? model,
  };
}

const CALLERS = { anthropic: callAnthropic, openai: callOpenAi, gemini: callGemini };

// ---------------------------------------------------------------------------
// Auditing one answer
// ---------------------------------------------------------------------------

const EXTRAS_KEYS = [
  'color_hex',
  'color_name',
  'grout_color_hex',
  'unit_size_w',
  'unit_size_h',
  'unit_size_unit',
  'list_price_amount',
  'sale_price_amount',
  'sale_discount_pct_stated',
  'sale_ends_at',
];

/**
 * The six divergence classes the parity test simulates, measured for real.
 *
 * These are NOT failures — every one is absorbed. They are recorded because
 * "which provider does which" is the one thing the offline test had to guess at,
 * and this is where that guess gets replaced by evidence.
 */
function describeShape(raw, schema) {
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  const present = new Set(Object.keys(raw ?? {}));

  const omitted = required.filter(k => !present.has(k));
  const emptyStrings = Object.entries(raw ?? {})
    .filter(([, v]) => v === '')
    .map(([k]) => k);
  const quotedNumbers = Object.entries(raw ?? {})
    .filter(([k, v]) => {
      const declared = properties[k]?.type;
      const wantsNumber = Array.isArray(declared)
        ? declared.includes('number')
        : declared === 'number';
      return wantsNumber && typeof v === 'string';
    })
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const extraKeys = [...present].filter(k => !(k in properties));
  const booleansAsStrings = Object.entries(raw ?? {})
    .filter(([, v]) => v === 'true' || v === 'false')
    .map(([k]) => k);

  return { omitted, emptyStrings, quotedNumbers, extraKeys, booleansAsStrings };
}

/**
 * Values the provider STATED that the normalizers then dropped.
 *
 * Each one is a hole in the member's card with no error attached, which is why
 * these and only these are worth a non-zero exit. The alternative — treating
 * every shape difference as a failure — would make the script cry wolf on the
 * divergences that are already handled by design.
 */
function auditRejections(raw, normalized, repo) {
  const rejected = [];
  const stated = v => v !== null && v !== undefined && v !== '';

  if (stated(raw.color_hex) && normalized.appearance.colorHex === null) {
    rejected.push(
      `stated color_hex ${JSON.stringify(raw.color_hex)} did not survive normalizeHexColor`
    );
  }
  if (stated(raw.grout_color_hex) && normalized.appearance.groutColorHex === null) {
    rejected.push(
      `stated grout_color_hex ${JSON.stringify(raw.grout_color_hex)} did not survive normalizeHexColor`
    );
  }
  // The size is checked side by side and not only as a pair, because a repeat
  // needs BOTH and each side can be lost for its own reason: a quoted number, a
  // unit the enum does not carry, or a figure past the ten-metre ceiling.
  for (const side of ['unit_size_w', 'unit_size_h']) {
    if (!stated(raw[side])) continue;
    if (!stated(raw.unit_size_unit)) {
      rejected.push(
        `${side} = ${JSON.stringify(raw[side])} arrived with no unit_size_unit — ` +
          'a size with no unit is dropped, and the preview loses its repeat'
      );
      continue;
    }
    if (repo.toMillimetres(raw[side], raw.unit_size_unit) === null) {
      rejected.push(
        `stated ${side} ${JSON.stringify(raw[side])} ${JSON.stringify(raw.unit_size_unit)} ` +
          'did not become millimetres'
      );
    }
  }
  if (
    stated(raw.unit_size_w) &&
    stated(raw.unit_size_h) &&
    stated(raw.unit_size_unit) &&
    normalized.appearance.unitWMm === null
  ) {
    rejected.push(
      `stated size ${JSON.stringify(raw.unit_size_w)}x${JSON.stringify(raw.unit_size_h)} ` +
        `${JSON.stringify(raw.unit_size_unit)} did not become a repeat — the preview cannot draw a pattern`
    );
  }
  if (stated(raw.color_name) && normalized.appearance.colorName === null) {
    rejected.push(
      `stated color_name ${JSON.stringify(raw.color_name)} was dropped — ` +
        'it is the only string a member can take to a paint counter'
    );
  }
  if (stated(raw.price_amount) && repo.parsePriceToCents(raw.price_amount) === null) {
    rejected.push(`stated price_amount ${JSON.stringify(raw.price_amount)} did not parse to cents`);
  }
  if (stated(raw.sale_discount_pct_stated) && typeof raw.sale_discount_pct_stated !== 'number') {
    rejected.push(
      `sale_discount_pct_stated arrived as ${typeof raw.sale_discount_pct_stated} ` +
        '— it is read with a bare typeof check, so the badge cross-check never fires'
    );
  }
  if (
    stated(raw.coverage_per_unit) &&
    typeof raw.coverage_per_unit !== 'number'
  ) {
    rejected.push(
      `coverage_per_unit arrived as ${typeof raw.coverage_per_unit} — ` +
        'mergeListingIntoDraft gates it with `> 0`, which a string passes, so it ' +
        'reaches the takeoff arithmetic as a string'
    );
  }
  if (
    stated(raw.list_price_amount) &&
    stated(raw.sale_price_amount) &&
    normalized.offer.discountPct === null
  ) {
    rejected.push(
      'both a list and a sale price were stated but no discount came out — ' +
        'either the sale price is not lower, or one of them failed to parse'
    );
  }
  if (
    stated(raw.sale_ends_at) &&
    normalized.offer.discountPct !== null &&
    normalized.offer.saleEndsAt === null
  ) {
    rejected.push(
      `stated sale_ends_at ${JSON.stringify(raw.sale_ends_at)} is not a real ISO date`
    );
  }
  return rejected;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** The fields worth putting side by side, raw reading above, derived below. */
const COMPARE_ROWS = [
  ['name', r => r.raw.name],
  ['brand', r => r.raw.brand],
  ['vendor', r => r.raw.vendor],
  ['sku', r => r.raw.sku],
  ['category', r => r.raw.category],
  ['confidence', r => r.raw.confidence],
  ['price_amount', r => r.raw.price_amount],
  ['price_currency', r => r.raw.price_currency],
  ['price_basis', r => r.raw.price_basis],
  ['coverage_per_unit', r => r.raw.coverage_per_unit],
  ['coverage_unit', r => r.raw.coverage_unit],
  ['dimensions', r => r.raw.dimensions],
  ['pieces_per_unit', r => r.raw.pieces_per_unit],
  ['price_per_area', r => r.raw.price_per_area_amount],
  ['availability', r => r.raw.availability],
  ['specs (count)', r => (Array.isArray(r.raw.specs) ? r.raw.specs.length : null)],
  ['— appearance —', () => ''],
  ['colorHex', r => r.normalized.appearance.colorHex],
  ['colorName', r => r.normalized.appearance.colorName],
  ['groutColorHex', r => r.normalized.appearance.groutColorHex],
  ['unitWMm', r => r.normalized.appearance.unitWMm],
  ['unitHMm', r => r.normalized.appearance.unitHMm],
  ['— offer —', () => ''],
  ['listPriceCents', r => r.normalized.offer.listPriceCents],
  ['salePriceCents', r => r.normalized.offer.salePriceCents],
  ['discountPct', r => r.normalized.offer.discountPct],
  ['saleEndsAt', r => r.normalized.offer.saleEndsAt],
  ['discountPctDisputed', r => r.normalized.offer.discountPctDisputed],
];

function cell(value) {
  if (value === null || value === undefined) return '·';
  if (value === '') return '""';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 30 ? `${text.slice(0, 29)}…` : text;
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - [...text].length));
}

/**
 * Field by field, provider by provider, with disagreement marked.
 *
 * The marker column is the point: a member picks one provider and sees one
 * card, so the only way disagreement is ever visible is a view like this.
 */
function renderTable(results, providers) {
  const answered = providers.filter(p => results[p]?.ok);
  if (answered.length === 0) return '  (no provider answered)\n';

  const labelWidth = Math.max(...COMPARE_ROWS.map(([label]) => label.length)) + 1;
  // Widths from the rendered cells, not a guess. A column narrower than its
  // content runs the next column into it and the disagreement markers stop
  // lining up — which is the one thing this view exists to make scannable.
  const widths = answered.map(p =>
    Math.max(
      p.length,
      ...COMPARE_ROWS.filter(([label]) => !label.startsWith('—')).map(
        ([, read]) => [...cell(read(results[p]))].length
      )
    )
  );

  let out = `  ${pad('', 2)}${pad('field', labelWidth)}`;
  answered.forEach((p, i) => {
    out += `  ${pad(p, widths[i])}`;
  });
  out += '\n';
  out += `  ${'-'.repeat(2 + labelWidth + answered.reduce((a, _, i) => a + widths[i] + 2, 0))}\n`;

  for (const [label, read] of COMPARE_ROWS) {
    if (label.startsWith('—')) {
      out += `  ${pad('', 2)}${label}\n`;
      continue;
    }
    const values = answered.map(p => cell(read(results[p])));
    const agree = values.every(v => v === values[0]);
    out += `  ${pad(agree ? '' : '≠', 2)}${pad(label, labelWidth)}`;
    values.forEach((v, i) => {
      out += `  ${pad(v, widths[i])}`;
    });
    out += '\n';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function money(usd) {
  // Zero is spelled out rather than folded into "<$0.01": "nothing will be
  // spent" and "a fraction of a cent will be spent" are different answers to
  // the question this line exists to answer.
  if (usd === 0) return '$0.00';
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n\n${usage()}`);
    return EXIT_USAGE;
  }

  if (args.help) {
    process.stdout.write(usage());
    return EXIT_OK;
  }
  if (!args.url && !args.image) {
    process.stderr.write(`error: give --url, --image, or both.\n\n${usage()}`);
    return EXIT_USAGE;
  }

  const repo = await loadRepoModules();

  // ---- keys, resolved but never shown ------------------------------------
  const keys = {};
  const keyOrigin = {};
  const missing = [];
  for (const provider of args.providers) {
    const found = resolveKey(provider);
    if (found) {
      keys[provider] = found.key;
      keyOrigin[provider] = found.from;
    } else {
      missing.push(provider);
    }
  }
  const runnable = args.providers.filter(p => keys[p]);
  const allKeys = Object.values(keys);

  // ---- what will be read -------------------------------------------------
  const tasks = [];
  try {
    if (args.url) tasks.push(await buildLinkTask(repo, args.url));
    if (args.image) tasks.push(await buildImageTask(repo, args.image, args.hint));
  } catch (error) {
    process.stderr.write(`error: ${scrub(error.message, allKeys)}\n`);
    return EXIT_USAGE;
  }

  // ---- the plan, printed before anything is sent -------------------------
  const lines = [];
  lines.push('');
  lines.push('material extraction — provider verification');
  lines.push('');
  for (const task of tasks) {
    const promptTokens =
      estimateTokens(task.systemPrompt) +
      estimateTokens(task.userPrompt) +
      (task.image ? ESTIMATED_IMAGE_TOKENS : 0);
    lines.push(`  input: ${task.label}`);
    lines.push(`    prompt ≈ ${promptTokens.toLocaleString()} tokens, output ceiling ${args.maxTokens.toLocaleString()}`);
    if (task.promptNote) lines.push(`    ! ${task.promptNote}`);
    task.promptTokens = promptTokens;
  }
  lines.push('');

  let upperBound = 0;
  lines.push('  will call:');
  for (const provider of runnable) {
    const model = args.models[provider] ?? DEFAULT_MODELS[provider];
    const { rates, source } = repo.resolveModelPrice(provider, model);
    let providerCost = 0;
    for (const task of tasks) {
      providerCost +=
        (task.promptTokens * rates.input + args.maxTokens * rates.output) / 1_000_000;
    }
    upperBound += providerCost;
    lines.push(
      `    ${pad(provider, 10)} ${pad(model, 26)} key from ${pad(keyOrigin[provider], 30)} ` +
        `≤ ${money(providerCost)}${source === 'exact' ? '' : ` (${source} price)`}`
    );
  }
  for (const provider of missing) {
    lines.push(
      `    ${pad(provider, 10)} SKIPPED — no key in $${KEY_SOURCES[provider].env} ` +
        `or Keychain ${KEY_SOURCES[provider].keychain.join(' / ')}`
    );
  }
  lines.push('');
  lines.push(
    `  worst case for this run: ${money(upperBound)} at list prices ` +
      `(backend/src/ai/model-pricing.ts, v${repo.PRICING_VERSION}).`
  );
  lines.push(
    '  That is an upper bound: it assumes every call fills its output ceiling. ' +
      'Real usage is reported after the run.'
  );
  lines.push('');

  if (runnable.length === 0) {
    process.stderr.write(`${lines.join('\n')}\n  no key for any requested provider — nothing to do.\n`);
    return EXIT_USAGE;
  }

  if (!args.live) {
    lines.push('  DRY RUN. Nothing was sent and nothing was spent.');
    lines.push('  Re-run with --live to actually call the providers above.');
    lines.push('');
    process.stdout.write(lines.join('\n'));
    return EXIT_OK;
  }

  process.stdout.write(`${lines.join('\n')}  --live given. Sending.\n\n`);

  // ---- the run -----------------------------------------------------------
  let rejectedAnywhere = false;
  const report = { tasks: [] };

  for (const task of tasks) {
    const results = {};
    await Promise.all(
      runnable.map(async provider => {
        const model = args.models[provider] ?? DEFAULT_MODELS[provider];
        const startedAt = Date.now();
        try {
          const answer = await CALLERS[provider]({
            key: keys[provider],
            model,
            task,
            maxTokens: args.maxTokens,
            toGeminiResponseSchema: repo.toGeminiResponseSchema,
          });
          const normalized = {
            appearance: repo.normalizeMaterialAppearance(answer.raw),
            offer: repo.normalizeMaterialSaleOffer(answer.raw),
          };
          const rejections = auditRejections(answer.raw, normalized, repo);
          if (rejections.length) rejectedAnywhere = true;
          results[provider] = {
            ok: true,
            model,
            servedModel: answer.servedModel,
            ms: Date.now() - startedAt,
            usage: answer.usage,
            raw: answer.raw,
            normalized,
            shape: describeShape(answer.raw, task.schema),
            rejections,
          };
        } catch (error) {
          rejectedAnywhere = true;
          results[provider] = {
            ok: false,
            model,
            ms: Date.now() - startedAt,
            error: scrub(error.message, allKeys),
          };
        }
      })
    );

    // ---- the comparison ---------------------------------------------------
    const out = [];
    out.push(`  ${task.label}`);
    out.push('');
    out.push(renderTable(results, runnable));

    out.push('  shape — what each provider did with the schema:');
    for (const provider of runnable) {
      const r = results[provider];
      if (!r?.ok) {
        out.push(`    ${pad(provider, 10)} FAILED — ${r?.error ?? 'unknown'}`);
        continue;
      }
      const s = r.shape;
      const notes = [];
      if (s.omitted.length) notes.push(`omitted ${s.omitted.length} required key(s): ${s.omitted.join(', ')}`);
      if (s.emptyStrings.length) notes.push(`"" for: ${s.emptyStrings.join(', ')}`);
      if (s.quotedNumbers.length) notes.push(`quoted numbers: ${s.quotedNumbers.join(', ')}`);
      if (s.booleansAsStrings.length) notes.push(`booleans as strings: ${s.booleansAsStrings.join(', ')}`);
      if (s.extraKeys.length) notes.push(`extra keys: ${s.extraKeys.join(', ')}`);
      out.push(
        `    ${pad(provider, 10)} ${notes.length ? notes.join('; ') : 'exactly the schema'} ` +
          `[${r.usage.input}→${r.usage.output} tok, ${r.ms}ms, served ${r.servedModel}]`
      );
    }
    out.push('');

    const anyRejection = runnable.some(p => results[p]?.rejections?.length);
    if (anyRejection) {
      out.push('  REJECTED — a stated value the normalizers dropped:');
      for (const provider of runnable) {
        for (const rejection of results[provider]?.rejections ?? []) {
          out.push(`    ${pad(provider, 10)} ${rejection}`);
        }
      }
      out.push('');
    }

    process.stdout.write(`${out.join('\n')}\n`);

    report.tasks.push({
      input: task.label,
      kind: task.kind,
      promptNote: task.promptNote,
      providers: Object.fromEntries(
        Object.entries(results).map(([p, r]) => [
          p,
          r.ok
            ? {
                model: r.model,
                servedModel: r.servedModel,
                ms: r.ms,
                usage: r.usage,
                raw: r.raw,
                normalized: r.normalized,
                shape: r.shape,
                rejections: r.rejections,
              }
            : { model: r.model, ms: r.ms, error: r.error },
        ])
      ),
    });
  }

  // ---- what it actually cost ---------------------------------------------
  let spent = 0;
  for (const task of report.tasks) {
    for (const [provider, r] of Object.entries(task.providers)) {
      if (!r.usage) continue;
      const { rates } = repo.resolveModelPrice(provider, r.model);
      spent += (r.usage.input * rates.input + r.usage.output * rates.output) / 1_000_000;
    }
  }
  process.stdout.write(
    `  actual, from the token counts the providers reported: ${money(spent)}\n` +
      `  (estimate at list prices — a bill is the only authority)\n\n`
  );

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  return rejectedAnywhere ? EXIT_REJECTED : EXIT_OK;
}

main()
  .then(code => {
    process.exitCode = code;
  })
  .catch(error => {
    process.stderr.write(`error: ${scrub(error?.stack ?? error?.message ?? error, [])}\n`);
    process.exitCode = EXIT_USAGE;
  });
