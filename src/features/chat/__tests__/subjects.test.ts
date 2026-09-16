/**
 * Grouping the rooms list by what each room is about.
 *
 * The interesting cases are the ones where a flat list would have been wrong in
 * a way nobody notices until a household has three projects: a material chat
 * opened without its project chat (no title to group under), a room whose
 * project was renamed (the group must survive it), and the ordering that decides
 * what a member sees first when they open Chat.
 */
import {
  filterRoomsByTab,
  groupRoomsBySubject,
  groupUnread,
  findSubjectRoom,
  isMaterialRoom,
  isProjectRoom,
  projectIdOf,
  CHAT_FILTER_ALL,
  CHAT_FILTER_ASSISTANT,
  CHAT_FILTER_GENERAL,
  CHAT_FILTER_PROJECTS,
  HOUSEHOLD_GROUP_KEY,
} from '../subjects';
import { CHAT_SUBJECT_MATERIAL, CHAT_SUBJECT_PROJECT, type ChatRoom } from '../types';

function room(over: Partial<ChatRoom> & { id: string }): ChatRoom {
  return {
    name: over.id,
    ai_enabled: true,
    is_default: false,
    is_assistant: false,
    restricted: false,
    subject: null,
    created_by: 'u1',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    last_message: null,
    unread_count: 0,
    ...over,
  } as ChatRoom;
}

function projectRoom(id: string, projectId: string, label: string, unread = 0): ChatRoom {
  return room({
    id,
    name: label,
    unread_count: unread,
    subject: {
      type: CHAT_SUBJECT_PROJECT,
      id: projectId,
      label,
      parent_id: null,
      parent_label: null,
      has_context: true,
    },
  });
}

function materialRoom(
  id: string,
  materialId: string,
  label: string,
  projectId: string,
  projectLabel: string | null,
  unread = 0
): ChatRoom {
  return room({
    id,
    name: label,
    unread_count: unread,
    subject: {
      type: CHAT_SUBJECT_MATERIAL,
      id: materialId,
      label,
      parent_id: projectId,
      parent_label: projectLabel,
      has_context: true,
    },
  });
}

describe('filterRoomsByTab', () => {
  const assistant = room({ id: 'assistant', is_assistant: true });
  const bills = room({ id: 'bills' });
  const kitchen = projectRoom('p1', 'proj-1', 'Kitchen Reno');
  const oak = materialRoom('m1', 'mat-1', 'Herringbone Oak', 'proj-1', 'Kitchen Reno');
  const all = [assistant, bills, kitchen, oak];

  it('shows everything under All, in the order it was given', () => {
    expect(filterRoomsByTab(all, CHAT_FILTER_ALL)).toEqual(all);
  });

  it('General is the household’s own rooms — not the assistant, not a project', () => {
    expect(filterRoomsByTab(all, CHAT_FILTER_GENERAL)).toEqual([bills]);
  });

  it('Projects takes a project chat AND the material chats beneath it', () => {
    expect(filterRoomsByTab(all, CHAT_FILTER_PROJECTS)).toEqual([kitchen, oak]);
  });

  it('AI Assistant takes the assistant room alone', () => {
    expect(filterRoomsByTab(all, CHAT_FILTER_ASSISTANT)).toEqual([assistant]);
  });

  it('accounts for every room exactly once across the three narrow tabs', () => {
    // The property that matters: no room is unreachable. A room kind that lands
    // in no tab is a conversation the member can only find by luck.
    const narrow = [
      ...filterRoomsByTab(all, CHAT_FILTER_GENERAL),
      ...filterRoomsByTab(all, CHAT_FILTER_PROJECTS),
      ...filterRoomsByTab(all, CHAT_FILTER_ASSISTANT),
    ];
    expect(new Set(narrow.map((r) => r.id))).toEqual(new Set(all.map((r) => r.id)));
    expect(narrow).toHaveLength(all.length);
  });

  it('treats a room from a Worker predating subjects as a General room', () => {
    // `subject` absent entirely (not null) — the pre-0167 shape.
    const legacy = { ...room({ id: 'legacy' }) };
    delete (legacy as Partial<ChatRoom>).subject;
    expect(filterRoomsByTab([legacy], CHAT_FILTER_GENERAL)).toEqual([legacy]);
    expect(filterRoomsByTab([legacy], CHAT_FILTER_PROJECTS)).toEqual([]);
  });
});

describe('groupRoomsBySubject', () => {
  it('puts the household’s own rooms first, then one section per project', () => {
    const groups = groupRoomsBySubject([
      room({ id: 'assistant', is_assistant: true }),
      room({ id: 'general', is_default: true }),
      projectRoom('r_kitchen', 'p1', 'Kitchen Reno'),
      materialRoom('r_oak', 's1', 'Herringbone Oak', 'p1', 'Kitchen Reno'),
      projectRoom('r_deck', 'p2', 'Deck Rebuild'),
    ]);

    expect(groups.map((g) => g.key)).toEqual([HOUSEHOLD_GROUP_KEY, 'p1', 'p2']);
    expect(groups[0].rooms.map((r) => r.id)).toEqual(['assistant', 'general']);
    expect(groups[1].title).toBe('Kitchen Reno');
    // The project's general chat leads its own group — a stable first row keeps
    // the group from reshuffling under a tap.
    expect(groups[1].rooms.map((r) => r.id)).toEqual(['r_kitchen', 'r_oak']);
  });

  it('titles a project group from a material when the project chat was never opened', () => {
    // The case that matters: a member can open a material's chat without ever
    // opening the project's, and a group headed "Project" would be all they see.
    const groups = groupRoomsBySubject([
      materialRoom('r_oak', 's1', 'Herringbone Oak', 'p1', 'Kitchen Reno'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Kitchen Reno');
    expect(groups[0].projectId).toBe('p1');
  });

  it('falls back to a neutral title when nothing carries the project name', () => {
    const groups = groupRoomsBySubject([
      materialRoom('r_oak', 's1', 'Herringbone Oak', 'p1', null),
    ]);
    expect(groups[0].title).toBe('Project');
  });

  it('keys a group on the project id, so a rename does not split it', () => {
    const groups = groupRoomsBySubject([
      projectRoom('r_kitchen', 'p1', 'Kitchen Reno v2'),
      materialRoom('r_oak', 's1', 'Herringbone Oak', 'p1', 'Kitchen Reno'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('p1');
    // The project chat's own label wins over a material's stale copy of it.
    expect(groups[0].title).toBe('Kitchen Reno v2');
  });

  it('omits the household section entirely when every room belongs to a project', () => {
    const groups = groupRoomsBySubject([projectRoom('r_kitchen', 'p1', 'Kitchen Reno')]);
    expect(groups.map((g) => g.key)).toEqual(['p1']);
  });

  it('treats a room from a pre-0167 Worker (no subject field) as a household room', () => {
    const legacy = { ...room({ id: 'r_old' }) } as ChatRoom;
    delete (legacy as { subject?: unknown }).subject;

    const groups = groupRoomsBySubject([legacy]);
    expect(groups[0].key).toBe(HOUSEHOLD_GROUP_KEY);
  });
});

describe('subject helpers', () => {
  it('reports the project a room belongs to', () => {
    expect(projectIdOf(projectRoom('r', 'p1', 'Kitchen'))).toBe('p1');
    expect(projectIdOf(materialRoom('r', 's1', 'Oak', 'p1', 'Kitchen'))).toBe('p1');
    expect(projectIdOf(room({ id: 'r' }))).toBeNull();
  });

  it('distinguishes a project chat from a material chat', () => {
    expect(isProjectRoom(projectRoom('r', 'p1', 'K'))).toBe(true);
    expect(isMaterialRoom(projectRoom('r', 'p1', 'K'))).toBe(false);
    expect(isMaterialRoom(materialRoom('r', 's1', 'Oak', 'p1', 'K'))).toBe(true);
  });

  it('sums unread across a group', () => {
    const [group] = groupRoomsBySubject([
      projectRoom('r_kitchen', 'p1', 'Kitchen Reno', 2),
      materialRoom('r_oak', 's1', 'Oak', 'p1', 'Kitchen Reno', 3),
    ]);
    expect(groupUnread(group)).toBe(5);
  });

  it('finds one subject’s room in an already-loaded list', () => {
    const rooms = [
      room({ id: 'general' }),
      materialRoom('r_oak', 's1', 'Oak', 'p1', 'Kitchen Reno'),
    ];
    expect(findSubjectRoom(rooms, CHAT_SUBJECT_MATERIAL, 's1')?.id).toBe('r_oak');
    expect(findSubjectRoom(rooms, CHAT_SUBJECT_MATERIAL, 'nope')).toBeUndefined();
    // Same id, different kind — a project and a material must never collide.
    expect(findSubjectRoom(rooms, CHAT_SUBJECT_PROJECT, 's1')).toBeUndefined();
  });
});
