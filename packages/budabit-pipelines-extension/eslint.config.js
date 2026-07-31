import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template literals are fine.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // The bridge/SDK code intentionally does defensive runtime checks and
      // interops with untyped host/worker payloads. Keep these as warnings so
      // they inform without failing `pnpm lint` in freshly scaffolded projects.
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-confusing-void-expression': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-deprecated': 'warn',
      // The host bridge's untyped action responses (repo:listWorkflows,
      // cashu:*, nostr:sign, etc.) are handled as `any` throughout this
      // extension's domain code — same interop rationale as the unsafe-*
      // downgrades above.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      // Leading-underscore args are an intentional unused-param convention
      // (e.g. options params kept for future/API-shape parity).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: [
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/node_modules/',
      '**/*.config.js',
      '**/*.config.ts',
      '**/playwright-report/',
      '**/test-results/',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
  }
);
