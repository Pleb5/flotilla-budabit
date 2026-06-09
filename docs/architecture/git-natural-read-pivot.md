# Session Plan

## Objective

- Pivot Budabit read-only repository browsing to prefer Git natural Smart HTTP reads over provider REST APIs and clone-first worker reads.
- Keep repo-state events as the immediate signed ref/UI seed, then use Git natural object reads as the default remote read path, then use provider REST only as an explicit fallback or measured host-specific exception, then use worker-backed `isomorphic-git` clone/fetch fallback for compatibility and local repo semantics.
- Preserve `isomorphic-git` for local repository state, checkout, write, merge, push, and fallback flows.
- Replace the incomplete GRASP REST read direction with a shared Git natural provider that can serve GRASP, generic Smart HTTP remotes, and hosted providers where Smart HTTP is available.
- Use `~/Work/gitworkshop` and `~/Work/git-natural-api` as reference implementations for principles, low-level protocol behavior, packfile parsing, object-addressed caching, URL fallback, and UI async contracts, without copying Gitworkshop behavior wholesale.

## Constraints

- Current repository state is authoritative over this plan.
- This plan is for implementation after review; do not launch implementation until the user approves.
- Prefer Git natural reads over provider REST APIs by default.
- Provider REST APIs remain available only as compatibility fallback, benchmark comparison, or host/operation-specific exception after evidence.
- Git natural read success must not mark a local worker clone initialized.
- Worker clone success must not invalidate immutable Git natural object cache entries.
- Preserve existing repo-state event behavior as an immediate UI seed and signed ref snapshot.
- Assume GRASP servers always attach the required CORS headers for Smart HTTP; GRASP natural-read requests should go direct by default and should not use the generic CORS proxy unless an explicit diagnostic/developer override is added later.
- Keep parsing and heavy object work in the worker/core boundary where practical; do not move packfile parsing into hot UI paths.
- Keep changes phase-based, minimal, and verified.
- Commit and push each verified phase during execution.
- Avoid staging or modifying unrelated worktree changes.

## Source Priority Decision

- Default read source order:

```text
repo-state snapshot for signed refs/UI seed
-> git-natural Smart HTTP reads for remote content and history
-> provider REST fallback or measured host-specific exception
-> worker isomorphic-git clone/fetch fallback
```

- GRASP and generic Smart HTTP remotes should prefer Git natural reads before GRASP REST and before worker clone fallback.
- GRASP Smart HTTP remotes are expected to be browser-reachable directly because GRASP servers should emit CORS headers; direct GRASP failures should be classified as endpoint/server/auth issues rather than automatically retried through the generic CORS proxy.
- Hosted providers such as GitHub, GitLab, Gitea, and Bitbucket should still try Git natural first when the clone URL is browser-reachable or proxy-reachable and the needed capability exists.
- Provider REST should not be the default first read source for directory, blob, refs, or commits once the Git natural path for that operation is implemented and enabled.

## Reference Lessons To Carry Through Every Phase

- Gitworkshop routes all read operations through a pool abstraction, not ad hoc `Promise.any(cloneUrls.map(...))` calls. See `~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts:1-16` and `~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts:1673-1741`.
- Gitworkshop avoids high-level `git-natural-api` helpers that refetch capabilities and instead uses cached `infoRefs` plus low-level `fetchPackfile`/`loadTree`/`parseCommit`. See `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:1-16`.
- Gitworkshop caches by Git object identity with L1 memory and IndexedDB for immutable data, while `infoRefs` remains TTL-based. See `~/Work/gitworkshop/src/lib/git-grasp-pool/cache.ts:1-12` and `~/Work/gitworkshop/src/lib/git-grasp-pool/cache.ts:171-419`.
- Gitworkshop fetches `blob:none` tree objects and stores raw packfile objects so different tree depths can be parsed without another network request. See `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:839-888` and `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:1139-1218`.
- Gitworkshop fetches commit history with `tree:0`, in small retryable batches, and caches each history batch by start commit and limit. See `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:746-833`.
- Gitworkshop protects UI state with aborts, cache fast paths, partial renders, and result checks. See `~/Work/gitworkshop/src/hooks/useGitExplorer.ts:337-352`, `~/Work/gitworkshop/src/hooks/useGitExplorer.ts:354-525`, and `~/Work/gitworkshop/src/hooks/useGitExplorer.ts:528-699`.
- `~/Work/git-natural-api` contains the low-level Smart HTTP pieces: `info/refs`, pkt-line want request creation, `git-upload-pack`, `blob:none`, `tree:0`, packfile parsing, commit parsing, and tree loading. See `~/Work/git-natural-api/refs.ts:38-97`, `~/Work/git-natural-api/packs.ts:38-101`, `~/Work/git-natural-api/packs.ts:116-140`, `~/Work/git-natural-api/index.ts:89-142`, and `~/Work/git-natural-api/index.ts:214-272`.
- Budabit already has partial GRASP natural-read pieces, but they are split across disabled REST reads, direct `info/refs` parsing, advertised refs helpers, and clone-backed GRASP API reads. See `packages/nostr-git-core/src/api/providers/grasp-rest.ts:116-173`, `packages/nostr-git-core/src/utils/advertised-refs.ts:97-164`, `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:95-100`, and `packages/nostr-git-core/src/api/providers/grasp.ts:445-551`.

## Phase 1: Baseline, Guardrails, And Read Source Contract

### Goal

- Define the read-source contract, source ordering, observability, and baseline behavior before changing production read paths.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check principles, gather confidence, and inspect any referenced code before deciding details.
- Focus references: `~/Work/gitworkshop/src/lib/git-grasp-pool/types.ts`, `~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts`, `~/Work/git-natural-api/refs.ts`, and Budabit `VendorReadRouter.ts`/`advertised-refs.ts`.

### Reference Lessons And Snippets

- Gitworkshop exposes URL status, source data, capabilities, proxy use, and error kinds through pool state rather than hiding fallback decisions.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/types.ts:82-110
export interface UrlState {
  url: string;
  originalUrl: string;
  effectiveUrl: string;
  status: UrlConnectionStatus;
  usesProxy: boolean;
  infoRefs: InfoRefsUploadPackResponse | null;
  headCommit: string | null;
  headRef: string | null;
  supportsFilter: boolean;
  capabilities: string[];
  latencyMs: number | null;
  lastError: string | null;
  lastErrorKind: UrlErrorKind | null;
}
```

- Budabit already has source metadata for refs, but it needs a `git-natural` source kind and source ordering that places Git natural ahead of provider REST.

```ts
// packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:86-93
export interface RefDiscoverySource {
  kind: "vendor" | "git-remote" | "repo-state" | "local";
  label: string;
  remoteUrl?: string;
  attemptedUrls?: string[];
  defaultBranch?: string;
  details?: string;
}
```

### Exit Criteria

- A documented source contract exists for directory listing, file content, refs, commit history, and future diff reads.
- The documented default read order is repo-state seed, Git natural, provider REST fallback/exception, worker clone fallback.
- Source metadata includes a distinct `git-natural` source and can report remote URL, effective URL/proxy, ref, commit hash, capability/fallback reason, and elapsed time.
- Baseline timings and behavior are recorded for representative reads: refs, root directory, README/file open, commit history, and worker clone fallback.
- Representative remotes are identified: GRASP Smart HTTP, generic Smart HTTP, GitHub, GitLab/Gitea, Bitbucket if available, private/auth-required, CORS/proxy-required, and a server without filter support if available.
- No production read ordering changes yet.

### Expected Touched Areas

- `docs/architecture/git-natural-read-pivot.md`
- `docs/architecture/git-natural-read-session-checkpoint.md`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- Potential small shared type file under `packages/nostr-git-core/src/git/` or `packages/nostr-git-ui/src/lib/components/git/`

### Steps

- Add or update read source types to include `git-natural` and distinguish `provider-rest` from generic `vendor` where useful.
- Add lightweight debug/telemetry fields for source kind, remote URL, effective URL/proxy status, ref, commit hash, operation, fallback reason, and elapsed time.
- Keep repo-state event data as an immediate signed seed, not as a substitute for object reads.
- Add tests or fixtures around source selection so a secondary provider REST URL does not jump ahead of the selected first remote unless explicit policy says so.
- Record baseline observations in the checkpoint or an architecture note, including commands/manual routes used.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- `git diff --check`
- Manual baseline notes for the representative remotes available in the current environment.

### Risks

- Baseline coverage may be limited by network, CORS, or auth availability.
- Source metadata can become noisy if every fallback logs at warning level.
- Existing UI and tests currently use `vendor` as a broad source name; splitting `provider-rest` may require careful compatibility within the UI.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 2: Git Object Cache And Low-Level Natural Client Foundation

### Goal

- Introduce a worker/core Git natural foundation with object-addressed caching, cached `infoRefs` capabilities, in-flight dedupe, CORS/proxy policy, and low-level packfile fetch primitives, without routing UI reads through it yet.
- Encode the GRASP-specific policy that GRASP Smart HTTP requests go direct by default because GRASP servers are expected to attach CORS headers.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check cache and protocol principles before choosing dependency/import boundaries.
- Focus references: `gitworkshop` cache/client code and `git-natural-api` `refs.ts`, `packs.ts`, `parse-packfile.ts`, `tree.ts`, and `commits.ts`.

### Reference Lessons And Snippets

- Gitworkshop intentionally avoids high-level helpers because they fetch capabilities repeatedly and bypass the cache.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:8-16
// We never call the library's high-level functions (getObject,
// fetchCommitsOnly, getDirectoryTreeAt, etc.) because every one of them
// calls getCapabilities() internally, which re-fetches infoRefs and
// bypasses our cache entirely.
```

- The low-level want request shape from `git-natural-api` is the useful reusable primitive.

```ts
// ~/Work/git-natural-api/packs.ts:116-140
export function createWantRequest(
  commitSha: string,
  capabilities: string[],
  deepen: number | undefined,
  filter?: string,
): string {
  if (commitSha.length !== 40) throw new InvalidCommit(commitSha);
  const pkts: string[] = [];
  pkts.push(`want ${commitSha} ${capabilities.join(" ")} agent=nsa/1.0.0\n`);
  if (typeof deepen !== "undefined") pkts.push(`deepen ${deepen}\n`);
  if (filter) pkts.push("filter " + filter + "\n");
  pkts.push("");
  pkts.push("done\n");
  return pkts.map(pktEncode).join("");
}
```

- Budabit already has direct advertised-ref parsing for GRASP URLs that can inform `infoRefs` parsing and CORS behavior.

```ts
// packages/nostr-git-core/src/utils/advertised-refs.ts:213-237
export async function listAdvertisedServerRefs(
  git: any,
  opts: {url: string; prefix?: string; symrefs?: boolean; onAuth?: any; corsProxy?: string | null},
): Promise<AdvertisedServerRef[]> {
  if (isGraspRepoHttpUrl(opts.url)) {
    const body = await fetchAdvertisedRefsText(opts.url, opts.corsProxy)
    return filterAdvertisedRefs(parseGitUploadPackAdvertisement(body), opts)
  }
  const refs = await git.listServerRefs({ url: opts.url, prefix: opts.prefix, symrefs: opts.symrefs })
  return Array.isArray(refs) ? refs : []
}
```

### Exit Criteria

- A Git natural cache exists with object-addressed keys for commits, blobs, trees, raw `blob:none` object batches, and history batches, plus short-TTL URL-scoped `infoRefs`.
- `infoRefs` fetches are cached, deduped, parse capabilities and symrefs, and can use existing CORS/proxy policy.
- The CORS/proxy policy treats GRASP repo HTTP URLs as direct-only by default; no generic CORS proxy is used for GRASP natural reads unless a later explicit override is designed.
- Low-level `git-upload-pack` fetch primitives exist for object-by-hash, `blob:none`, and `tree:0` requests.
- Capability selection happens from cached `infoRefs`; high-level helpers that refetch capabilities are avoided unless benchmarks prove acceptable.
- The incomplete `grasp-rest-utils.ts` path is not expanded as the primary implementation; useful parsing concepts are either replaced by a tested dependency or moved into the shared natural client.
- No UI read path depends on Git natural yet.

### Expected Touched Areas

- New or updated natural read files under `packages/nostr-git-core/src/git/` or `packages/nostr-git-core/src/worker/workers/`
- `packages/nostr-git-core/src/utils/advertised-refs.ts`
- `packages/nostr-git-core/src/utils/grasp-url.ts`
- `packages/nostr-git-core/src/git/nip98-http-client.ts` if auth header support is reused for natural reads
- `packages/nostr-git-core/src/api/providers/grasp-rest-utils.ts` only to deprecate/quarantine or reuse tested pieces deliberately
- `pnpm-lock.yaml` and workspace package manifests only if a new dependency is chosen

### Steps

- Decide whether to add `@fiatjaf/git-natural-api` as a dependency or implement a narrow local low-level module, based on build/test compatibility and whether browser/worker imports are stable.
- Add `GitObjectCache` or equivalent natural cache with memory first and IndexedDB persistence where appropriate.
- Add `fetchInfoRefs` with request dedupe, TTL cache, symref parsing, capability parsing, proxy support, and structured errors.
- Preserve Budabit's existing GRASP no-proxy behavior from `resolveCorsProxyForUrl()` for natural reads, and document direct GRASP CORS failures as server/endpoint problems rather than proxy candidates.
- Add low-level `fetchPackfile` wrapper for `git-upload-pack` with response status checks and parsed sideband handling.
- Add capability selection from cached `infoRefs`, including `filter` detection and structured `missing-filter-capability` errors.
- Add tests for pkt-line/ref parsing, capability extraction, cache keys, dedupe, and error classification.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- Targeted natural cache/client tests added in this phase.
- `git diff --check`

### Risks

- `git-natural-api` may not be packaged for Budabit's build target; local helpers may be safer but require more maintenance.
- Packfile parsing and IndexedDB persistence can introduce worker bundle size and performance concerns.
- CORS behavior differs across generic remotes, GitHub, GitLab, and Gitea; GRASP is assumed to provide CORS headers and should remain direct by default.
- NIP-98 auth for GRASP reads should sign the direct GRASP URL; proxied GRASP requests are out of scope unless explicitly introduced later.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 3: GitNaturalReadProvider Operations Behind A Feature Flag

### Goal

- Implement a read-only `GitNaturalReadProvider` behind tests and a disabled/opt-in feature flag for refs, directory listing, file content, and commit history.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check request shapes, tree traversal, blob fetch, commit history, and abort behavior.
- Focus references: `git-http.ts` operation methods, `useGitExplorer.ts`, `git-natural-api/index.ts`, and Budabit worker RPC read methods.

### Reference Lessons And Snippets

- Directory listings should use `blob:none`, parse tree metadata, and avoid blob content until a file is opened.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:288-323
async function fetchDirectoryTree(
  effectiveUrl: string,
  commitHash: string,
  serverCaps: string[],
  signal: AbortSignal,
  parseDepth?: number,
): Promise<{ tree: Tree; rootTreeHash: string; rawObjects: Map<string, ParsedObject> }> {
  const caps = selectCapabilities(serverCaps);
  if (!serverCaps.includes("filter")) throw new Error("git server does not support filter capability");
  caps.push("filter");
  const want = createWantRequest(commitHash, caps, 1, "blob:none");
  const result = await fetchPackfile(effectiveUrl, want);
  const commitObj = result.objects.get(commitHash);
  const rootTreeHash = utf8.decode(commitObj!.data.slice(5, 45));
  const rootTreeObj = result.objects.get(rootTreeHash)!;
  return { tree: loadTree(rootTreeObj, result.objects, parseDepth), rootTreeHash, rawObjects: result.objects };
}
```

- Commit history should use `tree:0`, not a clone, and should return structured commit data only.

```ts
// ~/Work/git-natural-api/index.ts:214-272
export async function fetchCommitsOnly(
  url: string,
  commitOrRef: string,
  maxCommits?: number,
): Promise<Commit[]> {
  const caps = await getCapabilities(url, info);
  if (caps.includes("filter")) capabilities.push("filter");
  else throw new MissingCapability(url, "filter");
  const want = createWantRequest(commitOrRef, capabilities, maxCommits, "tree:0");
  const result = await fetchPackfile(url, want);
  return Array.from(result.objects).map(([hash, obj]) => parseCommit(obj.data, hash));
}
```

- Budabit's clone-backed GRASP provider does similar user-visible operations today, but through temp FS fetches that the natural provider should avoid for read-only browsing.

```ts
// packages/nostr-git-core/src/api/providers/grasp.ts:881-918
await git.fetch({
  fs,
  http,
  dir,
  url: remoteUrl,
  depth: 1,
  ...(targetRef ? {ref: targetRef, singleBranch: true} : {}),
})
const {oid, blob} = await (git as any).readBlob({ fs, dir, filepath: path })
const content = Buffer.from(blob as Uint8Array).toString("base64")
return {content, encoding: "base64", sha: oid}
```

### Exit Criteria

- `GitNaturalReadProvider` or equivalent worker RPC can list refs, resolve refs, list a directory, fetch a file blob, list commit history, and get one commit from compatible public remotes.
- Results include source metadata: source kind, remote URL, effective URL/proxy, ref, commit hash, object hash when applicable, and fallback/capability info.
- Ref resolution handles full refs, short branches, tags, peeled annotated tags, `HEAD` symrefs, and direct 40-character commit hashes.
- Directory reads fetch tree metadata with `blob:none`; file content fetches selected blobs by object hash.
- Commit history uses `tree:0` where supported and has a fallback/decline path when `filter` is missing.
- Structured errors exist for missing filter capability, CORS/proxy failure, auth required, ref not found, object not found, protocol error, and transient network failure.
- Feature flag or internal-only worker RPC prevents production UI from depending on the provider yet.

### Expected Touched Areas

- `packages/nostr-git-core/src/git/` natural provider files
- `packages/nostr-git-core/src/worker/worker.ts`
- `packages/nostr-git-core/src/worker/workers/` worker RPC helpers
- `packages/nostr-git-ui/src/lib/components/git/WorkerManager.ts`
- `packages/nostr-git-core/test/` natural provider tests

### Steps

- Add input/result types for `listRefs`, `resolveRef`, `listDirectory`, `getFileContent`, `listCommits`, and `getCommit`.
- Add worker RPC methods for natural reads, keeping parsing off the UI thread.
- Implement ref resolution from cached `infoRefs`, including peeled tags and default branch extraction.
- Implement directory listing by fetching/parsing `blob:none` tree objects at the required depth.
- Implement file content by traversing tree metadata to blob hash, then fetching the blob by hash.
- Implement commit history by fetching `tree:0` batches and sorting/normalizing history results.
- Add tests using fixtures or mocked `fetch` responses for compatible, no-filter, missing-ref, and CORS/proxy cases.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- Targeted worker RPC tests if added.
- `git diff --check`
- Optional manual smoke reads against one GRASP/generic and one hosted remote if network allows.

### Risks

- Servers may return delta objects or large packfiles that expose parser limits.
- Some remotes may not support `filter`; provider must decline without breaking fallback.
- Blob decoding must preserve binary files and not assume UTF-8 for all paths.
- Commit order from packfile objects may not be sorted; normalization must sort or walk parents appropriately.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 4: VendorReadRouter Shadow Integration With Git-Natural Preference

### Goal

- Wire Git natural into `VendorReadRouter` in shadow/feature-flagged mode and make the planned source order explicit: repo-state seed, Git natural, provider REST fallback/exception, worker clone fallback.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check URL fallback, merged refs, abort behavior, and UI cache fast paths.
- Focus references: `gitworkshop` `pool.ts`, `useGitExplorer.ts`, Budabit `VendorReadRouter.ts`, `Repo.svelte.ts`, `WorkerManager.ts`, and existing router tests.

### Reference Lessons And Snippets

- Gitworkshop uses a winner-first fallback order while keeping extra fallback URLs ephemeral.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts:1683-1741
private async withFallback<T>(
  signal: AbortSignal,
  operation: (url: string) => Promise<T | null>,
  fallbackUrls?: string[],
): Promise<T | null> {
  const poolUrls = this.getOrderedUrls();
  const poolUrlSet = new Set(poolUrls);
  const extraUrls = fallbackUrls ? fallbackUrls.filter((u) => !poolUrlSet.has(u) && !isNonHttpUrl(u)) : [];
  for (const url of [...poolUrls, ...extraUrls]) {
    if (signal.aborted) return null;
    const result = await operation(url);
    if (result !== null) return result;
  }
  return null;
}
```

- Budabit's router is already the right seam because it owns directory, file, refs, and commits before worker fallback.

```ts
// packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:163-250
async listDirectory(params: {
  workerManager: WorkerManager;
  repoEvent: RepoAnnouncementEvent;
  repoKey?: string;
  cloneUrls: string[];
  branch: string;
  path?: string;
}): Promise<VendorDirectoryResult> {
  const remotes = this.getValidRemotes(params.cloneUrls);
  // Current path tries provider REST, then worker fallback.
}
```

- Existing router tests already protect the selected-remote policy and disabled GRASP REST behavior.

```ts
// packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts:41-68
it("skips vendor REST reads for GRASP clone URLs and uses git refs directly", async () => {
  const router = new VendorReadRouter({ getTokens: async () => [], preferVendorReads: true });
  const result = await router.listRefs({ workerManager, repoEvent, cloneUrls: ["https://.../repo.git"] });
  expect(result.source.kind).toBe("git-remote");
  expect(workerManager.listServerRefs).toHaveBeenCalledTimes(1);
});
```

### Exit Criteria

- `VendorReadRouter` can call Git natural worker RPCs for refs, directory, file content, and commit history under a feature flag or shadow mode.
- When enabled, Git natural is attempted before provider REST for supported operations.
- Shadow mode compares Git natural results against existing provider REST or worker results without changing user-visible output.
- Mismatch logs include operation, remote URL, ref, commit hash, path, object hash, and source result summaries.
- Stale result suppression is preserved during fast branch switches, path navigation, repo changes, and tab changes.
- Existing router fallback behavior and tests continue to pass.

### Expected Touched Areas

- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- `packages/nostr-git-ui/src/lib/components/git/WorkerManager.ts`
- `packages/nostr-git-ui/src/lib/components/git/Repo.svelte.ts`
- `packages/nostr-git-ui/src/lib/components/git/FileManager` or related manager files if natural metadata needs propagation

### Steps

- Add natural-read configuration flags to `VendorReadRouterConfig`, defaulting production-visible behavior conservatively if needed but documenting the target source order.
- Add natural read attempt methods that call `WorkerManager` natural RPCs and normalize results into existing router result shapes.
- Insert natural read attempts before provider REST when enabled; keep provider REST after natural and before clone fallback.
- Add shadow-mode comparisons for refs, directory listings, file content metadata, and commit history.
- Update source metadata and error reporting to include `git-natural` and fallback reason.
- Extend tests to assert selected remote policy, natural-before-REST ordering, REST fallback after natural decline, and worker fallback after both fail.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- Core natural provider tests from Phase 3.
- `git diff --check`
- Manual shadow-mode comparison on at least one available repo if network allows.

### Risks

- The current router name and `fromVendor` flags may confuse source semantics once `git-natural` is neither provider REST nor clone fallback.
- Manager-level caches currently use branch/path keys; they must not become durable truth over immutable object cache entries.
- Shadow comparisons can be expensive if they duplicate network reads without cache reuse.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 5: Enable GRASP And Generic Smart HTTP Natural Reads

### Goal

- Make GRASP and generic Smart HTTP browsing work through Git natural reads before any provider REST or worker clone fallback, because these remotes benefit most from avoiding clone setup and incomplete REST assumptions.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check GRASP URL/proxy/auth behavior, state-event comparison, and direct Smart HTTP reads.
- Focus references: Gitworkshop `git-grasp-pool`, Budabit `grasp-url.ts`, `grasp-capabilities.ts`, `advertised-refs.ts`, `grasp.ts`, and `grasp-rest.ts`.

### Reference Lessons And Snippets

- Gitworkshop treats Smart HTTP URLs as a pool with direct/proxy decisions and permanent failure tracking.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:450-569
fetchInfoRefs(url: string, signal: AbortSignal): Promise<InfoRefsUploadPackResponse> {
  const existing = this.inFlightInfoRefs.get(url);
  if (existing) return existing.then((info) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return info;
  });
  const effectiveUrl = this.cors.resolveUrl(url);
  const fetchPromise = (async () => {
    const cached = await this.cache.getInfoRefs(url);
    if (cached) return cached;
    const info = await libGetInfoRefs(effectiveUrl);
    this.cache.putInfoRefs(url, info);
    return info;
  })();
  this.inFlightInfoRefs.set(url, fetchPromise);
  return fetchPromise;
}
```

- Budabit already disables GRASP REST reads because current GRASP relays expose Smart HTTP rather than REST endpoints.

```ts
// packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:95-100
type SupportedVendor = "github" | "gitlab" | "gitea" | "bitbucket" | "grasp-rest";

// GRASP relays currently expose git smart HTTP endpoints, not the REST endpoints below.
// Keep REST reads disabled until a compatible GRASP REST API is deployed.
const ENABLE_GRASP_REST_READS: boolean = false;
```

- Budabit's GRASP REST provider has useful `infoRefs` parsing and branch/tag listing, but commit, directory, and file content are intentionally unimplemented.

```ts
// packages/nostr-git-core/src/api/providers/grasp-rest.ts:315-327
async listCommits(owner: string, repo: string, options?: ListCommitsOptions): Promise<Commit[]> {
  throw createInvalidInputError(
    "GRASP REST API commit listing not yet implemented. Use the event-based GRASP API instead.",
    this.buildContext({operation: "listCommits"}),
  )
}
```

### Exit Criteria

- GRASP Smart HTTP repo browsing can list refs, list directories, open files, and list commit history through Git natural when server capabilities allow.
- GRASP Smart HTTP natural reads go direct by default and do not use the generic CORS proxy.
- Generic HTTP(S) Git remotes use Git natural for the same operations when browser/proxy access and capabilities allow.
- Incomplete GRASP REST endpoints remain disabled or secondary and are not required for browsing.
- Worker clone fallback still handles unsupported filters, protocol errors, CORS/proxy failures, auth failures, and object-missing cases.
- User-visible errors distinguish Git natural read fallback from local clone initialization failure.
- Git natural read success does not update `clonedRepos`, `repoDataLevels`, or any local clone-ready state.

### Expected Touched Areas

- `packages/nostr-git-core/src/utils/grasp-url.ts`
- `packages/nostr-git-core/src/api/providers/grasp-capabilities.ts`
- `packages/nostr-git-core/src/git/nip98-http-client.ts`
- `packages/nostr-git-core/src/worker/worker.ts`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- `packages/nostr-git-ui/src/lib/components/git/Repo.svelte.ts`
- Existing GRASP REST docs may be updated to reflect the natural-read pivot

### Steps

- Add natural-read URL eligibility policy for GRASP repo HTTP URLs and generic HTTP(S) clone URLs.
- Reuse `resolveCorsProxyForUrl` behavior so GRASP direct Smart HTTP is never accidentally proxied by default; if a GRASP request appears CORS-blocked, classify it as a GRASP server/endpoint conformance issue or auth issue, not a reason to silently route through the generic proxy.
- Reuse or adapt NIP-98 auth header generation for private/authenticated GRASP reads if required.
- Ensure natural read attempts never call `initializeRepo`, `ensureShallowClone`, or clone-state transitions.
- Update GRASP-related router tests so GRASP no longer means disabled REST followed immediately by clone-backed worker reads when natural read is available.
- Update docs/comments that currently call the path `grasp-rest` if the implementation is now Smart HTTP natural reads.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- `git diff --check`
- Manual smoke with at least one GRASP Smart HTTP URL if network/auth is available.

### Risks

- GRASP servers may require NIP-98 auth or specific headers for private reads.
- If a GRASP server does not return CORS headers, the implementation should surface that as a GRASP server/endpoint problem; default proxy fallback must not hide the conformance issue.
- Some GRASP endpoints may omit HEAD or have state events ahead/behind Smart HTTP refs; result metadata must make that visible.
- Generic remotes can be valid Git but not browser-reachable because of CORS.
- Existing `grasp-rest` naming may create confusion in UI logs, tests, and docs.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 6: Hosted Provider Adoption And REST Demotion

### Goal

- Expand Git natural reads to hosted providers and make provider REST an explicit fallback or measured exception rather than the default fast path.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check hosted-provider behavior, CORS proxy policy, rate limits, and natural read compatibility.
- Focus references: Gitworkshop `CorsProxyManager`, `GitHttpClient`, and Budabit provider REST implementations in `VendorReadRouter.ts`.

### Reference Lessons And Snippets

- Gitworkshop has a per-origin CORS policy and tries direct/proxy based on known and learned behavior.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/cors-proxy.ts:7-12
// Strategy:
//  1. Check if the origin is in the hardcoded blocked list -> use proxy
//  2. Check the runtime cache for a previous decision -> use that
//  3. Otherwise try direct first; on CORS-like error, retry via proxy
//  4. Cache the per-origin decision for the session
```

- Budabit currently has REST implementations for hosted providers; these should become fallback/comparison paths, not default-first paths.

```ts
// packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:530-573
if (this.preferVendorReads && remotes.length > 0) {
  const vendorUrls = this.getPolicyVendorUrls(remotes);
  if (vendorUrls.length > 0) {
    console.log(`[VendorReadRouter] Trying REST API for listCommits...`);
    // Current path tries REST first.
  }
}
console.log(`[VendorReadRouter] Using git worker fallback`);
```

### Exit Criteria

- Git natural reads are attempted before provider REST for compatible hosted remotes when enabled.
- Provider REST remains as fallback for CORS-blocked Smart HTTP, auth-specific cases, missing filter support, or host/operation cases where measured evidence says REST is better.
- Benchmarks or recorded observations compare Git natural and REST for refs, directory, file open, and commit history on available hosted providers.
- Hosted provider auth and token handling are not regressed.
- Rate-limit and CORS errors are classified separately from Git protocol/capability errors.

### Expected Touched Areas

- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
- `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- Token/helper code only if natural reads need auth header integration
- Natural provider CORS/proxy policy files
- Documentation/checkpoint benchmark notes

### Steps

- Update router policy so hosted providers use natural read first under the selected rollout flag.
- Keep existing REST implementations as fallback calls after natural declines/fails with fallback-safe errors.
- Add tests proving GitHub/GitLab/Gitea/Bitbucket REST does not run before natural when natural is eligible.
- Add tests proving REST still runs when natural returns CORS blocked, missing filter capability, auth required, or protocol unsupported.
- Record benchmark observations or limitations for each hosted provider available in the environment.
- Keep per-host exceptions data-driven and documented in the checkpoint.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.test.ts`
- Natural provider tests from core.
- `git diff --check`
- Manual hosted-provider smoke reads if network and auth permit.

### Risks

- GitHub/GitLab browser CORS may force proxy or REST fallback for many users.
- REST APIs sometimes expose metadata not present in raw Git reads; the router must keep result shapes normalized.
- Hosted provider token semantics differ from Smart HTTP auth semantics.
- Benchmarks may be noisy because proxy availability and rate limits vary.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Phase 7: Diff, Merge Analysis Reads, And Cleanup

### Goal

- Apply object-addressed natural reads to heavier read-only views after basic browsing is stable, then remove misleading clone-first and incomplete GRASP REST read accounting.

### Phase Start Reference Check

- Before implementation, read the checkpoint and the whole plan from start to finish, then reread this phase, then consult `~/Work/gitworkshop` and `~/Work/git-natural-api` to double-check diff tree fetching, commit-range reads, merge-base heuristics, and cleanup boundaries.
- Focus references: Gitworkshop `getCommitRange`, `fetchFullTree`, `getBlob`, and Budabit PR/merge worker paths.

### Reference Lessons And Snippets

- Gitworkshop computes diff inputs with two `blob:none` full-tree reads and lazy blob fetches for changed paths.

```ts
// ~/Work/gitworkshop/src/lib/git-grasp-pool/pool.ts:1533-1607
async getCommitRange(
  tipCommitId: string,
  baseCommitId: string,
  signal: AbortSignal,
  fallbackUrls?: string[],
): Promise<CommitRangeData | null> {
  const [tipResult, baseResult] = await Promise.all([
    this.withFallback(signal, (url) => this.http.fetchFullTree(url, tipCommitId, signal), fallbackUrls),
    this.withFallback(signal, (url) => this.http.fetchFullTree(url, baseCommitId, signal), fallbackUrls),
  ]);
  if (!tipResult || !baseResult) return null;
  return { tipCommit: tipResult.commit, baseCommit: baseResult.commit, tipTree: tipResult.tree, baseTree: baseResult.tree };
}
```

- Budabit PR/merge workflows currently rely on clone/fetch state and should keep clone fallback for write/merge semantics even if read-only analysis gets natural-read acceleration.

```ts
// packages/nostr-git-core/src/worker/worker.ts:1995-2041
await smartInitializeRepoUtil(git, cacheManager, {repoId: opts.repoId, cloneUrls: targetUrls}, deps, progress)
const targetFetchResult = await withUrlFallback(orderedUrls, async (cloneUrl: string) => {
  await ensureOriginRemoteConfig(git, dir, cloneUrl)
  await git.fetch({ dir, url: cloneUrl, ref: opts.targetBranch, singleBranch: true, depth: 100 })
  await git.resolveRef({dir, ref: `refs/remotes/origin/${opts.targetBranch}`})
})
```

### Exit Criteria

- Diff metadata can use object-addressed `blob:none` full-tree reads where compatible and fetch changed blobs lazily by hash.
- Commit-range/merge-analysis read-only discovery can use natural reads where safe, while actual merge, checkout, write, and push remain `isomorphic-git`/worker clone responsibilities.
- Clone-depth repair paths are no longer invoked for normal browsing when Git natural succeeds.
- Dead or misleading GRASP REST read paths, docs, and flags are removed or clearly marked as non-primary.
- Documentation explains remaining cases where clone fallback is intentionally required.
- Cache metrics/debug logs center on source metadata and immutable object cache behavior.

### Expected Touched Areas

- `packages/nostr-git-core/src/worker/worker.ts`
- `packages/nostr-git-core/src/worker/workers/` PR and merge analysis helpers
- `packages/nostr-git-ui/src/lib/components/git/` diff/PR components and managers if source metadata is surfaced
- `packages/nostr-git-core/src/api/providers/grasp-rest.ts`
- `packages/nostr-git-core/src/api/providers/grasp-rest-utils.ts`
- `packages/nostr-git-core/GRASP_REST_IMPLEMENTATION.md`
- `packages/nostr-git-core/GRASP_REST_ROADMAP.md`
- `docs/architecture/git-natural-read-pivot.md`

### Steps

- Add natural commit-range/read-only diff API using two full tree metadata reads and lazy blob fetch.
- Integrate natural reads into read-only PR preview or diff discovery where it does not affect merge/write semantics.
- Keep existing worker clone paths for merge-base/merge/write operations that require local repo semantics or unsupported natural cases.
- Remove, deprecate, or rewrite stale GRASP REST docs and placeholder packfile utilities once natural provider coverage replaces them.
- Simplify router and clone-readiness messages that imply browsing requires clone initialization.
- Document intentional clone fallback cases: private auth unsupported by natural reads, server lacks filter, CORS/proxy unavailable, protocol errors, local editing, merge, push, checkout, and full worktree operations.

### Verification

- `pnpm check`
- `pnpm exec vitest run -c packages/nostr-git-core/vitest.config.ts --coverage.enabled=false`
- `pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts --coverage.enabled=false`
- `git diff --check`
- Manual smoke for browsing, file open, commit history, PR preview/diff if feasible.

### Risks

- Merge-analysis code paths are correctness-sensitive; natural reads must not replace local merge semantics prematurely.
- Full-tree reads can be memory-heavy for large repositories even with `blob:none`.
- Cleanup may remove fallback paths too early if capability coverage is overestimated.
- Documentation cleanup can diverge from code if done before final behavior is stable.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing:
  - Move this phase into `Completed With Evidence`.
  - Record verification commands and results.
  - Record changed files.
  - Set `Current Phase` to the next phase, or `Complete` if no phase remains.
  - Copy the next phase's exit criteria into `Phase Exit Criteria`.
  - Set `Next Action` to the first concrete step of the next phase.
  - Record any remaining risks or blockers.
- Commit and push the phase, including code changes and checkpoint/plan updates.
- Do not leave the checkpoint saying `ready to commit/push` unless commit or push failed.
- Do not consider the phase complete until checkpoint update, verification, commit, and push all succeeded.

### Continue

- After push succeeds, proceed to the next phase unless blocked or explicitly told to stop.

## Success Metrics

- Time to refs visible decreases or stays equal.
- Time to root tree visible decreases.
- Time to README/file visible decreases.
- Bytes transferred before first render decreases.
- Worker clone invocations during read-only browsing decrease significantly.
- Clone deepen/repair retries during browsing decrease significantly.
- Provider REST calls during normal browsing decrease unless explicitly configured or used as fallback.
- Fallback success rate remains stable or improves.
- UI stale result incidents remain zero.
- Auth, CORS, capability, and protocol failures become easier to diagnose.

## Decision Record

- Git natural reads are the preferred remote read path after repo-state seeding.
- Provider REST APIs are fallback/exception paths, not the normal first read path.
- The implementation should learn from Gitworkshop's pool/cache/low-level protocol approach while fitting Budabit's current worker, router, manager, and Nostr/GRASP architecture.
- The incomplete GRASP REST implementation should not be expanded as a separate primary read architecture; its useful ideas are `infoRefs` parsing, branch/tag shape, GRASP URL handling, and documentation of gaps.
- `isomorphic-git` remains the authoritative local Git engine for worktree/write/merge/push/checkout and fallback clone flows.
