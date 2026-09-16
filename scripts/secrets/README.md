# Symply secrets (Keychain helpers)

Operator tokens for agents live in **macOS Keychain** under `symply.<system>.<name>`.

```bash
./scripts/secrets/put.sh symply.cloudflare.api_token '…'
./scripts/secrets/get.sh symply.cloudflare.api_token   # stdout only — never chat
./scripts/secrets/list.sh
eval "$(./scripts/secrets/export-env.sh)"
./scripts/secrets/set-revenuecat.sh   # after backend/.env.revenuecat is filled
./scripts/secrets/seed-from-local.sh                  # from .env.local + shell
```

See [documents/ecosystem/SERVICES.md](../../documents/ecosystem/SERVICES.md).
