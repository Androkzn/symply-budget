import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { NeighbourWithPeople } from '@api/neighbours';
import { RELATION_INFO } from '@api/neighbours';
import { Icon, Typography } from '@components/ui';
import { useAppColors } from '@theme';

import { NeighbourAvatar } from './NeighbourAvatar';

/**
 * The bubble on the map — the thing the whole feature is looked at through.
 *
 * ## The anatomy, and why each part earns its pixels
 *
 * A real-estate map's pin is a price, because price is the one fact that
 * distinguishes two listings at a glance. Here the equivalent fact is **who
 * lives there**, so the bubble is a face with a count on it:
 *
 *  - **the circle** is the home's photo, or its primary occupant's, or their
 *    initials on a stable per-name colour. Something is always drawn; an empty
 *    circle would make an added neighbour look like a failed one;
 *  - **the count badge** appears only when a home has more than one occupant.
 *    A "1" on every pin is noise that trains the eye to stop reading the badge,
 *    which defeats it for the homes where it matters;
 *  - **the relation ring** tints the circle's border by `relation`, so next-door
 *    and across-the-street are distinguishable without tapping. The ring rather
 *    than the fill, because the fill is the photo;
 *  - **the tail** points at the actual coordinate. Without it a 44pt circle
 *    centred on the point covers roughly half a lot, and a member cannot tell
 *    which house it means;
 *  - **the spare-key badge**, when set. It is the single most operationally
 *    useful fact on this map ("who can let the plumber in") and it is worth a
 *    dedicated glyph rather than being one line inside a detail sheet.
 *
 * ## Selection makes it BIGGER, not just tinted
 *
 * The selected pin scales up and raises its shadow. A colour-only selected state
 * is invisible against satellite imagery, which is exactly the background this
 * map is most useful on.
 *
 * ## `tracksViewChanges` is the caller's problem, and it matters
 *
 * A `<Marker>` wrapping a custom view re-rasterises on every render unless the
 * caller sets `tracksViewChanges={false}`, and on a map with thirty of them that
 * is the difference between a smooth pan and a slideshow. This component is
 * therefore pure and cheap, and `NeighboursMapScreen` turns tracking off once
 * the first paint has landed.
 */

export const MARKER_SIZE = 44;
export const MARKER_SELECTED_SIZE = 56;

export type NeighbourMapMarkerProps = {
  neighbour: NeighbourWithPeople;
  selected?: boolean;
  householdId?: string;
  testID?: string;
};

export function NeighbourMapMarker({
  neighbour,
  selected = false,
  householdId,
  testID,
}: NeighbourMapMarkerProps) {
  const colors = useAppColors();
  const relation = RELATION_INFO[neighbour.relation] ?? RELATION_INFO.other;
  const size = selected ? MARKER_SELECTED_SIZE : MARKER_SIZE;
  // The home's own photo wins over an occupant's: the pin marks a building, and
  // a member who photographed the house chose that as its identity.
  const primary = neighbour.people.find((person) => person.is_primary) ?? neighbour.people[0];
  const photo = neighbour.photo_blob ?? primary?.photo_blob ?? null;
  const avatarName = neighbour.photo_blob ? neighbour.label : primary?.name ?? neighbour.label;

  return (
    <View style={styles.wrapper} testID={testID}>
      <View
        style={[
          styles.bubble,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: selected ? colors.primary : relation.color,
            backgroundColor: colors.backgroundMain,
            shadowOpacity: selected ? 0.35 : 0.18,
            elevation: selected ? 8 : 4,
          },
        ]}
      >
        <NeighbourAvatar
          name={avatarName}
          photo={photo}
          size={size - 6}
          householdId={householdId}
          testID={testID ? `${testID}-avatar` : undefined}
        />
      </View>

      {neighbour.person_count > 1 && (
        <View
          style={[
            styles.countBadge,
            { backgroundColor: colors.primary, borderColor: colors.backgroundMain },
          ]}
          testID={testID ? `${testID}-count` : undefined}
        >
          <Typography variant="caption2" weight="bold" style={{ color: colors.white }}>
            {neighbour.person_count}
          </Typography>
        </View>
      )}

      {neighbour.has_spare_key && (
        <View
          style={[
            styles.keyBadge,
            { backgroundColor: colors.warning, borderColor: colors.backgroundMain },
          ]}
          testID={testID ? `${testID}-key` : undefined}
        >
          <Icon name="key" size={9} color={colors.white} />
        </View>
      )}

      {/* The tail. A triangle drawn with borders — the standard RN trick, and
          cheaper than an SVG on a view that is rasterised per marker. */}
      <View
        style={[
          styles.tail,
          { borderTopColor: selected ? colors.primary : relation.color },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    // Room for the badges, which overhang the bubble on both top corners.
    paddingTop: 6,
    paddingHorizontal: 6,
  },
  bubble: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  countBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
