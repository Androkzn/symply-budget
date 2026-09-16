import { Hono } from 'hono';

import {
  getBrandPresentation,
  DEFAULT_BRAND_PRESENTATION,
  type BrandPresentation,
} from '../config/brand-presentation';
import { HouseholdService } from '../services/household-service';
import type { Env } from '../types';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inviteLandingHtml(
  deepLink: string,
  opts?: {
    householdName?: string | null;
    address?: string | null;
    inviterName?: string | null;
    imageUrl?: string | null;
    pageUrl?: string;
    brand?: BrandPresentation;
  }
): string {
  // deepLink is a `<scheme>://...` URL built from a hex token — safe to embed.
  const safe = deepLink.replace(/"/g, '&quot;').replace(/</g, '&lt;');
  // The brand controls the app name + hero icon shown on the page. Fall back to
  // House (the template brand) so a missing brand never breaks the public page.
  const brand = opts?.brand ?? DEFAULT_BRAND_PRESENTATION;
  const appName = escapeHtml(brand.displayName);
  const appIcon = brand.icon;
  // Household name / address / inviter are user-controlled — escape everywhere.
  const name = opts?.householdName ? escapeHtml(opts.householdName) : null;
  const addr = opts?.address ? escapeHtml(opts.address) : null;
  const inviter = opts?.inviterName ? escapeHtml(opts.inviterName) : null;
  const imageUrl = opts?.imageUrl ? escapeHtml(opts.imageUrl) : null;
  const title = name ? `Join ${name} on ${appName}` : `Join a household on ${appName}`;
  const who = inviter ? `${inviter} invited you to join` : "You've been invited to join";
  const place = name ? `"${name}"${addr ? ` · ${addr}` : ''}` : 'a household';
  const desc = `${who} ${place} on ${appName}. Open the app to request to join.`;
  const pageUrl = opts?.pageUrl ? escapeHtml(opts.pageUrl) : '';
  const heading = name ? `Join ${name}` : "You've been invited";
  const blurb = `${who} ${place}. Open ${appName} to request to join.`;
  // Use the household photo if present (large card), else fall back to a summary card.
  const ogImageTags = imageUrl
    ? `\n<meta property="og:image" content="${imageUrl}" />\n<meta name="twitter:card" content="summary_large_image" />\n<meta name="twitter:image" content="${imageUrl}" />`
    : '\n<meta name="twitter:card" content="summary" />';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${appName}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />${pageUrl ? `\n<meta property="og:url" content="${pageUrl}" />` : ''}${ogImageTags}
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#F5F5F7; color:#1d1d1f; display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  @media (prefers-color-scheme: dark){ body{ background:#000; color:#f5f5f7; } .card{ background:#1c1c1e; } }
  .card { background:#fff; border-radius:20px; padding:36px 28px; max-width:380px; width:100%; text-align:center;
    box-shadow:0 12px 40px rgba(0,0,0,.12); }
  .icon { font-size:64px; line-height:1; margin-bottom:16px; }
  h1 { font-size:22px; margin:0 0 8px; }
  p { font-size:15px; line-height:1.5; color:#6e6e73; margin:0 0 24px; }
  @media (prefers-color-scheme: dark){ p{ color:#a1a1a6; } }
  a.btn { display:block; background:#0a84ff; color:#fff; text-decoration:none; font-weight:600; font-size:17px;
    padding:14px; border-radius:14px; margin-bottom:12px; }
  a.btn.secondary { background:transparent; color:#0a84ff; }
  .hint { font-size:13px; color:#86868b; margin-top:8px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${appIcon}</div>
    <h1>${heading}</h1>
    <p>${blurb}</p>
    <a class="btn" id="open" href="${safe}">Open in App</a>
    <a class="btn secondary" href="${safe}">Reopen</a>
    <div class="hint">Don't have the app yet? Install ${appName}, then tap the link again.</div>
  </div>
  <script>
    // Best-effort auto-open for users who already have the app installed.
    (function(){
      var dl = ${JSON.stringify(deepLink)};
      // A user gesture is most reliable, but try a soft auto-launch on load too.
      setTimeout(function(){ window.location.href = dl; }, 250);
      document.getElementById('open').addEventListener('click', function(e){
        e.preventDefault(); window.location.href = dl;
      });
    })();
  </script>
</body>
</html>`;
}

// Build the rich-preview opts for an invite landing page from an opaque
// identifier (token or short code). Best-effort: any failure falls back to
// generic copy and never blocks the page.
async function inviteLandingOpts(c: { env: Env; req: { url: string } }, identifier: string) {
  const brand = getBrandPresentation(c.env);
  try {
    const preview = await new HouseholdService(c.env, c.env.DB).getInviteLinkPreview(identifier);
    if (!preview) return { pageUrl: c.req.url, brand };
    // The household photo proxy (/api/household-photos) is public; prefer it for
    // the OG image, else fall back to the inviter's avatar.
    const imageUrl = preview.photo_key
      ? `${c.env.API_URL}/api/household-photos/${preview.photo_key}`
      : preview.inviter_avatar_url ?? null;
    return {
      householdName: preview.household_name,
      address: preview.address,
      inviterName: preview.inviter_name,
      imageUrl,
      pageUrl: c.req.url,
      brand,
    };
  } catch {
    return { pageUrl: c.req.url, brand };
  }
}

const inviteLandingRoutes = new Hono<{ Bindings: Env }>();

inviteLandingRoutes.get('/join/:token', async (c) => {
  const raw = c.req.param('token');
  const opts = await inviteLandingOpts(c, raw);
  return c.html(inviteLandingHtml(`${opts.brand.scheme}://join/${encodeURIComponent(raw)}`, opts));
});

// Short link: `/j/<short_code>`. Resolves the same link as `/join`; redirects
// into the app via the join scheme (the app/backend resolve the code).
inviteLandingRoutes.get('/j/:code', async (c) => {
  const raw = c.req.param('code');
  const opts = await inviteLandingOpts(c, raw);
  return c.html(inviteLandingHtml(`${opts.brand.scheme}://join/${encodeURIComponent(raw)}`, opts));
});

inviteLandingRoutes.get('/invite/:token', async (c) => {
  const raw = c.req.param('token');
  const opts = await inviteLandingOpts(c, raw);
  return c.html(
    inviteLandingHtml(`${opts.brand.scheme}://invite/${encodeURIComponent(raw)}`, opts)
  );
});

export default inviteLandingRoutes;
