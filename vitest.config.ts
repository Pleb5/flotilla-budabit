import path from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig} from "vitest/config"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const rootAliases = {
  "@src": path.resolve(__dirname, "src"),
  "@app": path.resolve(__dirname, "src/app"),
  "@lib": path.resolve(__dirname, "src/lib"),
  "@assets": path.resolve(__dirname, "src/assets"),
  "$app/environment": path.resolve(__dirname, "src/app/core/__mocks__/$app-environment.ts"),
  "$app/navigation": path.resolve(__dirname, "src/app/core/__mocks__/$app-navigation.ts"),
  "$app/stores": path.resolve(__dirname, "src/app/core/__mocks__/$app-stores.ts"),
}

export default defineConfig({
  resolve: {
    alias: rootAliases,
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.*",
        "**/node_modules/**",
        "**/tests/**",
        "**/*.{test,spec}.{ts,tsx}",
      ],
      thresholds: {
        lines: 20,
        functions: 20,
        branches: 20,
        statements: 20,
      },
    },
    projects: [
      {
        resolve: {
          alias: rootAliases,
        },
        test: {
          name: "main",
          include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
          exclude: ["**/node_modules/**", "**/packages/**", "**/e2e/**", "tests/e2e/**"],
        },
      },
      {
        extends: "./packages/nostr-git-core/vitest.config.ts",
        root: path.resolve(__dirname, "packages/nostr-git-core"),
        test: {
          name: "nostr-git-core",
          include: ["test/**/*.{test,spec}.ts"],
        },
      },
      {
        extends: "./packages/nostr-git-ui/vitest.config.ts",
        root: path.resolve(__dirname, "packages/nostr-git-ui"),
        test: {
          name: "nostr-git-ui",
          include: ["src/**/*.{test,spec}.ts"],
        },
      },
      {
        extends: "./packages/budabit-kanban-extension/vitest.config.ts",
        root: path.resolve(__dirname, "packages/budabit-kanban-extension"),
        test: {
          name: "budabit-kanban-extension",
          include: ["packages/shared/src/**/*.{test,spec}.ts"],
        },
      },
      {
        extends: "./packages/flotilla-extension-template/vitest.config.ts",
        root: path.resolve(__dirname, "packages/flotilla-extension-template"),
        test: {
          name: "flotilla-extension-template",
          include: ["packages/shared/src/**/*.{test,spec}.ts"],
        },
      },
    ],
  },
})
