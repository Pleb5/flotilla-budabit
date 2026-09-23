---
trigger: always_on
---

Core and UI are in-tree workspace packages, not submodules. Use `pnpm dev` from
the Budabit root to rebuild and watch them together with the app. For a one-off
library build, run `pnpm --filter @nostr-git/core --filter @nostr-git/ui run build`.

To preview changes, use that full development stack from the repository root.

Then you can test the changes using the playwright mcp tools. Use the IP address and not the localhost address.

If you need login in to budabit, you can use the existing dev login shortcut in LogInBunker.svelte, guarded by import.meta.env.DEV and triggered by entering the bunker token "reviewkey", which now seeds a deterministic NIP-01 secret for a consistent identity
