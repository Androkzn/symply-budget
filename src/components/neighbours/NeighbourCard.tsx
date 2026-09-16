import React from 'react';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';

import type { NeighbourWithPeople } from '@api/neighbours';
import { RELATION_INFO } from '@api/neighbours';
import { FavoriteStar, Icon, Typography } from '@components/ui';
import { useAppColors } from '@theme';
import { formatDistance, shortAddressLabel } from '@utils/neighbourGeo';

import { NeighbourPeopleStack } from './NeighbourPeopleStack';

/**
 * One home, as a row in the list view.
 *
 * The list is the map's twin, not its fallback: a map answers "who is where"
 * and a list answers "who do I have, and which one do I want" — search, sort by
 * distance, and a phone number you can reach in one tap. Both are first-class,
 * which is why the screen offers a segmented toggle rather than burying the list
 * behind a menu.
 *
 * The layout is `ContractorCard`'s, deliberately: badge row, title block, a
 * strip of facts, and one primary action pinned to the bottom edge. A member who
 * has used the contractors list already knows how to read this.
 */

export type NeighbourCardProps = {
  neighbour: NeighbourWithPeople;
  unitSystem: 'metric' | 'imperial';
  householdId?: string;
  onPress: () => void;
  onToggleFavorite: () => void;
  testID?: string;
};

export function NeighbourCard({
  neighbour,
  unitSystem,
  householdId,
  onPress,
  onToggleFavorite,
  testID,
}: NeighbourCardProps) {
  const colors = useAppColors();
  const relation = RELATION_INFO[neighbour.relation] ?? RELATION_INFO.other;
  // The number a member would actually dial: the primary occupant's, or the
  // first one who has a number at all. A card with a Call button that dials
  // nobody is worse than a card with no Call button.
  const callable =
    neighbour.people.find((person) => person.is_primary && person.phone) ??
    neighbour.people.find((person) => person.phone);
  const distance = formatDistance(neighbour.distance_meters, unitSystem);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      onPress={onPress}
      activeOpacity={0.7}
      testID={testID}
      accessibilityRole="button"
      // Labelling the card collapses everything inside it, so the badges have to
      // be spoken here or not at all — the spare key especially, which is the
      // fact this feature is most useful for.
      accessibilityLabel={[
        neighbour.label,
        relation.label,
        neighbour.neighbourhood?.name,
        neighbour.has_spare_key ? 'has our key' : null,
        neighbour.is_favorite ? 'favourite' : null,
        distance,
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.relationBadge, { backgroundColor: `${relation.color}20` }]}>
            <Icon name={relation.icon} size={14} color={relation.color} />
            <Typography
              variant="caption2"
              weight="medium"
              style={{ color: relation.color, marginLeft: 4 }}
            >
              {relation.short}
            </Typography>
          </View>
          {neighbour.neighbourhood && (
            <View
              style={[
                styles.areaBadge,
                {
                  backgroundColor: `${neighbour.neighbourhood.color ?? colors.primary}18`,
                },
              ]}
            >
              <Typography
                variant="caption2"
                weight="medium"
                style={{ color: neighbour.neighbourhood.color ?? colors.primary }}
                numberOfLines={1}
              >
                {neighbour.neighbourhood.name}
              </Typography>
            </View>
          )}
          {neighbour.has_spare_key && (
            <View style={[styles.areaBadge, { backgroundColor: `${colors.warning}20` }]}>
              <Icon name="key" size={11} color={colors.warning} />
            </View>
          )}
        </View>
        <FavoriteStar isFavorite={neighbour.is_favorite} onToggle={onToggleFavorite} />
      </View>

      <View style={styles.body}>
        <Typography variant="headline" weight="semibold" numberOfLines={1}>
          {neighbour.label}
        </Typography>
        <Typography variant="subheadline" color={colors.textSecondary} numberOfLines={1}>
          {shortAddressLabel(neighbour)}
        </Typography>
      </View>

      <View style={styles.factsRow}>
        <NeighbourPeopleStack
          people={neighbour.people}
          householdId={householdId}
          testID={testID ? `${testID}-people` : undefined}
        />
        <View style={styles.facts}>
          {neighbour.person_count > 0 && (
            <Typography variant="caption1" color={colors.textSecondary}>
              {neighbour.person_count === 1 ? '1 person' : `${neighbour.person_count} people`}
            </Typography>
          )}
          {!!distance && (
            <Typography variant="caption1" color={colors.textSecondary}>
              {distance} away
            </Typography>
          )}
        </View>
      </View>

      {callable?.phone && (
        <TouchableOpacity
          style={[styles.callButton, { borderTopColor: colors.borderColor }]}
          onPress={() => Linking.openURL(`tel:${callable.phone}`)}
          testID={testID ? `${testID}-call` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`Call ${callable.name}`}
        >
          <Icon name="call" size={16} color={colors.primary} />
          <Typography variant="subheadline" color={colors.primary}>
            Call {callable.name.split(' ')[0]}
          </Typography>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    flexWrap: 'wrap',
  },
  relationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  areaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: 140,
  },
  body: {
    marginBottom: 12,
  },
  factsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  facts: {
    alignItems: 'flex-end',
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
