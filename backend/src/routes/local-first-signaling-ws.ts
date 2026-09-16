import { Hono } from 'hono';

import { requireLocalFirstApi } from '../middleware/brand-gate';
import { LocalFirstControlService } from '../services/local-first-control-service';
import type { Env } from '../types';
import { verifyAccessToken } from '../utils/jwt';

/**
 * WebSocket upgrade for Budget V2 WebRTC signaling.
 * Mount BEFORE `/households` (and before authenticated `/v2` if needed) so the
 * header-less RN WebSocket upgrade is not rejected. Auth via `?token=`.
 */
const signalingWs = new Hono<{ Bindings: Env }>();

signalingWs.use(requireLocalFirstApi());

signalingWs.get('/households/:householdId/signaling', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json({ error: { code: 'bad_request', message: 'Expected websocket upgrade' } }, 426);
  }

  const householdId = c.req.param('householdId');
  const token = c.req.query('token');
  const deviceId = c.req.query('deviceId');
  if (!token) {
    return c.json({ error: { code: 'unauthorized', message: 'Missing token' } }, 401);
  }
  if (!deviceId) {
    return c.json({ error: { code: 'validation_error', message: 'deviceId required' } }, 400);
  }

  const payload = await verifyAccessToken(token, c.env);
  if (!payload?.sub) {
    return c.json({ error: { code: 'unauthorized', message: 'Invalid token' } }, 401);
  }

  const control = new LocalFirstControlService(c.env);
  try {
    await control.getState(householdId, payload.sub);
  } catch {
    // Not a member — which is the normal state of a device that has just
    // claimed an invite and is waiting to be let in. That device is exactly the
    // one with something to hear, so the question is handed to the coordinator
    // rather than answered here: it is the tier holding the claim record, and
    // it admits only a device already named on a live claim (matched on user
    // AND device id), receive-only and told nothing but its own invite's fate.
    // Answering 403 here instead would keep the invitee on a screen that cannot
    // change until a push arrives.
  }

  const stub = control.getCoordinatorStub(householdId);
  const url = new URL('https://do/connect');
  url.searchParams.set('userId', payload.sub);
  url.searchParams.set('deviceId', deviceId);
  return stub.fetch(url.toString(), c.req.raw);
});

export default signalingWs;
