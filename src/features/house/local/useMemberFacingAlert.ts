/**
 * The one way a House screen tells a member something did not happen.
 *
 * ## What this replaces
 *
 * Every P4 refusal used to end the conversation. "Scanning a bill for you is
 * off in private mode" is true, it is well written, and it leaves the member
 * with a single OK button and nothing to do — so the feature reads as broken
 * rather than as unconfigured. It is not unconfigured by accident either: most
 * of those features need a model, Symply will not run one over the member's
 * home data, and the member *can* supply their own provider. Nothing on screen
 * said so.
 *
 * So a refusal that a key would lift is now a question with two answers:
 *
 *  - **Add AI provider** — straight to `/ai-access`, where the key is entered.
 *  - **Maybe later** — closes, exactly as before.
 *
 * ## Why the flag rather than the method name
 *
 * The offer is only made where it is true. `needsAiProvider` is set per entry
 * in `unsupportedCopy.ts` and rides through `HouseLocalUnsupportedError` and
 * `toMemberFacingError` untouched — screens never inspect a method name to
 * decide. The refusals a key does NOT lift (the encrypted file channel, the
 * contractor marketplace, the retired satellite tracing, the join table with no
 * row key on any backend) keep their single button, because a member who taps
 * "Add AI provider", pays a provider and comes back to the same wall has been
 * misled by us.
 *
 * ## Not only for local-first
 *
 * A genuine failure — a 500, a dropped connection — comes through here too and
 * gets the plain one-button alert it always had. The hook is the single call
 * site for both so that a screen cannot accidentally keep one path and lose the
 * other.
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert } from 'react-native';

import { toMemberFacingError } from './memberFacingError';

/** Where a member connects their own provider key. */
export const AI_ACCESS_ROUTE = '/ai-access';

/**
 * Show one error.
 *
 * `fallback` is the screen's own sentence for a failure that carried no copy of
 * its own — kept, so a screen that already said something sensible about a real
 * outage does not lose it.
 */
export type ShowMemberFacingError = (err: unknown, fallback: string) => void;

export function useMemberFacingAlert(): ShowMemberFacingError {
  const router = useRouter();

  return useCallback(
    (err: unknown, fallback: string) => {
      const { title, message, needsAiProvider } = toMemberFacingError(
        err,
        fallback,
      );

      if (!needsAiProvider) {
        Alert.alert(title, message);
        return;
      }

      Alert.alert(title, message, [
        // Cancel first so iOS pins it left and leaves the offer as the
        // emphasised button — the member came here wanting the feature.
        { text: 'Maybe later', style: 'cancel' },
        {
          text: 'Add AI provider',
          onPress: () => router.push(AI_ACCESS_ROUTE),
        },
      ]);
    },
    [router],
  );
}
