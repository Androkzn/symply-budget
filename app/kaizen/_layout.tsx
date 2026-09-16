import { Stack } from 'expo-router';

/** Stack host for Symply Life (brand `symply-kaizen`) pushed screens. Screens render their
 * own headers via the ported KaizenScreen wrapper, so the native header stays hidden. */
export default function KaizenStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
