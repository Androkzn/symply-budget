import type { Context, Next } from 'hono';

/**
 * Prevent CDN / client HTTP caches from serving stale authenticated JSON.
 * Mobile clients previously sent Cache-Control: max-age=3600 on GETs, which
 * could cause empty owner-pending / notification history responses to stick.
 */
export function noStoreAuthResponses() {
  return async (c: Context, next: Next) => {
    await next();

    if (!c.req.header('Authorization')) {
      return;
    }

    const contentType = c.res.headers.get('Content-Type') ?? '';
    if (!contentType.includes('application/json')) {
      return;
    }

    c.header('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
    c.header('Vary', 'Authorization');
  };
}
