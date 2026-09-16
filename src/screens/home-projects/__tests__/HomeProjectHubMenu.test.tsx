/**
 * The header "…" menu on the project hub.
 *
 * This menu is the ONLY way to reach publish, manage-access, archive and delete
 * — Archive used to be a text link in the body and the other three have never
 * had another entry point — so an item that silently stops being built is a
 * feature that silently stops existing, and no type error or lint rule would say
 * so. Hence a suite on the action set itself.
 *
 * The two toggles are the interesting part: each is one row in two states, so
 * the assertions are that exactly one of each pair is ever offered, and that it
 * is the one matching the project in front of the member.
 */
import {
  buildProjectMenuActions,
  type ProjectMenuHandlers,
} from '../HomeProjectHubScreen';

function handlers(): ProjectMenuHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    manageAccess: () => calls.push('manageAccess'),
    publish: () => calls.push('publish'),
    unpublish: () => calls.push('unpublish'),
    archive: () => calls.push('archive'),
    unarchive: () => calls.push('unarchive'),
    remove: () => calls.push('remove'),
  };
}

const SHARED_ACTIVE = { isDraft: false, isArchived: false };

describe('the project hub’s “…” menu', () => {
  it('offers the four project-level actions, in a stable order', () => {
    expect(buildProjectMenuActions(SHARED_ACTIVE, handlers()).map((a) => a.label)).toEqual([
      'Manage access',
      'Move back to a draft',
      'Archive',
      'Delete project',
    ]);
  });

  /**
   * "Edit budget" was removed rather than renamed. It never opened an editor: it
   * switched to the Budget tab and focused the target field, duplicating a tab
   * pill already on screen under a name that promised something else. Every
   * budget figure is editable in place on that tab now, so this pins the row out
   * rather than letting it creep back.
   */
  it('offers no budget row — the Budget tab owns every budget figure', () => {
    for (const state of [
      SHARED_ACTIVE,
      { isDraft: true, isArchived: false },
      { isDraft: false, isArchived: true },
      { isDraft: true, isArchived: true },
    ]) {
      expect(buildProjectMenuActions(state, handlers()).map((a) => a.label)).not.toContain(
        'Edit budget'
      );
    }
  });

  it('offers Publish for a draft and Unpublish for a shared project, never both', () => {
    const draft = buildProjectMenuActions({ ...SHARED_ACTIVE, isDraft: true }, handlers());
    expect(draft.map((a) => a.label)).toContain('Publish to household');
    expect(draft.map((a) => a.label)).not.toContain('Move back to a draft');

    const shared = buildProjectMenuActions(SHARED_ACTIVE, handlers());
    expect(shared.map((a) => a.label)).toContain('Move back to a draft');
    expect(shared.map((a) => a.label)).not.toContain('Publish to household');
  });

  it('offers Unarchive instead of Archive once a project is archived', () => {
    const archived = buildProjectMenuActions({ isDraft: false, isArchived: true }, handlers());
    expect(archived.map((a) => a.label)).toContain('Unarchive');
    expect(archived.map((a) => a.label)).not.toContain('Archive');
  });

  it('keeps Delete last and marks it destructive — and marks nothing else', () => {
    // Position and styling both matter: Archive is the reversible answer to most
    // reasons a member opens this menu, and it has to be the row above rather
    // than below. `destructiveButtonIndex` on iOS takes exactly one index.
    const actions = buildProjectMenuActions(SHARED_ACTIVE, handlers());
    expect(actions[actions.length - 1].label).toBe('Delete project');
    expect(actions.filter((a) => a.destructive).map((a) => a.label)).toEqual(['Delete project']);
  });

  it('keeps Archive directly above Delete in every state', () => {
    for (const state of [
      SHARED_ACTIVE,
      { isDraft: true, isArchived: false },
      { isDraft: false, isArchived: true },
      { isDraft: true, isArchived: true },
    ]) {
      const labels = buildProjectMenuActions(state, handlers()).map((a) => a.label);
      const archiveIndex = labels.findIndex((l) => l === 'Archive' || l === 'Unarchive');
      expect(archiveIndex).toBe(labels.indexOf('Delete project') - 1);
    }
  });

  it('offers the same number of rows in every state, so nothing is dropped', () => {
    for (const state of [
      SHARED_ACTIVE,
      { isDraft: true, isArchived: false },
      { isDraft: false, isArchived: true },
      { isDraft: true, isArchived: true },
    ]) {
      expect(buildProjectMenuActions(state, handlers())).toHaveLength(4);
    }
  });

  it('runs the handler each row names', () => {
    const h = handlers();
    for (const action of buildProjectMenuActions(SHARED_ACTIVE, h)) action.run();
    expect(h.calls).toEqual(['manageAccess', 'unpublish', 'archive', 'remove']);

    const draftArchived = handlers();
    for (const action of buildProjectMenuActions(
      { isDraft: true, isArchived: true },
      draftArchived
    )) {
      action.run();
    }
    expect(draftArchived.calls).toEqual(['manageAccess', 'publish', 'unarchive', 'remove']);
  });
});
