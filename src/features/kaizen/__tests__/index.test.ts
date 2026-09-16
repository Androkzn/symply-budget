import {
  isKaizenBrand,
  KAIZEN_FEATURE_ID,
  KAIZEN_WORDMARK_GRADIENT_DARK,
  KAIZEN_WORDMARK_GRADIENT_LIGHT,
  KaizenTodayScreen,
  KaizenGuideScreen,
  KaizenMoreScreen,
  KaizenCareerScreen,
  KaizenAssessScreen,
  KaizenLearnScreen,
  KaizenSystemsScreen,
} from '../index';
import { CoachChatScreen } from '../screens/CoachChatScreen';
import { SystemsHubScreen } from '../screens/SystemsHubScreen';

describe('kaizen feature barrel', () => {
  it('exposes the stable feature id', () => {
    expect(KAIZEN_FEATURE_ID).toBe('kaizen');
  });

  it('re-exports the branding helpers and wordmark gradients', () => {
    expect(typeof isKaizenBrand).toBe('function');
    expect(Array.isArray(KAIZEN_WORDMARK_GRADIENT_DARK)).toBe(true);
    expect(Array.isArray(KAIZEN_WORDMARK_GRADIENT_LIGHT)).toBe(true);
  });

  it('re-exports the brand-shell screen components', () => {
    for (const Screen of [
      KaizenTodayScreen,
      KaizenGuideScreen,
      KaizenMoreScreen,
      KaizenCareerScreen,
      KaizenAssessScreen,
      KaizenLearnScreen,
      KaizenSystemsScreen,
    ]) {
      expect(Screen).toBeDefined();
    }
  });

  it('re-exports KaizenGuideScreen as the CoachChatScreen Guide tab shell', () => {
    expect(KaizenGuideScreen).toBe(CoachChatScreen);
  });

  it('re-exports KaizenSystemsScreen as the SystemsHub port', () => {
    expect(KaizenSystemsScreen).toBe(SystemsHubScreen);
  });
});
