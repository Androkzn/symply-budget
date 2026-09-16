import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

/**
 * Neighbours — the homes around this property, and the people who live in them.
 *
 * Three tables, and the split is the whole design:
 *
 *  - **`neighbourhoods`** is a named AREA ("Maple Court", "the cul-de-sac").
 *    Optional, cosmetic-plus: it groups pins, tints them on the map and carries
 *    a picture. Deleting one must never delete the homes inside it.
 *  - **`neighbours`** is a HOME, not a person. That is the load-bearing choice.
 *    A pin on a map is a building; the Wilsons who live in it are three people
 *    with three phone numbers, and modelling the pin as a person means the
 *    second occupant either overwrites the first or becomes a second pin on the
 *    same roof. Latitude/longitude are `notNull` because a row that cannot be
 *    drawn is not a neighbour in this feature — the map IS the feature.
 *  - **`neighbour_people`** is an occupant. Zero or more per home; a home with
 *    none is legitimate ("the empty house on the corner") and shows a plain pin.
 *
 * ## Why the address columns are split AND flattened
 *
 * Both `formatted_address` and the six component columns are stored. The
 * components are what an edit form binds to and what an exported contact card
 * needs field-by-field; `formatted_address` is what the OS geocoder actually
 * returned and what the map sheet renders in one line. Recomputing either from
 * the other loses information — a reverse geocode often has no unit number the
 * member then types in, and re-joining components produces a string the geocoder
 * never said.
 *
 * ## `place_source` is not decoration
 *
 * A pin dropped by tapping the map is exact to the metre and its address is a
 * guess; a pin geocoded from a typed address is the reverse. The screens say so
 * ("Address from map" vs "Pinned from address"), and a future re-geocode must
 * never silently move a pin the member placed by hand.
 *
 * ## Privacy
 *
 * Every row here is a third party who did not install this app. Nothing in this
 * family is ever sent to an AI provider (the egress allowlist excludes all three
 * tables), nothing is shared beyond the household, and on a local-first
 * household these rows never leave the members' own devices at all.
 */

export const NEIGHBOUR_RELATIONS = [
  'next_door',
  'across',
  'behind',
  'corner',
  'nearby',
  'strata',
  'other',
] as const;
export type NeighbourRelation = (typeof NEIGHBOUR_RELATIONS)[number];

export const NEIGHBOUR_PLACE_SOURCES = [
  /** The member tapped the map; the address was reverse-geocoded from the pin. */
  'map_tap',
  /** The member typed an address; the pin was forward-geocoded from it. */
  'geocoded',
  /** The member typed an address and placed the pin themselves. */
  'manual',
  /** Created from a device contact's postal address. */
  'contact_import',
] as const;
export type NeighbourPlaceSource = (typeof NEIGHBOUR_PLACE_SOURCES)[number];

export const NEIGHBOUR_PERSON_ROLES = [
  'adult',
  'child',
  'tenant',
  'owner',
  'pet',
  'other',
] as const;
export type NeighbourPersonRole = (typeof NEIGHBOUR_PERSON_ROLES)[number];

export const neighbourhoods = sqliteTable(
  'neighbourhoods',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Hex tint applied to this area's pins and its header. NULL = default. */
    color: text('color'),
    /**
     * R2 key for the area photo, or the synthetic `lf-blob/<id>` form on a
     * local-first household (see `blobKeyFor`). Never a device file path — that
     * is the Budget `localWishMedia` bug, and it does not travel.
     */
    photo_key: text('photo_key'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byHousehold: index('neighbourhoods_by_household').on(t.household_id),
    /**
     * One name per property. The uniqueness is real — two "Maple Court" areas
     * are a mistake every time — and it is why `neighbourhoods` carries a
     * deterministic row id on the device ledger (S3b): without it, two members
     * creating the area offline would both survive the merge.
     */
    uniqueName: uniqueIndex('neighbourhoods_household_name_unique').on(t.household_id, t.name),
  })
);

export const neighbours = sqliteTable(
  'neighbours',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /**
     * `set null`, not `cascade`. Deleting an area must leave its homes on the
     * map — the member drew a boundary they no longer want, not a street they
     * no longer have.
     */
    neighbourhood_id: text('neighbourhood_id').references(() => neighbourhoods.id, {
      onDelete: 'set null',
    }),
    /** What the member calls this home — "The Wilsons", "42 Maple". */
    label: text('label').notNull(),
    relation: text('relation').notNull().default('nearby'),

    address_line1: text('address_line1'),
    address_line2: text('address_line2'),
    city: text('city'),
    state_province: text('state_province'),
    postal_code: text('postal_code'),
    country: text('country'),
    /** Exactly what the geocoder returned, kept verbatim. See the header. */
    formatted_address: text('formatted_address'),

    /** `notNull`: a neighbour that cannot be drawn is not a row this feature has. */
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    place_source: text('place_source').notNull().default('manual'),

    photo_key: text('photo_key'),
    notes: text('notes'),
    is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    /** Shows in the emergency sheet — who to call when nobody is home. */
    is_emergency_contact: integer('is_emergency_contact', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** They hold a key to this property. Surfaced with a distinct pin badge. */
    has_spare_key: integer('has_spare_key', { mode: 'boolean' }).notNull().default(false),

    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byHousehold: index('neighbours_by_household').on(t.household_id),
    byNeighbourhood: index('neighbours_by_neighbourhood').on(t.neighbourhood_id),
    /**
     * The map query is "everything near me", so the index that matters is the
     * bounding-box one. SQLite will not use a two-column index for two range
     * predicates, but it will use this one to narrow on latitude first, which is
     * the half that discriminates on a residential street.
     */
    byLatLon: index('neighbours_by_lat_lon').on(t.household_id, t.latitude, t.longitude),
  })
);

export const neighbourPeople = sqliteTable(
  'neighbour_people',
  {
    id: text('id').primaryKey(),
    neighbour_id: text('neighbour_id')
      .notNull()
      .references(() => neighbours.id, { onDelete: 'cascade' }),
    /**
     * Denormalised from the parent. Every read in this family is scoped to one
     * property, and carrying the column means the device ledger can filter
     * without a join it has no query planner for.
     */
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role').notNull().default('adult'),
    phone: text('phone'),
    email: text('email'),
    photo_key: text('photo_key'),
    notes: text('notes'),
    /** The face shown on the map bubble when the home has no photo of its own. */
    is_primary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    sort_order: integer('sort_order').notNull().default(0),
    /**
     * The OS address-book identifier this person came from or was exported to,
     * so a re-import updates rather than duplicates. Device-scoped and
     * meaningless on another phone, which is why it is never matched on across
     * devices — only used as a hint on the device that wrote it.
     */
    device_contact_id: text('device_contact_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    byNeighbour: index('neighbour_people_by_neighbour').on(t.neighbour_id),
    byHousehold: index('neighbour_people_by_household').on(t.household_id),
  })
);
