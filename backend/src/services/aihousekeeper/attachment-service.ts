import { and, desc, eq } from 'drizzle-orm';

import { aihousekeeperAttachments } from '../../db/schema-aihousekeeper';
import type { Env } from '../../types';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import { generateId, now as nowIso } from '../../utils/id';
import { createDb } from '../db';

const MAX_SIZE_BYTES = 25 * 1024 * 1024;

function isAllowedMime(mime: string): boolean {
  if (mime.startsWith('image/')) return true;
  const docAllow = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ]);
  return docAllow.has(mime);
}

export class AihousekeeperAttachmentService {
  private db;

  constructor(private env: Env, d1: D1Database) {
    this.db = createDb(d1);
  }

  assertAllowedMime(mimeType: string): void {
    if (!isAllowedMime(mimeType)) {
      throw new ValidationError({
        mimeType: [`unsupported mime type: ${mimeType}`],
      });
    }
  }

  async createUploadRecord(
    householdId: string,
    userId: string,
    input: { fileName: string; mimeType: string; size?: number; kindHint?: string }
  ) {
    const id = generateId();
    const safeName = input.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 255);
    const r2Key = `aihousekeeper-attachments/${householdId}/${id}/${safeName}`;
    const ts = nowIso();

    await this.db.insert(aihousekeeperAttachments).values({
      id,
      household_id: householdId,
      user_id: userId,
      r2_key: r2Key,
      file_name: safeName,
      mime_type: input.mimeType,
      size_bytes: input.size ?? null,
      status: 'pending_upload',
      kind_hint: input.kindHint ?? null,
      created_at: ts,
      updated_at: ts,
    });

    return {
      id,
      uploadUrl: `/households/${householdId}/aihousekeeper/attachments/${id}/upload`,
      r2Key,
      maxSizeBytes: MAX_SIZE_BYTES,
    };
  }

  async getAttachmentForUpload(householdId: string, userId: string, attachmentId: string) {
    const row = await this.db
      .select()
      .from(aihousekeeperAttachments)
      .where(
        and(
          eq(aihousekeeperAttachments.id, attachmentId),
          eq(aihousekeeperAttachments.household_id, householdId)
        )
      )
      .get();
    if (!row) throw new NotFoundError('attachment');
    if (row.user_id !== userId) {
      throw new ForbiddenError('attachment belongs to a different user');
    }
    if (row.status !== 'pending_upload') {
      throw new ForbiddenError(`attachment already ${row.status}`);
    }
    return row;
  }

  async markUploaded(attachmentId: string, body: ArrayBuffer, _contentType: string) {
    const digest = await crypto.subtle.digest('SHA-256', body);
    const contentHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const ts = nowIso();

    await this.db
      .update(aihousekeeperAttachments)
      .set({
        status: 'uploaded',
        size_bytes: body.byteLength,
        content_hash: contentHash,
        updated_at: ts,
      })
      .where(eq(aihousekeeperAttachments.id, attachmentId));

    return { id: attachmentId, status: 'uploaded' as const, sizeBytes: body.byteLength };
  }

  async getAttachment(householdId: string, attachmentId: string) {
    const row = await this.db
      .select()
      .from(aihousekeeperAttachments)
      .where(
        and(
          eq(aihousekeeperAttachments.id, attachmentId),
          eq(aihousekeeperAttachments.household_id, householdId)
        )
      )
      .get();
    if (!row) throw new NotFoundError('attachment');
    return row;
  }

  async listAttachments(householdId: string) {
    return this.db
      .select()
      .from(aihousekeeperAttachments)
      .where(eq(aihousekeeperAttachments.household_id, householdId))
      .orderBy(desc(aihousekeeperAttachments.created_at))
      .limit(50)
      .all();
  }

  async deleteAttachment(householdId: string, userId: string, attachmentId: string) {
    const row = await this.db
      .select()
      .from(aihousekeeperAttachments)
      .where(
        and(
          eq(aihousekeeperAttachments.id, attachmentId),
          eq(aihousekeeperAttachments.household_id, householdId)
        )
      )
      .get();
    if (!row) throw new NotFoundError('attachment');
    if (row.user_id !== userId) {
      throw new ForbiddenError('attachment belongs to a different user');
    }

    try {
      await this.env.REPORTS_BUCKET.delete(row.r2_key);
    } catch (err) {
      console.warn('[aihousekeeper-attachments] R2 delete failed', {
        id: attachmentId,
        error: (err as Error).message,
      });
    }
    await this.db.delete(aihousekeeperAttachments).where(eq(aihousekeeperAttachments.id, attachmentId));
    return { id: attachmentId, deleted: true as const };
  }

  get maxSizeBytes(): number {
    return MAX_SIZE_BYTES;
  }
}
