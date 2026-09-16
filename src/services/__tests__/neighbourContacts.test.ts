/**
 * The address-book bridge, both directions.
 *
 * The mapping functions are where this feature meets data it does not control,
 * and every case below is a real shape a phone hands back: a contact with three
 * numbers, one with no address, one whose only name is in `firstName`, one whose
 * country arrives as an ISO code rather than a word. None of them is exotic and
 * all of them break a naive mapper.
 *
 * The permission paths are asserted too, because "denied" and "unavailable"
 * reach the member as different sentences — one offers Settings and the other
 * does not — and collapsing them is the kind of regression nothing else catches.
 */
jest.mock('expo-contacts/legacy', () => ({
  Fields: {
    Name: 'name',
    FirstName: 'firstName',
    LastName: 'lastName',
    PhoneNumbers: 'phoneNumbers',
    Emails: 'emails',
    Addresses: 'addresses',
    Image: 'image',
  },
  SortTypes: { FirstName: 'firstName' },
  ContactTypes: { Person: 'person' },
  requestPermissionsAsync: jest.fn(),
  getContactsAsync: jest.fn(),
  getContactByIdAsync: jest.fn(),
  presentContactPickerAsync: jest.fn(),
  addContactAsync: jest.fn(),
}));

import * as Contacts from 'expo-contacts/legacy';

import {
  contactToNeighbour,
  exportPersonToContacts,
  listContacts,
  pickContact,
  requestContactsPermission,
  type PickedContact,
} from '../neighbourContacts';

const mocked = Contacts as unknown as {
  requestPermissionsAsync: jest.Mock;
  getContactsAsync: jest.Mock;
  getContactByIdAsync: jest.Mock;
  presentContactPickerAsync: jest.Mock;
  addContactAsync: jest.Mock;
};

const SARAH = {
  id: 'contact-1',
  name: 'Sarah Wilson',
  firstName: 'Sarah',
  lastName: 'Wilson',
  contactType: 'person',
  phoneNumbers: [
    { number: ' +1 604 555 0142 ', label: 'mobile', id: 'p1' },
    { number: '+16045550199', label: 'work', id: 'p2' },
  ],
  emails: [{ email: 'sarah@example.com', label: 'home', id: 'e1' }],
  addresses: [
    {
      street: '44 Maple St',
      city: 'Vancouver',
      region: 'BC',
      postalCode: 'V6B 1A1',
      isoCountryCode: 'CA',
      country: 'Canada',
      label: 'home',
      id: 'a1',
    },
  ],
  image: { uri: 'file:///sarah.jpg' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestContactsPermission', () => {
  it('distinguishes granted, denied and unavailable', async () => {
    mocked.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    expect(await requestContactsPermission()).toBe('granted');

    mocked.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    expect(await requestContactsPermission()).toBe('denied');

    // A throw means the module is not present at all (Expo Go, a web build) —
    // which needs a different sentence from a member who said no.
    mocked.requestPermissionsAsync.mockRejectedValueOnce(new Error('no module'));
    expect(await requestContactsPermission()).toBe('unavailable');
  });
});

describe('pickContact', () => {
  it('re-reads the chosen contact by id so the postal address is present', async () => {
    // The picker's payload is routinely trimmed, and the ADDRESS is the field
    // that places the pin — the one thing this feature cannot do without.
    mocked.presentContactPickerAsync.mockResolvedValue({ id: 'contact-1', name: 'Sarah Wilson' });
    mocked.getContactByIdAsync.mockResolvedValue(SARAH);

    const picked = await pickContact();
    expect(mocked.getContactByIdAsync).toHaveBeenCalledWith('contact-1', expect.any(Array));
    expect(picked?.address?.address_line1).toBe('44 Maple St');
    expect(picked?.address?.formatted_address).toBe('44 Maple St, Vancouver, BC, V6B 1A1');
  });

  it('falls back to the picker payload when the re-read fails', async () => {
    mocked.presentContactPickerAsync.mockResolvedValue(SARAH);
    mocked.getContactByIdAsync.mockRejectedValue(new Error('gone'));
    const picked = await pickContact();
    expect(picked?.name).toBe('Sarah Wilson');
  });

  it('returns null when the member cancels', async () => {
    mocked.presentContactPickerAsync.mockResolvedValue(null);
    expect(await pickContact()).toBeNull();
  });

  it('returns null rather than throwing when the picker itself fails', async () => {
    mocked.presentContactPickerAsync.mockRejectedValue(new Error('no picker'));
    expect(await pickContact()).toBeNull();
  });

  it('takes the FIRST number only', async () => {
    mocked.presentContactPickerAsync.mockResolvedValue(SARAH);
    mocked.getContactByIdAsync.mockResolvedValue(SARAH);
    const picked = await pickContact();
    // A card shows one Call button; three numbers with no way to tell them apart
    // is worse than the one the OS already considers primary.
    expect(picked?.phone).toBe('+1 604 555 0142');
  });
});

describe('listContacts', () => {
  it('drops nameless entries and sorts the rest', async () => {
    mocked.getContactsAsync.mockResolvedValue({
      data: [
        { id: 'c3', contactType: 'person' },
        { ...SARAH, id: 'c2', name: 'Zoe Adams', firstName: 'Zoe', lastName: 'Adams' },
        { ...SARAH, id: 'c1', name: 'Anita Patel', firstName: 'Anita', lastName: 'Patel' },
      ],
    });
    const contacts = await listContacts();
    expect(contacts.map((contact) => contact.name)).toEqual(['Anita Patel', 'Zoe Adams']);
  });

  it('composes a name from the parts when there is no full name', async () => {
    mocked.getContactsAsync.mockResolvedValue({
      data: [{ id: 'c1', contactType: 'person', firstName: 'Raj', lastName: 'Patel' }],
    });
    const contacts = await listContacts();
    expect(contacts[0]!.name).toBe('Raj Patel');
  });

  it('handles an empty address book', async () => {
    mocked.getContactsAsync.mockResolvedValue({ data: undefined });
    expect(await listContacts()).toEqual([]);
  });
});

describe('contactToNeighbour', () => {
  const picked: PickedContact = {
    contactId: 'contact-1',
    name: 'Sarah Wilson',
    phone: '+16045550142',
    email: 'sarah@example.com',
    address: {
      address_line1: '44 Maple St',
      city: 'Vancouver',
      state_province: 'BC',
      postal_code: 'V6B 1A1',
      country: 'CA',
      formatted_address: '44 Maple St, Vancouver, BC, V6B 1A1',
    },
    imageUri: null,
  };

  it('builds a home whose label is the person and whose occupant is them', () => {
    const request = contactToNeighbour(picked, { latitude: 49.283, longitude: -123.12 });
    expect(request.label).toBe('Sarah Wilson');
    expect(request.latitude).toBe(49.283);
    expect(request.place_source).toBe('contact_import');
    expect(request.people).toHaveLength(1);
    expect(request.people![0]).toMatchObject({
      name: 'Sarah Wilson',
      phone: '+16045550142',
      is_primary: true,
      // The link back, so a re-import UPDATES rather than duplicating. Nothing
      // in this file ever matches by name — see the service header.
      device_contact_id: 'contact-1',
    });
  });

  it('carries the address through field by field', () => {
    const request = contactToNeighbour(picked, { latitude: 0, longitude: 0 });
    expect(request.address_line1).toBe('44 Maple St');
    expect(request.city).toBe('Vancouver');
    expect(request.state_province).toBe('BC');
    expect(request.postal_code).toBe('V6B 1A1');
    expect(request.country).toBe('CA');
  });

  it('copes with a contact that has no address at all', () => {
    const request = contactToNeighbour(
      { ...picked, address: null },
      { latitude: 49.283, longitude: -123.12 }
    );
    // The coordinates came from the map picker instead. A contact with no
    // address is still perfectly importable — that is the whole reason the
    // coordinates are a parameter rather than derived here.
    expect(request.address_line1).toBeNull();
    expect(request.latitude).toBe(49.283);
  });

  it('lets the caller override the guessed relation', () => {
    const request = contactToNeighbour(
      picked,
      { latitude: 0, longitude: 0 },
      { relation: 'next_door' }
    );
    expect(request.relation).toBe('next_door');
  });
});

describe('exportPersonToContacts', () => {
  const person = {
    name: 'Sarah Wilson',
    phone: '+16045550142',
    email: 'sarah@example.com',
    notes: 'Feeds the cat',
  };
  const neighbour = {
    label: 'The Wilsons',
    address_line1: '44 Maple St',
    city: 'Vancouver',
    state_province: 'BC',
    postal_code: 'V6B 1A1',
    country: 'CA',
    formatted_address: '44 Maple St, Vancouver, BC, V6B 1A1',
  };

  it('creates a contact carrying the number AND the address', async () => {
    mocked.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocked.addContactAsync.mockResolvedValue('new-contact-1');

    const outcome = await exportPersonToContacts(person, neighbour);
    expect(outcome).toEqual({ status: 'ok', contactId: 'new-contact-1' });

    const written = mocked.addContactAsync.mock.calls[0]![0];
    expect(written.firstName).toBe('Sarah');
    expect(written.lastName).toBe('Wilson');
    // The home's label as the company line: it is what shows under the name in
    // the OS list, and "Sarah Wilson — The Wilsons" is the disambiguation a
    // member wants there.
    expect(written.company).toBe('The Wilsons');
    expect(written.phoneNumbers[0].number).toBe('+16045550142');
    // A phone number with no address is half of what the member recorded.
    expect(written.addresses[0].street).toBe('44 Maple St');
  });

  it('omits the address block entirely when there is none', async () => {
    mocked.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocked.addContactAsync.mockResolvedValue('new-contact-2');
    await exportPersonToContacts(person, { ...neighbour, address_line1: null });
    expect(mocked.addContactAsync.mock.calls[0]![0].addresses).toBeUndefined();
  });

  it('handles a single-word name without inventing a surname', async () => {
    mocked.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocked.addContactAsync.mockResolvedValue('new-contact-3');
    await exportPersonToContacts({ ...person, name: 'Prince' }, neighbour);
    const written = mocked.addContactAsync.mock.calls[0]![0];
    expect(written.firstName).toBe('Prince');
    expect(written.lastName).toBeUndefined();
  });

  it('reports denial without attempting the write', async () => {
    mocked.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await exportPersonToContacts(person, neighbour)).toEqual({ status: 'denied' });
    expect(mocked.addContactAsync).not.toHaveBeenCalled();
  });

  it('reports a failed write as failed, not as denied', async () => {
    mocked.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mocked.addContactAsync.mockRejectedValue(new Error('write failed'));
    expect(await exportPersonToContacts(person, neighbour)).toEqual({ status: 'failed' });
  });
});
