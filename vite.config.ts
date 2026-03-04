import {config} from "dotenv"
import path from "path"
import {fileURLToPath} from "url"
import {defineConfig} from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import {SvelteKitPWA} from "@vite-pwa/sveltekit"
import {sveltekit} from "@sveltejs/kit/vite"
import svg from "@poppanator/sveltekit-svg"

config({path: ".env"})
config({path: ".env.template"})

const platformName = process.env.VITE_PLATFORM_NAME || "Budabit"
const platformDescription =
  process.env.VITE_PLATFORM_DESCRIPTION || "Decentralized Git collaboration on Nostr"
const platformAccent = process.env.VITE_PLATFORM_ACCENT || "#8B5CF6"

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
    SvelteKitPWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: platformName,
        short_name: platformName,
        theme_color: platformAccent,
        background_color: "#ffffff",
        description: platformDescription,
        start_url: "/",
        scope: "/",
        id: "/",
        display: "standalone",
        icons: [
          {src: "/pwa-64x64.png", sizes: "64x64", type: "image/png"},
          {src: "/pwa-192x192.png", sizes: "192x192", type: "image/png"},
          {src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any"},
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    svg({
      svgoOptions: {
        multipass: true,
        plugins: ["preset-default", "removeViewBox", "removeDimensions"],
      },
    }),
  ],
})
