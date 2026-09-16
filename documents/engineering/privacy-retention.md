# Privacy and retention — platform bridge

> Companion to [Ecosystem_Data_Bridge_Plan.md](../design/Ecosystem_Data_Bridge_Plan.md) §3 Retention essentials.

## Principles

- No table stores raw JWTs, passwords, IdP proofs, provider authorization codes, raw idempotency keys, Soft Transfer envelope payloads, or Realtime audio.
- Product access/refresh tokens are SecureStore-only on device; never MMKV/Zustand persist/App Group (`at+jwt`). House companion tokens (`companion+jwt`) are the only capability tokens allowed in House App Group.

## Platform row retention (House D1)

| Class | Retention |
|-------|-----------|
| One-use proofs / tickets / IdP challenges | Purge shortly after consume or expiry |
| Transfer JTIs / speech grants | Purge after 2× TTL |
| Idempotency / prepare rows | Live 24h; purge by 48h |
| Refresh-family hashes (revoked/expired) | ≤30 days after final expiry/revocation (reuse detection) |
| Deletion saga / status rows | Purge 30 days after terminal state |
| Identity tombstones | Until all joined/processor receipts terminal, then +30 days |
| Billing / legal | Detached from `user_id` / contact / vendor App User ID; follow lawful retention separately |

## Child Workers

House-authority tables remain empty and unmounted. Children may retain local mirrors, import receipts, and product deletion work items per brand policy.

## Ops

Pepper/key versions remain until their last referencing row is purged. Document rotations in SERVICES.md.
