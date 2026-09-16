import { eq, and, asc, desc } from 'drizzle-orm';
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { v4 as uuidv4 } from 'uuid';

import { householdMembers } from '../db/schema';
import { visitNotes, type VisitNote, VISIT_NOTE_TYPES } from '../db/schema-labor-hub';
import type { Env } from '../types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { nowIso } from '../utils/id';

export class VisitNotesService {
  private db: DrizzleD1Database;

  constructor(_env: Env, d1: D1Database) {
    this.db = drizzle(d1);
  }

  // ============ ACCESS CHECK ============

  private async checkHouseholdAccess(householdId: string, userId: string): Promise<void> {
    const member = await this.db
      .select()
      .from(householdMembers)
      .where(and(eq(householdMembers.household_id, householdId), eq(householdMembers.user_id, userId)))
      .get();

    if (!member) {
      throw new ForbiddenError('You do not have access to this household');
    }
  }

  // ============ VISIT NOTES ============

  async getNotesForVisit(householdId: string, visitId: string, userId: string): Promise<VisitNote[]> {
    await this.checkHouseholdAccess(householdId, userId);

    return this.db
      .select()
      .from(visitNotes)
      .where(and(eq(visitNotes.visit_id, visitId), eq(visitNotes.household_id, householdId)))
      .orderBy(asc(visitNotes.timestamp))
      .all();
  }

  async getNotesForHousehold(
    householdId: string,
    userId: string,
    filters?: {
      type?: string;
      tag?: string;
      limit?: number;
    }
  ): Promise<VisitNote[]> {
    await this.checkHouseholdAccess(householdId, userId);

    let notes = await this.db
      .select()
      .from(visitNotes)
      .where(eq(visitNotes.household_id, householdId))
      .orderBy(desc(visitNotes.timestamp))
      .all();

    if (filters?.type) {
      notes = notes.filter((n) => n.type === filters.type);
    }

    if (filters?.tag) {
      notes = notes.filter((n) => {
        const tags = JSON.parse(n.tags || '[]') as string[];
        return tags.includes(filters.tag!);
      });
    }

    if (filters?.limit) {
      notes = notes.slice(0, filters.limit);
    }

    return notes;
  }

  async getNote(householdId: string, noteId: string, userId: string): Promise<VisitNote> {
    await this.checkHouseholdAccess(householdId, userId);

    const note = await this.db
      .select()
      .from(visitNotes)
      .where(and(eq(visitNotes.id, noteId), eq(visitNotes.household_id, householdId)))
      .get();

    if (!note) {
      throw new NotFoundError('Note not found');
    }

    return note;
  }

  async createNote(
    householdId: string,
    visitId: string,
    userId: string,
    input: {
      type: (typeof VISIT_NOTE_TYPES)[number];
      content?: string;
      transcription?: string;
      tags?: string[];
    }
  ): Promise<VisitNote> {
    await this.checkHouseholdAccess(householdId, userId);

    const id = uuidv4();
    const now = nowIso();

    await this.db.insert(visitNotes).values({
      id,
      visit_id: visitId,
      household_id: householdId,
      type: input.type,
      content: input.content || null,
      transcription: input.transcription || null,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      timestamp: now,
      created_at: now,
    });

    return this.getNote(householdId, id, userId);
  }

  async createTextNote(
    householdId: string,
    visitId: string,
    userId: string,
    content: string,
    tags?: string[]
  ): Promise<VisitNote> {
    return this.createNote(householdId, visitId, userId, {
      type: 'text',
      content,
      tags,
    });
  }

  async createPhotoNote(
    householdId: string,
    visitId: string,
    userId: string,
    photoKey: string,
    tags?: string[]
  ): Promise<VisitNote> {
    return this.createNote(householdId, visitId, userId, {
      type: 'photo',
      content: photoKey,
      tags,
    });
  }

  async createVoiceNote(
    householdId: string,
    visitId: string,
    userId: string,
    audioKey: string,
    transcription?: string,
    tags?: string[]
  ): Promise<VisitNote> {
    return this.createNote(householdId, visitId, userId, {
      type: 'voice',
      content: audioKey,
      transcription,
      tags,
    });
  }

  async createChecklistNote(
    householdId: string,
    visitId: string,
    userId: string,
    checklistData: string,
    tags?: string[]
  ): Promise<VisitNote> {
    return this.createNote(householdId, visitId, userId, {
      type: 'checklist',
      content: checklistData,
      tags,
    });
  }

  async updateNote(
    householdId: string,
    noteId: string,
    userId: string,
    input: {
      content?: string;
      transcription?: string;
      tags?: string[];
    }
  ): Promise<VisitNote> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.getNote(householdId, noteId, userId);

    const updateData: Partial<VisitNote> = {};

    if (input.content !== undefined) updateData.content = input.content;
    if (input.transcription !== undefined) updateData.transcription = input.transcription;
    if (input.tags !== undefined) updateData.tags = JSON.stringify(input.tags);

    await this.db.update(visitNotes).set(updateData).where(eq(visitNotes.id, noteId));

    return this.getNote(householdId, noteId, userId);
  }

  async addTranscription(
    householdId: string,
    noteId: string,
    userId: string,
    transcription: string
  ): Promise<VisitNote> {
    return this.updateNote(householdId, noteId, userId, { transcription });
  }

  async addTags(householdId: string, noteId: string, userId: string, newTags: string[]): Promise<VisitNote> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getNote(householdId, noteId, userId);
    const currentTags = JSON.parse(existing.tags || '[]') as string[];
    const mergedTags = [...new Set([...currentTags, ...newTags])];

    return this.updateNote(householdId, noteId, userId, { tags: mergedTags });
  }

  async removeTags(householdId: string, noteId: string, userId: string, tagsToRemove: string[]): Promise<VisitNote> {
    await this.checkHouseholdAccess(householdId, userId);

    const existing = await this.getNote(householdId, noteId, userId);
    const currentTags = JSON.parse(existing.tags || '[]') as string[];
    const filteredTags = currentTags.filter((t) => !tagsToRemove.includes(t));

    return this.updateNote(householdId, noteId, userId, { tags: filteredTags });
  }

  async deleteNote(householdId: string, noteId: string, userId: string): Promise<void> {
    await this.checkHouseholdAccess(householdId, userId);

    await this.getNote(householdId, noteId, userId);

    await this.db.delete(visitNotes).where(eq(visitNotes.id, noteId));
  }

  // ============ BULK OPERATIONS ============

  async getNotesGroupedByType(householdId: string, visitId: string, userId: string): Promise<Record<string, VisitNote[]>> {
    const notes = await this.getNotesForVisit(householdId, visitId, userId);

    return notes.reduce(
      (acc, note) => {
        if (!acc[note.type]) {
          acc[note.type] = [];
        }
        acc[note.type].push(note);
        return acc;
      },
      {} as Record<string, VisitNote[]>
    );
  }

  async getNotesTimeline(
    householdId: string,
    visitId: string,
    userId: string
  ): Promise<Array<VisitNote & { formattedTime: string }>> {
    const notes = await this.getNotesForVisit(householdId, visitId, userId);

    return notes.map((note) => ({
      ...note,
      formattedTime: new Date(note.timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
    }));
  }

  async searchNotes(
    householdId: string,
    userId: string,
    query: string
  ): Promise<VisitNote[]> {
    await this.checkHouseholdAccess(householdId, userId);

    const allNotes = await this.db
      .select()
      .from(visitNotes)
      .where(eq(visitNotes.household_id, householdId))
      .all();

    const lowerQuery = query.toLowerCase();

    return allNotes.filter((note) => {
      const contentMatch = note.content?.toLowerCase().includes(lowerQuery);
      const transcriptionMatch = note.transcription?.toLowerCase().includes(lowerQuery);
      const tagsMatch = note.tags?.toLowerCase().includes(lowerQuery);
      return contentMatch || transcriptionMatch || tagsMatch;
    });
  }
}
