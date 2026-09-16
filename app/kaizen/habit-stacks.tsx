import { Redirect } from 'expo-router';

import { isKaizenBrand } from '@features/kaizen';
import { HabitStackScreen } from '@features/kaizen/screens/HabitStackScreen';

export default function Kaizen_HabitStackScreen_Route() {
  if (!isKaizenBrand()) {
    return <Redirect href="/" />;
  }
  return <HabitStackScreen />;
}
