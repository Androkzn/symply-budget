import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  NEIGHBOUR_PERSON_ROLES,
  NEIGHBOUR_PLACE_SOURCES,
  NEIGHBOUR_RELATIONS,
} from '../db/schema-neighbours';
import { authMiddleware } from '../middleware/auth';
import { NeighbourService } from '../services/neighbour-service';
import type { Env } from '../types';

/**
 * `/households/:householdId/neighbours` — the homes around this property.
 *
 * Mounted under the household prefix like every other House family, so the
 * membership check the service performs has a `householdId` to check against.
 * The neighbourhoods (areas) live under `/neighbourhoods` on the SAME router
 * rather than a second mount: they are meaningless without the homes they
 * group, every screen that reads one reads the other, and a second top-level
 * prefix would put two halves of one feature in two places.
 *
 * Route ORDER matters here in a way it does not in most of this tree.
 * `/neighbourhoods` must be declared before `/:neighbourId`, or Hono matches
 * the literal path as an id and every area request 404s as a missing
 * neighbour. Same for `/people/:personId`.
 */

const neighbours = new Hono<{ Bindings: Env }>();

neighbours.use('/*', authMiddleware());

function getHouseholdId(c: { req: { param: (key: string) => string | undefined } }): string {
  const householdId = c.req.param('householdId');
  if (!householdId) throw new Error('Household ID is required');
  return householdId;
}

const personSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(NEIGHBOUR_PERSON_ROLES).optional(),
  phone: z.string().max(60).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  photo_key: z.string().max(400).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_primary: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  device_contact_id: z.string().max(200).nullable().optional(),
});

const createNeighbourSchema = z.object({
  label: z.string().min(1).max(120),
  relation: z.enum(NEIGHBOUR_RELATIONS).optional(),
  neighbourhood_id: z.string().nullable().optional(),
  address_line1: z.string().max(200).nullable().optional(),
  address_line2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state_province: z.string().max(120).nullable().optional(),
  postal_code: z.string().max(40).nullable().optional(),
  country: z.string().max(80).nullable().optional(),
  formatted_address: z.string().max(400).nullable().optional(),
  // Bounds are asserted here AND in the service. The service is the authority
  // (the local facade mirrors it), but a 400 from the validator is a better
  // answer than a 500 from an insert.
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  place_source: z.enum(NEIGHBOUR_PLACE_SOURCES).optional(),
  photo_key: z.string().max(400).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  is_favorite: z.boolean().optional(),
  is_emergency_contact: z.boolean().optional(),
  has_spare_key: z.boolean().optional(),
  people: z.array(personSchema).max(20).optional(),
});

const updateNeighbourSchema = createNeighbourSchema
  .omit({ people: true })
  .partial()
  .refine(
    (value) =>
      (value.latitude === undefined) === (value.longitude === undefined),
    { message: 'latitude and longitude must be updated together', path: ['latitude'] }
  );

const neighbourhoodSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(24).nullable().optional(),
  photo_key: z.string().max(400).nullable().optional(),
});

const service = (c: { env: Env; get: (k: 'userId') => string }) =>
  new NeighbourService(c.env, c.env.DB);

// ------------------------------------------------------------ neighbourhoods
// Declared FIRST — see the header. `/neighbourhoods` would otherwise match
// `/:neighbourId`.

neighbours.get('/neighbourhoods', async (c) => {
  const householdId = getHouseholdId(c);
  const neighbourhoods = await service(c).listNeighbourhoods(householdId, c.get('userId'));
  return c.json({ neighbourhoods });
});

neighbours.post('/neighbourhoods', zValidator('json', neighbourhoodSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const neighbourhood = await service(c).createNeighbourhood(
    householdId,
    c.get('userId'),
    c.req.valid('json')
  );
  return c.json({ neighbourhood }, 201);
});

neighbours.patch(
  '/neighbourhoods/:neighbourhoodId',
  zValidator('json', neighbourhoodSchema.partial()),
  async (c) => {
    const householdId = getHouseholdId(c);
    const neighbourhood = await service(c).updateNeighbourhood(
      householdId,
      c.get('userId'),
      c.req.param('neighbourhoodId')!,
      c.req.valid('json')
    );
    return c.json({ neighbourhood });
  }
);

neighbours.delete('/neighbourhoods/:neighbourhoodId', async (c) => {
  const householdId = getHouseholdId(c);
  await service(c).deleteNeighbourhood(
    householdId,
    c.get('userId'),
    c.req.param('neighbourhoodId')!
  );
  return c.json({ success: true });
});

// -------------------------------------------------------------------- people
// Also before `/:neighbourId`, for the same reason.

neighbours.patch('/people/:personId', zValidator('json', personSchema.partial()), async (c) => {
  const householdId = getHouseholdId(c);
  const person = await service(c).updatePerson(
    householdId,
    c.get('userId'),
    c.req.param('personId')!,
    c.req.valid('json')
  );
  return c.json({ person });
});

neighbours.delete('/people/:personId', async (c) => {
  const householdId = getHouseholdId(c);
  await service(c).removePerson(householdId, c.get('userId'), c.req.param('personId')!);
  return c.json({ success: true });
});

// ---------------------------------------------------------------- neighbours

neighbours.get('/', async (c) => {
  const householdId = getHouseholdId(c);
  const isFavorite = c.req.query('is_favorite');
  const list = await service(c).list(householdId, c.get('userId'), {
    neighbourhood_id: c.req.query('neighbourhood_id'),
    relation: c.req.query('relation') as never,
    is_favorite: isFavorite === undefined ? undefined : isFavorite === 'true',
    search: c.req.query('search'),
  });
  return c.json({ neighbours: list });
});

neighbours.post('/', zValidator('json', createNeighbourSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const neighbour = await service(c).create(householdId, c.get('userId'), c.req.valid('json'));
  return c.json({ neighbour }, 201);
});

neighbours.get('/:neighbourId', async (c) => {
  const householdId = getHouseholdId(c);
  const neighbour = await service(c).get(
    householdId,
    c.get('userId'),
    c.req.param('neighbourId')!
  );
  return c.json({ neighbour });
});

neighbours.patch('/:neighbourId', zValidator('json', updateNeighbourSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const neighbour = await service(c).update(
    householdId,
    c.get('userId'),
    c.req.param('neighbourId')!,
    c.req.valid('json')
  );
  return c.json({ neighbour });
});

neighbours.delete('/:neighbourId', async (c) => {
  const householdId = getHouseholdId(c);
  await service(c).remove(householdId, c.get('userId'), c.req.param('neighbourId')!);
  return c.json({ success: true });
});

neighbours.post('/:neighbourId/people', zValidator('json', personSchema), async (c) => {
  const householdId = getHouseholdId(c);
  const person = await service(c).addPerson(
    householdId,
    c.get('userId'),
    c.req.param('neighbourId')!,
    c.req.valid('json')
  );
  return c.json({ person }, 201);
});

export default neighbours;
