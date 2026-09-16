/**
 * Aihousekeeper CONFIG_KV seed — run once per environment BEFORE first deploy.
 *
 * Per MCP_UI_Implementation_Plan_v3.1.md §11/Ops3. This script prints the
 * `wrangler kv key put` commands the developer must run manually. Values
 * are committed here (non-secret) except `aihousekeeper_briefing_signing_key_v1`
 * which the developer must generate and set via `wrangler secret put`.
 *
 * Usage:
 *   npx tsx backend/scripts/seed-aihousekeeper-kv.ts --env staging
 *   npx tsx backend/scripts/seed-aihousekeeper-kv.ts --env production
 */

const AIHOUSEKEEPER_KV_SEEDS: Record<string, string> = {
  // Kill-switches — operator-controllable at runtime.
  aihousekeeper_enabled: 'true',
  aihousekeeper_outbound_loop_enabled: 'true',
  aihousekeeper_briefings_enabled: 'true',
  aihousekeeper_sms_enabled: 'true',
  aihousekeeper_email_digest_enabled: 'true',
  aihousekeeper_conservative_mode: 'false',

  // Signing-key metadata for public briefing URL (B11).
  aihousekeeper_briefing_signing_key_version: 'v1',
  aihousekeeper_briefing_signing_key_min_version: 'v1',

  // Memory redaction toggle (cost lever).
  aihousekeeper_memory_ai_redaction_enabled: 'true',
};

function main(): void {
  const envIdx = process.argv.indexOf('--env');
  const env = envIdx >= 0 ? process.argv[envIdx + 1] : undefined;
  if (!env || !['staging', 'production'].includes(env)) {
    process.stderr.write('Usage: seed-aihousekeeper-kv.ts --env {staging|production}\n');
    process.exit(1);
  }

  process.stdout.write(`# Run these commands to seed CONFIG_KV for --env ${env}:\n`);
  for (const [key, value] of Object.entries(AIHOUSEKEEPER_KV_SEEDS)) {
    process.stdout.write(
      `wrangler kv key put --binding CONFIG_KV --env ${env} ${key} ${JSON.stringify(value)}\n`
    );
  }
  process.stdout.write(
    `\n# NOTE: aihousekeeper_briefing_signing_key_v1 is key material — generate (openssl rand -hex 32) and set via:\n` +
      `#   wrangler secret put AIHOUSEKEEPER_BRIEFING_SIGNING_KEY_V1 --env ${env}\n` +
      `# (Or, if you choose to keep signing keys in KV rather than secrets, use wrangler kv key put.)\n`
  );
}

main();
