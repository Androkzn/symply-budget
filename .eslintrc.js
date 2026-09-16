module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
  },
  settings: {
    'import/resolver': {
      'babel-module': {},
    },
  },
  overrides: [
    {
      // Centralized design-token enforcement: screens must not hardcode colors
      // or font metrics. Route all color through `useAppColors()` / theme tokens
      // and all type through the `<Typography>` component or `scaledFont()`, so a
      // change in `designTokens.ts` / `appColors.ts` applies app-wide.
      // TODO: flip hex/fontSize from 'warn' to 'error' once the screen sweep is done.
      files: ['src/screens/**/*.tsx', 'src/screens/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "MemberExpression[object.name='theme'][property.name='colors']",
            message:
              'Do not read theme.colors in screens. Use useAppColors() from @theme (Track A / A7).',
          },
        ],
      },
    },
    {
      files: ['src/screens/**/*.tsx', 'src/screens/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector:
              "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
            message:
              'Do not hardcode hex colors in screens. Use a token from useAppColors() (see appColors.ts).',
          },
          {
            selector: "Property[key.name='fontSize'][value.type='Literal']",
            message:
              'Do not hardcode fontSize in screens. Use a <Typography> variant or scaledFont() from the design tokens.',
          },
        ],
      },
    },
    {
      // Track A / A0 — API layer must stay free of navigation side effects (CA-3 / A5).
      files: ['src/api/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@react-navigation/*',
                  'expo-router',
                  '@services/aiAccessNavigation',
                  '**/aiAccessNavigation',
                ],
                message:
                  'API layer must not import navigation. Throw typed errors; navigate in UI (A5).',
              },
            ],
          },
        ],
      },
    },
    {
      // Track A / A0 — route analytics + error reporting through wrapper modules.
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      excludedFiles: [
        'src/services/analytics.ts',
        'src/services/monitoring.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@sentry/react-native',
                message:
                  'Import Sentry via src/services/monitoring.ts only (A0).',
              },
              {
                name: 'posthog-react-native',
                message:
                  'Import PostHog via src/services/analytics.ts only (A0).',
              },
            ],
            patterns: [
              {
                group: ['@sentry/*'],
                message:
                  'Import Sentry via src/services/monitoring.ts only (A0).',
              },
            ],
          },
        ],
      },
    },
    {
      // Brand packs own hex literals. Components may only use theme/brand tokens.
      // Exclude generated token files (they re-export brand hex by design).
      files: ['src/components/**/*.tsx', 'src/components/**/*.ts'],
      excludedFiles: [
        '**/*.generated.ts',
        '**/*.generated.tsx',
        '**/tokens.generated.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector:
              "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
            message:
              'Do not hardcode hex colors in components. Use useAppColors() / theme tokens or brand colors.',
          },
        ],
      },
    },
  ],
};
