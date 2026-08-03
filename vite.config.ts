import {config} from "dotenv"
import path from "path"
import {fileURLToPath} from "url"
import {defineConfig, type Plugin} from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import {sveltekit} from "@sveltejs/kit/vite"
import svg from "@poppanator/sveltekit-svg"

config({path: ".env"})
config({path: ".env.template"})

const parsePort = (value?: string): number | undefined => {
  if (!value) {
    return
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isNaN(parsed) ? undefined : parsed
}

const devAllowedHosts = process.env.VITE_DEV_ALLOWED_HOSTS?.split(",")
  .map(host => host.trim())
  .filter(Boolean)

const devHmrPort = parsePort(process.env.VITE_DEV_HMR_PORT)
const devHmrClientPort = parsePort(process.env.VITE_DEV_HMR_CLIENT_PORT)
const devHmrHost = process.env.VITE_DEV_HMR_HOST?.trim()
const devHmrPath = process.env.VITE_DEV_HMR_PATH?.trim()
const devHmrProtocol = ["ws", "wss"].includes(process.env.VITE_DEV_HMR_PROTOCOL || "")
  ? process.env.VITE_DEV_HMR_PROTOCOL
  : undefined
const devHmrEnabled = process.env.VITE_DEV_HMR_ENABLED === "1"

const devServiceWorkerCleanup = {
  name: "budabit-dev-service-worker-cleanup",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?", 1)[0] !== "/service-worker.js") {
        next()
        return
      }

      response.setHeader("Content-Type", "application/javascript")
      response.setHeader("Cache-Control", "no-store")
      response.end('importScripts("/sw.js")\n')
    })
  },
} satisfies Plugin

const devHmr =
  devHmrEnabled && (devHmrHost || devHmrPath || devHmrPort || devHmrClientPort || devHmrProtocol)
    ? {
        host: devHmrHost,
        path: devHmrPath,
        port: devHmrPort,
        clientPort: devHmrClientPort,
        protocol: devHmrProtocol,
      }
    : undefined

export default defineConfig({
  server: {
    port: 1847,
    strictPort: true,
    allowedHosts: devAllowedHosts,
    hmr: devHmr,
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
    __CICD__: JSON.stringify(process.env.FEATURE_CICD === "1"),
  },
  optimizeDeps: {
    include: ["@codemirror/state", "@codemirror/view"],
    exclude: [
      "svelte-codemirror-editor",
      "codemirror",
      "@codemirror/lang-javascript",
      "@codemirror/lang-python",
      "@codemirror/lang-json",
      "@codemirror/lang-cpp",
      "@codemirror/lang-css",
      "@codemirror/lang-go",
      "@codemirror/lang-html",
      "@codemirror/lang-java",
      "@codemirror/lang-xml",
      "@codemirror/lang-markdown",
      "@codemirror/lang-rust",
      "@codemirror/lang-sql",
      "@codemirror/lang-vue",
      "@codemirror/lang-yaml",
      "@codemirror/language",
      "@codemirror/legacy-modes",
      "@codemirror/theme-one-dark",
      "@replit/codemirror-lang-svelte",
      "highlight.svelte",
      "@nostr-git/core",
      "@nostr-git/ui",
      // Must not be prebundled: it imports @welshman/* which resolve to linked
      // workspace TypeScript source; prebundling would inline a duplicate copy
      // of welshman's module-level singletons (Pool, netContext, ...)
      "@pomade/core",
      // Two zod majors coexist (app code uses zod@3, @pomade/core needs its
      // nested zod@4). If zod were prebundled, Vite would rewrite every bare
      // "zod" import to the single optimized copy by name, breaking one side.
      // Excluded, each importer node-resolves to its own correct version.
      // Safe: both are pure ESM and no prebundled dep imports zod.
      "zod",
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
    devServiceWorkerCleanup,
    sveltekit(),
    svg({
      svgoOptions: {
        multipass: true,
        plugins: ["preset-default", "removeViewBox", "removeDimensions"],
      },
    }),
  ],
})
