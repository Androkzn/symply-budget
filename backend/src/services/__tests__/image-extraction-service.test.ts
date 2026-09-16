/**
 * Report images — the storage/retrieval half of PDF image extraction (the
 * extraction itself runs in Lambda). Runs against the live miniflare D1 + R2.
 *
 * The interesting behaviour is all in the read paths: a soft-deleted image must
 * stay out of every listing (a "deleted" photo reappearing in a report is a
 * visible bug), finding links live in a JSON column that can hold anything, and
 * URL construction switches on whether a public R2 domain is configured.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { ImageExtractionService } from '../image-extraction-service';

const testEnv = env as unknown as Env;
const d1 = testEnv.DB as unknown as D1Database;

const REPORT = 'rep_img_1';
const OTHER_REPORT = 'rep_img_2';
const HOUSEHOLD = 'hh_img_1';

const service = (over?: Partial<Env>) =>
  new ImageExtractionService({ ...testEnv, ...over } as Env, d1);

async function createTables(): Promise<void> {
  await d1.exec(
    `CREATE TABLE IF NOT EXISTS report_images (
      id TEXT PRIMARY KEY, report_id TEXT NOT NULL, household_id TEXT,
      chunk_id TEXT, finding_id TEXT, page_number INTEGER,
      image_key TEXT NOT NULL, thumbnail_key TEXT, original_filename TEXT,
      content_type TEXT DEFAULT 'image/jpeg', file_size INTEGER, image_type TEXT,
      caption TEXT, ai_description TEXT, ai_confidence REAL, system_category TEXT,
      finding_ids TEXT, tags TEXT, position_x REAL, position_y REAL,
      extraction_method TEXT, extraction_confidence REAL,
      status TEXT DEFAULT 'ready', error_message TEXT, width INTEGER, height INTEGER,
      created_at TEXT, updated_at TEXT
    )`.replace(/\s+/g, ' ')
  );
}

/** Store one image and return its id. */
const store = (over: Partial<Parameters<ImageExtractionService['storeExtractedImage']>[0]> = {}) =>
  service().storeExtractedImage({
    report_id: REPORT,
    household_id: HOUSEHOLD,
    image_key: `reports/${REPORT}/images/x.jpg`,
    ...over,
  });

beforeEach(async () => {
  await createTables();
  await d1.exec('DELETE FROM report_images');
});

describe('ImageExtractionService — storing', () => {
  it('stores an extracted image as ready and returns its id', async () => {
    const id = await store({ page_number: 4, image_type: 'photo' });
    const image = await service().getImage(id);

    expect(image).toMatchObject({
      id,
      report_id: REPORT,
      page_number: 4,
      image_type: 'photo',
      status: 'ready',
    });
  });

  it('defaults the content type to JPEG when the extractor sent none', async () => {
    const id = await store();
    expect((await service().getImage(id))!.content_type).toBe('image/jpeg');
  });

  it('honours a caller-supplied id', async () => {
    const id = await store({ id: 'img_explicit' });
    expect(id).toBe('img_explicit');
  });

  it('serialises the finding links as JSON and reads them back as an array', async () => {
    const id = await store({ finding_ids: ['f1', 'f2'] });
    expect((await service().getImage(id))!.finding_ids).toEqual(['f1', 'f2']);
  });

  it('reads back an empty finding list when none were linked', async () => {
    const id = await store();
    expect((await service().getImage(id))!.finding_ids).toEqual([]);
  });

  it('bulk-stores a page of images and returns one id per image', async () => {
    const ids = await service().bulkStoreImages(REPORT, HOUSEHOLD, [
      { image_key: 'a.jpg', page_number: 1 },
      { image_key: 'b.jpg', page_number: 2 },
      { image_key: 'c.jpg', page_number: 3 },
    ]);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(await service().getReportImages(REPORT)).toHaveLength(3);
  });

  it('returns null for an image that does not exist', async () => {
    expect(await service().getImage('img_missing')).toBeNull();
  });
});

describe('ImageExtractionService — listing a report', () => {
  beforeEach(async () => {
    await store({ image_key: 'p3.jpg', page_number: 3, system_category: 'roof' });
    await store({ image_key: 'p1.jpg', page_number: 1, system_category: 'plumbing' });
    await store({ image_key: 'p2.jpg', page_number: 2, system_category: 'roof' });
    await store({ report_id: OTHER_REPORT, image_key: 'other.jpg', page_number: 1 });
  });

  it('returns only the requested report’s images, ordered by page', async () => {
    const images = await service().getReportImages(REPORT);
    expect(images.map((i) => i.page_number)).toEqual([1, 2, 3]);
  });

  it('filters by page number', async () => {
    const images = await service().getReportImages(REPORT, { page_number: 2 });
    expect(images).toHaveLength(1);
    expect(images[0].image_key).toBe('p2.jpg');
  });

  it('filters by system category', async () => {
    const images = await service().getReportImages(REPORT, { system_category: 'roof' });
    expect(images.map((i) => i.page_number)).toEqual([2, 3]);
  });

  it('paginates with limit and offset', async () => {
    const page = await service().getReportImages(REPORT, { limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
    expect(page[0].page_number).toBe(2);
  });

  it('omits a soft-deleted image from the listing', async () => {
    const id = await store({ image_key: 'gone.jpg', page_number: 9 });
    expect(await service().deleteImage(id)).toBe(true);

    const keys = (await service().getReportImages(REPORT)).map((i) => i.image_key);
    expect(keys).not.toContain('gone.jpg');
  });
});

describe('ImageExtractionService — finding links', () => {
  it('finds images attached directly to a finding', async () => {
    await store({ image_key: 'direct.jpg', finding_id: 'f_direct' });
    await store({ image_key: 'unrelated.jpg' });

    const images = await service().getImagesForFinding('f_direct');
    expect(images).toHaveLength(1);
    expect(images[0].image_key).toBe('direct.jpg');
  });

  it('finds images linked through the JSON finding list', async () => {
    await store({ image_key: 'multi.jpg', finding_ids: ['f_a', 'f_b'] });
    const images = await service().getImagesForFindings(['f_b']);
    expect(images.map((i) => i.image_key)).toEqual(['multi.jpg']);
  });

  it('matches either the direct link or the JSON list', async () => {
    await store({ image_key: 'direct.jpg', finding_id: 'f_a' });
    await store({ image_key: 'json.jpg', finding_ids: ['f_b'] });

    const images = await service().getImagesForFindings(['f_a', 'f_b']);
    expect(images.map((i) => i.image_key).sort()).toEqual(['direct.jpg', 'json.jpg']);
  });

  it('ignores an image whose finding list is corrupt rather than failing the query', async () => {
    // The column is free-form JSON; one bad row must not break the whole report.
    await store({ image_key: 'good.jpg', finding_ids: ['f_a'] });
    await d1.exec(
      `INSERT INTO report_images (id, report_id, image_key, finding_ids, status) VALUES ('img_bad', '${REPORT}', 'bad.jpg', 'not json', 'ready')`
    );

    const images = await service().getImagesForFindings(['f_a']);
    expect(images.map((i) => i.image_key)).toEqual(['good.jpg']);
  });

  it('links an image to a finding without duplicating an existing link', async () => {
    const id = await store({ finding_ids: ['f_a'] });

    expect(await service().linkImageToFinding(id, 'f_b')).toBe(true);
    expect(await service().linkImageToFinding(id, 'f_b')).toBe(true);

    expect((await service().getImage(id))!.finding_ids).toEqual(['f_a', 'f_b']);
  });

  it('reports failure when linking an image that does not exist', async () => {
    expect(await service().linkImageToFinding('img_missing', 'f_a')).toBe(false);
  });
});

describe('ImageExtractionService — updating and deleting', () => {
  it('updates the caption and description', async () => {
    const id = await store();
    await service().updateImageMetadata(id, { caption: 'North wall', ai_description: 'staining' });

    const image = await service().getImage(id);
    expect(image).toMatchObject({ caption: 'North wall', ai_description: 'staining' });
  });

  it('soft-deletes rather than dropping the row', async () => {
    const id = await store();
    expect(await service().deleteImage(id)).toBe(true);

    const image = await service().getImage(id);
    expect(image).not.toBeNull();
    expect(image!.status).toBe('deleted');
  });

  it('removes the stored objects from R2 on delete', async () => {
    await testEnv.REPORTS_BUCKET.put('del/main.jpg', new Uint8Array([1, 2, 3]));
    await testEnv.REPORTS_BUCKET.put('del/thumb.jpg', new Uint8Array([1, 2, 3]));
    const id = await store({ image_key: 'del/main.jpg', thumbnail_key: 'del/thumb.jpg' });

    await service().deleteImage(id);
    expect(await testEnv.REPORTS_BUCKET.get('del/main.jpg')).toBeNull();
    expect(await testEnv.REPORTS_BUCKET.get('del/thumb.jpg')).toBeNull();
  });

  it('still marks the row deleted when the R2 objects are already gone', async () => {
    // Storage cleanup must never block the user-visible delete.
    const id = await store({ image_key: 'never/existed.jpg' });
    expect(await service().deleteImage(id)).toBe(true);
    expect((await service().getImage(id))!.status).toBe('deleted');
  });

  it('reports failure when deleting an image that does not exist', async () => {
    expect(await service().deleteImage('img_missing')).toBe(false);
  });
});

describe('ImageExtractionService — R2 upload and URLs', () => {
  it('uploads the image and a thumbnail, then records the row', async () => {
    const result = await service().uploadImage(
      REPORT,
      HOUSEHOLD,
      new Uint8Array([1, 2, 3, 4]).buffer,
      'image/png',
      { page_number: 2, original_filename: 'scan.png' }
    );

    expect(result.image_key).toMatch(/^reports\/rep_img_1\/images\/.+\.png$/);
    expect(result.thumbnail_key).toMatch(/^reports\/rep_img_1\/thumbnails\/.+\.png$/);
    expect(await testEnv.REPORTS_BUCKET.get(result.image_key)).not.toBeNull();

    const image = await service().getImage(result.id);
    expect(image).toMatchObject({
      page_number: 2,
      original_filename: 'scan.png',
      file_size: 4,
      extraction_method: 'manual_upload',
    });
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/svg+xml', 'svg'],
    ['application/octet-stream', 'jpg'],
  ])('gives %s the .%s extension', async (contentType, ext) => {
    const result = await service().uploadImage(REPORT, HOUSEHOLD, new Uint8Array([1]).buffer, contentType);
    expect(result.image_key.endsWith(`.${ext}`)).toBe(true);
  });

  it('serves images from the public R2 domain when one is configured', async () => {
    const id = await store({ image_key: 'reports/a/images/b.jpg' });
    const image = await service({ R2_PUBLIC_DOMAIN: 'cdn.example.com' } as Partial<Env>).getImage(id);
    expect(image!.url).toBe('https://cdn.example.com/reports/a/images/b.jpg');
  });

  it('falls back to an API path when no public domain is set', async () => {
    const id = await store({ image_key: 'reports/a/images/b c.jpg' });
    const image = await service({ R2_PUBLIC_DOMAIN: undefined } as Partial<Env>).getImage(id);
    // The key is URL-encoded so a space or slash cannot break the route.
    expect(image!.url).toBe('/api/images/reports%2Fa%2Fimages%2Fb%20c.jpg');
  });

  it('returns the raw bytes and content type from storage', async () => {
    await testEnv.REPORTS_BUCKET.put('raw/img.png', new Uint8Array([9, 8, 7]), {
      httpMetadata: { contentType: 'image/png' },
    });

    const data = await service().getImageData('raw/img.png');
    expect(data!.contentType).toBe('image/png');
    expect(new Uint8Array(data!.data)).toEqual(new Uint8Array([9, 8, 7]));
  });

  it('returns null for bytes that are not in storage', async () => {
    expect(await service().getImageData('raw/missing.png')).toBeNull();
  });
});
