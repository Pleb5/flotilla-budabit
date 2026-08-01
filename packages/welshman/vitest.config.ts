import {resolve} from "path"
import {defineConfig} from "vitest/config"

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    globals: true,
    server: {
      deps: {
        // @pomade/core imports @welshman/* which resolve to TypeScript source in
        // this repo, so it must be processed by Vite rather than loaded by Node
        inline: [/@pomade\/core/],
      },
    },
  },
  resolve: {
    alias: {
      "@welshman/app": resolve(__dirname, "packages/app/src"),
      "@welshman/content": resolve(__dirname, "packages/content/src"),
      "@welshman/feeds": resolve(__dirname, "packages/feeds/src"),
      "@welshman/lib": resolve(__dirname, "packages/lib/src"),
      "@welshman/net": resolve(__dirname, "packages/net/src"),
      "@welshman/signer": resolve(__dirname, "packages/signer/src"),
      "@welshman/store": resolve(__dirname, "packages/store/src"),
      "@welshman/util": resolve(__dirname, "packages/util/src"),
    },
  },
})
