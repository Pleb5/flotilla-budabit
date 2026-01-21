import {config} from "dotenv"
import {defineConfig} from "vite"
import {SvelteKitPWA} from "@vite-pwa/sveltekit"
import {sveltekit} from "@sveltejs/kit/vite"
import svg from "@poppanator/sveltekit-svg"

config({path: ".env"})
config({path: ".env.template"})

export default defineConfig({
  server: {
    port: 1847,
    fs: {
      allow: ['.', '../packages', '../../node_modules'],
    },
    // host: "0.0.0.0",
    // strictPort: true,
    // allowedHosts: ["coracle-client.ngrok.io"],
    // hmr: {
    //   protocol: "wss",
    //   host: "coracle-client.ngrok.io",
    //   clientPort: 443,
    // },
    // cors: true,
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
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/theme-one-dark",
      "@nostr-git/core",
    ],
  },
  ssr: {
    noExternal: ["@nostr-git/core", "@nostr-git/ui"],
  },
  resolve: {
    conditions: ["import", "module", "browser", "default"],
  },

  assetsInclude: ['**/*.wasm', '**/*.worker.js', '**/*.worker.ts'],
  
  worker: {
    format: "es", // avoid 'iife' so code-splitting is allowed
    rollupOptions: {
      output: { 
        format: "es",
        // Ensure workers from node_modules are properly handled
        entryFileNames: '_app/[name].js',
      },
    },
  },

  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 ** 2, // 5 MB or set to something else
      },
      manifest: {
        name: process.env.VITE_PLATFORM_NAME,
        short_name: process.env.VITE_PLATFORM_NAME,
        theme_color: process.env.VITE_PLATFORM_ACCENT,
        description: process.env.VITE_PLATFORM_DESCRIPTION,
        // @ts-ignore
        permissions: ["clipboardRead", "clipboardWrite", "unlimitedStorage"],
        icons: [
          {src: "pwa-64x64.png", sizes: "64x64", type: "image/png"},
          {src: "pwa-192x192.png", sizes: "192x192", type: "image/png"},
          {src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any"},
          {
            src: "maskable-icon-512x512.png",
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
        plugins: [
          "preset-default",
          "removeViewBox",
          "removeDimensions",
        ],
      },
    }),
  ],
})
