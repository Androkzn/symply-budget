module.exports = {
  dependencies: {
    'react-native-vector-icons': {
      platforms: {
        ios: null,
      },
    },
    // Removed from Expo SDK 57 — keep disabled if leftover in node_modules.
    'expo-av': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
  assets: ['./node_modules/react-native-vector-icons/Fonts'],
};
