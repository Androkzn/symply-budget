# DLQ message retention (14 days)

Cloudflare Queues DLQ retention defaults to **4 days**; undrained messages are deleted after that window. Wrangler TOML does **not** expose `message_retention_period` on `[[queues.consumers]]` or producers — set retention via CLI after deploy (all envs × all fleet brands).

## One-shot (preferred)

From `backend/` (loads all fleet + Language DLQ names):

```bash
eval "$(../scripts/secrets/export-env.sh)"
npm run ops:dlq-retention
```

Script: [`backend/scripts/set-dlq-retention.sh`](../../backend/scripts/set-dlq-retention.sh) (`1209600` seconds = 14 days).

## Manual

```bash
wrangler queues update <queue-name> --message-retention-period-secs 1209600
```

Repeat for each `*-dlq` queue in `wrangler.toml`, `wrangler.budget.toml`, `wrangler.kaizen.toml`, `wrangler.health.toml`, and `backend-language/wrangler.toml` (staging + production names differ by prefix).

House staging DLQs (no brand prefix): `aihousekeeper-outbound-staging-dlq`, `garden-plan-generation-staging-dlq`, `task-enrichment-staging-dlq`.
