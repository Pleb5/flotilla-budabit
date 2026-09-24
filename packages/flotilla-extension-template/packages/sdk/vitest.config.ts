import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    environmentMatchGlobs: [
      // Bridge and worker tests need DOM APIs (postMessage, addEventListener)
      ['src/bridge.test.ts', 'jsdom'],
      ['src/worker/**/*.test.ts', 'jsdom'],
    ],
  },
});
