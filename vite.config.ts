import {config} from "dotenv"
import path from "path"
import {fileURLToPath} from "url"
import {defineConfig} from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import {sveltekit} from "@sveltejs/kit/vite"
import svg from "@poppanator/sveltekit-svg"

config({path: ".env"})
config({path: ".env.template"})

export default defineConfig({
  server: {
    port: 1847,
    fs: {
      allow: [".", path.resolve(__dirname, "../")],
    },
  },
  build: {
    sourcemap: true,
  },
  define: {
    __PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
    __DEVELOPMENT__: JSON.stringify(process.env.NODE_ENV !== "production"),
    __GRASP__: JSON.stringify(process.env.FEATURE_GRASP !== "0"),
    __NIP34_PR__: JSON.stringify(process.env.FEATURE_NIP34_PR === "1"),
    __CICD__: JSON.stringify(process.env.FEATURE_CICD === "1"),
    __TERMINAL__: JSON.stringify(process.env.FEATURE_TERMINAL !== "0"),
    __STRICT_NIP29__: JSON.stringify(process.env.FEATURE_STRICT_NIP29 === "1"),
  },
  optimizeDeps: {
    include: ["@codemirror/state", "@codemirror/view"],
    exclude: [
      "svelte-codemirror-editor",
      "codemirror",
      "@codemirror/lang-javascript",
      "@codemirror/lang-python",
      "@codemirror/lang-json",
      "@codemirror/lang-css",
      "@codemirror/lang-html",
      "@codemirror/lang-xml",
      "@codemirror/lang-markdown",
      "@codemirror/lang-sql",
      "@codemirror/theme-one-dark",
      "@nostr-git/core",
      "@nostr-git/ui",
    ],
  },
  ssr: {
    noExternal: ["@nostr-git/core", "@nostr-git/ui"],
  },
  resolve: {
    conditions: ["import", "module", "browser", "default"],
    alias: {
      "@src": path.resolve(__dirname, "src"),
      "@app": path.resolve(__dirname, "src/app"),
      "@lib": path.resolve(__dirname, "src/lib"),
      "@assets": path.resolve(__dirname, "src/assets"),
    },
  },

  assetsInclude: ["**/*.wasm", "**/*.worker.js", "**/*.worker.ts"],

  worker: {
    format: "es", // avoid 'iife' so code-splitting is allowed
    rollupOptions: {
      output: {
        format: "es",
        // Ensure workers from node_modules are properly handled
        entryFileNames: "_app/[name].js",
      },
    },
  },

  plugins: [
    sveltekit(),
    svg({
      svgoOptions: {
        multipass: true,
        plugins: ["preset-default", "removeViewBox", "removeDimensions"],
      },
    }),
  ],
})
