/**
 * The list card's job is to say, without being opened, which project this is and
 * whether it needs attention. These cover the three things that were invisible
 * on the two-line row it replaces — the cover photo, the money and the date —
 * plus the backend split that decides which of two image paths can render at all.
 */
// `renderOnDevice` drives the theme through a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Stubbed deliberately: the real component checks the blob cache and the
// connection on mount, and those promises resolve after this suite tears down.
// What the card owes is picking the blob path — HouseBlobImage has its own suite
// for what happens next.
jest.mock('@components/house-v2/HouseBlobImage', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    HouseBlobImage: (props: { testID?: string }) => <View testID={props.testID} />,
  };
});

import React from 'react';

import type { HomeProject } from '@api/home-projects';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';
import { HomeProjectListCard } from '../HomeProjectListCard';

const DESCRIPTOR = {
  blobId: 'blob_cover_1',
  mime: 'image/jpeg',
  bytes: 240_000,
  sha256: 'd'.repeat(64),
  chunkCount: 2,
  keyEpoch: 1,
};

function makeProject(overrides: Partial<HomeProject> = {}): HomeProject {
  return {
    id: 'hp_1',
    household_id: 'hh_1',
    title: 'Upstairs bathroom',
    type: 'bathroom_reno',
    template_key: 'bathroom_reno',
    status: 'in_progress',
    summary: 'Rip out the tub, walk-in shower, heated floor.',
    goals: null,
    constraints: null,
    target_budget_cents: 1_250_000,
    currency: 'USD',
    contingency_pct: 15,
    target_start_at: null,
    target_end_at: null,
    cover_attachment_id: null,
    cover_url: null,
    cover_blob: null,
    created_by: 'u_1',
    updated_by: 'u_1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Days from today as an ISO date, so the schedule copy is not pinned to a clock. */
function isoInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

describe('HomeProjectListCard', () => {
  it('names the project, its status and its type', () => {
    const tree = treeText(
      renderOnDevice('iPhone 14 Pro', <HomeProjectListCard project={makeProject()} onPress={jest.fn()} />)
    );
    expect(tree).toContain('Upstairs bathroom');
    // Home projects have their own vocabulary — Labor Hub's status labels would
    // have mislabelled every row.
    expect(tree).toContain('In progress');
    expect(tree).toContain('Bathroom reno');
  });

  it('shows the budget with its contingency buffer', () => {
    const tree = treeText(
      renderOnDevice('iPhone 14 Pro', <HomeProjectListCard project={makeProject()} onPress={jest.fn()} />)
    );
    expect(tree).toContain('$12,500');
    expect(tree).toContain('+15% buffer');
  });

  it('omits the budget line entirely when no target is set', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard
          project={makeProject({ target_budget_cents: null })}
          onPress={jest.fn()}
        />
      )
    );
    expect(tree).not.toContain('budget');
  });

  it('calls out an overdue project rather than printing a date nobody reads', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard
          project={makeProject({ target_end_at: isoInDays(-6) })}
          onPress={jest.fn()}
        />
      )
    );
    expect(tree).toContain('6d overdue');
  });

  it('counts down to a due date that has not passed', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard
          project={makeProject({ target_end_at: isoInDays(9) })}
          onPress={jest.fn()}
        />
      )
    );
    expect(tree).toContain('9d left');
  });

  it('does not call a finished project overdue', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard
          project={makeProject({ status: 'done', target_end_at: isoInDays(-20) })}
          onPress={jest.fn()}
        />
      )
    );
    expect(tree).toContain('Finished');
    expect(tree).not.toContain('overdue');
  });

  it('offers the empty tile as the add-a-photo affordance', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard project={makeProject()} onPress={jest.fn()} onPressCover={jest.fn()} />
      )
    );
    expect(tree).toContain('home-project-cover-empty-hp_1');
    expect(tree).toContain('Add photo');
  });

  it('drops the add-photo prompt when the cover is not editable', () => {
    const tree = treeText(
      renderOnDevice('iPhone 14 Pro', <HomeProjectListCard project={makeProject()} onPress={jest.fn()} />)
    );
    expect(tree).toContain('home-project-cover-empty-hp_1');
    expect(tree).not.toContain('Add photo');
  });

  it('offers a pencil beside the name when the title can be edited', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard project={makeProject()} onPress={jest.fn()} onPressRename={jest.fn()} />
      )
    );
    expect(tree).toContain('home-project-rename-hp_1');
  });

  /**
   * The mirror of the cover rule: a caller with no handler cannot carry the edit
   * out, and a pencil that does nothing is worse than none at all.
   */
  it('draws no pencil when there is no rename handler', () => {
    const tree = treeText(
      renderOnDevice('iPhone 14 Pro', <HomeProjectListCard project={makeProject()} onPress={jest.fn()} />)
    );
    expect(tree).not.toContain('home-project-rename-hp_1');
  });

  it('renders a server-backed cover from its url', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard
          project={makeProject({
            cover_attachment_id: 'hpa_1',
            cover_url: 'https://example.test/cover.jpg',
          })}
          onPress={jest.fn()}
        />
      )
    );
    expect(tree).toContain('home-project-cover-remote-hp_1');
    expect(tree).toContain('https://example.test/cover.jpg');
  });

  it('routes a local-first cover through the blob path, which is the only one that can open it', () => {
    const tree = treeText(
      renderOnDevice(
        'iPhone 14 Pro',
        <HomeProjectListCard
          project={makeProject({ cover_attachment_id: 'hpa_1', cover_blob: DESCRIPTOR })}
          onPress={jest.fn()}
        />
      )
    );
    expect(tree).toContain('home-project-cover-blob-hp_1');
    // A sealed blob is not a URL; an <Image source> would have rendered nothing.
    expect(tree).not.toContain('home-project-cover-remote-hp_1');
  });
});
