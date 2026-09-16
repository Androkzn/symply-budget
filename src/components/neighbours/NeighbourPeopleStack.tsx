import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { NeighbourPerson } from '@api/neighbours';
import { Typography } from '@components/ui';
import { useAppColors } from '@theme';

import { NeighbourAvatar } from './NeighbourAvatar';

/**
 * Overlapping faces, with "+3" when there are more than fit.
 *
 * The stack answers "how many people, and do I recognise any of them" in one
 * glance, which is the question a member scanning a list of homes is actually
 * asking. A count alone ("4 people") answers half of it.
 *
 * ## Order is the row order, not "photos first"
 *
 * It is tempting to float the occupants who have photos to the front so the
 * stack looks fuller. That would make the same household render differently on
 * two screens and reorder itself when a photo is added — motion that means
 * nothing. The primary occupant is first because they are first in the data;
 * everyone else follows in `sort_order`.
 */

export const STACK_DEFAULT_MAX = 4;

export type NeighbourPeopleStackProps = {
  people: readonly NeighbourPerson[];
  size?: number;
  max?: number;
  householdId?: string;
  testID?: string;
};

export function NeighbourPeopleStack({
  people,
  size = 28,
  max = STACK_DEFAULT_MAX,
  householdId,
  testID,
}: NeighbourPeopleStackProps) {
  const colors = useAppColors();
  if (people.length === 0) return null;

  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;
  // A quarter of the avatar's width, so faces overlap enough to read as a group
  // without hiding the one behind.
  const overlap = -Math.round(size / 4);

  return (
    <View style={styles.row} testID={testID}>
      {shown.map((person, index) => (
        <NeighbourAvatar
          key={person.id}
          name={person.name}
          photo={person.photo_blob}
          size={size}
          householdId={householdId}
          ringColor={colors.backgroundSecondary}
          ringWidth={2}
          style={index === 0 ? undefined : { marginLeft: overlap }}
          testID={testID ? `${testID}-${index}` : undefined}
        />
      ))}
      {overflow > 0 && (
        <View
          style={[
            styles.overflow,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: overlap,
              backgroundColor: colors.pillBackground,
              borderColor: colors.backgroundSecondary,
            },
          ]}
          testID={testID ? `${testID}-overflow` : undefined}
        >
          <Typography variant="caption2" weight="semibold" color={colors.textSecondary}>
            +{overflow}
          </Typography>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overflow: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
