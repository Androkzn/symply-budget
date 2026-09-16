import React from 'react';
import { Linking, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import type { NeighbourWithPeople } from '@api/neighbours';
import { PLACE_SOURCE_LABELS, RELATION_INFO } from '@api/neighbours';
import { Icon, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { formatDistance, shortAddressLabel } from '@utils/neighbourGeo';

import { NeighbourAvatar } from './NeighbourAvatar';
import { NeighbourPeopleStack } from './NeighbourPeopleStack';

/**
 * The card that slides up when a pin is tapped.
 *
 * ## Why a card over the map and not a navigation push
 *
 * Tapping a pin is an act of ORIENTATION — "who is this one?" — and the answer
 * is only useful while the surrounding pins are still visible. Pushing a full
 * screen destroys the context that made the question worth asking, and the
 * member then has to go back and re-find their place. Every map product that
 * matters (Zillow, Airbnb, Google Maps) answers a pin tap with a card for this
 * reason. The full detail screen is one tap further, for when the member has
 * decided this is the one.
 *
 * ## Four actions, and no menu
 *
 * Call, message, directions, open. They are the four things a member does with a
 * neighbour, they fit one row at any width, and none of them is hidden behind an
 * overflow. Actions that cannot work are RENDERED DISABLED rather than removed —
 * a row that changes shape per neighbour makes the member re-find the button
 * they want on every card, which is the cost of tidiness paid in muscle memory.
 *
 * ## The provenance line is small and always present
 *
 * "Placed on the map" vs "Found from the address" tells the member which half of
 * this record to trust — a tapped pin is exact and its address is a guess, a
 * geocoded one is the reverse. It is one caption; it saves the member from
 * distrusting both halves when one is wrong.
 */

export type NeighbourPeekCardProps = {
  neighbour: NeighbourWithPeople;
  unitSystem: 'metric' | 'imperial';
  householdId?: string;
  onOpen: () => void;
  onClose: () => void;
  testID?: string;
};

/** The platform's own maps app, with a label so the pin is named on arrival. */
function directionsUrl(neighbour: NeighbourWithPeople): string {
  const { latitude, longitude } = neighbour;
  const label = encodeURIComponent(neighbour.label);
  return Platform.select({
    ios: `http://maps.apple.com/?ll=${latitude},${longitude}&q=${label}`,
    default: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
  });
}

export function NeighbourPeekCard({
  neighbour,
  unitSystem,
  householdId,
  onOpen,
  onClose,
  testID = 'neighbour-peek',
}: NeighbourPeekCardProps) {
  const colors = useAppColors();
  const relation = RELATION_INFO[neighbour.relation] ?? RELATION_INFO.other;
  const contact =
    neighbour.people.find((person) => person.is_primary && person.phone) ??
    neighbour.people.find((person) => person.phone);
  const distance = formatDistance(neighbour.distance_meters, unitSystem);
  const primary = neighbour.people.find((person) => person.is_primary) ?? neighbour.people[0];

  const actions: {
    key: string;
    icon: string;
    label: string;
    onPress: () => void;
    enabled: boolean;
  }[] = [
    {
      key: 'call',
      icon: 'call',
      label: 'Call',
      enabled: !!contact?.phone,
      onPress: () => contact?.phone && Linking.openURL(`tel:${contact.phone}`),
    },
    {
      key: 'message',
      icon: 'chatbubble',
      label: 'Message',
      enabled: !!contact?.phone,
      onPress: () => contact?.phone && Linking.openURL(`sms:${contact.phone}`),
    },
    {
      key: 'directions',
      icon: 'navigate',
      label: 'Directions',
      enabled: true,
      onPress: () => Linking.openURL(directionsUrl(neighbour)),
    },
    {
      key: 'open',
      icon: 'information-circle',
      label: 'Details',
      enabled: true,
      onPress: onOpen,
    },
  ];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.backgroundMain, borderColor: colors.borderColor },
      ]}
      testID={testID}
      accessibilityViewIsModal={false}
    >
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        testID={`${testID}-close`}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Icon name="close" size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.headerRow} onPress={onOpen} activeOpacity={0.75}>
        <NeighbourAvatar
          name={neighbour.photo_blob ? neighbour.label : primary?.name ?? neighbour.label}
          photo={neighbour.photo_blob ?? primary?.photo_blob ?? null}
          size={52}
          householdId={householdId}
          testID={`${testID}-avatar`}
        />
        <View style={styles.headerText}>
          <Typography variant="headline" weight="semibold" numberOfLines={1}>
            {neighbour.label}
          </Typography>
          <Typography variant="subheadline" color={colors.textSecondary} numberOfLines={1}>
            {shortAddressLabel(neighbour)}
          </Typography>
          <View style={styles.metaRow}>
            <View style={[styles.relationDot, { backgroundColor: relation.color }]} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {relation.label}
              {distance ? ` · ${distance}` : ''}
              {neighbour.person_count > 0
                ? ` · ${neighbour.person_count === 1 ? '1 person' : `${neighbour.person_count} people`}`
                : ''}
            </Typography>
          </View>
        </View>
      </TouchableOpacity>

      {neighbour.people.length > 0 && (
        <View style={styles.peopleRow}>
          <NeighbourPeopleStack
            people={neighbour.people}
            size={32}
            householdId={householdId}
            testID={`${testID}-people`}
          />
          <Typography variant="caption1" color={colors.textSecondary} numberOfLines={1}>
            {neighbour.people.map((person) => person.name.split(' ')[0]).join(', ')}
          </Typography>
        </View>
      )}

      <View style={[styles.actions, { borderTopColor: colors.borderColor }]}>
        {actions.map((action) => (
          <TouchableOpacity
            key={action.key}
            style={styles.action}
            onPress={action.onPress}
            disabled={!action.enabled}
            testID={`${testID}-${action.key}`}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: !action.enabled }}
          >
            <Icon
              name={action.icon}
              size={20}
              color={action.enabled ? colors.primary : colors.textTertiary}
            />
            <Typography
              variant="caption2"
              color={action.enabled ? colors.primary : colors.textTertiary}
            >
              {action.label}
            </Typography>
          </TouchableOpacity>
        ))}
      </View>

      <Typography variant="caption2" color={colors.textTertiary} style={styles.provenance}>
        {PLACE_SOURCE_LABELS[neighbour.place_source]}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: CornerRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    padding: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingRight: 24,
  },
  headerText: {
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  relationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  action: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    minWidth: 64,
  },
  provenance: {
    textAlign: 'center',
    marginTop: 10,
  },
});
