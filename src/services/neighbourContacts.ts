/**
 * The device address book, in both directions.
 *
 * **Import**: pick people you already have numbers for and put them on the map.
 * **Export**: push a neighbour's occupants back out, so "call the Wilsons" works
 * from the phone app, the car, the watch — everywhere this app is not.
 *
 * Export is the half that is easy to skip and shouldn't be. A member who has
 * carefully recorded who lives where has built something they can only read
 * inside one screen of one app; writing it back to Contacts is what makes it
 * theirs. It is also the honest answer to "what happens if I stop using this" —
 * the data was never held hostage.
 *
 * ## What is deliberately NOT here
 *
 * - **No bulk read of the address book.** `pickContact` opens the OS picker,
 *   which returns exactly the one person the member chose and requires no
 *   permission at all on iOS. Reading every contact to render our own list is
 *   the pattern that earns an app a privacy label it does not need; it is only
 *   used when the member explicitly asks to browse (`listContacts`), and that
 *   path asks for permission first and says why.
 * - **No matching by name.** A re-import updates the row whose
 *   `device_contact_id` matches, and nothing else. Guessing that "J. Wilson" and
 *   "John Wilson" are the same person is how an import quietly overwrites a
 *   different neighbour.
 * - **No writing to an existing contact.** Export always creates. Merging into
 *   someone's real address-book entry — one this app did not create and does not
 *   understand — is a destructive act on data that is not ours.
 *
 * ## Why `expo-contacts/legacy` and not the SDK 57 class API
 *
 * The new surface (`Contact.create({...})`, `contact.getPhones()`) is the better
 * shape for an app that edits the address book continuously — it fetches each
 * field group on demand instead of over-reading. This feature does the opposite:
 * it touches Contacts twice, at the moment the member asks, and wants the whole
 * record in one call so the picker returns something complete.
 *
 * The deciding factor is `presentContactPickerAsync`, which only the legacy
 * surface exposes. It is the permission-free, out-of-process picker — the most
 * privacy-preserving path available here, and the one this feature's common case
 * runs on. Both surfaces ship in the same package and neither is deprecated.
 */
import * as Contacts from 'expo-contacts/legacy';

import type {
  CreateNeighbourPersonRequest,
  CreateNeighbourRequest,
  NeighbourPerson,
  NeighbourWithPeople,
} from '@api/neighbours';
import { composeFormattedAddress } from '@utils/neighbourGeo';

/** What one picked contact offers this feature. */
export type PickedContact = {
  contactId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  /** The contact's postal address, when they have one. Used to place the pin. */
  address: {
    address_line1: string | null;
    city: string | null;
    state_province: string | null;
    postal_code: string | null;
    country: string | null;
    formatted_address: string | null;
  } | null;
  /** A local file URI for the contact's photo, when the OS exposes one. */
  imageUri: string | null;
};

export type ContactsPermissionOutcome = 'granted' | 'denied' | 'unavailable';

const CONTACT_FIELDS = [
  Contacts.Fields.Name,
  Contacts.Fields.FirstName,
  Contacts.Fields.LastName,
  Contacts.Fields.PhoneNumbers,
  Contacts.Fields.Emails,
  Contacts.Fields.Addresses,
  Contacts.Fields.Image,
];

export async function requestContactsPermission(): Promise<ContactsPermissionOutcome> {
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

function displayName(contact: Contacts.ExistingContact): string {
  const composed = [contact.firstName, contact.lastName]
    .filter((part) => !!part?.trim())
    .join(' ')
    .trim();
  return contact.name?.trim() || composed || 'Unnamed contact';
}

/**
 * `ExistingContact` rather than `Contact` — the difference is `id`, which only a
 * contact the OS has actually stored carries. Every caller here is reading, so
 * every caller has one; typing the parameter as `Contact` would make `id`
 * optional and hide the fact that a read result always has it.
 */
function toPicked(contact: Contacts.ExistingContact): PickedContact {
  const address = contact.addresses?.[0];
  const parsedAddress = address
    ? {
        address_line1: address.street?.trim() || null,
        city: address.city?.trim() || null,
        state_province: address.region?.trim() || null,
        postal_code: address.postalCode?.trim() || null,
        country: address.isoCountryCode?.trim() || address.country?.trim() || null,
        formatted_address: null as string | null,
      }
    : null;
  if (parsedAddress) {
    parsedAddress.formatted_address = composeFormattedAddress(parsedAddress) || null;
  }
  return {
    contactId: contact.id ?? null,
    name: displayName(contact),
    // The FIRST number, not a merged list. A neighbour card shows one "Call"
    // button; offering three numbers with no way to tell them apart is worse
    // than offering the one the OS already considers primary.
    phone: contact.phoneNumbers?.[0]?.number?.trim() || null,
    email: contact.emails?.[0]?.email?.trim() || null,
    address: parsedAddress,
    imageUri: contact.image?.uri ?? null,
  };
}

/**
 * Open the OS contact picker and return the one person chosen.
 *
 * `presentContactPickerAsync` is the permission-free path on iOS: the system
 * renders the picker out of process and hands back only the selection, so the
 * app never sees the rest of the address book. Preferred over `listContacts`
 * wherever the member is adding one neighbour, which is the common case.
 */
export async function pickContact(): Promise<PickedContact | null> {
  try {
    const contact = await Contacts.presentContactPickerAsync();
    if (!contact) return null;
    // The picker's payload is sometimes trimmed; re-read by id when we can, so
    // the postal address (which is what places the pin) is actually present.
    if (contact.id) {
      try {
        const full = await Contacts.getContactByIdAsync(contact.id, CONTACT_FIELDS);
        if (full) return toPicked(full);
      } catch {
        // Fall through to the picker's own payload.
      }
    }
    return toPicked(contact);
  } catch {
    return null;
  }
}

/**
 * Read the address book for the multi-select import screen.
 *
 * The permission-gated path, and the only one. Returns people who have at least
 * a name; contacts with no name at all are business cards and noise.
 */
export async function listContacts(): Promise<PickedContact[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: CONTACT_FIELDS,
    sort: Contacts.SortTypes.FirstName,
  });
  return (data ?? [])
    .map(toPicked)
    .filter((contact) => contact.name !== 'Unnamed contact')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Turn a picked contact into the create request for a NEW home.
 *
 * The coordinates are the caller's, not the contact's: a postal address is not a
 * position, and the screen geocodes it (or asks the member to drop a pin) before
 * this is called. Passing them in rather than geocoding here keeps this function
 * pure and testable, and keeps the "we could not find that address, tap the map
 * instead" branch in the screen where the member can act on it.
 */
export function contactToNeighbour(
  contact: PickedContact,
  coordinates: { latitude: number; longitude: number },
  overrides: Partial<CreateNeighbourRequest> = {}
): CreateNeighbourRequest {
  const person: CreateNeighbourPersonRequest = {
    name: contact.name,
    role: 'adult',
    phone: contact.phone,
    email: contact.email,
    is_primary: true,
    device_contact_id: contact.contactId,
  };
  return {
    // The home takes the person's name as its label — "The Wilsons" is what a
    // member would have typed anyway, and it is editable on the next screen.
    label: contact.name,
    relation: 'nearby',
    address_line1: contact.address?.address_line1 ?? null,
    city: contact.address?.city ?? null,
    state_province: contact.address?.state_province ?? null,
    postal_code: contact.address?.postal_code ?? null,
    country: contact.address?.country ?? null,
    formatted_address: contact.address?.formatted_address ?? null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    place_source: 'contact_import',
    people: [person],
    ...overrides,
  };
}

export type ExportOutcome =
  | { status: 'ok'; contactId: string }
  | { status: 'denied' }
  | { status: 'failed' };

/**
 * Write one occupant back to the address book.
 *
 * The neighbour's address rides along on the contact, because a phone number
 * with no address is half of what the member recorded — and Contacts is where
 * both belong once they leave this app.
 *
 * Always CREATES. See the header for why merging into an existing entry is not
 * on offer.
 */
export async function exportPersonToContacts(
  person: Pick<NeighbourPerson, 'name' | 'phone' | 'email' | 'notes'>,
  neighbour: Pick<
    NeighbourWithPeople,
    | 'label'
    | 'address_line1'
    | 'city'
    | 'state_province'
    | 'postal_code'
    | 'country'
    | 'formatted_address'
  >
): Promise<ExportOutcome> {
  const permission = await requestContactsPermission();
  if (permission !== 'granted') return { status: permission === 'denied' ? 'denied' : 'failed' };

  const [firstName, ...rest] = person.name.trim().split(/\s+/);
  const contact: Contacts.Contact = {
    // `id` is assigned by the OS on write; the cast is the shape the module's
    // own types require for a create.
    contactType: Contacts.ContactTypes.Person,
    name: person.name,
    firstName: firstName || person.name,
    lastName: rest.join(' ') || undefined,
    // The home's label as the company line is a small lie that reads well: it is
    // what shows under the name in the OS contact list, and "The Wilsons —
    // 42 Maple" is exactly the disambiguation a member wants there.
    company: neighbour.label,
    note: person.notes ?? undefined,
    phoneNumbers: person.phone
      ? [{ number: person.phone, label: 'home', id: 'phone-1' }]
      : undefined,
    emails: person.email ? [{ email: person.email, label: 'home', id: 'email-1' }] : undefined,
    addresses: neighbour.address_line1
      ? [
          {
            label: 'home',
            id: 'address-1',
            street: neighbour.address_line1 ?? undefined,
            city: neighbour.city ?? undefined,
            region: neighbour.state_province ?? undefined,
            postalCode: neighbour.postal_code ?? undefined,
            country: neighbour.country ?? undefined,
          },
        ]
      : undefined,
  } as Contacts.Contact;

  try {
    const contactId = await Contacts.addContactAsync(contact);
    return { status: 'ok', contactId };
  } catch {
    return { status: 'failed' };
  }
}
