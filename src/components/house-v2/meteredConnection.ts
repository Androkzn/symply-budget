/**
 * "Is this connection one the member pays for by the megabyte?"
 *
 * The H6 fetch policy (plan §8) is *lazy on first view, with an explicit
 * download affordance on cellular*. Attachments are photos: auto-fetching a
 * screenful of them on a metered connection is a real cost to a real person, and
 * unlike a thumbnail from a CDN there is no small version to fetch instead — the
 * blob is sealed whole.
 *
 * Failure is biased toward *not* auto-downloading being wrong rather than
 * downloading being wrong… except when NetInfo itself fails. There, "not
 * metered" is the safer default: a permanently broken probe would otherwise
 * turn every image in the app into a manual tap forever.
 */
import NetInfo from '@react-native-community/netinfo';

export async function isMeteredConnection(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    if (state?.type === 'cellular') return true;
    // iOS reports "Low Data Mode" / personal hotspots through this flag even
    // when `type` reads `wifi`, so it catches the tethering case cellular alone
    // would miss.
    const details = state?.details as { isConnectionExpensive?: boolean } | null | undefined;
    return details?.isConnectionExpensive === true;
  } catch {
    return false;
  }
}
