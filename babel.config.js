module.exports = function (api) {
  api.cache(true);
  const isJest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID != null;
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Enable Hermes parser for Flow syntax (match expressions) in RN 0.81+.
      // Omit in Jest — conflicts with Babel’s parser override (“More than one plugin attempted to override parsing”).
      ...(isJest ? [] : ['babel-plugin-syntax-hermes-parser']),
      [
        'module-resolver',
        {
          root: ['./src'],
          extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
          alias: {
            '@symply/contracts': './packages/contracts/src',
            '@symply/local-first': './packages/local-first/src',
            '@': './src',
            '@api': './src/api',
            '@assets': './src/assets',
            '@brand': './src/brand',
            '@components': './src/components',
            '@config': './src/config',
            '@constants': './src/constants',
            '@contexts': './src/contexts',
            '@features': './src/features',
            '@hooks': './src/hooks',
            '@navigation': './src/navigation',
            '@screens': './src/screens',
            '@services': './src/services',
            '@stores': './src/stores',
            '@theme': './src/theme',
            '@types': './src/types',
            '@utils': './src/utils',
            '@shared-user': './src/shared-user',
            '@smart-engine': './src/smart-engine',
          },
        },
      ],
      // Note: react-native-reanimated/plugin is handled automatically by babel-preset-expo in SDK 54+
    ],
  };
};
