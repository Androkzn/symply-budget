import { Redirect } from 'expo-router';
import React from 'react';

import { isHouseBrand } from '@brand';
import { SpacesNavigator } from '@navigation/SpacesNavigator';

export default function SpacesTab() {
  // Spaces (rooms and areas) is a House-only feature; child apps bounce home.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <SpacesNavigator />;
}
