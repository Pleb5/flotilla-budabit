# Git-Natural Read Architecture Pivot

## Purpose

Budabit should move normal read-only repository browsing away from clone-first behavior and toward targeted Git object reads. The target model is to treat Git remotes as content-addressed object stores for reads, while preserving `isomorphic-git` for local repository semantics and write workflows.

This document defines the architecture pivot and phased migration plan. It intentionally stays at a high-medium level. Implementation details should be refined step by step as work begins.

## Current Model

Budabit currently uses a layered read path:

1. Repo-state events provide immediate signed ref snapshots when available.
2. Vendor REST APIs provide fast reads for supported hosts such as GitHub, GitLab, Gitea, and Bitbucket.
3. Worker-backed `isomorphic-git` initializes a local repo through shallow clone and fetch operations.
4. Fallback paths deepen or repair the local clone when commits, refs, trees, or blobs are missing.

This model works, but shallow clone still carries clone semantics. Even shallow reads can require filesystem setup, `.git` metadata, refs, object writes, checkout behavior, clone-depth repair, and provider-specific fallbacks.

## Target Model

Budabit should introduce a read-only Git natural API path before worker clone fallback:

```text
repo-state snapshot
-> provider REST where useful
-> git-natural smart HTTP reads
-> worker isomorphic-git clone fallback
```

The git-natural path should use Git smart HTTP directly and request only the objects required for the current read operation.

| Operation | Preferred Git Request Shape | Result |
| --- | --- | --- |
| Ref discovery | `info/refs?service=git-upload-pack` | branches, tags, HEAD, capabilities |
| Directory listing | `filter blob:none` | commit and tree metadata without file contents |
| Commit history | `filter tree:0` | commit objects without trees or blobs |
| File open | fetch blob by object hash | selected file bytes only |
| Diff metadata | two `blob:none` tree fetches | changed path discovery without blob bodies |

## Goals

1. Make normal repo browsing fast without requiring shallow clone.
2. Reduce redundant branch, path, depth, and clone-readiness accounting.
3. Preserve existing `isomorphic-git` write and worktree flows.
4. Keep existing fallback behavior available while the new path matures.
5. Make cache identity Git-native and mostly immutable.
6. Support GRASP and generic smart HTTP remotes without depending on provider REST APIs.

## Non-Goals

1. Do not replace `isomorphic-git` as Budabit's full Git provider.
2. Do not make git-natural read success imply a local clone exists.
3. Do not remove vendor REST APIs until a measured replacement is better.
4. Do not require every server to support partial clone filters.
5. Do not redesign push, merge, checkout, status, commit creation, or local editing in this pivot.

## Architectural Components

### GitNaturalReadProvider

Add a read-only provider focused on remote object reads. This should not implement the current broad `GitProvider` interface.

Initial public surface:

```ts
interface GitNaturalReadProvider {
  listRefs(input: ListRefsInput): Promise<ListRefsResult>;
  resolveRef(input: ResolveRefInput): Promise<ResolveRefResult>;
  listDirectory(input: ListDirectoryInput): Promise<ListDirectoryResult>;
  getFileContent(input: GetFileContentInput): Promise<GetFileContentResult>;
  listCommits(input: ListCommitsInput): Promise<ListCommitsResult>;
}
```

This provider should own Git smart HTTP negotiation, filter capability detection, object fetches, and normalized read results.

### GitObjectCache

Add an object-addressed cache shared by git-natural reads. The durable cache should be keyed by immutable Git identity wherever possible.

| Data | Key | Invalidation |
| --- | --- | --- |
| info refs | `remoteUrl` | short TTL |
| resolved refs | `remoteUrl + refName` | tied to info refs TTL |
| commits | `commitHash` | immutable, eviction only |
| trees | `commitHash + depth` | immutable, eviction only |
| path entries | `commitHash + normalizedPath` | immutable, eviction only |
| blobs | `blobHash` | immutable, eviction and size limits only |
| history batches | `startCommitHash + limit` | immutable, eviction only |

Path and branch UI caches may remain, but they should become derived memoization rather than durable truth.

### VendorReadRouter Integration

`VendorReadRouter` is the best initial seam. It already coordinates provider reads and worker fallback for directories, file content, refs, and commits.

The router should treat git-natural as another read source, not as a clone initializer.

Recommended source order:

```text
repo-state refs for immediate UI seed
provider REST for known high-quality vendor APIs
git-natural for smart HTTP clone URLs
worker clone fallback for compatibility and local repo semantics
```

The exact ordering may vary by host after benchmarks. GRASP and generic smart HTTP remotes should prefer git-natural before clone fallback.

### Worker Boundary

Git-natural packfile parsing and object caching should live in the worker when practical. This avoids UI-thread parsing cost and centralizes in-flight request dedupe.

The UI should receive normalized read results and source metadata. It should not need to know whether a tree came from vendor REST, git-natural, or worker clone unless the source affects messaging.

## Async Contract Rules

The pivot must preserve Budabit's finely tuned async behavior. These rules are required before replacing any hot read path.

### Immutable Result Identity

Every result that reads repository content should resolve to a commit hash when possible.

```text
ref name -> commit hash -> tree/blob/history data
```

Branch names are mutable pointers. Commit hashes, tree hashes, and blob hashes are immutable.

### Source Metadata

Every read result should carry source metadata.

```ts
type ReadSource = "repo-state" | "vendor" | "git-natural" | "worker-clone";

interface ReadSourceMeta {
  source: ReadSource;
  remoteUrl?: string;
  ref?: string;
  commitHash?: string;
  usedProxy?: boolean;
}
```

This keeps UI state, debug logs, and fallback decisions explainable.

### Stale Result Suppression

Branch switches, path navigation, tab changes, and repo changes must prevent stale async results from painting newer UI state.

Acceptable mechanisms:

1. `AbortSignal` propagation.
2. Per-request generation IDs.
3. Result acceptance checks against current repo, ref, path, and commit hash.

### Fallback Isolation

A git-natural read success must not mark a worker clone as initialized. A worker clone success must not invalidate immutable object cache entries.

These are separate state machines:

```text
git-natural read cache state
worker local clone state
repo-state snapshot state
provider REST state
```

### Error Classification

Fallback decisions need structured errors, not only generic exceptions.

Minimum useful classes:

| Error Class | Meaning | Fallback Behavior |
| --- | --- | --- |
| `missing-filter-capability` | server lacks partial clone filters | skip git-natural filtered read |
| `cors-blocked` | browser cannot reach smart HTTP endpoint | try proxy or next URL |
| `auth-required` | private repo or rejected credentials | try token/auth path or report auth need |
| `ref-not-found` | requested ref is absent | try alternate ref candidates |
| `object-not-found` | commit/tree/blob not reachable from URL | try next URL or clone fallback |
| `protocol-error` | malformed or unsupported Git smart HTTP response | try next URL or clone fallback |
| `transient-network` | timeout, 429, temporary failure | retry or fallback according to policy |

## Cache Pivot

Budabit should stop treating "repo loaded" as the primary cached read unit. The new primary cache unit should be Git objects.

Current read operations often answer UI questions directly:

```text
branch + path -> listing
branch + path -> content
repoId -> initialized clone state
```

The new model answers Git graph questions first:

```text
remoteUrl + ref -> commitHash
commitHash -> tree metadata
commitHash + path -> entry hash
blobHash -> bytes
```

Then UI questions become projections over cached Git graph data.

Example README read:

```text
main -> abc123
abc123 root tree -> README.md blob def456
def456 -> README contents
```

If another route later needs the root listing, it reuses `abc123 root tree`. If another route opens the same blob from another branch or remote, it reuses `def456`.

## Capability and Compatibility Strategy

Before using `blob:none` or `tree:0`, the git-natural provider must inspect the server's `info/refs` advertisement and confirm the `filter` capability is present.

If `filter` is present:

```text
use blob:none for tree metadata
use tree:0 for commit history
fetch blobs lazily by hash
```

If `filter` is absent:

```text
do not send filtered requests
fall back to provider REST or worker clone
record capability status for that remote URL
```

This makes the optimization opportunistic rather than mandatory.

## Phased Plan

### Phase 0: Baseline and Guardrails

Define current performance and behavior before changing the read path.

Deliverables:

1. Baseline timings for repo page load, ref loading, root tree listing, README loading, file open, and commit history.
2. Identify representative repositories: GitHub, GitLab or Gitea, GRASP, generic smart HTTP, private/authenticated, and a server without filter support if available.
3. Add lightweight logging or debug events that identify source, URL, ref, commit hash, fallback reason, and elapsed time.
4. Confirm existing worker clone fallback remains testable independently.

Exit criteria:

1. We can compare old and new paths without guessing.
2. Fallback behavior is observable.
3. No production read path has changed yet.

### Phase 1: Object Cache Foundation

Introduce cache primitives without routing UI reads through them yet.

Deliverables:

1. Add `GitObjectCache` with memory cache first.
2. Add IndexedDB persistence for durable immutable objects where appropriate.
3. Add in-flight request dedupe for identical object reads.
4. Define size limits and eviction policy for blobs and raw packfile objects.
5. Keep branch/ref data on short TTL and object data on eviction-only policy.

Exit criteria:

1. Cache keys are object-addressed.
2. Mutable ref data is not mixed with immutable object data.
3. Cache can be used by future git-natural reads without affecting current clone behavior.

### Phase 2: Git Natural Read Provider Skeleton

Implement the read-only provider behind tests and feature flags.

Deliverables:

1. Implement `infoRefs` fetch and capability parsing.
2. Implement ref resolution with short TTL caching.
3. Implement low-level filtered packfile fetches for `blob:none` and `tree:0`.
4. Implement lazy blob fetch by object hash.
5. Return normalized read results with source metadata.
6. Classify errors into fallback-friendly categories.

Exit criteria:

1. Provider can read refs, root tree, selected file content, and commit history from compatible public remotes.
2. Provider cleanly declines unsupported remotes without breaking worker clone fallback.
3. Provider has no write or local clone responsibilities.

### Phase 3: Router Integration in Shadow Mode

Wire git-natural reads into the router without making them authoritative.

Deliverables:

1. Add shadow reads for selected operations in development or feature-flagged mode.
2. Compare git-natural results against current vendor or worker results.
3. Record mismatches in path names, file modes, commit hashes, ref names, binary/text handling, and errors.
4. Validate stale result suppression during fast branch/path navigation.

Exit criteria:

1. Shadow reads demonstrate correctness on representative repos.
2. Mismatch categories are understood.
3. No user-visible behavior depends on git-natural yet unless explicitly enabled.

### Phase 4: GRASP and Generic Read Path Enablement

Enable git-natural reads where they provide the largest immediate win.

Deliverables:

1. Route GRASP smart HTTP and generic HTTP clone URLs through git-natural before worker clone fallback.
2. Keep provider REST disabled or secondary for incomplete GRASP REST paths until they are corrected.
3. Preserve worker clone fallback for unsupported capabilities, CORS failures, auth failures, and protocol failures.
4. Ensure read success does not imply local clone readiness.

Exit criteria:

1. GRASP/generic repo browsing works without normal shallow clone when the server supports filters.
2. Unsupported servers still work through existing fallback paths.
3. User-visible clone errors distinguish read fallback from local clone failure.

### Phase 5: Broader Read Path Adoption

Expand git-natural reads to hosted providers where benchmarks justify it.

Deliverables:

1. Compare vendor REST versus git-natural for GitHub, GitLab, Gitea, and Bitbucket.
2. Prefer git-natural where it is faster, more complete, or less rate-limit prone.
3. Keep vendor REST where it is simpler or faster for a specific host/operation.
4. Normalize source-specific behavior behind one router contract.

Exit criteria:

1. Normal code browsing avoids clone setup for most compatible remotes.
2. Vendor REST and git-natural are policy choices, not separate UI behaviors.
3. Clone fallback becomes rare for read-only browsing.

### Phase 6: Diff, Merge Analysis, and Advanced Reads

Use object-addressed reads for heavier Git views after basic browsing is stable.

Deliverables:

1. Use `blob:none` full-tree fetches to discover changed paths between commits.
2. Fetch changed blobs lazily by hash for diff content.
3. Use `tree:0` history batches for merge-base and ahead/behind heuristics where appropriate.
4. Keep existing worker-based analysis available as fallback.

Exit criteria:

1. Diff and merge views benefit from cached tree and blob objects.
2. Expensive worker clone/deepen paths are avoided for compatible remotes.
3. Edge cases still fall back to current behavior.

### Phase 7: Cleanup and Consolidation

Remove redundant read accounting only after the new path is proven.

Deliverables:

1. Simplify clone-depth repair paths that are no longer part of normal browsing.
2. Remove dead or misleading GRASP REST code paths once replaced or implemented properly.
3. Consolidate cache metrics and debug logs around source metadata.
4. Document remaining cases where clone fallback is intentionally required.

Exit criteria:

1. Read path architecture is simpler than before.
2. Shallow clone is no longer the normal browsing mechanism.
3. Worktree and write workflows remain unchanged and reliable.

## Success Metrics

Track these before and after each enablement phase:

| Metric | Target Direction |
| --- | --- |
| Time to refs visible | lower |
| Time to root tree visible | lower |
| Time to README visible | lower |
| Time to first file open | lower or equal |
| Bytes transferred before first render | lower |
| Worker clone invocations during read-only browsing | much lower |
| Clone deepen retries during browsing | much lower |
| Fallback success rate | stable or higher |
| UI stale result incidents | zero |
| Auth/CORS error clarity | higher |

## Key Risks

| Risk | Mitigation |
| --- | --- |
| Async fallback ordering regresses UI state | use aborts, generation IDs, and source metadata |
| Cache layers disagree | make object-addressed cache durable truth for git-natural reads |
| Server lacks filter support | detect capability and fall back cleanly |
| CORS blocks smart HTTP | use existing proxy strategy and next-URL fallback |
| Private repo auth differs by source | route auth explicitly through provider policy |
| Git-natural result is mistaken for clone readiness | keep read cache state separate from local clone state |
| Packfile parsing hurts UI responsiveness | run parsing in worker and dedupe requests |
| Existing GRASP REST code is incomplete | treat it as separate from git-natural read provider until fixed |

## Decision Record

The pivot should proceed incrementally. The first production goal is not to remove `isomorphic-git`; it is to stop requiring shallow clone for normal read-only browsing when a remote can satisfy targeted smart HTTP reads.

The architecture should optimize for a clean split:

```text
git-natural: remote read-only object access
isomorphic-git: local repo, worktree, write, push, merge, checkout, fallback
```

This split gives Budabit the speed profile seen in Gitworkshop while preserving the mature fallback and write semantics already present in the codebase.
