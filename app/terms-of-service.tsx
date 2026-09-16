/**
 * `/terms-of-service` — the Terms, as a root route.
 *
 * It is still a screen in the Settings stack for every brand whose More tab has
 * an ABOUT section. Full Budget reaches it from PROFILE instead: the account
 * documents moved there when More became the overflow-tabs hub, and Profile is
 * a sibling TAB of the one hosting that stack, so it cannot push into it.
 *
 * Registering the same component in both places is the established pattern here
 * (`app/device-sync.tsx`, `app/house-backup.tsx`), and it works because the
 * screen takes no props and only ever calls `goBack()`.
 */
import { TermsOfServiceScreen } from '@screens/settings/TermsOfServiceScreen';

export default function TermsOfServiceRoute() {
  return <TermsOfServiceScreen />;
}
