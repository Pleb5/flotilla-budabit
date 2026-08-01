# Welshman fork

This directory is a vendored fork of [coracle-social/welshman](https://github.com/coracle-social/welshman), owned and maintained by the budabit repo. It replaces the former pnpm `patchedDependencies` setup which patched compiled dist output of `@welshman/{app,feeds,net,signer}@0.8.16`.

- Upstream: https://github.com/coracle-social/welshman.git
- Base: tag `0.8.16` (commit `e0d48a9f1f9f455f13666fe0d15fa632ffad5cb1`)
- Imported via `git subtree` with `--squash` under the prefix `packages/welshman`
- Git remote (add if missing): `welshman-upstream` -> upstream URL above

## How budabit consumes these packages

All `@welshman/*` packages are pnpm workspace packages with **source entries**:
`main`/`types` point at `src/index.ts` (no build step). Vite, vitest, and
svelte-check consume the TypeScript directly. The root budabit `package.json`
depends on them via `workspace:*`.

## Intentional divergences from upstream 0.8.16

Ported from the former dist patches into TypeScript source:

1. **app** (`packages/app/src/session.ts`)
   - `addSession` cleans up the previous session's signer when replaced
   - `getSigner` cache key includes NIP-46 secret/handler identity
   - NIP-46 signer gets `pubkey` assigned from the session
2. **feeds** (`packages/feeds/src/{controller,request}.ts`)
   - `priority` and `owner` options threaded through `FeedController` and `requestPage`
3. **signer** (`packages/signer/src/signers/nip46.ts`)
   - Receiver abort-controller lifecycle fixes
   - Sender: `stopped` state, active-request abort, queue rejection on stop,
     publish acknowledged before resolving
   - Request timeouts (5s for `switch_relays`, 30s otherwise) and listener cleanup
4. **net** (`packages/net/src/{message,policy,request}.ts`)
   - `ClientReqPayload` supports multiple filters per REQ
   - `socketPolicyCloseInactive`: skip reconnect replay when nothing pending;
     cancel queued replay on CLOSE while disconnected
   - `request.ts`: per-relay subscription scheduler (priority classes
     finite/critical-live/background-live, relay policy resolver, filter
     chunking by count/bytes, learned subscription caps from NOTICEs,
     retry-on-"too big", diagnostics snapshots via
     `getRequestSchedulerSnapshots`/`subscribeRequestScheduler`)

Additional mechanical divergences (not behavioral):

- All type imports/exports normalized to `import type`/`export type`
  (via `@typescript-eslint/consistent-type-imports` autofix) because budabit's
  svelte-check runs with `verbatimModuleSyntax`
- Two `as BufferSource` casts (`lib/src/Tools.ts` sha256, `util/src/Blossom.ts`
  decrypt) for TypeScript 5.9's stricter `Uint8Array` generics
- `net/__tests__/request.test.ts`: `onClose` expectation updated to match the
  forked `request()` threshold semantics (fires per successful relay)
- `vitest.config.ts`: `server.deps.inline` for `@pomade/core` so its
  `@welshman/*` imports resolve through Vite (they point at TypeScript source)

Budabit-side consumption contract (outside this directory): any node_modules
package that imports `@welshman/*` (currently `@pomade/core`) must be excluded
from Vite prebundling (`optimizeDeps.exclude` in `vite.config.ts`) and inlined
in vitest (`server.deps.inline`), otherwise it bundles a duplicate copy of
welshman's module-level singletons (`Pool`, `netContext`, session stores).
Corollary: dependencies of such excluded packages that exist at multiple
versions in the tree (currently `zod`: app tree on v3, `@pomade/core` on v4)
must also be excluded from prebundling, because Vite rewrites bare imports of
excluded packages to a prebundled dep *by name*, ignoring the importer's own
node_modules resolution.

Pruned from upstream tree: `docs/`, `.github/`, `.husky/`, `scripts/`,
`renovate.json`, `typedoc.json`, `watch.sh`, `link_deps`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, plus trimmed root `package.json` (no husky/typedoc/
eslint tooling; kept vitest + happy-dom for the test suite).

Package manifests diverge minimally: `main`/`types` (and editor `exports`)
point to `src/` instead of `dist/`.

## Merging upstream

```sh
git remote add welshman-upstream https://github.com/coracle-social/welshman.git  # once
git fetch welshman-upstream --tags
git subtree pull --prefix packages/welshman welshman-upstream <tag-or-branch> --squash
```

Then:

1. Resolve conflicts, keeping the divergences listed above (the net scheduler
   is the largest and most likely to conflict).
2. Re-apply prunes if upstream re-adds pruned paths (deletions may resurrect).
3. Verify: `pnpm test:welshman`, `pnpm check`, `pnpm test:main`, `pnpm build`.
4. Update this file: new base tag/commit, any divergence changes.

## Testing

```sh
pnpm test:welshman   # welshman's own vitest suite (runs against src/ via aliases)
```
