import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**/*", "dist/**/*", ".svelte-kit/**/*", "tests/**/*"],
    environment: "node",
    reporters: [["default", { summary: false }]],
  },
});
