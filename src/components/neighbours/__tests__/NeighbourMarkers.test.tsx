/**
 * The two things drawn on the map, and the rules that make them readable.
 *
 * A marker is a rasterised view sitting on photography — it has no text the
 * member can fall back on and no layout the eye can inspect. So the properties
 * asserted here are the ones that decide whether a glance at the map answers
 * anything:
 *
 *  - a count badge that appears ONLY when it is telling you something new;
 *  - a spare-key badge, which is the single most operationally useful fact on
 *    this screen ("who can let the plumber in");
 *  - a photo when there is one and initials when there is not, always something;
 *  - selection that changes SIZE, because a colour-only selected state is
 *    invisible against satellite imagery.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { NeighbourWithPeople } from '@api/neighbours';
import { ThemeProvider } from '@contexts/ThemeContext';

import { NeighbourAvatar, avatarTintFor } from '../NeighbourAvatar';
import { NeighbourClusterMarker, clusterSizeFor, CLUSTER_MAX_SIZE, CLUSTER_MIN_SIZE } from '../NeighbourClusterMarker';
import { MARKER_SELECTED_SIZE, MARKER_SIZE, NeighbourMapMarker } from '../NeighbourMapMarker';
import { NeighbourPeopleStack } from '../NeighbourPeopleStack';

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

const BLOB = {
  blobId: 'blob-1',
  mime: 'image/jpeg',
  bytes: 1024,
  sha256: 'a'.repeat(64),
  chunkCount: 1,
  keyEpoch: 1,
};

function person(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    neighbour_id: 'nbr-1',
    household_id: 'hh-1',
    name,
    role: 'adult' as const,
    phone: null,
    email: null,
    photo_key: null,
    notes: null,
    is_primary: false,
    sort_order: 0,
    device_contact_id: null,
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

function neighbour(overrides: Partial<NeighbourWithPeople> = {}): NeighbourWithPeople {
  const people = (overrides.people ?? []) as NeighbourWithPeople['people'];
  return {
    id: 'nbr-1',
    household_id: 'hh-1',
    neighbourhood_id: null,
    label: 'The Wilsons',
    relation: 'next_door',
    address_line1: '44 Maple St',
    address_line2: null,
    city: 'Vancouver',
    state_province: 'BC',
    postal_code: null,
    country: 'CA',
    formatted_address: '44 Maple St, Vancouver',
    latitude: 49.283,
    longitude: -123.121,
    place_source: 'map_tap',
    photo_key: null,
    notes: null,
    is_favorite: false,
    is_emergency_contact: false,
    has_spare_key: false,
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    person_count: people.length,
    neighbourhood: null,
    distance_meters: null,
    ...overrides,
    people,
  };
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAll((node) => node.props?.testID === testID).length > 0;
}

describe('NeighbourAvatar', () => {
  it('renders initials when there is no photo', async () => {
    const tree = await render(<NeighbourAvatar name="Sarah Wilson" testID="av" />);
    expect(JSON.stringify(tree.toJSON())).toContain('SW');
  });

  it('gives the same name the same colour every time', async () => {
    // The same family must be the same colour on every screen, so a member can
    // recognise the avatar stack before reading a single letter.
    expect(avatarTintFor('Sarah Wilson')).toBe(avatarTintFor('Sarah Wilson'));
    expect(avatarTintFor('Sarah Wilson')).not.toBe(avatarTintFor('Anita Patel'));
  });

  it('varies between two names of the same length', async () => {
    // `name.length % n` would collide on every same-length pair, which on one
    // street is most of them.
    expect(avatarTintFor('Amy Adams')).not.toBe(avatarTintFor('Bob Baker'));
  });

  it('renders the blob image when a photo is present', async () => {
    const tree = await render(<NeighbourAvatar name="Sarah" photo={BLOB} testID="av" />);
    expect(has(tree, 'av-photo')).toBe(true);
  });
});

describe('NeighbourMapMarker', () => {
  it('hides the count badge for a home with one occupant or none', async () => {
    // A "1" on every pin is noise that trains the eye to stop reading the badge,
    // which defeats it for the homes where it matters.
    const solo = await render(
      <NeighbourMapMarker
        neighbour={neighbour({ people: [person('p1', 'Sarah Wilson')] as never })}
        testID="m"
      />
    );
    expect(has(solo, 'm-count')).toBe(false);

    const empty = await render(<NeighbourMapMarker neighbour={neighbour()} testID="m" />);
    expect(has(empty, 'm-count')).toBe(false);
  });

  it('shows the count once there is more than one occupant', async () => {
    const tree = await render(
      <NeighbourMapMarker
        neighbour={
          neighbour({
            people: [person('p1', 'Sarah Wilson'), person('p2', 'Tom Wilson')] as never,
          })
        }
        testID="m"
      />
    );
    expect(has(tree, 'm-count')).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain('2');
  });

  it('badges a home that holds our spare key', async () => {
    const without = await render(<NeighbourMapMarker neighbour={neighbour()} testID="m" />);
    expect(has(without, 'm-key')).toBe(false);

    const with_ = await render(
      <NeighbourMapMarker neighbour={neighbour({ has_spare_key: true })} testID="m" />
    );
    expect(has(with_, 'm-key')).toBe(true);
  });

  it('grows when selected rather than only changing colour', async () => {
    // Against satellite imagery a tint change is invisible; the size change is
    // what makes the selected pin findable.
    expect(MARKER_SELECTED_SIZE).toBeGreaterThan(MARKER_SIZE);
    const tree = await render(
      <NeighbourMapMarker neighbour={neighbour()} selected testID="m" />
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain(String(MARKER_SELECTED_SIZE));
  });

  it("prefers the HOME's photo over an occupant's", async () => {
    // The pin marks a building, and a member who photographed the house chose
    // that as its identity. Asserted through the ABSENCE of the occupant's
    // initials: the blob channel cannot resolve a fixture descriptor under Jest,
    // so what is observable is which identity the avatar was handed — the home's
    // label, which has no initials on screen, rather than "SW".
    const tree = await render(
      <NeighbourMapMarker
        neighbour={neighbour({
          photo_blob: BLOB,
          people: [person('p1', 'Sarah Wilson', { is_primary: true })] as never,
        })}
        testID="m"
      />
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain('"SW"');
    expect(has(tree, 'm-avatar')).toBe(true);
  });

  it('falls back to the primary occupant when the home has no photo', async () => {
    const tree = await render(
      <NeighbourMapMarker
        neighbour={neighbour({
          people: [
            person('p1', 'Tom Wilson'),
            person('p2', 'Sarah Wilson', { is_primary: true }),
          ] as never,
        })}
        testID="m"
      />
    );
    // Sarah's initials, not Tom's — `is_primary` decides the face, not order.
    expect(JSON.stringify(tree.toJSON())).toContain('SW');
  });
});

describe('NeighbourClusterMarker', () => {
  it('scales with the count, within bounds', async () => {
    expect(clusterSizeFor(1)).toBe(CLUSTER_MIN_SIZE);
    expect(clusterSizeFor(8)).toBeGreaterThan(clusterSizeFor(3));
    // Unbounded scaling produces a bubble that covers the map. A neighbourhood
    // has tens of homes, so the useful discrimination is "a few" vs "a lot".
    expect(clusterSizeFor(10_000)).toBe(CLUSTER_MAX_SIZE);
  });

  it('reports homes AND people, because they answer different questions', async () => {
    const tree = await render(<NeighbourClusterMarker homeCount={6} personCount={14} testID="c" />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('6');
    expect(json).toContain('14 people');
  });

  it('says nothing about people when none are recorded', async () => {
    const tree = await render(<NeighbourClusterMarker homeCount={4} personCount={0} testID="c" />);
    expect(JSON.stringify(tree.toJSON())).not.toContain('people');
  });

  it('singularises one person', async () => {
    const tree = await render(<NeighbourClusterMarker homeCount={2} personCount={1} testID="c" />);
    expect(JSON.stringify(tree.toJSON())).toContain('1 person');
  });
});

describe('NeighbourPeopleStack', () => {
  const five = [
    person('p1', 'A One'),
    person('p2', 'B Two'),
    person('p3', 'C Three'),
    person('p4', 'D Four'),
    person('p5', 'E Five'),
  ];

  it('renders nothing for an empty household', async () => {
    const tree = await render(<NeighbourPeopleStack people={[]} testID="s" />);
    expect(tree.toJSON()).toBeNull();
  });

  it('caps the faces and shows the remainder', async () => {
    const tree = await render(<NeighbourPeopleStack people={five} max={4} testID="s" />);
    expect(has(tree, 's-3')).toBe(true);
    expect(has(tree, 's-4')).toBe(false);
    expect(has(tree, 's-overflow')).toBe(true);
    // RN splits `+{n}` into two text children, so the rendered tree carries
    // `["+","1"]` rather than the string `"+1"`. Read the serialised tree, which
    // is plain data, rather than the element props, which carry the theme
    // context and are circular.
    expect(JSON.stringify(tree.toJSON())).toContain('["+","1"]');
  });

  it('keeps ROW order rather than floating photos to the front', async () => {
    // Reordering by "has a photo" would make the same household render
    // differently on two screens and reshuffle when a photo is added — motion
    // that means nothing.
    const tree = await render(
      <NeighbourPeopleStack
        people={[person('p1', 'A One'), person('p2', 'B Two', { photo_blob: BLOB })]}
        testID="s"
      />
    );
    const json = JSON.stringify(tree.toJSON());
    expect(json.indexOf('AO')).toBeLessThan(json.indexOf('s-1'));
  });
});
