import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../types';

/**
 * Durable Object for a single household chat room — a thin, stateless (no
 * message persistence) WebSocket fan-out layer.
 *
 * D1 is the source of truth for messages. All writes go through the normal
 * authenticated REST path (routes/chat-rooms.ts → ChatRoomService); after a
 * write the service calls this DO's `/broadcast` endpoint to push the new
 * message to every connected client in the room.
 *
 * Clients connect (read-only) via the Worker's WS-upgrade route, which verifies
 * the access token + household membership BEFORE forwarding to `/connect`. The
 * verified userId is passed as a query param so this DO never re-authenticates.
 *
 * Uses the **hibernatable** WebSocket API (`acceptWebSocket` + `webSocket*`
 * handler methods) so idle rooms evict from memory and incur no duration
 * billing — important for the free-tier constraint.
 */
export class ChatRoomDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/connect':
        return this.handleConnect(request, url);
      case '/broadcast':
        return this.handleBroadcast(request);
      case '/connected':
        return this.handleConnected();
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Accept a WebSocket from a client. The Worker has already verified auth and
   * membership; `userId` arrives as a query param so we can track presence
   * (used to skip push notifications for already-connected members).
   */
  private handleConnect(request: Request, url: URL): Response {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const userId = url.searchParams.get('userId') ?? 'unknown';

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernatable accept. The attachment survives hibernation and lets us
    // recover the connected userId in webSocket* handlers + /connected.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Broadcast a JSON event (a new message, or a transient typing indicator) to
   * every connected socket. Returns the set of currently-connected userIds so
   * the caller can avoid pushing notifications to members who are live.
   */
  private async handleBroadcast(request: Request): Promise<Response> {
    const payload = await request.text(); // already-serialized event JSON
    const sockets = this.ctx.getWebSockets();
    const connectedUserIds = new Set<string>();

    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      if (attachment?.userId) {
        connectedUserIds.add(attachment.userId);
      }
      try {
        ws.send(payload);
      } catch {
        // Socket is closing/closed; drop it.
        try {
          ws.close(1011, 'broadcast failed');
        } catch {
          /* ignore */
        }
      }
    }

    return Response.json({ connectedUserIds: [...connectedUserIds] });
  }

  private handleConnected(): Response {
    const connectedUserIds = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      if (attachment?.userId) {
        connectedUserIds.add(attachment.userId);
      }
    }
    return Response.json({ connectedUserIds: [...connectedUserIds] });
  }

  /**
   * Client → server messages. The socket is a read-only feed for actual chat
   * messages (those go through REST), so we only handle lightweight control
   * frames here: a `ping` keepalive and a `typing` indicator relayed to peers.
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let parsed: { type?: string } | null = null;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    if (!parsed || typeof parsed.type !== 'string') return;

    if (parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (parsed.type === 'typing') {
      const attachment = ws.deserializeAttachment() as { userId?: string } | null;
      const event = JSON.stringify({ type: 'typing', userId: attachment?.userId ?? 'unknown' });
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === ws) continue;
        try {
          peer.send(event);
        } catch {
          /* ignore */
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'error');
    } catch {
      /* ignore */
    }
  }
}
