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
