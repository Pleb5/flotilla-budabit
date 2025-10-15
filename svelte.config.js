import adapter from "@sveltejs/adapter-static"
import {vitePreprocess} from "@sveltejs/vite-plugin-svelte"

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
    csp: {
      directives: {
        "worker-src": ["self", "blob:"],
        "style-src": ["self", "unsafe-inline"],
        "frame-src": ["none"],
        "child-src": ["none"],
        "form-action": ["none"],
      },
    },
  },
  compilerOptions: {
    warningFilter: (warning) => {
      return !['a11y_media_has_caption'].includes(warning.code)
    },
  }
}
