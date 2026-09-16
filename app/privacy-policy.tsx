/**
 * `/privacy-policy` — the Privacy Policy, as a root route. Same reasoning as
 * `app/terms-of-service.tsx`: full Budget reaches it from Profile, which is a
 * sibling tab of the one hosting the Settings stack it also lives in.
 */
import { PrivacyPolicyScreen } from '@screens/settings/PrivacyPolicyScreen';

export default function PrivacyPolicyRoute() {
  return <PrivacyPolicyScreen />;
}
