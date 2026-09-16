import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { QuoteWithDetails, QuoteComparison, QuoteStatus } from '@api/quotes';

interface QuoteState {
  quotes: QuoteWithDetails[];
  pendingQuotes: QuoteWithDetails[];
  selectedQuote: QuoteWithDetails | null;
  comparison: QuoteComparison | null;
  filterStatus: QuoteStatus | null;
  isLoading: boolean;
  error: string | null;
}

interface QuoteActions {
  setQuotes: (quotes: QuoteWithDetails[]) => void;
  setPendingQuotes: (quotes: QuoteWithDetails[]) => void;
  addQuote: (quote: QuoteWithDetails) => void;
  addQuotes: (quotes: QuoteWithDetails[]) => void;
  updateQuote: (quoteId: string, updates: Partial<QuoteWithDetails>) => void;
  removeQuote: (quoteId: string) => void;
  setSelectedQuote: (quote: QuoteWithDetails | null) => void;
  setComparison: (comparison: QuoteComparison | null) => void;
  setFilterStatus: (status: QuoteStatus | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type QuoteStore = QuoteState & QuoteActions;

const initialState: QuoteState = {
  quotes: [],
  pendingQuotes: [],
  selectedQuote: null,
  comparison: null,
  filterStatus: null,
  isLoading: false,
  error: null,
};

export const useQuoteStore = create<QuoteStore>()(
  immer((set) => ({
    ...initialState,

      setQuotes: (quotes) =>
        set((state) => {
          state.quotes = quotes;
        }),

      setPendingQuotes: (quotes) =>
        set((state) => {
          state.pendingQuotes = quotes;
        }),

      addQuote: (quote) =>
        set((state) => {
          state.quotes.unshift(quote);
          if (['requested', 'received', 'reviewing'].includes(quote.status)) {
            state.pendingQuotes.unshift(quote);
          }
        }),

      addQuotes: (quotes) =>
        set((state) => {
          state.quotes.unshift(...quotes);
          const pendingStatuses = ['requested', 'received', 'reviewing'];
          const newPending = quotes.filter((q) => pendingStatuses.includes(q.status));
          state.pendingQuotes.unshift(...newPending);
        }),

      updateQuote: (quoteId, updates) =>
        set((state) => {
          const index = state.quotes.findIndex((q) => q.id === quoteId);
          if (index !== -1) {
            state.quotes[index] = { ...state.quotes[index], ...updates };
          }
          const pendingIndex = state.pendingQuotes.findIndex((q) => q.id === quoteId);
          if (pendingIndex !== -1) {
            const updatedQuote = { ...state.pendingQuotes[pendingIndex], ...updates };
            // Remove from pending if status changed to non-pending
            if (['accepted', 'declined', 'expired'].includes(updatedQuote.status)) {
              state.pendingQuotes.splice(pendingIndex, 1);
            } else {
              state.pendingQuotes[pendingIndex] = updatedQuote;
            }
          }
          if (state.selectedQuote?.id === quoteId) {
            state.selectedQuote = { ...state.selectedQuote, ...updates };
          }
        }),

      removeQuote: (quoteId) =>
        set((state) => {
          state.quotes = state.quotes.filter((q) => q.id !== quoteId);
          state.pendingQuotes = state.pendingQuotes.filter((q) => q.id !== quoteId);
          if (state.selectedQuote?.id === quoteId) {
            state.selectedQuote = null;
          }
        }),

      setSelectedQuote: (quote) =>
        set((state) => {
          state.selectedQuote = quote;
        }),

      setComparison: (comparison) =>
        set((state) => {
          state.comparison = comparison;
        }),

      setFilterStatus: (status) =>
        set((state) => {
          state.filterStatus = status;
        }),

      setLoading: (loading) =>
        set((state) => {
          state.isLoading = loading;
        }),

      setError: (error) =>
        set((state) => {
          state.error = error;
        }),

      reset: () => set(initialState),
    }))
);
