/**
 * Vocabulary cards API — donor `/api/v1/cards`.
 * IMPORTANT: reads return RAW D1 rows (snake_case columns). Writes take
 * camelCase per the zod schema. Both shapes are typed below.
 */
import { languageRequest } from './languageClient';

export type CardType = 'vocabulary' | 'grammar' | 'pronunciation' | 'phrase';
export type SkillDomain = 'reading' | 'writing' | 'listening' | 'speaking';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/** Raw card row (snake_case) as returned by the read endpoints. */
export interface CardRow {
  id: string;
  word?: string;
  translation?: string;
  context?: string;
  domain?: string;
  practice_kind?: string;
  difficulty_level?: string;
  card_type?: string;
  front_content?: string;
  back_content?: string;
  next_review_date?: string;
  ease_factor?: number;
  interval_days?: number;
  repetitions?: number;
  mastery_score?: number;
  is_active?: number;
  [key: string]: unknown;
}

export interface CardInput {
  cardType: CardType;
  skillDomain: SkillDomain;
  cefrLevel: CefrLevel;
  frontContent: string;
  backContent: string;
  audioUrl?: string;
  imageUrl?: string;
  exampleSentences?: string[];
  notes?: string;
  tags?: string[];
}

export interface CardsPage {
  cards: CardRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const languageCardsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    type?: string;
    state?: 'active' | 'retired' | 'regression_due';
    search?: string;
    practiceKind?: string;
    active?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.type) q.set('type', params.type);
    if (params?.state) q.set('state', params.state);
    if (params?.search) q.set('search', params.search);
    if (params?.practiceKind) q.set('practiceKind', params.practiceKind);
    if (params?.active !== undefined) q.set('active', String(params.active));
    const qs = q.toString();
    return languageRequest<CardsPage>(`/cards${qs ? `?${qs}` : ''}`);
  },

  due: (params?: { practiceKind?: string; state?: string }) => {
    const q = new URLSearchParams();
    if (params?.practiceKind) q.set('practiceKind', params.practiceKind);
    if (params?.state) q.set('state', params.state);
    const qs = q.toString();
    return languageRequest<{ dueCards: CardRow[]; totalDue: number }>(
      `/cards/due${qs ? `?${qs}` : ''}`,
    );
  },

  create: (card: CardInput) =>
    languageRequest<{ card: CardRow }>('/cards', { method: 'POST', body: card }).then((r) => r.card),

  update: (id: string, patch: Partial<CardInput> & { isActive?: boolean }) =>
    languageRequest<{ card: CardRow }>(`/cards/${id}`, { method: 'PUT', body: patch }).then(
      (r) => r.card,
    ),

  remove: (id: string) =>
    languageRequest<{ success: boolean }>(`/cards/${id}`, { method: 'DELETE' }),

  bulkImport: (cards: CardInput[]) =>
    languageRequest<{ imported: number; failed: number; errors: Array<{ index: number; error: string }> }>(
      '/cards/bulk-import',
      { method: 'POST', body: { cards } },
    ),
};
