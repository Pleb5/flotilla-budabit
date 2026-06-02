# Nostr-Git
 
Nostr-Git is a TypeScript library that bridges **Git** with **Nostr**.
It provides helpers to:
 
- Create and parse Git-related Nostr events (NIP-34, plus related NIPs used by the project)
- Perform Git operations (via `isomorphic-git`) with vendor/provider abstractions
- Publish and consume repo announcements, repo state, patches, issues, and status updates
- Run Git operations in a **Web Worker** (Comlink) for browser-friendly usage
 
This repository builds and publishes a **single-package npm distribution**:
 
- Package name: `@nostr-git/core`
 
The public API is exposed via top-level exports and subpath exports (see `package.json` and `src/index.ts`).
 
## Install
 
```bash
pnpm add @nostr-git/core
# or
npm i @nostr-git/core
```
 
## Quick start (library)
 
The root barrel exports namespaced modules:
 
```ts
import * as ngit from "@nostr-git/core"
 
// Example: initialize provider plumbing for Git + Nostr
const git = ngit.api.getGitProvider()
```
 
Convenience exports are also available:
 
```ts
import { getGitProvider, initializeNostrGitProvider } from "@nostr-git/core"
```
 
## Event tag access (required)
 
Always use the canonical tag helpers when reading event tags.
Do **not** use `event.tags.find` / `event.tags.filter` directly.
 
```ts
// Option A: import helpers from the `events` subpath
import { getTag, getTags, getTagValue } from "@nostr-git/core/events"
 
// Option B: use the namespaced root export
// import * as ngit from "@nostr-git/core"
// const { getTag, getTags, getTagValue } = ngit.events
 
const committer = getTag(event, "committer")
const clones = getTags(announcement, "clone")
const repoUrl = getTagValue(announcement, "r")
```
 
## Worker usage (browser)
 
Nostr-Git ships a worker bundle export and a Comlink client.
 
```ts
import { getGitWorker, configureWorkerEventIO } from "@nostr-git/core"
import type { EventIO } from "@nostr-git/core"
 
const eventIO: EventIO = {
  fetchEvents: async () => [],
  publishEvent: async (event) => ({ ok: true, relays: [] }),
  publishEvents: async (events) => Promise.all(events.map((e) => eventIO.publishEvent(e))),
  getCurrentPubkey: () => "f".repeat(64),
}
 
const { api, worker } = getGitWorker((evt) => {
  console.log("[worker-progress]", (evt as MessageEvent).data ?? evt)
})
 
await configureWorkerEventIO(api, eventIO)
// ... call worker API methods
worker.terminate()
```
 
See `examples/worker-usage.ts` for a fuller example.
 
## Runtime validation (feature-flagged)
 
Optional Zod-backed event validation can be toggled via `NOSTR_GIT_VALIDATE_EVENTS`.
 
- Default behavior: enabled when `NODE_ENV != "production"`, disabled in production.
- Truthy values: `true`, `1`, `yes`
- Falsy values: `false`, `0`, `no`
 
## Development
 
### Prerequisites
 
- Node.js 18+
- pnpm (this repo pins `pnpm@10.12.4` in `package.json`)
 
### Common commands
 
```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm dev
```
 
For watch mode (tsc + worker bundle), see `pnpm watch` and `scripts/dev.mjs`.
 
## Documentation
 
- [API](API.md)
- [Development Guide](DEVELOPMENT.md)
- [Architecture](ARCHITECTURE.md)
- [Deployment](DEPLOYMENT.md)
- [Subscription Cookbook](docs/subscription-cookbook.md)
 
## License
 
See [LICENSE](LICENSE).
