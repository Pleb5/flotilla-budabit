# NIP-34 Alignment Plan (incl. NIP-22, NIP-32)

This plan proposes concrete edits to align Budabit/Flotilla with the published article. It assumes all network I/O happens via injected closures in core services.

## Guiding Principles

- TypeScript-first; keep semicolons; follow existing convs.
- Shared logic in `@nostr-git/shared-types` and `@nostr-git/core`.
- All I/O via injected closures: `io: { fetchEvents; publishEvent; }`.
- Canonical repo key is `npub/name` (fallback `npub`). Deprecate any usage of 30617.id as key.

## Modules and Changes

### Shared Types/Utilities

- `@nostr-git/shared-types/src/nip32.ts` (DONE)
  - `extractSelfLabels(evt)`, `extractLabelEvents(events)`, `mergeEffectiveLabels({ self, external, t })`.
  - Provides normalized views (e.g., `status/open`, `type/bug`).
- `@nostr-git/shared-types/src/nip34.ts`
  - Already includes kinds & tag types. No breaking changes now.

### Core Services (All IO Injected)

- `@nostr-git/core/src/lib/repositories.ts` (NEW)
  - `groupByEuc(repos: RepoAnnouncementEvent[])`.
  - `deriveMaintainers(group)`: union from trusted 30617 in group.
  - `loadRepositories(io)` to fetch and group, returning grouped view keyed by `r:euc`.

- `@nostr-git/core/src/lib/repoState.ts` (DONE)
  - `mergeRepoStateByMaintainers({ states, maintainers })` per-ref by recency, bound to maintainers.

- `@nostr-git/core/src/lib/patchGraph.ts` (DONE)
  - `buildPatchGraph({ patches })` using NIP-10 edges; revision folding rules.

- `@nostr-git/core/src/lib/issues.ts` (DONE)
  - `assembleIssueThread({ root, comments, statuses })` NIP-22 scoped tags.

- `@nostr-git/core/src/lib/status-resolver.ts` (DONE)
  - `resolveStatus({ statuses, rootAuthor, maintainers })` precedence and revision rules.

- `@nostr-git/core/src/lib/labels.ts` (DONE)
  - `effectiveLabelsFor(target, { self, external, t })` wraps shared-types helpers.

- `@nostr-git/core/src/lib/repoKeys.ts` (NEW)
  - `canonicalRepoKey({ pubkey, name })` -> `npub/name` or fallback `npub`.
  - `mapLegacyRepoKey(oldKey)` -> new, with `console.warn` deprecation when encountered.

- `@nostr-git/core/src/lib/subscriptions.ts` (DONE)
  - `buildRepoSubscriptions({ a, rootId, euc })` returns redundant filters by `a`, `e`, and `r:euc` with dedupe guidance.

### Data Migrations

- Introduce `repoKeys.ts` helpers and gradually replace any usage of 30617.id in FS/caches.
- Log deprecation warnings when old-style keys are observed; provide mapping helpers.

### Tests to Add (Focused)

- `euc-grouping.spec.ts`: grouping and maintainer union.
- `repo-state-merge.spec.ts`: maintainer-bounded per-ref merge. (DONE)
- `patch-dag.spec.ts`: DAG build, revision folding.
- `nip22-threading.spec.ts`: scoped tags, threading, dedupe.
- `status-precedence.spec.ts`: precedence & revision rule.
- `labels-merge.spec.ts`: merge order and normalization. (DONE in shared-types as `tests/nip32.spec.ts`)
- `repo-keys.spec.ts`: canonical generation, legacy warnings.

## I/O Adapters

- All core services accept `io: { fetchEvents; publishEvent; }` injected from Flotilla app, so no direct pools are created in leaf modules.

## Risk & Rollback

- Changes are additive (stubs + utilities). No public API is broken.
- New helpers are opt-in; UI can switch gradually.
- Rollback by not adopting new helpers if issues arise.

## Phased Checklist

- Phase 1: Correctness
  - Add new modules (stubs) and tests (may fail initially).
  - Wire `canonicalRepoKey` where convenient; add deprecation warnings.
- Phase 2: UX
  - Integrate effective labels and status resolver into UI listings.
  - Show grouped repos by `r:euc`; fold duplicate facets.
- Phase 3: Performance
  - Add caching to repo state merge; optimize redundant subscriptions.

