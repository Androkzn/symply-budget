# `@symply/local-first`

Shared local-first core for Symply Ecosystem (Budget V2 first; House/Health later).

**Contracts:** [Symply_Budget_TRD_v2.0.md](../../documents/requirements/Buget%20v2/Symply_Budget_TRD_v2.0.md)

## Phase 0 scope

| Module | Status |
|--------|--------|
| Crypto (Ed25519, AES-GCM, Argon2id, HKDF) | Implemented (pure TS via `@noble/*`) |
| Key hierarchy helpers | Implemented |
| Platform adapters (SecureStore, FS) | Interfaces only |
| Memory store | Implemented (Jest / single-process fallback) |
| SQLite store | Implemented (`SqliteLocalFirstStore` + injectable `SqliteDriver`; Budget uses `expo-sqlite`) |
| SQLCipher page encryption | Follow-up (op-sqlite JSI); ops payloads already AEAD under HDK |
| Operation log append / verify / apply | Implemented |
| Sync / mailbox / control client | Stubs + types |

## Rules

- No React Native UI imports.
- Platform storage/network injected via adapters.
- Financial payloads never designed for backend SoT.

## Scripts

```bash
npm run test -w @symply/local-first
npm run typecheck -w @symply/local-first
```

## Spike defaults (Phase 0)

| Concern | Choice | Notes |
|---------|--------|-------|
| Crypto | `@noble/ciphers` + `@noble/curves` + `@noble/hashes` | Audited pure TS; works in Node tests and RN |
| Local DB | `SqliteLocalFirstStore` + `expo-sqlite` on device; memory store in tests |
| SQLCipher pages (follow-up) | op-sqlite or equivalent JSI binding |
| Sync transport (later) | `react-native-webrtc` (already in app deps via config plugin) | Not wired in Phase 0 |
