import adapter from "@sveltejs/adapter-static"
import {vitePreprocess} from "@sveltejs/vite-plugin-svelte"

const buildVersion = process.env.VITE_BUILD_ID || process.env.VITE_BUILD_HASH || "dev"

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    alias: {
      "@src": "src",
      "@app": "src/app",
      "@lib": "src/lib",
      "@assets": "src/assets",
    },
    version: {
      name: buildVersion,
    },
    csp: {
      directives: {
        "worker-src": ["self", "blob:"],
        "style-src": ["self", "unsafe-inline"],
        "frame-src": [
          "self",
          "http://localhost:*",
          "http://127.0.0.1:*",
          "https://localhost:*",
          "https:",
        ],
        "child-src": ["self", "blob:"],
        "form-action": ["none"],
      },
    },
  },
  compilerOptions: {
    warningFilter: warning => {
      return !["a11y_media_has_caption"].includes(warning.code)
    },
  },
}
