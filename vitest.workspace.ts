import path from "path"
import {fileURLToPath} from "url"
import {defineWorkspace} from "vitest/config"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineWorkspace([
  // Main app tests
  {
    resolve: {
      alias: {
        "@app": path.resolve(__dirname, "src/app"),
        "@lib": path.resolve(__dirname, "src/lib"),
        "$app/environment": path.resolve(__dirname, "src/app/core/__mocks__/$app-environment.ts"),
        "$app/navigation": path.resolve(__dirname, "src/app/core/__mocks__/$app-navigation.ts"),
        "$app/stores": path.resolve(__dirname, "src/app/core/__mocks__/$app-stores.ts"),
      },
    },
    test: {
      name: "main",
      include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
      exclude: [
        "**/node_modules/**",
        "**/packages/**",
        "**/e2e/**",
        "tests/e2e/**",
      ],
    },
  },
  // Extension package tests
  {
    extends: './packages/budabit-kanban-extension/vitest.config.ts',
    test: {
      include: ['packages/budabit-kanban-extension/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**', 'tests/**'],
      name: 'budabit-kanban-extension',
    },
  },
  {
    extends: './packages/flotilla-extension-template/vitest.config.ts',
    test: {
      include: ['packages/flotilla-extension-template/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**', 'tests/**'],
      name: 'flotilla-extension-template',
    },
  },
  // Other packages
  {
    test: {
      include: ['packages/nostr-git-core/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**', 'tests/**'],
      name: 'nostr-git-core',
    },
  },
  {
    test: {
      include: ['packages/nostr-git-ui/**/*.{test,spec}.ts'],
      exclude: ['**/e2e/**', '**/node_modules/**', 'tests/**'],
      name: 'nostr-git-ui',
    },
  },
]);
