import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';

import {
  commitKaizenFileImport,
  importDestinationPath,
  scopeToImportPurpose,
  type KaizenImportPurpose,
  type KaizenImportResult,
} from './importHandlers';
import type { KaizenDriveRememberScope, KaizenUploadedFile } from './rememberScopes';

type ImportTarget = KaizenImportPurpose | KaizenDriveRememberScope;

export function resolveImportPurpose(target: ImportTarget): KaizenImportPurpose {
  if (
    target === 'resume' ||
    target === 'questions' ||
    target === 'book' ||
    target === 'knowledge' ||
    target === 'auto'
  ) {
    return target;
  }
  return scopeToImportPurpose(target);
}

export function useKaizenFileImport(
  target: ImportTarget,
  options?: {
    bookId?: string;
    navigateAfterImport?: boolean;
    onImported?: (result: KaizenImportResult) => void;
  },
) {
  const importQuestionsFromText = useKaizenStore(state => state.importQuestionsFromText);
  const analyzeResume = useKaizenStore(state => state.analyzeResume);
  const saveCareerSetup = useKaizenStore(state => state.saveCareerSetup);
  const addSkill = useKaizenStore(state => state.addSkill);
  const addBook = useKaizenStore(state => state.addBook);
  const attachBookFile = useKaizenStore(state => state.attachBookFile);
  const addKnowledgeItem = useKaizenStore(state => state.addKnowledgeItem);
  const profile = useKaizenStore(state => state.profile);

  const [busy, setBusy] = useState(false);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const purpose = resolveImportPurpose(target);

  const importFile = useCallback(
    async (file: KaizenUploadedFile): Promise<KaizenImportResult | null> => {
      setBusy(true);
      setLastFileName(file.name);
      try {
        if (__DEV__) {
          const { consumeE2EForceImportFail } =
            require('@services/e2e-import-fail') as typeof import('@services/e2e-import-fail');
          if (consumeE2EForceImportFail()) {
            throw new Error('e2e forced import failure');
          }
        }
        const result = await commitKaizenFileImport(purpose, file, {
          importQuestionsFromText,
          analyzeResume,
          saveCareerSetup,
          addSkill,
          addBook,
          attachBookFile,
          addKnowledgeItem,
          profileCareerStep: profile?.career_setup_step ?? null,
        }, { bookId: options?.bookId, careerStep: profile?.career_setup_step ?? undefined });

        options?.onImported?.(result);

        if (options?.navigateAfterImport !== false) {
          const path = importDestinationPath(result);
          if (path) router.push(path as never);
        }

        return result;
      } catch {
        setLastFileName(null);
        Alert.alert(
          'Import failed',
          'Could not import that file. Try another format or paste the text instead.',
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [
      purpose,
      importQuestionsFromText,
      analyzeResume,
      saveCareerSetup,
      addSkill,
      addBook,
      attachBookFile,
      addKnowledgeItem,
      profile?.career_setup_step,
      options?.bookId,
      options?.navigateAfterImport,
      options?.onImported,
    ],
  );

  return {
    purpose,
    importFile,
    busy,
    lastFileName,
    clearLastFileName: () => setLastFileName(null),
  };
}
