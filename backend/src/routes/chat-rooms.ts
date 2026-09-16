/**
 * House household-chat routes — a thin instantiation of the shared chat route
 * factory (`create-chat-routes.ts`) bound to the House service + `chat-*`
 * segment/keys. All handlers live in the factory so a change there applies to
 * every app; only these bindings differ.
 */
import { ChatRoomService } from '../services/chat-room-service';

import { createChatRoutes, createChatWsRoutes } from './chat/create-chat-routes';

export const chatWsRoutes = createChatWsRoutes();

const chatRooms = createChatRoutes({
  routeSegment: 'chat-rooms',
  rateLimitKey: 'chat:message',
  r2Prefix: 'chat-images',
  createService: (env, db) => new ChatRoomService(env, db),
});

export default chatRooms;
