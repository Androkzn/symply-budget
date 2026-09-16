# Symply Budget

Standalone Symply Budget mobile app and Cloudflare Worker backend. This repository is single-brand and does not depend on the Symply Ecosystem repository at build or deploy time.

## Identity

- Display name: Symply Budget
- iOS: `com.symply.budget`
- Widget: `com.symply.budget.widget`
- Watch: `com.symply.budget.watchkitapp`
- App Group: `group.com.symply.budget`
- Android: `com.symply.budget`
- Expo project: `7e6f549f-c8ed-4018-8f20-fc578b812c20`
- Updates channels: `symply-budget-development`, `symply-budget-staging`, `symply-budget-production`

## Commands

```sh
npm start
npm run validate:brand -- symply-budget
npm run verify:standalone
npm run typecheck
cd backend && npm run typecheck && npm run test
cd backend && npm run deploy:all
```

Use `npm run prepare:xcode:budget` before local iOS builds. Credentials remain in EAS/Apple/Google services and must never be committed.
