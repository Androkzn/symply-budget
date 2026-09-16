/**
 * Local `contractor_messages` — the ledger counterpart of `src/api/messages.ts`
 * (plan §11, sub-wave B4).
 *
 * **Nothing here sends anything, and that is the finding that makes the whole
 * module local.** The name says "messages" and the DTO has `channel: 'email' |
 * 'sms' | 'in_app'`, which reads like a transport. `message-service.ts` has no
 * transport: `createMessage` inserts a row, stamps `status` and `sent_at`, and
 * returns it. No mail is sent, no SMS is dispatched, no push is queued. The
 * member composes in the app, sends from their own mail or messages app, and
 * this table is the record that they did — exactly the shape
 * `localContractorsApi.requestReceipt` already has, where "asking the contractor
 * for a receipt" turned out to be a `mailto:` and a timestamp.
 *
 * So there is no H6 gap and no P4 gap in this module. Eight of the eleven
 * methods are local; the other three are Tier C.
 *
 * **Three remote by design.** `getTemplates`, `getTemplate` and `applyTemplate`
 * all read `message_templates`, which is named in `HOUSE_TIER_C_TABLES` — global
 * reference data, the same eight canned messages for every household, carrying
 * nothing of theirs. `applyTemplate` is the interesting one of the three: it
 * looks like a write because it takes `variables`, but it only substitutes
 * `{{placeholders}}` in the template text and returns a string. No household row
 * is touched, so routing it to the Worker leaks nothing and needs nothing local.
 *
 * ## Two client-vs-server divergences, both resolved in the client's favour
 *
 * 1. **`ConversationSummary` is a different shape on each side.** The client
 *    declares snake_case fields with `last_message` as a whole
 *    `ContractorMessage` and `contractor_specialty`; the Worker answers
 *    camelCase with `lastMessage` as a TRUNCATED 100-character string and no
 *    specialty at all. `MessagesScreen` reads the client's shape, so that is
 *    what this emits. The remote path is simply broken there today and nothing
 *    in this sub-wave can fix it — the same position B3 found `totalAmount` in.
 * 2. **`create` accepts an absent `direction`.** The client type marks it
 *    optional and `ConversationScreen` omits it; the route's zod marks it
 *    REQUIRED, so that call is a 400 against the Worker right now. This defaults
 *    it to `'outbound'` — the only direction a member can originate — which
 *    makes sending a message work offline where it does not work online. A
 *    superset in the client's favour, like B3's `ProjectPayment.title`.
 *
 * And one divergence resolved the OTHER way, deliberately: `getAll`'s
 * `direction` filter is a **no-op**, because the route's `filterSchema` does not
 * declare `direction` and zod strips it in transit. Implementing it locally
 * would make the same screen show two different lists depending on which backend
 * answered, which is worse than reproducing a filter that does nothing.
 *
 * **The contractor join is composed, never stored** — rule 1 in `types.ts`. So
 * are `unread_count` and `total_messages`: a stored count under per-field LWW is
 * the derived-collection failure mode, where two members reading two different
 * messages offline each write a total that omits the other's.
 *
 * **No bulk path.** Every write is one row, except `markConversationAsRead`,
 * which mutates rows already in the ledger rather than inserting any and is
 * therefore one op regardless of how long the thread is.
 */
// Side-effect BEFORE @symply/local-first — @noble captures globalThis.crypto at
// module load, and this module is a Proxy entry point, so it can be the first
// House module a screen pulls into the graph.
import './cryptoPolyfill';

import type {
  ConversationSummary,
  MessageChannel,
  MessageDirection,
  MessageStatus,
  MessageWithContractor,
} from '@api/messages';

import { HouseLocalUnknownPropertyError } from './errors';
import { newLocalId } from './ids';
import { activeHouseholdId, nowIso, rowsOf, writeLocal } from './localWrite';
import type { LocalContractor, LocalContractorMessage } from './types';

// ---------------------------------------------------------------------------
// Input shapes — mirrors of the module-private request types in
// `src/api/messages.ts`. They are not exported there, so they are restated
// rather than imported; `apiParity.test.ts` catches a method that disappears and
// `tsc` catches a field whose type changed on the DTO.
// ---------------------------------------------------------------------------

export type CreateLocalMessageInput = {
  contractor_id: string;
  direction?: MessageDirection;
  channel: MessageChannel;
  subject?: string;
  body: string;
  attachments?: string[];
};

export type LocalMessageFilters = {
  contractor_id?: string;
  /** Declared for parity; the Worker's query schema drops it — see the header. */
  direction?: MessageDirection;
  channel?: MessageChannel;
  status?: MessageStatus;
};

function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId !== active) throw new HouseLocalUnknownPropertyError(householdId);
  return active;
}

function messagesOf(householdId: string): LocalContractorMessage[] {
  requireActiveProperty(householdId);
  return rowsOf<LocalContractorMessage>('contractorMessages');
}

function contractorsById(householdId: string): Map<string, LocalContractor> {
  requireActiveProperty(householdId);
  return new Map(rowsOf<LocalContractor>('contractors').map((row) => [row.id, row]));
}

/** Server order: `created_at` desc (`getMessages`, `getConversationSummaries`). */
function byCreatedAtDesc(a: { created_at: string }, b: { created_at: string }): number {
  return b.created_at.localeCompare(a.created_at);
}

/** Server order: `created_at` asc (`getConversation` — a thread reads downwards). */
function byCreatedAtAsc(a: { created_at: string }, b: { created_at: string }): number {
  return a.created_at.localeCompare(b.created_at);
}

/**
 * The contractor block the Worker joins per request.
 *
 * `specialty` is in the CLIENT's `MessageWithContractor` and absent from the
 * Worker's `enrichMessage` — the same asymmetry B3 found on `ProjectWithDetails`
 * — so this fills it in. A superset of what the server sends cannot break a
 * screen, and it means the specialty chip on a conversation row renders offline.
 */
function enrich(
  message: LocalContractorMessage,
  contractor: LocalContractor,
): MessageWithContractor {
  return {
    ...message,
    contractor: {
      id: contractor.id,
      name: contractor.name,
      company_name: contractor.company_name,
      specialty: contractor.specialty,
      phone: contractor.phone,
      email: contractor.email,
    },
  };
}

/**
 * `enrichMessage` THROWS on a dangling contractor and a list read must not.
 *
 * A peer running a build older than the B4 cascade fix can still deliver a
 * message whose contractor it deleted. The Worker would 404 the whole request;
 * dropping the orphan keeps one bad row from blanking the inbox. This is the
 * same list-drops / single-raises split `localQuotesApi` and `localProjectsApi`
 * use.
 */
function enrichAll(
  messages: readonly LocalContractorMessage[],
  byId: Map<string, LocalContractor>,
): MessageWithContractor[] {
  const out: MessageWithContractor[] = [];
  for (const message of messages) {
    const contractor = byId.get(message.contractor_id);
    if (contractor) out.push(enrich(message, contractor));
  }
  return out;
}

function requireMessage(householdId: string, messageId: string): LocalContractorMessage {
  const found = messagesOf(householdId).find((row) => row.id === messageId);
  if (!found) throw new Error('Message not found');
  return found;
}

/** `checkContractorAccess` — every conversation path runs it first. */
function requireContractor(householdId: string, contractorId: string): LocalContractor {
  const found = contractorsById(householdId).get(contractorId);
  if (!found) throw new Error('Contractor not found');
  return found;
}

/** One place builds a single-message answer, so every write returns one shape. */
function detail(householdId: string, messageId: string): { message: MessageWithContractor } {
  const message = requireMessage(householdId, messageId);
  const contractor = contractorsById(householdId).get(message.contractor_id);
  if (!contractor) throw new Error('Contractor not found');
  return { message: enrich(message, contractor) };
}

export const localMessagesApi = {
  /**
   * `GET /messages` — `MessageService.getMessages`.
   *
   * `direction` is accepted and ignored; see the header. The other three filters
   * are applied in the Worker's own order, after the sort rather than before it,
   * which matters only for `limit` — and `limit` is not on the client's filter
   * type at all, so there is nothing here to truncate.
   */
  getAll: async (householdId: string, filters?: LocalMessageFilters) => {
    const byId = contractorsById(householdId);
    const messages = messagesOf(householdId)
      .filter((row) => (filters?.contractor_id ? row.contractor_id === filters.contractor_id : true))
      .filter((row) => (filters?.channel ? row.channel === filters.channel : true))
      .filter((row) => (filters?.status ? row.status === filters.status : true))
      .sort(byCreatedAtDesc);
    return { messages: enrichAll(messages, byId) };
  },

  /**
   * `GET /messages/conversations` — one row per contractor the household has
   * ever written to or heard from.
   *
   * Every field is derived. `unread_count` is inbound messages not yet marked
   * read, `total_messages` is the thread length, and `last_message` is the
   * newest — the CLIENT's whole-message shape rather than the Worker's truncated
   * string (see the header).
   *
   * Contractor order follows first appearance in the newest-first message list,
   * which is what the Worker's `[...new Set(messages.map(...))]` produces: the
   * most recently active conversation leads. A contractor whose record is gone
   * is skipped, exactly as the Worker's `if (contractor)` does.
   */
  getConversations: async (householdId: string) => {
    const byId = contractorsById(householdId);
    const newestFirst = messagesOf(householdId).sort(byCreatedAtDesc);

    const conversations: ConversationSummary[] = [];
    for (const contractorId of [...new Set(newestFirst.map((row) => row.contractor_id))]) {
      const contractor = byId.get(contractorId);
      if (!contractor) continue;
      const thread = newestFirst.filter((row) => row.contractor_id === contractorId);
      const last = thread[0];
      if (!last) continue;
      conversations.push({
        contractor_id: contractorId,
        contractor_name: contractor.name,
        contractor_company: contractor.company_name,
        contractor_specialty: contractor.specialty,
        last_message: last,
        unread_count: thread.filter((row) => row.direction === 'inbound' && row.status !== 'read')
          .length,
        total_messages: thread.length,
      });
    }
    return { conversations };
  },

  /** `GET /messages/conversation/:contractorId` — oldest first, as a thread reads. */
  getConversation: async (householdId: string, contractorId: string) => {
    const contractor = requireContractor(householdId, contractorId);
    const messages = messagesOf(householdId)
      .filter((row) => row.contractor_id === contractorId)
      .sort(byCreatedAtAsc)
      .map((row) => enrich(row, contractor));
    return { messages };
  },

  getOne: async (householdId: string, messageId: string) => detail(householdId, messageId),

  /**
   * `POST /messages` — a ledger write, not a send. See the header.
   *
   * `status` and `sent_at` follow `createMessage` exactly: an outbound message
   * is born `'sent'` and stamped now, an inbound one is born `'delivered'` with
   * a null `sent_at`, because an inbound message was sent by somebody else at a
   * time this household does not know.
   *
   * `direction` defaults to `'outbound'` where the client omits it — the one
   * place this facade is deliberately more permissive than the Worker, because
   * the Worker's zod rejects the call `ConversationScreen` actually makes.
   */
  create: async (householdId: string, data: CreateLocalMessageInput) => {
    requireActiveProperty(householdId);
    requireContractor(householdId, data.contractor_id);

    const direction: MessageDirection = data.direction ?? 'outbound';
    const timestamp = nowIso();
    const message: LocalContractorMessage = {
      // Random id: `contractor_messages` carries no `uniqueIndex`, and two
      // members sending the same contractor the same question offline have sent
      // two messages. Merging them would delete one member's words.
      id: newLocalId('msg'),
      household_id: householdId,
      contractor_id: data.contractor_id,
      direction,
      channel: data.channel,
      subject: data.subject || null,
      body: data.body,
      // Attachment KEYS, stored as the JSON text D1 stores. The files behind
      // them move through the H6 blob channel; the list of them is a column.
      attachments: data.attachments ? JSON.stringify(data.attachments) : null,
      status: direction === 'outbound' ? 'sent' : 'delivered',
      sent_at: direction === 'outbound' ? timestamp : null,
      read_at: null,
      // Only `applyTemplate` knows which template produced a body, and that runs
      // on the server against Tier C data; the create route never sets this.
      template_used: null,
      created_at: timestamp,
    };

    await writeLocal(
      (draft) => {
        draft.contractorMessages.push(message);
      },
      {
        opType: 'CONTRACTOR_MESSAGE_CREATE',
        entityType: 'contractor_message',
        entityId: message.id,
        payload: message,
      },
    );
    return detail(householdId, message.id);
  },

  /**
   * `POST /messages/:id/read`.
   *
   * Idempotent in the Worker's specific way: an already-read message is NOT
   * re-stamped, so `read_at` records when it was first opened rather than when
   * it was last looked at. Reproduced — under per-field LWW, re-stamping would
   * also make two members opening the same message converge on whichever device
   * synced last.
   */
  markAsRead: async (householdId: string, messageId: string) => {
    const existing = requireMessage(householdId, messageId);
    if (existing.status === 'read') return detail(householdId, messageId);

    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        const message = draft.contractorMessages.find(
          (row) => row.id === messageId && row.household_id === householdId,
        );
        if (!message) throw new Error('Message not found');
        message.status = 'read';
        message.read_at = timestamp;
      },
      {
        opType: 'CONTRACTOR_MESSAGE_READ',
        entityType: 'contractor_message',
        entityId: messageId,
        payload: { id: messageId, read_at: timestamp },
      },
    );
    return detail(householdId, messageId);
  },

  /**
   * `POST /messages/conversation/:contractorId/read` — INBOUND only, in ONE op.
   *
   * The Worker's `where` includes `direction = 'inbound'`, which is not a detail:
   * marking the household's own outbound messages "read" would zero the unread
   * badge and also rewrite the status of everything the member ever sent.
   *
   * Unlike `markAsRead` this re-stamps rows that were already read, because the
   * Worker issues one unconditional UPDATE across the thread. The two paths
   * genuinely differ and both are mirrored rather than harmonised.
   */
  markConversationAsRead: async (householdId: string, contractorId: string) => {
    requireContractor(householdId, contractorId);
    const timestamp = nowIso();
    await writeLocal(
      (draft) => {
        for (const message of draft.contractorMessages) {
          if (
            message.household_id === householdId &&
            message.contractor_id === contractorId &&
            message.direction === 'inbound'
          ) {
            message.status = 'read';
            message.read_at = timestamp;
          }
        }
      },
      {
        opType: 'CONTRACTOR_CONVERSATION_READ',
        entityType: 'contractor',
        entityId: contractorId,
        payload: { contractor_id: contractorId, read_at: timestamp },
      },
    );
    return { success: true };
  },

  /**
   * `DELETE /messages/:id` — the row alone.
   *
   * Nothing cascades from `contractor_messages` in D1; it is a leaf. The
   * attachment keys in the JSON column point at blobs the H6 channel owns, and
   * reaping those is that channel's job rather than this method's — the same
   * split `localContractorsApi.deleteDocument` uses.
   */
  delete: async (householdId: string, messageId: string) => {
    requireMessage(householdId, messageId);
    await writeLocal(
      (draft) => {
        draft.contractorMessages = draft.contractorMessages.filter(
          (row) => !(row.id === messageId && row.household_id === householdId),
        );
      },
      {
        opType: 'CONTRACTOR_MESSAGE_DELETE',
        entityType: 'contractor_message',
        entityId: messageId,
        payload: { id: messageId },
      },
    );
  },

  // ---- templates (Tier C, remote) -----------------------------------------
  //
  // `getTemplates`, `getTemplate` and `applyTemplate` are absent from this
  // object ON PURPOSE, and they are the only absences in it. `message_templates`
  // is Tier C — the same canned messages for every household, carrying nothing
  // of theirs — so the Proxy routes them to the Worker and `apiParity.test.ts`
  // declares each one with its reason. See the header.
};
