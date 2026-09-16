import * as Linking from 'expo-linking';

import {
  __resetE2EDocumentPickStateForTests,
  buildE2EDocumentPickUrl,
  consumeE2EDocumentPick,
  hasPendingE2EDocumentPick,
  registerE2EUploadDeliver,
  tryQueueE2EDocumentPickFromUrl,
} from '../e2e-document-pick';

jest.mock('../../assets/e2e/kaizen/book.pdf', () => 101, { virtual: true });
jest.mock('../../assets/e2e/kaizen/resume.pdf', () => 102, { virtual: true });
jest.mock('../../assets/e2e/kaizen/technical-questions.txt', () => 103, { virtual: true });

jest.mock('expo-linking', () => ({
  parse: jest.fn(),
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      downloadAsync: jest.fn().mockResolvedValue(undefined),
      localUri: 'file:///tmp/e2e-fixture.pdf',
      uri: 'file:///tmp/e2e-fixture.pdf',
    })),
  },
}));

describe('e2e-document-pick', () => {
  beforeEach(() => {
    __resetE2EDocumentPickStateForTests();
    jest.clearAllMocks();
  });

  it('builds the kaizen pick URL', () => {
    expect(buildE2EDocumentPickUrl('kaizen-book')).toBe('kaizen://e2e-pick?key=kaizen-book');
  });

  it('queues a pick from the e2e-pick URL and consumes it once', async () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-pick',
      queryParams: { key: 'kaizen-book' },
    });
    expect(tryQueueE2EDocumentPickFromUrl('kaizen://e2e-pick?key=kaizen-book')).toBe(true);
    expect(hasPendingE2EDocumentPick()).toBe(true);

    const file = await consumeE2EDocumentPick();
    expect(file).toEqual({
      uri: 'file:///tmp/e2e-fixture.pdf',
      name: 'book.pdf',
      mime: 'application/pdf',
    });
    expect(hasPendingE2EDocumentPick()).toBe(false);
    expect(await consumeE2EDocumentPick()).toBeNull();
  });

  // Auto-apply is the contract both directions: whichever of (queue, panel
  // mount) happens second flushes the pick. Maestro cannot drive the native
  // document sheet, so the fixture has to land without a tap — and the upload
  // panel leans on this as its fallback when the deep link arrives after the
  // "Upload File" tap (see KaizenFileUploadPanel.handleDocument).
  it('flushes a queued pick as soon as an upload panel registers', async () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-pick',
      queryParams: { key: 'kaizen-book' },
    });
    const deliver = jest.fn().mockResolvedValue(undefined);
    expect(tryQueueE2EDocumentPickFromUrl('kaizen://e2e-pick?key=kaizen-book')).toBe(true);
    registerE2EUploadDeliver(deliver);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(deliver).toHaveBeenCalledWith({
      uri: 'file:///tmp/e2e-fixture.pdf',
      name: 'book.pdf',
      mime: 'application/pdf',
    });
    expect(hasPendingE2EDocumentPick()).toBe(false);
  });

  it('auto-delivers a pick queued while a panel is already registered', async () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-pick',
      queryParams: { key: 'kaizen-book' },
    });
    const deliver = jest.fn().mockResolvedValue(undefined);
    registerE2EUploadDeliver(deliver);

    expect(tryQueueE2EDocumentPickFromUrl('kaizen://e2e-pick?key=kaizen-book')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(hasPendingE2EDocumentPick()).toBe(false);
  });

  it('rejects unknown keys and non-pick URLs', () => {
    (Linking.parse as jest.Mock).mockReturnValue({
      hostname: 'e2e-pick',
      queryParams: { key: 'missing' },
    });
    expect(tryQueueE2EDocumentPickFromUrl('kaizen://e2e-pick?key=missing')).toBe(false);
    (Linking.parse as jest.Mock).mockReturnValue({ hostname: 'today' });
    expect(tryQueueE2EDocumentPickFromUrl('kaizen://today')).toBe(false);
    expect(tryQueueE2EDocumentPickFromUrl(null)).toBe(false);
  });
});
