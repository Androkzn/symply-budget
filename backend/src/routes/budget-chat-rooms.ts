/**
 * Budget household-chat routes — a thin instantiation of the shared chat route
 * factory (`create-chat-routes.ts`) bound to the Budget service + `budget-chat-*`
 * segment/keys. All handlers live in the factory so a change there applies to
 * every app; only these bindings differ.
 */
import { BudgetChatRoomService } from '../services/budget-chat-room-service';

import { createChatRoutes, createChatWsRoutes } from './chat/create-chat-routes';

export const budgetChatWsRoutes = createChatWsRoutes();

const budgetChatRooms = createChatRoutes({
  routeSegment: 'budget-chat-rooms',
  rateLimitKey: 'budget-chat:message',
  r2Prefix: 'budget-chat-images',
  createService: (env, db) => new BudgetChatRoomService(env, db),
});

export default budgetChatRooms;
