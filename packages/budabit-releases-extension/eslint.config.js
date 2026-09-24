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
      // Bridge code performs defensive checks and interoperates with host payloads.
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
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/test-host/**/*.ts'],
    // Disposable wire-fixture payloads are intentionally raw; production code keeps typed linting.
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
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
