import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  // Main app tests
  {
    test: {
      include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
      exclude: [
        '**/node_modules/**',
        '**/packages/**',
        '**/e2e/**',
        'tests/e2e/**',
      ],
    },
  },
  // Extension package tests
  {
    extends: './packages/budabit-kanban-extension/vitest.config.ts',
    test: {
      include: ['packages/budabit-kanban-extension/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**'],
      name: 'budabit-kanban-extension',
    },
  },
  {
    extends: './packages/flotilla-extension-template/vitest.config.ts',
    test: {
      include: ['packages/flotilla-extension-template/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**'],
      name: 'flotilla-extension-template',
    },
  },
  // Other packages
  {
    test: {
      include: ['packages/nostr-git-core/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**'],
      name: 'nostr-git-core',
    },
  },
  {
    test: {
      include: ['packages/nostr-git-ui/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**'],
      name: 'nostr-git-ui',
    },
  },
]);
