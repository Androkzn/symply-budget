/**
 * House chat assistant — the READ-THE-WORLD half.
 *
 * The write tools in {@link ./house-assistant-actions} let the assistant change
 * the household's project. These two let it find out things it does not know,
 * which is the other half of the same complaint: asked to "find good mold
 * removal, professional", the assistant had no way to look anything up, so it
 * asked three clarifying questions and found nobody.
 *
 * ## Two tools, because they are two different questions
 *
 * `find_local_pros` answers **"who"** — a named, phoneable, rated contractor
 * near this home. It is not a web search dressed up: `ContractorSearchService`
 * already exists, already grounds Gemini with Google Search, already resolves
 * the household's city/state, and already returns ratings, review counts, phone
 * numbers and Maps links in a typed shape. Re-implementing that inside a chat
 * tool would produce a worse answer from the same model.
 *
 * `web_search` answers **"what"** — what mold remediation costs in this region,
 * whether a permit is needed, what the code says about a bathroom fan. Claude's
 * server-side `web_search` tool, via the same `generateWithWebSearch` the
 * garbage-schedule detector uses.
 *
 * ## Why the search runs server-side when the writes do not
 *
 * Nothing about a web search touches a Tier-A row. There is no local-first
 * objection to sending "mold remediation cost Vancouver BC" to a model — it is
 * the same act as the household's own AI features already perform, and the
 * answer belongs to nobody. So this half stays where the API keys are, and only
 * the writes take the long way round through the client.
 *
 * What DOES leak, and is worth stating: `find_local_pros` sends the household's
 * city and state (never the street address — see {@link locationFor}) to the
 * search model, because a contractor search with no place in it is useless. A
 * local-first household's address is already used this way by the contractor
 * search screen the member can open by hand; the tool does not widen it.
 */
import type { GenerateToolDef } from '../../ai/provider';
import { createAnthropicAdapterForUser } from '../../ai/provider-factory';
import { ContractorSearchService } from '../contractor-search-service';
import { HouseholdService } from '../household-service';

import type {
  ChatAssistantToolContext,
  ChatAssistantToolReturn,
  ChatTableSpec,
} from './chat-room-service-core';

/** Model with the `web_search_20250305` server tool. */
const WEB_SEARCH_MODEL = 'claude-sonnet-4-5-20250929';

const WEB_SEARCH_SYSTEM = `You are researching one narrow question for a homeowner, on behalf of an assistant that will relay your answer in a chat message.

Answer in at most 120 words. Lead with the figure or fact asked for. Prefer sources for the homeowner's own region over national averages, and say which region a figure is for. Give a range, not a false precision. Name the source when it is a code, a municipality or a manufacturer. If the search does not settle it, say what is unclear rather than filling the gap.`;

export const FIND_LOCAL_PROS_TOOL: GenerateToolDef = {
  name: 'find_local_pros',
  description:
    "Find real, named local professionals near this home — with ratings, phone numbers and links. Use it whenever the member asks you to find, recommend or get quotes from someone for a trade (mold remediation, electrician, plumber, roofer, flooring installer...). Do not ask clarifying questions first if the trade is clear; search, then ask about anything genuinely missing.",
  input_schema: {
    type: 'object',
    properties: {
      trade: {
        type: 'string',
        description:
          'The specialty to search for, in the words a directory would use, e.g. "mold remediation specialist", "licensed electrician", "hardwood flooring installer".',
      },
      problem: {
        type: 'string',
        description:
          'What the job actually is, in one or two sentences, using the household\'s own record where it says something. This is what the search is grounded on.',
      },
      urgency: {
        type: 'string',
        enum: ['critical', 'major', 'minor', 'informational'],
        description: 'How pressing it is. Defaults to major.',
      },
    },
    required: ['trade', 'problem'],
  },
};

export const WEB_SEARCH_TOOL: GenerateToolDef = {
  name: 'web_search',
  description:
    "Look something up on the web when you do not know it and the household's record does not say: regional prices, product specs, building-code or permit requirements, how long a material takes to cure. Prefer this over answering from memory whenever the member would notice a wrong number. Do NOT use it to find contractors — use find_local_pros.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The question in full, including the place when it matters, e.g. "cost to remediate mold in a 100 sq ft shed, Vancouver BC 2026".',
      },
    },
    required: ['query'],
  },
};

export const RESEARCH_TOOLS: GenerateToolDef[] = [FIND_LOCAL_PROS_TOOL, WEB_SEARCH_TOOL];

/** True for a tool name this module owns. */
export function isResearchTool(name: string): boolean {
  return name === FIND_LOCAL_PROS_TOOL.name || name === WEB_SEARCH_TOOL.name;
}

/**
 * City + state for the search, and nothing finer.
 *
 * The street address would sharpen a directory query slightly and is exactly
 * the field a member is most surprised to find in an outbound request, so it is
 * left out. A household that has not set a city cannot be searched for at all —
 * that is a question to ask, not a national average to fake.
 */
async function locationFor(
  ctx: ChatAssistantToolContext
): Promise<{ city: string; state: string } | null> {
  const households = new HouseholdService(ctx.env, ctx.env.DB);
  const household = await households.getHousehold(ctx.householdId, ctx.userId);
  const city = household.city?.trim();
  const state = household.state_province?.trim();
  if (!city) return null;
  return { city, state: state || '' };
}

/** Contractor rows → the table card the client renders under the reply. */
function prosTable(
  pros: Array<{
    name: string;
    company_name: string | null;
    rating: number;
    review_count: number;
    phone: string | null;
    highlights: string[];
  }>
): ChatTableSpec {
  return {
    title: 'Local pros',
    columns: ['Name', 'Rating', 'Phone'],
    rows: pros.slice(0, 5).map((p) => [
      p.company_name || p.name,
      p.rating > 0 ? `${p.rating.toFixed(1)} (${p.review_count})` : '—',
      p.phone || '—',
    ]),
  };
}

async function runFindLocalPros(
  ctx: ChatAssistantToolContext,
  input: Record<string, unknown>
): Promise<ChatAssistantToolReturn> {
  const trade = typeof input.trade === 'string' ? input.trade.trim() : '';
  const problem = typeof input.problem === 'string' ? input.problem.trim() : '';
  if (!trade || !problem) {
    return 'I need the trade and a sentence about the job before I can search.';
  }

  const location = await locationFor(ctx);
  if (!location) {
    return "This home has no city set, so I cannot search near it. Ask the member which city to search in — or to add the address in the home's settings.";
  }

  const service = new ContractorSearchService(ctx.env, ctx.env.DB);
  const result = await service.searchContractors(ctx.householdId, ctx.userId, {
    problem_description: problem,
    problem_title: trade,
    // The service maps `system_category` to a specialty only when
    // `contractor_category` is absent; passing the trade directly means the
    // model searches for what was asked rather than for a mapped synonym.
    system_category: 'other',
    contractor_category: trade,
    location: { city: location.city, state: location.state },
    source_type: 'task_draft',
    source_id: `chat:${ctx.roomId}`,
    severity:
      input.urgency === 'critical' || input.urgency === 'minor' || input.urgency === 'informational'
        ? input.urgency
        : 'major',
  });

  if (result.contractors.length === 0) {
    return `No ${trade} came back for ${location.city}${location.state ? `, ${location.state}` : ''}. ${
      result.location_note ?? 'Suggest widening the area or trying a different search term.'
    }`;
  }

  // The model gets the full detail (so it can recommend ONE and say why); the
  // card carries the contactable columns so the member does not have to read
  // them out of a paragraph.
  const detail = result.contractors
    .slice(0, 5)
    .map((c, i) => {
      const bits = [
        `${i + 1}. ${c.company_name || c.name}`,
        c.rating > 0 ? `${c.rating.toFixed(1)}★ (${c.review_count} reviews)` : null,
        c.phone,
        c.website,
        c.highlights.slice(0, 2).join('; ') || null,
      ].filter(Boolean);
      return bits.join(' · ');
    })
    .join('\n');

  return {
    result:
      `Found ${result.contractors.length} in ${location.city}. ${result.search_summary}\n\n${detail}\n\n` +
      'Relay the best two or three in a sentence each, say WHY each one fits this job, and include phone numbers. The full list is already shown to the member as a card — do not repeat it as a table.',
    ui: [{ kind: 'table', table: prosTable(result.contractors) }],
  };
}

async function runWebSearch(
  ctx: ChatAssistantToolContext,
  input: Record<string, unknown>
): Promise<ChatAssistantToolReturn> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return 'I need a question to look up.';

  const provider = await createAnthropicAdapterForUser(
    ctx.env,
    ctx.userId,
    { feature: 'chat_assistant_web_search', userId: ctx.userId },
    WEB_SEARCH_MODEL
  );
  const { text } = await provider.generateWithWebSearch({
    systemPrompt: WEB_SEARCH_SYSTEM,
    userPrompt: query,
    model: WEB_SEARCH_MODEL,
    maxTokens: 1024,
    maxWebSearchUses: 4,
  });

  if (!text) return `The search for “${query}” came back empty. Say so rather than guessing.`;
  return `Search result for “${query}”:\n${text}\n\nRelay this in your own words, keep the figures, and say it came from a web lookup.`;
}

/** Dispatch a research tool. Failures come back as sentences, never throws. */
export async function runResearchTool(
  ctx: ChatAssistantToolContext,
  call: { name: string; input: Record<string, unknown> }
): Promise<ChatAssistantToolReturn> {
  try {
    if (call.name === FIND_LOCAL_PROS_TOOL.name) return await runFindLocalPros(ctx, call.input);
    if (call.name === WEB_SEARCH_TOOL.name) return await runWebSearch(ctx, call.input);
    return `Unknown lookup “${call.name}”.`;
  } catch (error) {
    console.error(`[chat] research tool '${call.name}' failed:`, error);
    return error instanceof Error
      ? `That lookup failed (${error.message}). Tell the member you could not search just now.`
      : 'That lookup failed. Tell the member you could not search just now.';
  }
}
