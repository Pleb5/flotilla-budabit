import path from "node:path"
import {fileURLToPath} from "node:url"
import {defineConfig} from "vitest/config"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  test: {
    include: ["test/**/*.{test,spec}.ts"],
    environment: "node",
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        statements: 59,
        branches: 53,
        lines: 59,
        functions: 53,
      },
    },
  },
})
