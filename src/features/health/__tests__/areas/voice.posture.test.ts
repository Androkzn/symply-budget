/**
 * VoiceChat — posture guard for an area that is deliberately NOT ported.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * The Swift donor's coach ("VoiceChat" / Health Coach V2) is 8,057 lines across
 * seven files, most of it an `SFSpeechRecognizer` → `AVSpeechSynthesizer` loop
 * and a 22-case spoken-command dispatcher. Symply Health ported the *coach* and
 * dropped the *hands-free* half. `HealthCoachScreen.tsx` records that decision
 * in words — search it for "ported TEXT-FIRST" (deliberately not cited by line
 * number; that comment has already moved once). So there is no voice UI, no
 * microphone capture, no transcription route — and therefore nothing to write
 * behavioural tests for.
 *
 * What CAN rot is the posture itself, and it can rot silently, because the
 * capability is already sitting in the tree one import away:
 *
 *   - `expo-speech-recognition`, `expo-audio` and `react-native-webrtc` are in
 *     the SHARED `package.json` and the SHARED `ios/Podfile.lock`. They are
 *     autolinked into every brand's binary, Health included.
 *   - `@hooks/useQuickSpeech`, `@hooks/useVoiceMode` and
 *     `@services/voice-recording` are first-party modules that already work.
 *     Today only House (Tasks, Aihousekeeper, Visits) and Kaizen (BookQuiz)
 *     import them.
 *   - The shared iOS surface ALREADY declares `NSMicrophoneUsageDescription`
 *     and `NSSpeechRecognitionUsageDescription` (see the PERMISSION block
 *     below). A Health build that grew a mic call would NOT be stopped by a
 *     missing purpose string — it would just start recording.
 *
 * One `import { useQuickSpeech } from '@hooks/useQuickSpeech'` in a Health
 * screen therefore ships a working microphone in a health app with zero tests
 * and zero product review. That is the failure this file is here to make loud.
 *
 * ── WHY IT IS NOT A GREP ─────────────────────────────────────────────────────
 *
 * The brief (§6) forbids `expect(grepCount).toBe(0)` on a drifting string. Each
 * block below anchors on a STRUCTURE instead:
 *
 *   A. the transitive first-party import closure of the Health surface — the
 *      real module graph, so a rename, a re-export or a barrel hop is still
 *      caught, and a `import x from 'some-new-mic-lib'` is caught by category
 *      rather than by name; plus a capture-API probe over every module in that
 *      closure, which needs no package named in advance (see `CAPTURE_APIS`);
 *   B. the Hono route table registered by `backend/src/routes/health*.ts` —
 *      the paths themselves, not prose about them;
 *   C. the brand capability declaration in `brands/symply-health/brand.cjs`.
 *
 * Every block proves its own probe still WORKS before asserting a negative — a
 * posture guard that silently stops probing is worse than no guard, because it
 * reads green forever. Two kinds of self-check do that here:
 *
 *   - FLOORS (001, 005): the walk must still resolve a Health graph of a
 *     plausible size, and the extractor must still find the `/health` mounts.
 *   - POSITIVE CONTROLS (004, 007): the same detector, pointed at code that
 *     genuinely uses voice, must light up. 004 simulates the exact one-line
 *     port a future developer would write; 007 aims block B at House's real
 *     `/aihousekeeper/voice-session`.
 *
 * 007 exists because this guard failed that control on its first draft: it
 * matched RELATIVE route paths, and House's voice endpoint registers `POST '/'`
 * with the capability living entirely in its mount prefix. Block B now composes
 * the full path. Keep the control — it is what caught that.
 *
 * ── WHEN A FUTURE PORTER SHOULD DELETE THIS FILE ─────────────────────────────
 *
 * Delete it when voice genuinely ports — i.e. when ALL of these are true:
 *
 *   1. a Health screen or store imports a voice/mic capability on purpose;
 *   2. that surface has its own behavioural tests (LOAD / INTERACT / MUTATION /
 *      CANCEL / VALIDATION / ERROR / CORNER per the coverage contract) —
 *      matrix rows HEALTH-VOICE-012…019 are pre-specified as `deferred` for
 *      exactly this;
 *   3. the microphone purpose string is Health's own and describes what Health
 *      does with it (today `app.config.ts:71` hands EVERY brand a string that
 *      names "Aihousekeeper" — see DEFECT note in the PERMISSION block).
 *
 * Until then: `it('is not ported', …)` below is the pin, and
 * `it('cannot be ported without …', …)` is the precondition that must OUTLIVE
 * the pin. If you delete the pin, keep the precondition.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../../..');

// ─────────────────────────────────────────────────────────────────────────────
// Shared probe: transitive first-party import closure
// ─────────────────────────────────────────────────────────────────────────────

/** tsconfig.json `paths` ⇄ babel.config.js aliases, as a resolver map. */
const ALIASES: Record<string, string> = {
  '@api': 'src/api',
  '@assets': 'src/assets',
  '@brand': 'src/brand',
  '@components': 'src/components',
  '@config': 'src/config',
  '@constants': 'src/constants',
  '@contexts': 'src/contexts',
  '@features': 'src/features',
  '@hooks': 'src/hooks',
  '@navigation': 'src/navigation',
  '@screens': 'src/screens',
  '@services': 'src/services',
  '@stores': 'src/stores',
  '@theme': 'src/theme',
  '@models': 'src/types',
  '@utils': 'src/utils',
  '@shared-user': 'src/shared-user',
  '@smart-engine': 'src/smart-engine',
  '@': 'src',
};

const EXTS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Voice/microphone CAPABILITY providers, by package. Matched as a package-name
 * prefix so a version bump or a deep import (`expo-audio/build/…`) still hits.
 *
 * This is a capability denylist, not a spelling list: the point is that NOTHING
 * able to open a microphone or synthesise speech is reachable. Add to it when a
 * new such package enters `package.json`; do not remove an entry to make a test
 * pass.
 */
const VOICE_PACKAGES = [
  'expo-speech',
  'expo-speech-recognition',
  'expo-audio',
  'expo-av',
  '@react-native-voice/voice',
  'react-native-voice',
  'react-native-webrtc',
  '@config-plugins/react-native-webrtc',
  'react-native-sound',
  'react-native-track-player',
  'react-native-audio-recorder-player',
  '@livekit/react-native',
];

/**
 * First-party modules that already wrap those packages. Listed as repo-relative
 * paths so they are resolved through the same graph walk as everything else —
 * if one of these files is renamed the resolution below simply stops matching,
 * and the package-level denylist above still catches the underlying capability.
 */
const VOICE_FIRST_PARTY = [
  'src/hooks/useQuickSpeech.ts',
  'src/hooks/useVoiceMode.ts',
  'src/services/voice-recording.ts',
];

function resolveFirstParty(spec: string, fromFile: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (spec === alias) {
        base = path.join(root, target);
        break;
      }
      if (spec.startsWith(`${alias}/`)) {
        base = path.join(root, target, spec.slice(alias.length + 1));
        break;
      }
    }
  }
  if (!base) return null;
  for (const ext of EXTS) {
    const withExt = `${base}${ext}`;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) return withExt;
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of EXTS) {
      const index = path.join(base, `index${ext}`);
      if (fs.existsSync(index)) return index;
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return null;
}

/** `import … from 'x'` / `export … from 'x'` / `import('x')` / `require('x')`. */
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function specifiersOf(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m = IMPORT_RE.exec(src);
  while (m) {
    out.push(m[1] || m[2] || m[3] || m[4]);
    m = IMPORT_RE.exec(src);
  }
  return out;
}

function sourceFilesUnder(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests and fixtures are allowed to import anything (a Kaizen screen test
      // mocks `@services/voice-recording`); only SHIPPED code is in scope.
      if (['__tests__', '__mocks__', 'test-utils'].includes(entry.name)) continue;
      sourceFilesUnder(p, acc);
    } else if (EXTS.includes(path.extname(entry.name)) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
      acc.push(p);
    }
  }
  return acc;
}

type Closure = {
  /** Every first-party module reachable from the Health entry points. */
  modules: Set<string>;
  /** Bare (node_modules / native) specifier → the files that import it. */
  external: Map<string, Set<string>>;
  /** The entry points the walk started from. */
  seeds: string[];
};

/**
 * The three doors into the Health feature: the feature directory itself, the
 * Health API clients, and the expo-router screens that mount them.
 */
function healthSeeds(): string[] {
  return [
    ...sourceFilesUnder(path.join(root, 'src/features/health')),
    ...fs
      .readdirSync(path.join(root, 'src/api'))
      .filter(f => /^health/i.test(f) && /\.tsx?$/.test(f))
      .map(f => path.join(root, 'src/api', f)),
    ...fs
      .readdirSync(path.join(root, 'app/(tabs)'))
      .filter(f => /^health-/.test(f))
      .map(f => path.join(root, 'app/(tabs)', f)),
  ];
}

/** Everything reachable from `seeds`, following first-party imports only. */
function closureFrom(seeds: string[]): Closure {
  const modules = new Set<string>();
  const external = new Map<string, Set<string>>();
  const queue = [...seeds];

  while (queue.length) {
    const file = queue.pop() as string;
    if (modules.has(file)) continue;
    modules.add(file);
    for (const spec of specifiersOf(file)) {
      const resolved = resolveFirstParty(spec, file);
      if (resolved) {
        if (!modules.has(resolved)) queue.push(resolved);
      } else {
        if (!external.has(spec)) external.set(spec, new Set());
        (external.get(spec) as Set<string>).add(path.relative(root, file));
      }
    }
  }

  return { modules, external, seeds };
}

/**
 * Source-level markers for actually OPENING a microphone or speaking — the
 * capability itself, as opposed to merely linking a package that offers it.
 *
 * This is the sharper half of the probe and it runs over EVERY reachable
 * module, not just importers of `VOICE_PACKAGES`. So a mic opened through a
 * package nobody thought to denylist — or through a bare `NativeModules` call —
 * is still caught. `HEALTH-VOICE-002c` is its positive control.
 */
const CAPTURE_APIS = [
  'getUserMedia',
  'getDisplayMedia',
  'mediaDevices',
  'MediaStream',
  'addTrack',
  'addTransceiver',
  'AudioRecorder',
  'useAudioRecorder',
  'RecordingPresets',
  'Audio.Recording',
  'SpeechRecognition',
  'startSpeechRecognition',
  'Speech.speak',
  'startListeningAsync',
];

function captureApisIn(rel: string): string[] {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return [];
  const src = fs.readFileSync(p, 'utf8');
  return CAPTURE_APIS.filter(api => src.includes(api));
}

const asRel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');

/**
 * TRANSPORT EXEMPTIONS — reachable importers of a `VOICE_PACKAGES` entry that
 * do not thereby put a microphone in Health.
 *
 * `react-native-webrtc` is the one entry on that list which is not a
 * capture-or-synthesis library: it is an RTC transport, and its microphone is
 * opt-in via `getUserMedia` / audio tracks. Everything else there
 * (`expo-speech`, `expo-audio`, `@react-native-voice/voice`, …) exists only to
 * record or speak, so importing one IS the capability and none of them may ever
 * be exempted.
 *
 * The entry below is Budget's local-first peer sync, which reaches Health
 * through the SHARED `src/stores/authStore.ts` (it boots the Budget ledger on
 * sign-in for every brand; `isBudgetLocalFirst()` then no-ops off `symply-budget`
 * at runtime). It opens an `RTCPeerConnection` and one ordered data channel
 * (`symply-lf-sync`) and never touches a track. Landed 2026-08-10.
 *
 * An exemption is NOT a suppression — it survives only while all three of these
 * hold, each asserted below:
 *   - the module is still reachable and still imports that package (002a) —
 *     otherwise the entry is stale and must be deleted;
 *   - the module still contains no `CAPTURE_APIS` marker (002b) — the moment
 *     Budget's peer grows `getUserMedia`, block A goes red again;
 *   - nothing anywhere in the closure captures (002d).
 */
const CAPTURE_EXEMPT: { file: string; pkg: string; why: string }[] = [
  {
    file: 'src/features/budget/local/sync/webrtcPeer.ts',
    pkg: 'react-native-webrtc',
    why: 'RTCPeerConnection + ordered data channel for ledger sync; no tracks, no getUserMedia',
  },
];

function matchesPkg(spec: string, pkg: string): boolean {
  return spec === pkg || spec.startsWith(`${pkg}/`);
}

/** An importer is exempt only while it is declared AND still capture-free. */
function isExemptImporter(rel: string, spec: string): boolean {
  return CAPTURE_EXEMPT.some(
    e => e.file === rel && matchesPkg(spec, e.pkg) && captureApisIn(e.file).length === 0,
  );
}

/**
 * External specifiers in a closure that can open a mic or speak, minus the
 * declared transport exemptions above. A specifier drops out only when EVERY
 * importer of it is exempt.
 */
function voicePackagesIn(c: Closure): string[] {
  const out: string[] = [];
  for (const [spec, importers] of c.external.entries()) {
    if (!VOICE_PACKAGES.some(pkg => matchesPkg(spec, pkg))) continue;
    const flagged = [...importers].filter(rel => !isExemptImporter(rel, spec));
    if (flagged.length) out.push(`${spec} <- ${flagged.join(', ')}`);
  }
  return out;
}

/** First-party voice wrappers in a closure. */
function voiceModulesIn(c: Closure): string[] {
  return VOICE_FIRST_PARTY.filter(rel => c.modules.has(path.join(root, rel)));
}

/** Every reachable module that names a mic/speech capture API. */
function captureCallsIn(c: Closure): string[] {
  return [...c.modules]
    .map(asRel)
    .sort()
    .filter(rel => captureApisIn(rel).length > 0)
    .map(rel => `${rel} => ${captureApisIn(rel).join(', ')}`);
}

const closure = closureFrom(healthSeeds());
const reachableVoicePackages = voicePackagesIn(closure);
const reachableVoiceModules = voiceModulesIn(closure);
const reachableCaptureCalls = captureCallsIn(closure);

const voiceIsReachableFromHealth =
  reachableVoicePackages.length > 0 ||
  reachableVoiceModules.length > 0 ||
  reachableCaptureCalls.length > 0;

// ─────────────────────────────────────────────────────────────────────────────
// A. The module graph
// ─────────────────────────────────────────────────────────────────────────────

describe('HEALTH-VOICE — A. module graph', () => {
  /**
   * The probe's own health check. A refactor that broke `resolveFirstParty`
   * (an alias rename, a move to package imports) would shrink the closure to
   * the seeds and every negative assertion below would pass vacuously. These
   * floors are set well under the real numbers at time of writing (86 seeds,
   * 777 modules, 44 external specifiers) so ordinary churn does not trip them,
   * but a collapsed walk does.
   */
  it('HEALTH-VOICE-001: the import walk still resolves the Health graph', () => {
    expect(closure.seeds.length).toBeGreaterThanOrEqual(40);
    expect(closure.modules.size).toBeGreaterThanOrEqual(300);
    expect(closure.external.size).toBeGreaterThanOrEqual(20);
    // Sanity: the walk really did leave the feature directory and reach the
    // shared UI + API layers, so "no voice anywhere" is a statement about the
    // whole reachable surface and not just about src/features/health.
    expect([...closure.modules].some(f => f.includes(`${path.sep}src${path.sep}components${path.sep}`))).toBe(true);
    expect([...closure.modules].some(f => f.includes(`${path.sep}src${path.sep}api${path.sep}`))).toBe(true);
  });

  /**
   * The load-bearing assertion. `expo-audio` / `expo-speech-recognition` /
   * `react-native-webrtc` are all present in package.json and linked into the
   * Health binary — this proves no Health-reachable module actually calls them.
   */
  it('HEALTH-VOICE-002: no microphone/speech package is reachable from Health', () => {
    expect(reachableVoicePackages).toEqual([]);
  });

  /**
   * Keeps every `CAPTURE_EXEMPT` entry load-bearing. An exemption that no longer
   * describes the graph is dead text that would silently cover a future import,
   * so it must be deleted rather than left behind — this is what says so.
   */
  it('HEALTH-VOICE-002a: every transport exemption is still real and still needed', () => {
    for (const e of CAPTURE_EXEMPT) {
      expect({ file: e.file, exists: fs.existsSync(path.join(root, e.file)) }).toEqual({
        file: e.file,
        exists: true,
      });
      // Still reachable from Health…
      expect([...closure.modules].map(asRel)).toContain(e.file);
      // …and still the importer of the package it is exempted for.
      expect(specifiersOf(path.join(root, e.file)).some(s => matchesPkg(s, e.pkg))).toBe(true);
    }
  });

  /**
   * The exemption's actual precondition. `react-native-webrtc` is exempt only
   * while the module using it stays a data-channel transport; one `getUserMedia`
   * and this goes red, which is the whole point of exempting the IMPORTER rather
   * than removing the package from `VOICE_PACKAGES`.
   */
  it('HEALTH-VOICE-002b: no exempted module has grown a capture API', () => {
    expect(
      CAPTURE_EXEMPT.map(e => ({ file: e.file, capture: captureApisIn(e.file) })),
    ).toEqual(CAPTURE_EXEMPT.map(e => ({ file: e.file, capture: [] })));
  });

  /**
   * FALSIFIABILITY for the capture probe, mirroring 004's role for the package
   * probe. `CAPTURE_APIS` is a list of source markers, and a list of strings
   * that matches nothing reads green forever — so point it at the two
   * first-party modules that genuinely do record, and require it to fire.
   */
  it('HEALTH-VOICE-002c: the capture probe really fires on code that records', () => {
    expect(captureApisIn('src/hooks/useQuickSpeech.ts')).toContain('SpeechRecognition');
    expect(captureApisIn('src/services/voice-recording.ts')).toContain('AudioRecorder');
    // And it is not simply matching everything: an ordinary Health module is clean.
    expect(captureApisIn('src/features/health/screens/HealthHomeScreen.tsx')).toEqual([]);
  });

  /**
   * The statement 002 is really trying to make, asserted directly and over the
   * WHOLE closure rather than only over importers of a denylisted package: no
   * Health-reachable module opens a microphone or synthesises speech, by any
   * route. This is strictly wider than 002 — it needs no package to be named in
   * advance — and it is what the transport exemption above is measured against.
   */
  it('HEALTH-VOICE-002d: no Health-reachable module calls a mic/speech capture API', () => {
    expect(reachableCaptureCalls).toEqual([]);
  });

  /**
   * Same statement one layer up: the three first-party wrappers House and
   * Kaizen use. Catching these separately gives a much better failure message
   * than "expo-audio appeared", because the wrapper is what a porter would
   * actually import.
   */
  it('HEALTH-VOICE-003: no first-party voice wrapper is reachable from Health', () => {
    expect(reachableVoiceModules).toEqual([]);
  });

  /**
   * FALSIFIABILITY — the most important test in block A.
   *
   * 002 and 003 assert a negative, and a negative is only worth something if
   * the same machinery produces a POSITIVE when voice really is present. So
   * this simulates the exact one-line change a future porter would make — a
   * Health screen importing `@hooks/useQuickSpeech` — by adding that module as
   * an extra SEED, and asserts the detector lights up.
   *
   * It touches no source file: the simulation is entirely in the seed list.
   * It calls the same `closureFrom` / `voicePackagesIn` / `voiceModulesIn` used
   * above, so the two can never drift apart. If someone weakens the denylist or
   * breaks the walk to make 002 pass, this goes red instead.
   */
  it('HEALTH-VOICE-004: the detector really fires when voice IS reachable', () => {
    const simulated = closureFrom([
      ...healthSeeds(),
      path.join(root, 'src/hooks/useQuickSpeech.ts'), // <- the porter's one line
    ]);
    expect(voiceModulesIn(simulated)).toContain('src/hooks/useQuickSpeech.ts');
    expect(voicePackagesIn(simulated).join(' ')).toContain('expo-speech-recognition');

    // And the transitive case: a wrapper reached indirectly, via Kaizen's quiz
    // screen, still resolves through to `expo-audio`.
    const viaWrapper = closureFrom([
      path.join(root, 'src/features/kaizen/screens/BookQuizScreen.tsx'),
    ]);
    expect(voiceModulesIn(viaWrapper)).toContain('src/services/voice-recording.ts');
    expect(voicePackagesIn(viaWrapper).join(' ')).toContain('expo-audio');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. The Worker route table
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_INDEX = fs.readFileSync(path.join(root, 'backend/src/index.ts'), 'utf8');

/**
 * FULL paths, not relative ones. This distinction is load-bearing and was found
 * by running this guard's own logic against a known-positive control: House's
 * voice endpoint registers `POST '/'` inside `routes/aihousekeeper-voice.ts`
 * and gets its entire identity from the mount in `index.ts`
 * (`/households/:householdId/aihousekeeper/voice-session`). A relative-path
 * check called that file clean. So the mount prefix is resolved here and the
 * capability test runs against the composed path.
 */
function mountedRouteFiles(): { prefix: string; file: string }[] {
  const imports = new Map<string, string>();
  const importRe =
    /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]\.\/routes\/([\w.-]+)['"]/g;
  let m = importRe.exec(WORKER_INDEX);
  while (m) {
    imports.set(m[1], m[2]);
    m = importRe.exec(WORKER_INDEX);
  }
  const out: { prefix: string; file: string }[] = [];
  const mountRe = /\.route\(\s*(['"`])([^'"`]+)\1\s*,\s*([A-Za-z_$][\w$]*)/g;
  let r = mountRe.exec(WORKER_INDEX);
  while (r) {
    const file = imports.get(r[3]);
    if (file) out.push({ prefix: r[2], file });
    r = mountRe.exec(WORKER_INDEX);
  }
  return out;
}

/**
 * `healthAi.post('/ai/coach/turn', …)` → `POST /ai/coach/turn`.
 * The path must start with `/` — without that anchor this also matches Hono's
 * context accessors (`c.get('userId')`) and invents routes that do not exist.
 */
const ROUTE_RE =
  /\b[A-Za-z_$][\w$]*\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])(\/[^'"`]*)\2/g;

function registrationsIn(file: string): { method: string; rel: string }[] {
  const p = path.join(root, 'backend/src/routes', `${file}.ts`);
  if (!fs.existsSync(p)) return [];
  const src = fs.readFileSync(p, 'utf8');
  const out: { method: string; rel: string }[] = [];
  ROUTE_RE.lastIndex = 0;
  let m = ROUTE_RE.exec(src);
  while (m) {
    out.push({ method: m[1].toUpperCase(), rel: m[3] });
    m = ROUTE_RE.exec(src);
  }
  return out;
}

function fullPath(prefix: string, rel: string): string {
  return `${prefix}${rel === '/' ? '' : rel}`.replace(/\/{2,}/g, '/') || '/';
}

const healthMounts = mountedRouteFiles().filter(mt => /^health/.test(mt.file));
const healthRoutes = [
  ...new Set(
    healthMounts.flatMap(mt =>
      registrationsIn(mt.file).map(r => `${r.method} ${fullPath(mt.prefix, r.rel)}`),
    ),
  ),
];

/** Anything whose NAME advertises capturing, carrying or transcribing speech. */
const AUDIO_CAPABILITY =
  /audio|voice|speech|transcri|whisper|realtime|dictat|utterance|\btts\b|\bstt\b/i;

describe('HEALTH-VOICE — B. Worker route table', () => {
  /**
   * Probe health check. If the registration or mount style changes (a builder,
   * a table, a decorator) this extractor silently returns [] and the negative
   * below becomes meaningless. Real numbers at time of writing: 8 `/health`
   * mounts, 143 distinct full paths.
   */
  it('HEALTH-VOICE-005: the route extractor still sees the /health surface', () => {
    expect(healthMounts.length).toBeGreaterThanOrEqual(5);
    expect(healthRoutes.length).toBeGreaterThanOrEqual(100);
    for (const mt of healthMounts) {
      expect({ file: mt.file, count: registrationsIn(mt.file).length }).toEqual({
        file: mt.file,
        count: expect.any(Number),
      });
      expect(registrationsIn(mt.file).length).toBeGreaterThan(0);
    }
    // The AI surface exists and is text-only — the whole posture in one line: a
    // coach endpoint, and no endpoint that takes audio. Also proves the mount
    // prefix really is being composed in (a relative-path bug drops `/health`).
    expect(healthRoutes).toContain('POST /health/ai/coach/turn');
  });

  /**
   * A voice port needs somewhere to send audio. Nothing on `/health` accepts
   * it — no upload, no transcription proxy, no realtime session mint. House
   * has exactly such a route; Health has no analogue.
   */
  it('HEALTH-VOICE-006: no /health route is an audio, transcription or realtime endpoint', () => {
    expect(healthRoutes.filter(r => AUDIO_CAPABILITY.test(r))).toEqual([]);
  });

  /**
   * FALSIFIABILITY for block B — and a regression pin on a hole this guard
   * actually had.
   *
   * The first draft matched RELATIVE registration paths. Run against House's
   * real voice endpoint it reported "clean", because
   * `routes/aihousekeeper-voice.ts` registers `POST '/'` and takes its whole
   * identity from the mount in `index.ts`. A Health audio route added the same
   * way would have sailed straight through 007.
   *
   * So: point the same extractor at that known-positive file and require a hit.
   * If someone simplifies the mount composition away, this goes red rather than
   * 007 going quietly useless.
   */
  it('HEALTH-VOICE-007: the route probe detects a real voice endpoint (House control)', () => {
    const control = mountedRouteFiles().filter(mt => mt.file === 'aihousekeeper-voice');
    expect(control.length).toBeGreaterThan(0);

    const controlPaths = control.flatMap(mt =>
      registrationsIn(mt.file).map(r => `${r.method} ${fullPath(mt.prefix, r.rel)}`),
    );
    expect(controlPaths).toContain('POST /households/:householdId/aihousekeeper/voice-session');
    expect(controlPaths.filter(r => AUDIO_CAPABILITY.test(r)).length).toBeGreaterThan(0);
  });

  /**
   * The storage half, and the strongest anchor in this file because it is a
   * data contract rather than a name.
   *
   * `PUT /health/files/:id/content` is the ONE route that takes raw bytes, so
   * it is the path of least resistance for a voice port ("just POST the m4a to
   * the file store"). It cannot be used that way: `ALLOWED_MIME_TYPES` admits
   * only images, PDF, plain text and JSON, and `user_files.file_type` is
   * constrained to three non-audio values by a CHECK in migration 0120. A
   * recording has nowhere to land.
   */
  it('HEALTH-VOICE-008: the Health asset store admits no audio MIME type', () => {
    const service = fs.readFileSync(
      path.join(root, 'backend/src/services/health-assets-service.ts'),
      'utf8',
    );
    const block = service.slice(service.indexOf('ALLOWED_MIME_TYPES'));
    const declared = [...block.slice(0, block.indexOf('};')).matchAll(/'([\w.+-]+\/[\w.+-]+)'/g)].map(
      x => x[1],
    );
    // Probe health check — the allow-list is really being read.
    expect(declared.length).toBeGreaterThanOrEqual(8);
    expect(declared).toContain('image/jpeg');
    // The assertion.
    expect(declared.filter(t => t.startsWith('audio/'))).toEqual([]);
    expect(/'audio_note'|'recording'|'voice'/.test(service)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Brand declaration, permission story, and the port preconditions
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const healthBrand = require('../../../../../brands/symply-health/brand.cjs');

/**
 * PERMISSION — the one genuinely latent piece of this area, recorded here
 * because it is the half a porter would otherwise assume still needs building.
 *
 * The Health build ALREADY ships microphone-class permissions:
 *
 *   - `ios/SymplyEcosystem/Info.plist` (the committed tree Xcode and EAS build)
 *     declares `NSMicrophoneUsageDescription` AND
 *     `NSSpeechRecognitionUsageDescription`, brand-neutrally via
 *     `$(PRODUCT_NAME)`. That plist is shared by all five brands.
 *   - On the prebuild path, `app.config.ts` re-injects them for every brand
 *     unconditionally: line 71 (mic), lines 122-142 (the
 *     `@config-plugins/react-native-webrtc` and `expo-speech-recognition`
 *     plugin entries).
 *
 * DEFECT (report-only, not fixed here — `app.config.ts` is out of this area's
 * ownership): `app.config.ts:71` and `:130` build that string as
 * `${product} uses the microphone so you can talk to Aihousekeeper hands-free
 * in voice mode.` — `product` is brand-derived but "Aihousekeeper" is
 * hard-coded. A prebuilt Symply Health binary would therefore prompt with a
 * Symply House feature name, for a feature Health does not have.
 *
 * The consequence for THIS guard: "has a permission story" is already true and
 * cannot be used as the thing that blocks a careless port. So the precondition
 * test below leans on the half that is NOT already satisfied — tests.
 */
const IOS_INFO_PLIST = fs.readFileSync(
  path.join(root, 'ios/SymplyEcosystem/Info.plist'),
  'utf8',
);
const micPermissionAlreadyShipped =
  IOS_INFO_PLIST.includes('NSMicrophoneUsageDescription') &&
  IOS_INFO_PLIST.includes('NSSpeechRecognitionUsageDescription');

describe('HEALTH-VOICE — C. brand posture and port preconditions', () => {
  /**
   * The brand pack is where a capability gets turned on for Health (`features`
   * drives tabs, widget, watch, drive). Voice has no key there, which is the
   * declaration-level statement of "not ported". A porter adding one lands
   * here first.
   */
  it('HEALTH-VOICE-009: the Health brand declares no voice/mic capability', () => {
    const featureKeys = Object.keys(healthBrand.features ?? {});
    expect(featureKeys.filter(k => /voice|speech|mic|audio|dictat/i.test(k))).toEqual([]);
    // Pin the real shape so an unrelated feature flag landing here is visible.
    expect(featureKeys.sort()).toEqual(['budget', 'googleDrive', 'watch', 'widget']);
  });

  /**
   * THE PIN. Delete this single test on the day voice ships; leave 011 alone.
   *
   * It restates A+B as one verdict so the failure message names the posture
   * rather than a package. If this goes red and the port was intentional:
   * remove this test, flip HEALTH-VOICE-012…019 in
   * `documents/engineering/testing/matrices/health.md` from `deferred` to real
   * paths, and fix the Aihousekeeper purpose string documented above.
   */
  it('HEALTH-VOICE-010: VoiceChat is still not ported (delete this test when it is)', () => {
    expect({
      voicePackages: reachableVoicePackages,
      voiceModules: reachableVoiceModules,
      audioRoutes: healthRoutes.filter(r => /audio|voice|speech|transcri/i.test(r)),
    }).toEqual({ voicePackages: [], voiceModules: [], audioRoutes: [] });
  });

  /**
   * THE PRECONDITION — this one must OUTLIVE the pin.
   *
   * It is a no-op while nothing is ported, and becomes the real gate the moment
   * something is: a microphone may only enter the Health surface alongside its
   * own behavioural tests and a declared permission. Written as a conditional
   * rather than a second pin so it keeps biting after 007 is deleted.
   */
  it('HEALTH-VOICE-011: voice cannot enter Health without tests and a permission story', () => {
    if (!voiceIsReachableFromHealth) {
      expect(voiceIsReachableFromHealth).toBe(false);
      return;
    }

    // (1) A permission story must exist. Today this is already true — see the
    //     PERMISSION note above — so it is asserted rather than assumed, to
    //     catch a future hygiene pass that strips the keys and leaves the code.
    expect(micPermissionAlreadyShipped).toBe(true);

    // (2) Matching tests must exist: a Health-owned suite whose NAME claims the
    //     voice surface. A posture guard is not coverage, so this file itself
    //     does not count.
    const areas = path.join(root, 'src/features/health/__tests__/areas');
    const behavioural = fs
      .readdirSync(areas)
      .filter(f => /voice|mic|speech|dictat/i.test(f) && /\.(test|spec)\.[jt]sx?$/.test(f))
      .filter(f => f !== 'voice.posture.test.ts');
    expect(behavioural.length).toBeGreaterThan(0);
  });
});
