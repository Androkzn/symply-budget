import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import type { CreateNeighbourRequest } from '@api/neighbours';
import { AppBackground, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { NeighbourAvatar } from '@components/neighbours';
import { EmptyState, GradientButton, Icon, SearchBar, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useNeighbourMutations, useNeighbourOrigin, useNeighbours } from '@hooks/useNeighbours';
import type { NeighboursStackParamList } from '@navigation/types';
import { geocodeAddress } from '@services/geocoding';
import {
  contactToNeighbour,
  listContacts,
  pickContact,
  requestContactsPermission,
  type PickedContact,
} from '@services/neighbourContacts';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { composeFormattedAddress, distanceMeters } from '@utils/neighbourGeo';

type Nav = NativeStackNavigationProp<NeighboursStackParamList>;
type Phase = 'intro' | 'loading' | 'list' | 'denied' | 'importing';

/**
 * Bring neighbours in from the device address book.
 *
 * ## Two doors, and the narrow one is the default
 *
 * **"Pick one person"** uses the OS picker — out of process, no permission, and
 * the app never sees a contact the member did not choose. It is listed first and
 * is the recommended path, because it is the one that gives up the least.
 *
 * **"Browse my contacts"** asks for full read access and renders our own
 * multi-select. It exists because importing eight neighbours one modal at a time
 * is miserable, and a member who has decided to do that has made an informed
 * choice. The screen says what each door costs BEFORE either is opened, rather
 * than firing a system prompt and letting iOS explain.
 *
 * ## Only contacts with an ADDRESS can be imported in bulk
 *
 * A neighbour needs coordinates, and the only thing a contact can offer is a
 * postal address to geocode. Contacts without one are shown greyed with the
 * reason, not hidden: "why is my neighbour missing from this list" is a worse
 * question than "ah, they have no address saved".
 *
 * The single-pick path has no such limit — it hands off to the map picker when
 * the address is missing, which is the right answer for one person and far too
 * many taps for eight.
 *
 * ## Everything is geocoded BEFORE anything is written
 *
 * A partial import that half-succeeded would leave the member re-selecting the
 * same people and creating duplicates of the ones that worked. Addresses are
 * resolved first, the failures are reported as a group, and the successes are
 * written in one bulk call — which on the ledger is one op per chunk rather than
 * one per home.
 */

export function NeighbourImportContactsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<Nav>();
  const { content: containerPadding } = useLayoutPadding();
  const { currentHousehold } = useHouseholdStore();
  const householdId = currentHousehold?.id;
  const { origin } = useNeighbourOrigin(currentHousehold);
  const { data: existing = [] } = useNeighbours(householdId);
  const mutations = useNeighbourMutations(householdId);

  const [phase, setPhase] = useState<Phase>('intro');
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  /** Contact ids already on the map, so a re-import cannot duplicate them. */
  const alreadyImported = useMemo(() => {
    const ids = new Set<string>();
    for (const neighbour of existing) {
      for (const person of neighbour.people) {
        if (person.device_contact_id) ids.add(person.device_contact_id);
      }
    }
    return ids;
  }, [existing]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((contact) => contact.name.toLowerCase().includes(needle));
  }, [contacts, search]);

  const handleBrowse = useCallback(async () => {
    const permission = await requestContactsPermission();
    if (permission !== 'granted') {
      setPhase('denied');
      return;
    }
    setPhase('loading');
    try {
      const data = await listContacts();
      setContacts(data);
      setPhase('list');
    } catch {
      setPhase('denied');
    }
  }, []);

  const handlePickOne = useCallback(async () => {
    const contact = await pickContact();
    if (!contact) return;
    // Straight into the add form. If the contact has an address the form will
    // geocode it; if not, the member picks the house on the map — which is one
    // extra tap and always works.
    navigation.navigate('AddEditNeighbour', {
      prefill: {
        label: contact.name,
        address_line1: contact.address?.address_line1 ?? null,
        city: contact.address?.city ?? null,
        state_province: contact.address?.state_province ?? null,
        postal_code: contact.address?.postal_code ?? null,
        country: contact.address?.country ?? null,
        formatted_address: contact.address?.formatted_address ?? null,
        place_source: 'contact_import',
        phone: contact.phone,
        email: contact.email,
        deviceContactId: contact.contactId,
      },
    });
  }, [navigation]);

  const toggle = useCallback((contact: PickedContact) => {
    if (!contact.contactId) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(contact.contactId!)) next.delete(contact.contactId!);
      else next.add(contact.contactId!);
      return next;
    });
  }, []);

  const handleImport = useCallback(async () => {
    if (!householdId || selected.size === 0) return;
    const chosen = contacts.filter(
      (contact) => contact.contactId && selected.has(contact.contactId)
    );
    setPhase('importing');
    setProgress({ done: 0, total: chosen.length });

    const entries: CreateNeighbourRequest[] = [];
    const failed: string[] = [];

    for (const [index, contact] of chosen.entries()) {
      const query = contact.address
        ? composeFormattedAddress({
            address_line1: contact.address.address_line1,
            city: contact.address.city,
            state_province: contact.address.state_province,
            postal_code: contact.address.postal_code,
            country: contact.address.country,
          })
        : '';
      const point = query ? await geocodeAddress(query) : null;
      setProgress({ done: index + 1, total: chosen.length });
      if (!point) {
        failed.push(contact.name);
        continue;
      }
      entries.push(
        contactToNeighbour(contact, point, {
          // A contact whose address places them within 150 m of home is almost
          // certainly a neighbour rather than a coincidence; anything further is
          // left as the neutral default and the member can correct it.
          relation:
            origin && distanceMeters(origin, point) <= 150 ? 'nearby' : 'other',
        })
      );
    }

    try {
      if (entries.length > 0) {
        await mutations.importContacts.mutateAsync(entries);
      }
      if (entries.length > 0 && failed.length === 0) {
        showToast('success', `Added ${entries.length} ${entries.length === 1 ? 'neighbour' : 'neighbours'}`);
        navigation.goBack();
        return;
      }
      if (entries.length === 0) {
        showToast('info', 'None of those addresses could be placed. Try picking them on the map.');
        setPhase('list');
        return;
      }
      showToast(
        'info',
        `Added ${entries.length}. We could not place ${failed.length}: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`
      );
      navigation.goBack();
    } catch {
      showToast('error', 'Could not import those contacts.');
      setPhase('list');
    } finally {
      setProgress(null);
    }
  }, [householdId, selected, contacts, origin, mutations, navigation]);

  useEffect(() => {
    // Nothing to select once the list has been replaced — keeps the CTA count
    // honest if the address book changes under us.
    setSelected((current) => {
      const valid = new Set(contacts.map((contact) => contact.contactId).filter(Boolean) as string[]);
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [contacts]);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="neighbour-import-screen">
        <ScreenHeader
          title="From your contacts"
          showBackButton
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />

        <AdaptiveContainer padding={containerPadding}>
          {phase === 'intro' && (
            <ScrollView
              style={screenScrollViewStyle.scroll}
              contentContainerStyle={styles.content}
              testID="neighbour-import-intro"
            >
              <TouchableOpacity
                style={[styles.door, { backgroundColor: colors.backgroundSecondary }]}
                onPress={handlePickOne}
                testID="neighbour-import-pick-one"
                accessibilityRole="button"
                // The privacy sentence is the whole reason this door is worded the
                // way it is; labelling the row would keep it from being read out.
                accessibilityLabel="Pick one person. Uses your phone's own picker. Symply only ever sees the person you choose."
              >
                <View style={[styles.doorIcon, { backgroundColor: `${colors.primary}1A` }]}>
                  <Icon name="person-add" size={22} color={colors.primary} />
                </View>
                <View style={styles.flex1}>
                  <Typography variant="body" weight="semibold">
                    Pick one person
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Uses your phone's own picker. Symply only ever sees the person you choose.
                  </Typography>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.door, { backgroundColor: colors.backgroundSecondary }]}
                onPress={handleBrowse}
                testID="neighbour-import-browse"
                accessibilityRole="button"
                accessibilityLabel="Browse my contacts. Add several at once. Symply will ask for access to your address book."
              >
                <View style={[styles.doorIcon, { backgroundColor: `${colors.primary}1A` }]}>
                  <Icon name="people" size={22} color={colors.primary} />
                </View>
                <View style={styles.flex1}>
                  <Typography variant="body" weight="semibold">
                    Browse my contacts
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Add several at once. Symply will ask for access to your address book.
                  </Typography>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={[styles.note, { backgroundColor: `${colors.info}12` }]}>
                <Icon name="lock-closed" size={16} color={colors.info} />
                <Typography variant="caption1" color={colors.textSecondary} style={styles.flex1}>
                  Whatever you add stays on your household's devices. Symply does not upload your
                  neighbours, and never sends them to an AI provider.
                </Typography>
              </View>
            </ScrollView>
          )}

          {phase === 'loading' && (
            <View style={styles.centre}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="subheadline" color={colors.textSecondary}>
                Reading your contacts…
              </Typography>
            </View>
          )}

          {phase === 'denied' && (
            <View style={styles.centre} testID="neighbour-import-denied">
              <EmptyState
                icon="lock-closed"
                title="Contacts access is off"
                description="Turn it on in Settings to browse your address book — or pick one person at a time, which needs no access at all."
                action={{ label: 'Pick one person', onPress: handlePickOne }}
              />
            </View>
          )}

          {phase === 'importing' && (
            <View style={styles.centre} testID="neighbour-import-progress">
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="subheadline" color={colors.textSecondary}>
                {progress
                  ? `Finding addresses… ${progress.done} of ${progress.total}`
                  : 'Adding neighbours…'}
              </Typography>
            </View>
          )}

          {phase === 'list' && (
            <View style={styles.flex1}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder="Search contacts"
                testID="neighbour-import-search"
              />
              <ScrollView
                style={screenScrollViewStyle.scroll}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                testID="neighbour-import-list"
              >
                {filtered.length === 0 ? (
                  <EmptyState
                    icon="people"
                    title="No contacts found"
                    description="Nothing in your address book matches that."
                  />
                ) : (
                  filtered.map((contact) => {
                    const id = contact.contactId ?? contact.name;
                    const imported = contact.contactId
                      ? alreadyImported.has(contact.contactId)
                      : false;
                    const hasAddress = Boolean(contact.address?.address_line1);
                    const disabled = imported || !hasAddress;
                    const isSelected = contact.contactId
                      ? selected.has(contact.contactId)
                      : false;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[
                          styles.row,
                          {
                            backgroundColor: colors.backgroundSecondary,
                            opacity: disabled ? 0.5 : 1,
                          },
                        ]}
                        onPress={() => !disabled && toggle(contact)}
                        disabled={disabled}
                        testID={`neighbour-import-row-${id}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected, disabled }}
                        accessibilityLabel={contact.name}
                      >
                        <NeighbourAvatar name={contact.name} size={36} />
                        <View style={styles.flex1}>
                          <Typography variant="body" weight="medium" numberOfLines={1}>
                            {contact.name}
                          </Typography>
                          <Typography
                            variant="caption1"
                            color={colors.textSecondary}
                            numberOfLines={1}
                          >
                            {imported
                              ? 'Already a neighbour'
                              : hasAddress
                                ? contact.address!.formatted_address ?? contact.phone ?? ''
                                : 'No address saved — pick them on the map instead'}
                          </Typography>
                        </View>
                        <Icon
                          name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={22}
                          color={isSelected ? colors.primary : colors.textTertiary}
                        />
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>

              <GradientButton
                title={
                  selected.size === 0
                    ? 'Select someone to add'
                    : `Add ${selected.size} ${selected.size === 1 ? 'neighbour' : 'neighbours'}`
                }
                onPress={handleImport}
                disabled={selected.size === 0}
                testID="neighbour-import-confirm"
              />
            </View>
          )}
        </AdaptiveContainer>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: CornerRadius.lg,
  },
  doorIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  flex1: { flex: 1 },
  listContent: { gap: Spacing.sm, paddingVertical: Spacing.md, paddingBottom: Spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
});
