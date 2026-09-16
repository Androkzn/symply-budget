import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { asyncStorage } from '@services/storage';

export interface WizardDraft {
  templateKey?: string;
  title?: string;
  spaceIds: string[];
  targetBudgetCents?: number;
  targetEndAt?: string;
}

interface UploadProgress {
  attachmentId: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
}

interface HomeProjectState {
  wizardDraft: WizardDraft;
  uploads: Record<string, UploadProgress>;
  setWizardDraft: (patch: Partial<WizardDraft>) => void;
  resetWizardDraft: () => void;
  setUploadProgress: (attachmentId: string, progress: UploadProgress) => void;
  clearUpload: (attachmentId: string) => void;
}

const emptyDraft: WizardDraft = { spaceIds: [] };

export const useHomeProjectStore = create<HomeProjectState>()(
  persist(
    (set) => ({
      wizardDraft: emptyDraft,
      uploads: {},
      setWizardDraft: (patch) =>
        set((s) => ({ wizardDraft: { ...s.wizardDraft, ...patch } })),
      resetWizardDraft: () => set({ wizardDraft: emptyDraft }),
      setUploadProgress: (attachmentId, progress) =>
        set((s) => ({
          uploads: { ...s.uploads, [attachmentId]: progress },
        })),
      clearUpload: (attachmentId) =>
        set((s) => {
          const next = { ...s.uploads };
          delete next[attachmentId];
          return { uploads: next };
        }),
    }),
    {
      name: 'home-project-prefs',
      storage: createJSONStorage(() => asyncStorage),
      partialize: (state) => ({ wizardDraft: state.wizardDraft }),
    }
  )
);
