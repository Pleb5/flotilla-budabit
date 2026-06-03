import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  compilerOptions: {
    runes: true,
    customElement: false,
  },
  preprocess: vitePreprocess(),
  kit: {
    files: {
      lib: "src/lib",
    },
  },
};
