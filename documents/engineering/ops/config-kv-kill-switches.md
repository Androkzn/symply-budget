# CONFIG_KV kill switches (Track B B0)

Operational pause flags in Worker `CONFIG_KV` (not D1 product flags). When active, the Worker emits a one-shot Sentry warning per isolate: `CONFIG_KV kill switch active` (tag `kill_switch`).

## Keys

| Key | Effect | Wired in |
|-----|--------|----------|
| `notifications_delivery_paused` | Skip scheduled notification delivery + House task reminders | `cron/scheduled.ts` |
| `report_pipeline_paused` | Block `process-enhanced` (503) + stuck-report sweep | `routes/reports.ts`, `enhanced-pdf-processor.ts` |
| `ai_rate_limit_deny` | AI/chat/coach rate-limit middleware returns 503 | `middleware/rate-limit.ts` |

Truthy values: `true`, `1`, `yes` (case-sensitive). Absent / other → inactive.

## Activate (staging example)

Repeat per brand config (`wrangler.toml`, `wrangler.budget.toml`, `wrangler.kaizen.toml`, `wrangler.health.toml`):

```bash
cd backend
npx wrangler kv key put --binding CONFIG_KV --env staging \
  notifications_delivery_paused true
# Budget/Kaizen/Health: add -c wrangler.<brand>.toml
```

## Verify (<60s)

```bash
npx wrangler kv key get --binding CONFIG_KV --env staging notifications_delivery_paused
npx wrangler tail --env staging --format pretty
# Expect: [B0] CONFIG_KV kill switch active: notifications_delivery_paused
```

Sentry alert (manual UI): **Alerts → Create Alert → Issues → message contains `CONFIG_KV kill switch active`** → notify Slack/email (one-shot per isolate; no code deploy).

## Rollback

```bash
npx wrangler kv key delete --binding CONFIG_KV --env staging notifications_delivery_paused
```

Same pattern for `report_pipeline_paused` and `ai_rate_limit_deny`.

## Related

- Runtime helpers: `backend/src/services/config-flags.ts`
- Lambda webhook secret: `LAMBDA_CALLBACK_API_KEY` (B6) — deploy preflight `backend/scripts/verify-lambda-callback-secret.sh`
- Health D1 `0092`/`0093`: **do not apply** until Data Bridge DoD
