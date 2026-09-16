import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import type { Env } from '../../types';
import { createCoreTables, resetAllTables } from '../aihousekeeper/__tests__/test-helpers';
import {
  EnhancedPdfProcessorService,
  ReportProcessingConflictError,
  STUCK_PROCESSING_GRACE_MS,
  sweepStuckProcessingReports,
} from '../enhanced-pdf-processor';

const testEnv = env as unknown as Env;
const HID = 'hh_report_sweep_01';
const UID = 'u_report_sweep_owner';
const MID = 'm_report_sweep_owner';

async function createReportsTable(): Promise<void> {
  await testEnv.DB.prepare(
    `CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_key TEXT NOT NULL,
      status TEXT NOT NULL,
      processing_started_at TEXT,
      processing_completed_at TEXT,
      error_message TEXT,
      page_count INTEGER,
      inspection_date TEXT,
      inspector_name TEXT,
      property_address TEXT,
      total_findings_count INTEGER DEFAULT 0,
      critical_findings_count INTEGER DEFAULT 0,
      processing_progress INTEGER DEFAULT 0,
      processing_stage TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`
  ).run();
}

async function seedReport(
  reportId: string,
  status: string,
  opts?: { processing_started_at?: string; updated_at?: string }
): Promise<void> {
  const ts = opts?.updated_at ?? new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO reports (
      id, household_id, uploaded_by, filename, file_size, file_key, status,
      processing_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      reportId,
      HID,
      UID,
      'inspection.pdf',
      1024,
      `reports/${reportId}.pdf`,
      status,
      opts?.processing_started_at ?? null,
      ts,
      ts
    )
    .run();
}

describe('sweepStuckProcessingReports', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createReportsTable();
    await resetAllTables(testEnv.DB);
    await testEnv.CONFIG_KV.delete('report_pipeline_paused');

    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.users).values({
      id: UID,
      email: 'report-sweep@example.com',
      email_verified: true,
    });
    await db.insert(schema.households).values({ id: HID, name: 'ReportSweepTest' });
    await db.insert(schema.householdMembers).values({
      id: MID,
      household_id: HID,
      user_id: UID,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });
  });

  it('reconciles processing rows older than the grace window', async () => {
    const reportId = 'rpt-sweep-stuck';
    const oldTs = new Date(Date.now() - STUCK_PROCESSING_GRACE_MS - 60_000).toISOString();
    await seedReport(reportId, 'processing', {
      processing_started_at: oldTs,
      updated_at: oldTs,
    });

    const result = await sweepStuckProcessingReports(testEnv);
    expect(result.reconciled).toBe(1);

    const row = await drizzle(testEnv.DB, { schema })
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe('report_stuck_in_processing');
  });

  it('skips processing rows still inside the grace window', async () => {
    const reportId = 'rpt-sweep-fresh';
    const freshTs = new Date().toISOString();
    await seedReport(reportId, 'processing', {
      processing_started_at: freshTs,
      updated_at: freshTs,
    });

    const result = await sweepStuckProcessingReports(testEnv);
    expect(result.reconciled).toBe(0);

    const row = await drizzle(testEnv.DB, { schema })
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();
    expect(row?.status).toBe('processing');
  });

  it('no-ops when report_pipeline_paused is set', async () => {
    const reportId = 'rpt-sweep-paused';
    const oldTs = new Date(Date.now() - STUCK_PROCESSING_GRACE_MS - 60_000).toISOString();
    await seedReport(reportId, 'processing', {
      processing_started_at: oldTs,
      updated_at: oldTs,
    });
    await testEnv.CONFIG_KV.put('report_pipeline_paused', 'true');

    const result = await sweepStuckProcessingReports(testEnv);
    expect(result.skipped).toBe('paused');
    expect(result.reconciled).toBe(0);

    const row = await drizzle(testEnv.DB, { schema })
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, reportId))
      .get();
    expect(row?.status).toBe('processing');
  });
});

describe('EnhancedPdfProcessorService CAS', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createReportsTable();
    await resetAllTables(testEnv.DB);

    const db = drizzle(testEnv.DB, { schema });
    await db.insert(schema.users).values({
      id: UID,
      email: 'report-cas@example.com',
      email_verified: true,
    });
    await db.insert(schema.households).values({ id: HID, name: 'ReportCasTest' });
    await db.insert(schema.householdMembers).values({
      id: MID,
      household_id: HID,
      user_id: UID,
      role: 'owner',
      joined_at: new Date().toISOString(),
    });
  });

  it('refuses processReportDirect when report is already processing', async () => {
    const reportId = 'rpt-cas-processing';
    await seedReport(reportId, 'processing', {
      processing_started_at: new Date().toISOString(),
    });

    const processor = new EnhancedPdfProcessorService(testEnv, testEnv.DB);
    await expect(processor.processReportDirect(reportId)).rejects.toBeInstanceOf(
      ReportProcessingConflictError
    );
  });

  it('refuses processReportDirect when report is completed', async () => {
    const reportId = 'rpt-cas-completed';
    await seedReport(reportId, 'completed');

    const processor = new EnhancedPdfProcessorService(testEnv, testEnv.DB);
    await expect(processor.processReportDirect(reportId)).rejects.toBeInstanceOf(
      ReportProcessingConflictError
    );
  });
});
