---
trigger: always_on
---

When being asked to fix a feature or a bug, make sure to run `pnpm build` in the diretory of any changed submodules (e.g. `flotilla-extensions/flotilla/packages/nostr-git-ui`) to ensure that the changes are reflected in the web app.

To preview the changes in the web app, run `pnpm run dev` in the root directory of the project (e.g. `flotilla-extensions/flotilla`).

Then you can test the changes using the playwright mcp tools. Use the IP address and not the localhost address.

If you need login in to budabit, you can use the existing dev login shortcut in LogInBunker.svelte, guarded by import.meta.env.DEV and triggered by entering the bunker token "reviewkey", which now seeds a deterministic NIP-01 secret for a consistent identity
