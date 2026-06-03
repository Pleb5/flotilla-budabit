// Vitest configuration for UI package tests
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, ".."),
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "tests/", "**/*.d.ts", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../src"),
      "@app": resolve(__dirname, "../../../src/app"),
      "@src": resolve(__dirname, "../../../src"),
      "@lib": resolve(__dirname, "../../../src/lib"),
      $lib: resolve(__dirname, "../src/lib"),
    },
  },
});
