// ESLint v9 flat config for the Cloudflare Workers backend.
//
// Mirrors the mobile app's `.eslintrc.js` intent (typescript-eslint recommended
// + `_`-prefixed unused args allowed), adapted to flat config. Type-aware rules
// are intentionally NOT enabled here — `npm run typecheck` (tsc, strict, with
// noUnusedLocals/noUnusedParameters) is the source of truth for type-level
// issues, so this stays a fast, syntactic lint over `src`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Not linted: build output and generated ambient types.
    ignores: ['dist/**', 'node_modules/**', 'worker-configuration.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // `any` is used deliberately for dynamic AI-provider responses and
      // loosely-typed external payloads; strict tsc still guards real type
      // safety. Kept as a warning so new usages stay visible for cleanup.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Track A / A0 — Clean Architecture import boundaries (error when clean; warn while violators remain).
  {
    files: ['src/services/**/*.ts'],
    ignores: ['src/services/**/__tests__/**', 'src/services/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/middleware/**', '../middleware/**', '../../middleware/**'],
              message:
                'Services must not import middleware. Use neutral utils/errors.ts (A1 / CA-6).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/routes/**/*.ts'],
    ignores: ['src/routes/**/__tests__/**', 'src/routes/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='drizzle']",
          message:
            'Routes must not call drizzle() directly. Delegate to a service or repository (A4 / CA-4).',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/ai/**', 'src/**/__tests__/**', 'src/**/*.test.ts', 'src/scripts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message: 'Route AI SDK usage through backend/src/ai/** only (A1 / CA-2).',
            },
            {
              name: '@google/generative-ai',
              message: 'Route Google AI SDK usage through backend/src/ai/** only (A1 / CA-2).',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name=/^(Claude|Gemini|OpenAI)Provider$/]",
          message:
            'Construct AI providers via createProviderAdapter() in ai/provider-factory.ts (A1 / CA-2).',
        },
      ],
    },
  },
);
