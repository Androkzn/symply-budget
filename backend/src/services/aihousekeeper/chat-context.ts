import { createProviderAdapter } from '../../ai/provider-factory';
import type { Env } from '../../types';
import { ApprovalQueueShim } from '../ai/approval-queue-shim';
import type {
  ApprovalQueueFacade,
  AihousekeeperToolContext,
} from '../ai/tools';
import { resolveProviderApiKey } from '../ai-credential-resolver';
import { usageRecorderFor } from '../ai-usage-service';
import { createDb } from '../db';
import { HouseholdService } from '../household-service';
import { createGoogleCalendarClient } from '../integrations/google-calendar';
import { createSendGridClient } from '../integrations/sendgrid';

import { AihousekeeperEventBus } from './event-bus';
import { ExpoPushClient } from './expo-push';
import { FamilyRouter } from './family-router';
import { MemoryService } from './memory-service';
import { OutboundDispatcher } from './outbound-dispatcher';
import { TrustLedgerService } from './trust-ledger-service';


export async function buildAihousekeeperChatToolContext(
  env: Env,
  householdId: string,
  userId: string,
  householdService: HouseholdService
): Promise<AihousekeeperToolContext> {
  const db = createDb(env.DB);
  const events = new AihousekeeperEventBus();
  new TrustLedgerService(db as unknown as AihousekeeperToolContext['db'], events);
  const { apiKey: anthropicKey } = await resolveProviderApiKey(env, userId, 'anthropic');
  const provider = createProviderAdapter({
    provider: 'anthropic',
    apiKey: anthropicKey,
    options: {
      onUsage: usageRecorderFor(env, {
        feature: 'aihousekeeper_chat',
        householdId,
        userId,
      }),
    },
  });
  const memory = new MemoryService({
    db: db as unknown as AihousekeeperToolContext['db'],
    d1: env.DB,
    ai: provider,
    events,
    env,
  });
  const familyRouter = new FamilyRouter(db as unknown as AihousekeeperToolContext['db']);
  const dispatcher = new OutboundDispatcher({
    db: db as unknown as AihousekeeperToolContext['db'],
    env,
    events,
    expoPush: new ExpoPushClient(),
    sendgrid: createSendGridClient({
      SENDGRID_API_KEY: env.SENDGRID_API_KEY,
      SENDGRID_DIGEST_TEMPLATE_ID: env.SENDGRID_DIGEST_TEMPLATE_ID,
      SENDGRID_FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
    }),
  });
  const approvalQueue = new ApprovalQueueShim(env.DB) as unknown as ApprovalQueueFacade;
  const googleCalendar = createGoogleCalendarClient(
    {
      GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    { db }
  );

  return {
    env,
    db: db as unknown as AihousekeeperToolContext['db'],
    householdId,
    userId,
    householdService,
    memory,
    dispatcher,
    familyRouter,
    events,
    approvalQueue,
    integrations: {
      sendgrid: createSendGridClient({
        SENDGRID_API_KEY: env.SENDGRID_API_KEY,
        SENDGRID_DIGEST_TEMPLATE_ID: env.SENDGRID_DIGEST_TEMPLATE_ID,
        SENDGRID_FROM_EMAIL: env.SENDGRID_FROM_EMAIL,
      }),
      googleCalendar,
    },
  };
}
