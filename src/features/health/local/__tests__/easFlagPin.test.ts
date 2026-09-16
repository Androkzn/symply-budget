import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * He0 — the build must PIN the client gate off (plan §1.7).
 *
 * `flag.ts` brand-defaults `EXPO_PUBLIC_HEALTH_LOCAL_FIRST` to ON for
 * `symply-health` when the var is unset. That default is deliberate and stays —
 * it is what He12 (full) finally switches on by REMOVING the pin below. Until
 * then the var must be pinned to `"0"` in every Health build profile, because
 * `EXPO_PUBLIC_*` is inlined at bundle time: a Health binary built with the var
 * unset ships flag-1, opens a ledger nothing writes to yet, and keeps hitting
 * D1 from the screens — the dual-world state §1.3 rejects, with no sub-60s kill
 * switch to undo it (§1.7).
 *
 * This suite reads the committed `eas.json` rather than restating the plan, so
 * a new Health profile (or an `env` block edited to drop the key) fails here
 * instead of at the next `eas build`.
 *
 * When He12 (full) lands, delete the pins AND this suite in the same merge —
 * do not weaken it to "0 or unset", which would stop guarding anything.
 */

const FLAG = 'EXPO_PUBLIC_HEALTH_LOCAL_FIRST';
const HEALTH_BRAND = 'symply-health';

const EAS_PATH = resolve(__dirname, '../../../../../eas.json');

type BuildProfile = {
  extends?: string;
  env?: Record<string, string>;
};

const easJson = JSON.parse(readFileSync(EAS_PATH, 'utf8')) as {
  build: Record<string, BuildProfile>;
};

const profiles = easJson.build;

/**
 * EAS merges a profile's `env` over its parent's, so the value a build actually
 * sees is the resolved chain — not the literal block. Resolve it the same way.
 */
function resolveEnv(name: string, seen: string[] = []): Record<string, string> {
  const profile = profiles[name];
  if (!profile) throw new Error(`eas.json has no build profile "${name}"`);
  if (seen.includes(name))
    throw new Error(`eas.json extends cycle: ${[...seen, name].join(' -> ')}`);

  const parent = profile.extends
    ? resolveEnv(profile.extends, [...seen, name])
    : {};
  return { ...parent, ...(profile.env ?? {}) };
}

const healthProfiles = Object.keys(profiles).filter(
  name => resolveEnv(name).APP_BRAND === HEALTH_BRAND,
);

describe('eas.json — Health local-first flag pin', () => {
  it('finds the Health build profiles at all', () => {
    // Guards the guard: if `APP_BRAND` is ever renamed, the per-profile checks
    // below would vacuously pass over an empty list.
    expect(healthProfiles).toEqual(
      expect.arrayContaining([
        'symply-health-development',
        'symply-health-preview',
        'symply-health-staging',
        'symply-health-production',
        'symply-health-simulator',
      ]),
    );
  });

  it.each(
    Object.keys(profiles)
      .filter(name => profiles[name].env?.APP_BRAND === HEALTH_BRAND)
      .map(name => [name] as const),
  )(`%s declares ${FLAG} = "0" in its own env block`, name => {
    // Declared, not inherited: a profile that owns an `env` block owns the pin,
    // because its own block SHADOWS nothing it does not restate.
    expect(profiles[name].env?.[FLAG]).toBe('0');
  });

  it.each(healthProfiles.map(name => [name] as const))(
    `%s resolves to ${FLAG} = "0" after \`extends\``,
    name => {
      // Catches the inheriting profiles too (`symply-health-testflight` extends
      // production and declares no `env` of its own).
      expect(resolveEnv(name)[FLAG]).toBe('0');
    },
  );

  it('pins every profile whose name says Health, brand key or not', () => {
    // A new `symply-health-*` profile that forgets `APP_BRAND` would otherwise
    // slip past both lists above.
    const byName = Object.keys(profiles).filter(name =>
      name.startsWith(`${HEALTH_BRAND}-`),
    );
    expect(byName.length).toBeGreaterThan(0);
    for (const name of byName) {
      expect([name, resolveEnv(name)[FLAG]]).toEqual([name, '0']);
    }
  });

  it('leaves other brands untouched — this pin is Health-only', () => {
    const foreign = Object.keys(profiles).filter(name => {
      const env = resolveEnv(name);
      return env.APP_BRAND !== HEALTH_BRAND && env[FLAG] !== undefined;
    });
    expect(foreign).toEqual([]);
  });
});
