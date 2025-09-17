# NIP-34 Alignment Audit (with NIP-22 and NIP-32)

This audit maps Budabit/Flotilla code to the published article’s claimed behaviors and lists divergences, risks, and test gaps. File paths and symbols are cited inline.

## Scope

- Repo Announcements (kind 30617)
- Repo State (kind 30618)
- Patches (kind 1617)
- Issues (kind 1621) and NIP-22 Comments (kind 1111)
- Status (kinds 1630–1633)
- Labels (kind 1985; NIP-32)
- Subscription strategy and deduping
- Identifier correctness (canonical repo key)

## Codepaths Discovered

- Types and constants
  - `packages/nostr-git/packages/shared-types/src/nip34.ts`
    - Exposes kind constants and tag type shapes for 30617/30618/1617/1621/163x.

- Repo/grouping utilities
  - `packages/nostr-git/packages/core/src/lib/workers/repos.ts` (repo scanning & sync helpers)
  - `packages/nostr-git/packages/core/src/lib/utils/canonicalRepoKey.ts` (canonical repo key impl)

- Patches apply/push (not the Nostr patch graph)
  - `packages/nostr-git/packages/core/src/lib/workers/patches.ts` (apply & push logic)
  - `packages/nostr-git/packages/ui/src/lib/components/git/WorkerManager.ts` (UI API surface)

- NIP-22 utils
  - `packages/nostr-git/packages/shared-types/src/nip22.ts`
  - `packages/nostr-git/packages/shared-types/src/utils-comment.ts`

- Event kinds usages in UI
  - `packages/nostr-git/packages/ui/src/lib/utils/eventKinds.ts`
  - Components like `IssueThread.svelte`, `PatchCard.svelte`

- GRASP provider (Git transport)
  - `packages/nostr-git/packages/core/src/lib/git/providers/grasp.ts`

## Alignment vs Article Claims

### 30617 Repo Announcements

- Article claim:
  - Group forks/mirrors by `r:euc` (primary coloc key). Treat `d` as local handle within group. Union of `web`, `clone`, `maintainers`.
- Current code:
  - Types for 30617 exist (`shared-types/nip34.ts`).
  - Grouping and maintainer derivation logic is scattered across repo utilities; no dedicated `groupByEuc` helper exported.
- Divergences:
  - Missing explicit `groupByEuc(events)` and `isMaintainer()` helpers.
  - Potential reliance in some places on event IDs or local paths before canonicalization.
- Risks:
  - Duplicate repo listings; inconsistent maintainer sets.
- Tests:
  - No focused unit tests for euc grouping.

### 30618 Repo State

- Article claim:
  - Sparse publish; merge per ref by recency; only from recognized maintainers derived from trusted 30617.
 - Current code:
   - Centralized merge policy implemented: `packages/nostr-git/packages/core/src/lib/repoState.ts` → `mergeRepoStateByMaintainers()`.
 - Divergences:
   - Further fixtures desired for complex HEAD/ref projections.
 - Risks:
   - Low (helper is maintainer-bounded; expand fixtures for edge-cases).
 - Tests:
   - Added `packages/nostr-git/packages/core/test/repo-state-merge.spec.ts` covering maintainer-only selection and newest per ref, plus HEAD projection.

### 1617 Patches (graph, revisions)

- Article claim:
  - Rebuild patchsets by walking NIP-10 edges; index by repo `a` and `r:<commit-id>`.
 - Current code:
   - Patch DAG with revision folding implemented: `packages/nostr-git/packages/core/src/lib/patchGraph.ts`.
 - Divergences:
   - Expand indexing usage by repo address `a` and `r:<commit-id>` at integration points.
 - Risks:
   - Medium if integrations skip `a`/`r` indexing; otherwise low.
 - Tests:
   - Added `packages/nostr-git/packages/core/test/patch-graph.spec.ts`.

### 1621 Issues + 1111 NIP-22 Comments

- Article claim:
  - Use scoped reply tags (A/a, E/e, I/i with K/k) for threading; join 1621 + 1111 + 163x.
 - Current code:
   - Implemented assembler using NIP-22 scoped tags: `packages/nostr-git/packages/core/src/lib/issues.ts` → `assembleIssueThread()`.
 - Divergences:
   - Add broader tests (uppercase/lowercase, scoped kinds, duplicate-id elimination).
 - Risks:
   - Low; assembler filters by scope and sorts by created_at.
 - Tests:
   - Partial unit tests exist; expand coverage.

### 163x Status

- Article claim:
  - Most recent status by root author or recognized maintainer is authoritative; revision naming rules.
 - Current code:
   - Precedence resolver implemented: `packages/nostr-git/packages/core/src/lib/status-resolver.ts` → `resolveStatus()`.
   - Helper exported: `issues.ts` → `resolveIssueStatus()`.
   - UI wired: `src/app/components/GitIssueItem.svelte` and issue `+page.svelte`, with reason tooltip.
 - Divergences:
   - Add more edge-case tests (revision naming rules if used).
 - Risks:
   - Low; visual verification available via tooltips.
 - Tests:
   - `packages/nostr-git/packages/core/test/status-resolver.spec.ts`.

### 1985 Labels (NIP-32)

- Article claim:
  - Merge effective labels: self-labels → external 1985 → lightweight `t`. Provide normalized view.
 - Current code:
   - Shared helpers implemented: `packages/nostr-git/packages/shared-types/src/nip32.ts` → `extractSelfLabels`, `extractLabelEvents`, `mergeEffectiveLabels`.
   - Core wrapper: `packages/nostr-git/packages/core/src/lib/labels.ts` → `effectiveLabelsFor()`.
 - Divergences:
   - Integrate effective labels into UI filters; add more normalization knobs if needed.
 - Risks:
   - Low; helpers are pure and typed.
 - Tests:
   - `packages/nostr-git/packages/shared-types/tests/nip32.spec.ts`.

### Subscription Strategy & Dedupe

- Article claim:
  - Redundant subs: by repo address `a`, by root `e`, and by `r:euc`, then dedupe.
 - Current code:
   - Centralized utility with dedupe/merge rules: `packages/nostr-git/packages/core/src/lib/subscriptions.ts` → `buildRepoSubscriptions()`.
 - Divergences:
   - Ensure call sites use this utility; log `notes` in dev.
 - Risks:
   - Low after adoption; reduces redundant traffic.
 - Tests:
   - `packages/nostr-git/packages/core/test/subscriptions.spec.ts`.

### Identifier Correctness (canonical repo key)

- Article claim:
  - Canonical repo key is `npub/name` (fallback npub), not event id.
 - Current code:
   - `core/src/lib/utils/canonicalRepoKey.ts` exists. Some code paths may still rely on older keys.
 - Divergences:
   - Deprecation warnings and mapping helpers pending (`repoKeys.ts`).
- Risks:
  - Cache/FS collisions; invisible repos.
- Tests:
  - Lacking unit tests validating key generation and old-key warnings.

## Summary of Divergences and Severity

- High: Patch DAG, Issues+NIP-22 assembler, Status precedence, Labels resolver, Repo state merge by maintainers.
- Medium: Repo grouping by `r:euc`, Subscription utility, Canonical key migration warnings.
- Low: Misc UI filter normalization.

## Immediate Test Gaps

- euc grouping and maintainer derivation.
- 30618 per-ref merge bounded to maintainers.
- Patch DAG + revision folding.
- NIP-22 scoped threading assembler.
- Status precedence engine.
- Label merging (self, external 1985, t) and normalization.
- Canonical keys and deprecation warnings.

