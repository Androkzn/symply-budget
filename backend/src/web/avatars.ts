import { Hono } from 'hono';

import type { Env } from '../types';

const avatarRoutes = new Hono<{ Bindings: Env }>();

avatarRoutes.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  const key = `avatars/${filename}`;

  try {
    const object = await c.env.REPORTS_BUCKET.get(key);
    if (!object) {
      return c.json({ error: 'Avatar not found' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('Error serving avatar:', error);
    return c.json({ error: 'Failed to load avatar' }, 500);
  }
});

export default avatarRoutes;
