// One-off: regenerate symply-budget `goal` at hi-res (crisp at the 72pt savings
// empty-state hero) with clean art (kills the stray speck). Mirrors the
// generate-icons.mjs post-processing but stores at SIZE=256 instead of 96.
//   node scripts/icon-gen/regen-goal-hires.mjs [outDir]   (default: kit)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildIconPrompt } from './brand-prompts.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BRAND = 'symply-budget';
const SLUG = 'goal';
const CONCEPT = 'a target/bullseye with an arrow hitting the center';
const SIZE = 256;
const NEUTRAL = { dark: '#92A6A0', light: '#536A63' }; // symply-budget (from generate-icons.mjs)
const OUT = process.argv[2] || null; // scratch dir, else install into kit

const hexToRgb = h => { const n = parseInt(h.replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; };

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  return execFileSync('security', ['find-generic-password', '-s', 'symply.test.openai', '-w'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

async function openaiImage(prompt, key) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', background: 'transparent', output_format: 'png', quality: 'high', n: 1 }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b64 = (await res.json())?.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai: empty image');
  return Buffer.from(b64, 'base64');
}

/** Raw transparent 1024² → clean SIZE² selected art (drops disconnected specks). */
async function keySelected(buf) {
  // Trim to ink, then drop small disconnected blobs (the stray speck) by keeping
  // only the largest connected alpha region.
  const trimmed = await sharp(buf).ensureAlpha().png().trim({ threshold: 10 }).toBuffer().catch(() => sharp(buf).ensureAlpha().png().toBuffer());
  const cleaned = await dropSpecks(trimmed);
  const inner = Math.round(SIZE * 0.85);
  const fitted = await sharp(cleaned).resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  const m = await sharp(fitted).metadata();
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fitted, left: Math.round((SIZE - (m.width || inner)) / 2), top: Math.round((SIZE - (m.height || inner)) / 2) }])
    .png().toBuffer();
}

/** Connected-components on alpha; keep blobs >= 12% of the largest blob's area. */
async function dropSpecks(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const on = i => data[i * c + 3] > 24;
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (!on(s) || label[s] !== -1) continue;
    const id = sizes.length; let count = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop(); count++;
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && on(q) && label[q] === -1) { label[q] = id; stack.push(q); }
    }
    sizes.push(count);
  }
  const max = Math.max(...sizes, 1);
  const keep = new Uint8Array(sizes.length);
  sizes.forEach((n, i) => { keep[i] = n >= max * 0.12 ? 1 : 0; });
  const out = Buffer.from(data);
  for (let p = 0; p < w * h; p++) if (label[p] === -1 || !keep[label[p]]) out[p * c + 3] = 0;
  return sharp(out, { raw: { width: w, height: h, channels: c } }).png().toBuffer();
}

async function silhouette(selectedPng, rgb) {
  const { data, info } = await sharp(selectedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    out[p * 4] = rgb.r; out[p * 4 + 1] = rgb.g; out[p * 4 + 2] = rgb.b; out[p * 4 + 3] = data[p * channels + 3];
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const dest = (state) => OUT
  ? path.join(OUT, state, `${SLUG}.png`)
  : path.join(REPO, 'brands', BRAND, 'src/assets/icons/png', state, `${SLUG}.png`);

async function main() {
  const key = readKey();
  const prompt = buildIconPrompt(BRAND, SLUG, CONCEPT);
  console.log(`Generating ${BRAND}/${SLUG} @ ${SIZE}² (gpt-image-1 high)…`);
  const raw = await openaiImage(prompt, key);
  const selected = await keySelected(raw);
  const states = {
    selected,
    'unselected-dark': await silhouette(selected, hexToRgb(NEUTRAL.dark)),
    'unselected-light': await silhouette(selected, hexToRgb(NEUTRAL.light)),
    'filled-accent': await silhouette(selected, { r: 255, g: 255, b: 255 }),
  };
  for (const [state, buf] of Object.entries(states)) {
    const p = dest(state);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
    console.log(`  ✓ ${state}/${SLUG}.png (${buf.length} bytes)`);
  }
  console.log(OUT ? `\n✓ wrote to scratch ${OUT}` : '\n✓ installed into kit');
}

main().catch(e => { console.error(e.message); process.exit(1); });
