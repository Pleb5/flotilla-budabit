/// <reference types="node" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import pkg from "./package.json" with { type: "json" };

const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        runes: true,
      },
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(process.cwd(), "src/lib/index.ts"),
      name: "NostrGitUI",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external,
    },
    sourcemap: true,
  },
  resolve: {
    dedupe: ["svelte"],
  },
});
