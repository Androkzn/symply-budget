import type { SavingsImportDraft, SavingsImportJob } from '@api/savings';

import { isoNow, newLocalId } from '../ids';

interface StoredImportJob {
  job: SavingsImportJob;
  draft: SavingsImportDraft;
}

const jobs = new Map<string, StoredImportJob>();

export function createLocalImportJob(
  householdId: string,
  draft: SavingsImportDraft,
  meta: { sourceKind: SavingsImportJob['source_kind']; fileName?: string | null; mimeType?: string | null },
): string {
  const id = newLocalId('import');
  const now = isoNow();
  jobs.set(id, {
    job: {
      id,
      household_id: householdId,
      status: 'ready',
      source_kind: meta.sourceKind,
      file_name: meta.fileName ?? null,
      mime_type: meta.mimeType ?? null,
      size_bytes: null,
      error: null,
      created_at: now,
      updated_at: now,
    },
    draft,
  });
  return id;
}

export function getLocalImportJob(
  householdId: string,
  jobId: string,
): { job: SavingsImportJob; draft: SavingsImportDraft | null } | null {
  const stored = jobs.get(jobId);
  if (!stored || stored.job.household_id !== householdId) return null;
  return { job: stored.job, draft: stored.draft };
}

export function markLocalImportCommitted(jobId: string): void {
  const stored = jobs.get(jobId);
  if (!stored) return;
  stored.job.status = 'committed';
  stored.job.updated_at = isoNow();
}

export function resetLocalImportJobsForTests(): void {
  jobs.clear();
}
