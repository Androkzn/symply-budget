# Production Web deployment

Run `npm run web:deploy:production` from this product repository. Export House and Budget serially, with a cleared Metro cache, to avoid brand cache contamination.

The Web export uses the product's production API and normal sign-in. No demo credentials are injected.

## Portfolio export

Run `npm run web:export:portfolio` to build the separate `dist-web-portfolio/` artifact with `EXPO_PUBLIC_PUBLIC_PREVIEW=1`, `APP_BRAND=symply-budget` and the production API environment. The command also runs the Pages asset preparation step. After reviewing the artifact, `npm run web:deploy:portfolio` publishes it to the separate `symply-budget-web-portfolio` project.

This does not change `web:export:production` or its `dist-web/` output. No credentials or account data are added to the bundle.

## Required Pages asset preparation

Cloudflare Pages ignores directories named `node_modules`. Expo emits dependency fonts and images into `assets/node_modules`, so uploading an unprepared export produces missing Ionicons and a misleading HTML/200 response from the SPA fallback.

`web:prepare-pages` copies only these exported assets into `assets/vendor` and adds an internal 200 rewrite for their original URLs. It does not copy the repository's dependencies, change JavaScript bundles or remove the original assets. Existing redirects are preserved. The production export script always runs this preparation.

For a custom export directory: `npm run web:prepare-pages -- /absolute/path/to/export` before Pages deploy.

Run `npm run test:pages-assets` for routing preservation, idempotence and missing-export checks. After deploying, inspect a hashed Ionicons URL from the export: it must return `font/ttf` and the actual font bytes, not HTML.

## Embedded appearance control

The transient theme bridge only accepts messages from the parent portfolio at `https://andreitekhtelev.dev` or local development at `http://localhost:3000`. It checks both origin and source, and never persists or syncs an account setting. Standalone and native appearances retain their existing behaviour.
