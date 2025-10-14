import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/nostr-git/packages/ui/tests/Repo.spec.ts',
    ],
  },
  resolve: {
    alias: {
      '$lib/stores/context': 'packages/nostr-git/packages/ui/tests/stubs/context.ts',
      '$lib/stores/tokens': 'packages/nostr-git/packages/ui/tests/stubs/tokens.ts',
      '$lib/stores/toast': 'packages/nostr-git/packages/ui/tests/stubs/toast.ts',
    }
  }
})
