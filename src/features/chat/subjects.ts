/**
 * Subject-scoped chat — the rules for rooms that belong to SOMETHING.
 *
 * A household's chat list used to be flat, and that was fine while every room
 * was a room somebody named. Once a project can have a general chat and each of
 * its materials can have its own, a flat list is the wrong shape: eleven rows
 * called "Herringbone Oak", "Matte Black Faucet", "Kitchen Reno" read as
 * eleven unrelated conversations when they are one project's worth of thinking.
 *
 * So the list groups. This module owns the grouping, away from the screen, for
 * two reasons: the same grouping is what a project's own chat list needs, and
 * the ordering rules below (assistant first, then General, then the project the
 * household is actually talking in) are the kind of thing worth testing without
 * mounting a FlatList.
 */
import {
  CHAT_SUBJECT_MATERIAL,
  CHAT_SUBJECT_PROJECT,
  type ChatRoom,
  type ChatSubjectType,
} from './types';

/** One group of rooms in the chat list. */
export interface ChatRoomGroup {
  /**
   * Stable key. `household` for the ungrouped rooms; otherwise the project id,
   * so a group survives a project being renamed.
   */
  key: string;
  title: string;
  /** The project this group is about, when it is a project group. */
  projectId: string | null;
  rooms: ChatRoom[];
}

/** The section title for rooms that belong to nothing in particular. */
export const HOUSEHOLD_GROUP_TITLE = 'Household';
export const HOUSEHOLD_GROUP_KEY = 'household';

/**
 * The four filters above the rooms list. `all` is the default — the list a
 * member opening Chat expects to see — and the other three answer the only
 * three questions the list is ever asked: what is the household talking about,
 * what is a project talking about, and where is the assistant.
 */
export const CHAT_FILTER_ALL = 'all';
export const CHAT_FILTER_GENERAL = 'general';
export const CHAT_FILTER_PROJECTS = 'projects';
export const CHAT_FILTER_ASSISTANT = 'assistant';

export type ChatRoomFilter =
  | typeof CHAT_FILTER_ALL
  | typeof CHAT_FILTER_GENERAL
  | typeof CHAT_FILTER_PROJECTS
  | typeof CHAT_FILTER_ASSISTANT;

/** True for a room attached to a home project (its general chat). */
export function isProjectRoom(room: ChatRoom): boolean {
  return room.subject?.type === CHAT_SUBJECT_PROJECT;
}

/** True for a room attached to one material inside a project. */
export function isMaterialRoom(room: ChatRoom): boolean {
  return room.subject?.type === CHAT_SUBJECT_MATERIAL;
}

/** True for any room that belongs to a project — its general chat or a material's. */
export function isProjectScopedRoom(room: ChatRoom): boolean {
  return isProjectRoom(room) || isMaterialRoom(room);
}

/**
 * The project a room belongs to, or null. A project's general chat is keyed on
 * its own subject id; a material's on its parent.
 */
export function projectIdOf(room: ChatRoom): string | null {
  if (isProjectRoom(room)) return room.subject?.id ?? null;
  if (isMaterialRoom(room)) return room.subject?.parent_id ?? null;
  return null;
}

/**
 * The rooms one filter tab shows.
 *
 * `general` is defined by exclusion — everything that is neither project-scoped
 * nor the assistant — rather than by a flag, so a room a member creates lands
 * somewhere visible on the day it is created, without a new room kind having to
 * teach this function about itself first.
 */
export function filterRoomsByTab(rooms: ChatRoom[], filter: ChatRoomFilter): ChatRoom[] {
  switch (filter) {
    case CHAT_FILTER_GENERAL:
      return rooms.filter((room) => !isProjectScopedRoom(room) && !room.is_assistant);
    case CHAT_FILTER_PROJECTS:
      return rooms.filter(isProjectScopedRoom);
    case CHAT_FILTER_ASSISTANT:
      return rooms.filter((room) => room.is_assistant);
    case CHAT_FILTER_ALL:
    default:
      return rooms;
  }
}

/**
 * Group a flat rooms list into the sections the chat list renders.
 *
 * Ordering, and why each rule is there:
 *  - Household first, always. It holds the AI assistant room and General, and a
 *    member opening Chat to message the household should not have to scroll
 *    past six projects to do it.
 *  - Then projects by most recent activity, so the thing being discussed today
 *    is at the top tomorrow as well.
 *  - Inside a project, its general chat leads and its materials follow by
 *    recency. The general chat is the one that always exists, so a stable
 *    first row keeps the group from reshuffling under a tap.
 *
 * The server already returns rooms newest-activity-first with the assistant and
 * General pinned, so within-group order is preserved rather than recomputed —
 * one source of truth for "recent", and the pins survive.
 */
export function groupRoomsBySubject(rooms: ChatRoom[]): ChatRoomGroup[] {
  const household: ChatRoom[] = [];
  const byProject = new Map<string, ChatRoomGroup>();

  for (const room of rooms) {
    const projectId = projectIdOf(room);
    if (!projectId) {
      household.push(room);
      continue;
    }

    let group = byProject.get(projectId);
    if (!group) {
      group = {
        key: projectId,
        // Resolved below from whichever room carries the project's name.
        title: '',
        projectId,
        rooms: [],
      };
      byProject.set(projectId, group);
    }
    group.rooms.push(room);
  }

  const groups: ChatRoomGroup[] = [];
  if (household.length > 0) {
    groups.push({
      key: HOUSEHOLD_GROUP_KEY,
      title: HOUSEHOLD_GROUP_TITLE,
      projectId: null,
      rooms: household,
    });
  }

  for (const group of byProject.values()) {
    group.title = projectTitleFor(group.rooms);
    // The project's general chat leads; materials keep the server's recency.
    group.rooms.sort((a, b) => Number(isProjectRoom(b)) - Number(isProjectRoom(a)));
    groups.push(group);
  }

  return groups;
}

/**
 * The display name for a project group.
 *
 * Prefers the project chat's own label, and falls back to the `parent_label` a
 * material chat carries — which is the case that matters, because a member can
 * open a material's chat without ever opening the project's, and a group headed
 * "Project" would then be the only thing they see.
 */
function projectTitleFor(rooms: ChatRoom[]): string {
  const fromProject = rooms.find(isProjectRoom)?.subject?.label;
  if (fromProject) return fromProject;
  const fromMaterial = rooms.find((r) => r.subject?.parent_label)?.subject?.parent_label;
  return fromMaterial || 'Project';
}

/** Total unread across a group — drives the count on a collapsed header. */
export function groupUnread(group: ChatRoomGroup): number {
  return group.rooms.reduce((sum, room) => sum + (room.unread_count || 0), 0);
}

/**
 * Find the room for one subject in an already-loaded list. Lets a project or
 * material screen show its unread badge without a second request, reusing the
 * rooms query the chat tab already keeps warm.
 */
export function findSubjectRoom(
  rooms: ChatRoom[],
  subjectType: ChatSubjectType | string,
  subjectId: string
): ChatRoom | undefined {
  return rooms.find((r) => r.subject?.type === subjectType && r.subject?.id === subjectId);
}
