import { getAIDisclosureAck, setAIDisclosureAck } from '../aiDisclosure';

describe('AI disclosure persistence', () => {
  afterEach(() => setAIDisclosureAck(false));

  it('stores and clears acknowledgement through MMKV storage', () => {
    expect(getAIDisclosureAck()).toBe(false);

    setAIDisclosureAck(true);
    expect(getAIDisclosureAck()).toBe(true);

    setAIDisclosureAck(false);
    expect(getAIDisclosureAck()).toBe(false);
  });
});
