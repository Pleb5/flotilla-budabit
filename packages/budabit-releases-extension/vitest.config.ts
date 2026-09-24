import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      // Unit instrumentation covers domain TS. Svelte flows are tested in Chromium,
      // not counted as zero-coverage CSS/template lines by Vitest's non-Svelte transform.
      include: ['packages/iframe-app/src/lib/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/test-utils/**',
        '**/*.config.ts',
        '**/types.ts',
        '**/test-fixtures.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 85,
        statements: 95,
      },
    },
  },
});
