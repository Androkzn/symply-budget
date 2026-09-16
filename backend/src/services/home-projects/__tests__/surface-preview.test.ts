/**
 * AI surface preview — the leash, not the model.
 *
 * Nothing here calls an image model. What is tested is everything that decides
 * *what the model is told and shown*, because that is where this feature is
 * either honest or not:
 *
 *  - the scale facts come from the stored document, so a client cannot flatter
 *    them;
 *  - the scale drawing goes in first, labelled authoritative;
 *  - material photos go in labelled as colour-only, capped, and a missing one
 *    degrades the render instead of failing the request;
 *  - the failures a member can actually cause come back as 404/503 with copy,
 *    not as a 500.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createMaterial,
  createRoomSurfaceModel,
  buildShapeOutline,
  roomShapePreset,
  seedShapeParams,
  serializeRoomSurfaceModel,
  splitRegion,
  updateSubArea,
  type Material,
  type RoomSurfaceModel,
} from '@symply/contracts';

import type { GenerateImageArgs } from '../../../ai/provider';
import {
  MAX_MATERIAL_REFERENCES,
  generateSurfacePreview,
  type SurfacePreviewDeps,
} from '../surface-preview';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

function tile(name: string, textureAttachmentId: string | null): Material {
  return { ...createMaterial({ name, kind: 'tile' }), textureAttachmentId };
}

/** A 4 × 3 room with a 2.4 m ceiling, and the id of its first wall. */
function roomWith(materials: Material[]): RoomSurfaceModel {
  const model = createRoomSurfaceModel({
    outline: buildShapeOutline(
      roomShapePreset('rectangle'),
      seedShapeParams(roomShapePreset('rectangle'), 4, 3),
    ),
    wallHeight_m: 2.4,
    materials,
  });
  const wall = model.surfaces.find(surface => surface.kind === 'wall')!;
  return {
    ...model,
    surfaces: model.surfaces.map(surface =>
      surface.id === wall.id
        ? { ...surface, materialId: materials[0]?.id ?? null }
        : surface,
    ),
  };
}

function wallIdOf(model: RoomSurfaceModel): string {
  return model.surfaces.find(surface => surface.kind === 'wall')!.id;
}

interface Harness {
  deps: SurfacePreviewDeps;
  calls: GenerateImageArgs[];
}

function harness(
  model: RoomSurfaceModel | null,
  options?: {
    r2: Record<string, ArrayBuffer | null>;
    noProvider?: boolean;
  },
): Harness {
  const calls: GenerateImageArgs[] = [];
  const objects = options?.r2 ?? {};

  const deps: SurfacePreviewDeps = {
    env: {
      REPORTS_BUCKET: {
        get: vi.fn(async (key: string) => {
          const bytes = objects[key];
          if (!bytes) return null;
          return { arrayBuffer: async () => bytes };
        }),
      },
    } as unknown as SurfacePreviewDeps['env'],
    loadGeometryPayload: async () =>
      model ? JSON.stringify(serializeRoomSurfaceModel(model)) : null,
    resolveAttachmentKey: async (_projectId, attachmentId) => ({
      r2_key: `key/${attachmentId}`,
      content_type: 'image/jpeg',
    }),
    imageProvider: async () =>
      options?.noProvider
        ? null
        : {
            model: 'test-image-model',
            provider: {
              generateImage: async (args: GenerateImageArgs) => {
                calls.push(args);
                return {
                  bytes: PNG_BYTES,
                  mime: 'image/png',
                  model: 'test-image-model',
                };
              },
            },
          },
  };
  return { deps, calls };
}

describe('the brief is computed, not accepted', () => {
  it('holds the model to piece counts taken from the stored document', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps, calls } = harness(model);

    const result = await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
    });

    // 4.00 m of 300 mm tile with a 3 mm joint → 13 whole, 64 mm cut.
    expect(result.brief.regions[0].across).toMatchObject({ whole: 13 });
    expect(calls[0].prompt).toContain('13 whole pieces');
    expect(calls[0].prompt).toContain('4.00 m');
  });

  it('previews the saved room, not one the caller describes', async () => {
    const panel = createMaterial({ name: 'Panelling', kind: 'panel' });
    const base = roomWith([tile('Metro', null), panel]);
    const wall = base.surfaces.find(s => s.kind === 'wall')!;
    const split = splitRegion(wall, 'horizontal', 1.1);
    const withPanel = updateSubArea(split.surface, split.createdIds[0], {
      materialId: panel.id,
      label: 'Wainscot',
    });
    const model = {
      ...base,
      surfaces: base.surfaces.map(s => (s.id === wall.id ? withPanel : s)),
    };
    const { deps, calls } = harness(model);

    await generateSurfacePreview(deps, { projectId: 'p1', surfaceId: wall.id });

    expect(calls[0].prompt).toContain('“Wainscot”');
    expect(calls[0].prompt).toContain('1.10 m from the bottom');
  });

  it('shapes the request like the surface rather than always square', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps, calls } = harness(model);
    await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
    });
    // 4.0 × 2.4 is landscape.
    expect(calls[0].size).toBe('1536x1024');
  });
});

describe('reference images', () => {
  it('sends the scale drawing first, labelled as the layout', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps, calls } = harness(model);

    const result = await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
      layoutPngBase64: 'aGVsbG8=',
    });

    expect(result.usedLayoutReference).toBe(true);
    expect(calls[0].references?.[0].role).toBe('layout');
  });

  it('accepts a data-URI prefix a client forgot to strip', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps, calls } = harness(model);
    await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
      layoutPngBase64: 'data:image/png;base64,aGVsbG8=',
    });
    expect(calls[0].references?.[0].bytes.byteLength).toBe(5);
  });

  it('says so honestly when there is no drawing to compose against', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps, calls } = harness(model);
    const result = await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
    });
    expect(result.usedLayoutReference).toBe(false);
    expect(calls[0].references).toEqual([]);
  });

  it('attaches a material photo, labelled colour-and-texture only', async () => {
    const model = roomWith([tile('Metro', 'att1')]);
    const { deps, calls } = harness(model, {
      r2: { 'key/att1': PNG_BYTES },
    });

    const result = await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
    });

    expect(result.materialReferenceCount).toBe(1);
    expect(calls[0].references?.[0].role).toBe('material');
  });

  /**
   * A swatch missing from the bucket is a material described in words instead
   * of shown. Taking the whole preview down for it would be the wrong trade.
   */
  it('degrades rather than failing when a texture will not load', async () => {
    const model = roomWith([tile('Metro', 'missing')]);
    const { deps } = harness(model, { r2: {} });

    const result = await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wallIdOf(model),
    });

    expect(result.materialReferenceCount).toBe(0);
    expect(result.brief.regions[0].materialName).toBe('Metro');
  });

  it('caps how many photos ride along', async () => {
    // Five distinct materials on one wall, each with a photo.
    const materials = Array.from({ length: 5 }, (_, index) =>
      tile(`Tile ${index}`, `att${index}`),
    );
    const base = roomWith(materials);
    const wall = base.surfaces.find(s => s.kind === 'wall')!;
    let surface = wall;
    // Split into four bands, then assign a different material to each.
    const first = splitRegion(surface, 'horizontal', 0.6);
    surface = first.surface;
    const second = splitRegion(surface, 'horizontal', 1.2, {
      regionId: first.createdIds[1],
    });
    surface = second.surface;
    const third = splitRegion(surface, 'horizontal', 1.8, {
      regionId: second.createdIds[1],
    });
    surface = third.surface;
    const ids = [
      first.createdIds[0],
      second.createdIds[0],
      third.createdIds[0],
      third.createdIds[1],
    ];
    ids.forEach((id, index) => {
      surface = updateSubArea(surface, id, { materialId: materials[index].id });
    });

    const model = {
      ...base,
      surfaces: base.surfaces.map(s => (s.id === wall.id ? surface : s)),
    };
    const { deps } = harness(model, {
      r2: Object.fromEntries(materials.map((_, i) => [`key/att${i}`, PNG_BYTES])),
    });

    const result = await generateSurfacePreview(deps, {
      projectId: 'p1',
      surfaceId: wall.id,
    });

    expect(result.materialReferenceCount).toBeLessThanOrEqual(
      MAX_MATERIAL_REFERENCES,
    );
  });
});

describe('failures a member can cause', () => {
  it('is a 404 with copy when the project has no room yet', async () => {
    const { deps } = harness(null);
    await expect(
      generateSurfacePreview(deps, { projectId: 'p1', surfaceId: 'sf_x' }),
    ).rejects.toMatchObject({
      name: 'NotFoundError',
      statusCode: 404,
    });
  });

  it('is a 404 when the surface is no longer in the room', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps } = harness(model);
    await expect(
      generateSurfacePreview(deps, { projectId: 'p1', surfaceId: 'sf_gone' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  /**
   * The copy matters as much as the code: a member whose preview is
   * unavailable must be told that their drawing and quantities are unaffected,
   * or they will assume the whole planner is broken.
   */
  it('is a 503 that says the planner still works when no image model exists', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps } = harness(model, { r2: {}, noProvider: true });
    await expect(
      generateSurfacePreview(deps, {
        projectId: 'p1',
        surfaceId: wallIdOf(model),
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('quantities are unaffected'),
    });
  });

  it('refuses a drawing that is too large before decoding it twice', async () => {
    const model = roomWith([tile('Metro', null)]);
    const { deps } = harness(model);
    // 5 MB of base64 → over the 4 MB raw cap.
    const huge = 'A'.repeat(6_000_000);
    await expect(
      generateSurfacePreview(deps, {
        projectId: 'p1',
        surfaceId: wallIdOf(model),
        layoutPngBase64: huge,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
