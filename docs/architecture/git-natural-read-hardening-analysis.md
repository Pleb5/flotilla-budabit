# Git Natural Read Hardening Analysis

## Scope

- This is an analysis-only report. It does not change production code or tests.
- Budabit files reviewed:
  - `packages/nostr-git-core/src/git/natural-read-client.ts`
  - `packages/nostr-git-core/src/git/natural-read-objects.ts`
  - `packages/nostr-git-core/src/git/natural-read-provider.ts`
  - `packages/nostr-git-core/src/git/natural-read-cache.ts`
  - `packages/nostr-git-core/src/worker/worker.ts`
  - `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts`
  - `packages/nostr-git-core/test/git/natural-read.spec.ts`
  - `packages/nostr-git-core/test/git/natural-read-provider.spec.ts`
- Reference files reviewed from `~/Work/gitworkshop`:
  - `src/lib/git-grasp-pool/git-http.ts`
  - `src/lib/git-grasp-pool/pool.ts`
  - `src/lib/git-grasp-pool/diff-utils.ts`
  - `src/lib/git-grasp-pool/cors-proxy.ts`
  - `src/lib/git-grasp-pool/cache.ts`
  - `src/lib/vendored/parse-packfile.ts`
  - `src/lib/__tests__/git-packfile.test.ts`

## Executive Summary

- The browser error `Invalid packfile header: shal` is caused by Budabit treating a Git upload-pack status pkt-line, `shallow <oid>`, as packfile bytes.
- The failing area is Budabit's custom upload-pack response extraction in `natural-read-client.ts`, not primarily the zlib/object parser in `natural-read-objects.ts`.
- `gitworkshop` delegates upload-pack extraction to `@fiatjaf/git-natural-api`'s `fetchPackfile`, while Budabit reimplemented extraction and missed the `shallow` / `unshallow` pkt-lines that appear when using `deepen`.
- Budabit's pack parser is close to the vendored `git-natural-api` parser used by `gitworkshop`, so it shares some limitations, including no support for forward `REF_DELTA` bases.
- Budabit is missing the hardening patterns that make `gitworkshop` stable in practice: protocol-status filtering, in-flight raw-object dedupe, direct-then-proxy CORS learning, binary-aware diff generation, and deeper round-trip parser tests.

## Observed Failure Analysis

### Symptom

- The app logs errors like `GitNaturalReadError: Invalid packfile header: shal` during natural `getFileContent`, `listDirectory`, and likely `listCommits`.
- The stack points to `parseGitNaturalPackfile()` after `getBlobNoneObjects()` or `listDirectory()` receives a purported packfile.
- The first four bytes of the data being parsed are `shal`, not `PACK`.

### Root Cause

- Budabit sends upload-pack wants with `deepen`, for example `deepen 1` for `blob:none` tree reads at `packages/nostr-git-core/src/git/natural-read-client.ts:392-410` and `deepen: depth` for `tree:0` at `:413-433`.
- Git upload-pack may respond with pkt-lines such as `shallow <oid>\n` or `unshallow <oid>\n` before the `NAK` / side-band pack data.
- Budabit's `extractPackfileFromUploadPackResponse()` skips `NAK`, `ACK`, and `ERR`, then treats any non-side-band payload as pack bytes at `packages/nostr-git-core/src/git/natural-read-client.ts:235-268`.
- A `shallow <oid>\n` payload starts with byte `0x73` (`s`), not side-band channel `1`, `2`, or `3`, so Budabit appends it to `chunks`.
- `parseGitNaturalPackfile()` then sees the first four bytes `shal` and correctly rejects the data at `packages/nostr-git-core/src/git/natural-read-objects.ts:69-74`.

### Why It Appears In Overview And Code Browsing

- README loading calls `VendorReadRouter.getFileContent()`, which tries natural reads first at `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:785-831`.
- File tree browsing calls natural `listDirectory()`, which uses `blob:none` and the same extractor path.
- Commit browsing calls natural `listCommits()`, which uses `tree:0` plus `deepen`, so it can receive the same shallow status pkt-lines.
- Budabit does not dedupe in-flight raw-object fetches for a commit, so multiple simultaneous UI requests can repeat the same failure instead of sharing one upload-pack request.

## Budabit Versus Gitworkshop Comparison

### Transport And Upload-Pack Response Handling

- Budabit implements `fetchUploadPack()` and `extractPackfileFromUploadPackResponse()` directly in `natural-read-client.ts`.
- `gitworkshop` uses `fetchPackfile()` from `@fiatjaf/git-natural-api` in `src/lib/git-grasp-pool/git-http.ts:21-31`, then builds higher-level caching and routing around that stable primitive.
- Budabit's extractor handles side-band channels but does not skip shallow negotiation status lines.
- `gitworkshop` avoids this bug by relying on the library extractor that already handles upload-pack response details.

### Capability Negotiation

- Both implementations select `ofs-delta`, `no-progress`, `multi_ack_detailed`, `side-band-64k`, require `shallow` and `object-format=sha1`, and append `filter` for filtered fetches.
- Budabit selection is in `packages/nostr-git-core/src/git/natural-read-client.ts:193-233`.
- `gitworkshop` selection is in `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:197-223`.
- The strategy is consistent; the bug is not capability selection.

### Pack/Object Parsing

- Budabit's `parseGitNaturalPackfile()` is structurally close to `gitworkshop`'s vendored `parsePackfile()` from `@fiatjaf/git-natural-api`.
- Both parse pack v2, object headers, zlib payloads, `OFS_DELTA`, and `REF_DELTA` with a parsed-object map.
- Both require `REF_DELTA` bases to have already been parsed; neither implementation resolves a legal forward `REF_DELTA` whose base appears later in the pack.
- Budabit should not only copy the reference parser behavior; it should add regression tests around real server packets and forward deltas if natural reads remain enabled for all HTTP providers.

### Tree And Blob Strategy

- Budabit fetches `blob:none` per commit, stores raw object batches, and recursively parses trees directly from the raw object map.
- `gitworkshop` also uses `blob:none` for tree metadata, but it layers parsed-tree caches with nest limits, raw-object cache reuse, and background full-tree parsing.
- Budabit fetches blobs by object hash after `blob:none`, same broad strategy as `gitworkshop`'s `fetchBlobByHash()`.
- Both implementations therefore share the object-by-hash operational risk: some Git servers can reject arbitrary SHA wants unless reachable SHA wants are allowed.
- Budabit should treat object-by-hash failure as an expected fallback condition and make sure worker clone fallback remains healthy.

### Commit History

- Budabit uses `tree:0` packfiles for history at `packages/nostr-git-core/src/git/natural-read-provider.ts:373-383`.
- `gitworkshop` uses the same strategy in `fetchCommitsOnly()` at `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:251-270`.
- Because both use `deepen`, Budabit's missing `shallow` handling affects commit pages too.

### Diff Strategy

- Budabit natural diff fetches two `blob:none` packs, flattens full trees into path maps, and fetches changed blobs sequentially or pairwise in `buildDiffChanges()`.
- `gitworkshop` splits this into pure tree comparison (`diffTrees`) and lazy blob diff generation (`generateUnifiedDiff`) with binary detection and parallel unique blob fetches.
- Budabit lacks binary detection for natural diffs and decodes every changed blob as UTF-8 at `packages/nostr-git-core/src/git/natural-read-provider.ts:690-723`.
- Budabit also does not short-circuit unchanged directory subtrees by tree hash during recursive flattening; `gitworkshop` explicitly does this in `diff-utils.ts:51-67` and `:121-138`.

### CORS And Proxy Policy

- Budabit chooses direct versus proxy with `resolveCorsProxyForUrl()`: GRASP is forced direct, other URLs use the configured/default proxy.
- `gitworkshop` has a `CorsProxyManager` that supports direct-first, proxy retry on CORS-like failures, known blocked origins, and per-origin learned decisions.
- Budabit's worker RPCs use `opts.corsProxy ?? resolveDefaultCorsProxy()` at `packages/nostr-git-core/src/worker/worker.ts:919`, `:974`, `:996`, and `:1037`, so a caller-provided `null` cannot force direct reads for generic remotes.
- That contradicts `VendorReadRouterConfig.gitNaturalCorsProxy` documentation at `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:35-37`.

### Fallback And Rollout Control

- Budabit's UI router has natural/provider/worker fallback for list refs, directory, file content, commits, and commit reads.
- Worker `getDiffBetween()` directly tries natural diff first at `packages/nostr-git-core/src/worker/worker.ts:260-296` and `:3625-3664`, outside `VendorReadRouter` rollout/shadow controls.
- `gitworkshop` centralizes URL health and fallback inside `GitGraspPool.withFallback()` and URL trackers, so repeated failures can mark URLs and reduce repeat noise.
- Budabit should either route natural diff through a comparable policy surface or add an explicit kill switch for worker natural diff.

### Caching And In-Flight Dedupe

- Budabit caches infoRefs, commits, blobs, trees, raw object batches, and history batches in memory.
- `gitworkshop` has L1 memory plus IndexedDB persistence for commits, blobs, refs, parsed trees, and history, with raw object batches kept L1-only.
- `gitworkshop` also dedupes in-flight raw object fetches by commit hash at `~/Work/gitworkshop/src/lib/git-grasp-pool/git-http.ts:1140-1218`.
- Budabit currently dedupes only infoRefs; concurrent directory/README/code-tab requests can each launch their own `blob:none` fetch and fail independently.

### Test Harness

- Budabit tests cover basic pkt-line extraction, filtered want construction, simple pack fixtures, natural provider success paths, and fallback routing.
- Budabit tests do not cover upload-pack `shallow` / `unshallow` status pkt-lines, real-looking multi-packet side-band streams, forward `REF_DELTA`, binary content, object-want rejection, or duplicate in-flight tree fetches.
- `gitworkshop`'s `git-packfile.test.ts` emphasizes round-tripping pack creation and parsing across blob/tree/commit, zero-object packs, trailer checksums, and large object-size varints.
- Budabit should borrow that style for parser fixtures and add upload-pack response fixtures that mimic real server negotiation, not only the happy-path `NAK` plus side-band pack.

## Findings

### High: Upload-Pack Shallow Pkt-Lines Are Parsed As Packfile Bytes

- Location: `packages/nostr-git-core/src/git/natural-read-client.ts:235-268`.
- Impact: Reproduces the observed `Invalid packfile header: shal` during `blob:none` and `tree:0` natural reads.
- Fix direction: Teach `extractPackfileFromUploadPackResponse()` to skip `shallow <oid>\n`, `unshallow <oid>\n`, and other upload-pack status pkt-lines before side-band pack data.
- Quality guard: Validate the final extracted bytes start with `PACK` before passing them to `parseGitNaturalPackfile()` and surface the leading status text in the error details.

### High: Missing Tests For Real Upload-Pack Negotiation Responses

- Location: `packages/nostr-git-core/test/git/natural-read.spec.ts:244-298`.
- Impact: Existing extraction tests only simulate `NAK` and side-band pack data. They would not catch the screenshot failure.
- Fix direction: Add fixtures for `shallow`, `unshallow`, progress channel packets, multiple side-band data packets, flush packets, and protocol error packets.

### High: In-Flight Raw Tree Fetches Are Not Deduped

- Location: `packages/nostr-git-core/src/git/natural-read-provider.ts:559-577` and `packages/nostr-git-core/src/git/natural-read-cache.ts:146-155`.
- Impact: Overview and code-tab loading can trigger repeated identical `blob:none` fetches and repeated console errors for the same commit.
- Reference: `gitworkshop` dedupes raw object fetches by commit hash in `git-http.ts:1140-1218`.
- Fix direction: Add an in-flight map keyed by URL, commit hash, filter, and proxy mode around `fetchBlobNonePackfile()` and `fetchTreeZeroPackfile()`.

### Medium: Worker RPC Null CORS Override Is Ignored

- Location: `packages/nostr-git-core/src/worker/worker.ts:919`, `:952`, `:974`, `:996`, `:1017`, `:1037`.
- Impact: `gitNaturalCorsProxy: null` in the UI cannot force direct natural reads for generic remotes, because nullish coalescing falls back to `resolveDefaultCorsProxy()`.
- Fix direction: Use `Object.prototype.hasOwnProperty.call(opts, "corsProxy")` to distinguish explicit `null` from omitted/undefined.

### Medium: Natural File Content Loses Byte Fidelity In UI Adapter

- Location: `packages/nostr-git-ui/src/lib/components/git/VendorReadRouter.ts:313-325`.
- Impact: Provider returns base64 plus byte size, but router decodes to UTF-8 and sets `size` to JS string length. Binary files and multibyte text are corrupted/mis-sized.
- Reference: `gitworkshop` keeps blobs as `Uint8Array`, caches bytes by hash, and only decodes text after binary checks.
- Fix direction: Preserve provider `encoding: "base64"` and `size`, or convert to the same binary-string convention used by the worker fallback before exposing it to `FileManager`.

### Medium: Natural Diff Is Not Binary-Aware

- Location: `packages/nostr-git-core/src/git/natural-read-provider.ts:676-728`.
- Impact: Binary files are decoded as UTF-8 and rendered as textual hunks.
- Reference: `gitworkshop` skips blob fetches for known binary extensions and checks null bytes before text diffing in `diff-utils.ts:159-355`.
- Fix direction: Add binary detection and emit a structured binary diff marker, or fall back to worker clone for binary changes.

### Medium: Worker Natural Diff Bypasses Router Rollout Controls

- Location: `packages/nostr-git-core/src/worker/worker.ts:260-296` and `:3625-3664`.
- Impact: Natural diff is active even if the UI router policy would have disabled or shadowed natural reads.
- Fix direction: Add an explicit worker config flag for natural diff, or route PR diff reads through the same policy surface.

### Medium: Pack Parser Does Not Resolve Forward `REF_DELTA`

- Location: `packages/nostr-git-core/src/git/natural-read-objects.ts:232-238`.
- Impact: Legal packs with a ref-delta before its base object fail as object-not-found.
- Reference: The vendored `gitworkshop` parser has the same limitation, so this is not the screenshot root cause. It remains a robustness gap for broad provider rollout.
- Fix direction: Parse object headers/data into pending entries, resolve deltas in a second pass by hash/offset, then compute final hashes.

### Low: Parsed Tree Cache Is Less Efficient Than Gitworkshop

- Location: `packages/nostr-git-core/src/git/natural-read-provider.ts:624-674` and `natural-read-cache.ts:138-155`.
- Impact: Repeated browsing re-parses raw tree objects instead of reusing nested parsed tree structures by commit and depth.
- Reference: `gitworkshop` caches parsed trees by commit and nest limit, and schedules background full parse.
- Fix direction: Add parsed-tree caching once correctness fixes land.

## Recommended Fix Order

1. Fix upload-pack extraction first.
2. Add tests for `shallow` / `unshallow` pkt-lines and multi-packet side-band responses before changing behavior.
3. Add in-flight raw-object dedupe for `blob:none` and `tree:0` fetches to reduce duplicate failures and redundant network traffic.
4. Fix explicit `corsProxy: null` handling in worker RPCs.
5. Preserve file-content bytes and byte size across the natural read UI adapter.
6. Add binary-aware natural diff handling inspired by `gitworkshop`.
7. Harden parser delta resolution if natural reads remain enabled for hosted providers at broad scale.
8. Add parsed-tree cache and background parse performance improvements after correctness is stable.

## Test Recommendations

- Add a unit test where upload-pack response is `shallow <oid>`, `NAK`, side-band channel 1 `PACK...`, flush; expected extracted pack starts with `PACK`.
- Add `unshallow <oid>` and multiple `shallow` line variants.
- Add a progress channel test with channel 2 packets before and between channel 1 data packets.
- Add a negative test where the response contains text or HTML and no `PACK`, asserting a clear protocol error instead of `Invalid packfile header` from the parser.
- Add provider tests where `blob:none` responses include shallow status lines, not only clean side-band pack fixtures.
- Add tests that two concurrent `listDirectory()` / `getFileContent()` calls for the same commit share one `blob:none` fetch.
- Add binary file content tests through `VendorReadRouter.naturalGetFileContentToVendor()`.
- Add natural diff tests for binary extensions and null-byte content.
- Add object-want rejection tests that verify fallback to REST/worker paths remains clean.
- Add pack parser round-trip tests modeled after `gitworkshop/src/lib/__tests__/git-packfile.test.ts`, including multi-object packs, large objects, trailer checksum awareness, delta objects, and malformed headers.

## Proposed Implementation Notes

### Upload-Pack Extractor

- Treat upload-pack response as a sequence of pkt-lines.
- Skip known negotiation/status payloads:
  - `NAK\n`
  - `ACK ...\n`
  - `shallow <oid>\n`
  - `unshallow <oid>\n`
  - `ready\n`
- Handle side-band channel 1 as pack data, channel 2 as progress, and channel 3 as fatal remote error.
- Accept unbanded pack data only when the payload begins with `PACK` or when pack collection has already started.
- After concatenation, validate `packfile.subarray(0, 4)` decodes to `PACK`; otherwise throw a protocol error that names the leading bytes.

### Cache/Dedupe

- Add `inFlightObjectBatches` inside `GitNaturalReadProvider` or `GitNaturalReadClient`.
- Key by normalized remote URL, effective proxy mode, commit hash, and filter.
- Share the promise until it settles, then store successful objects in the existing cache.
- Preserve per-caller abort semantics carefully. `gitworkshop` deliberately lets the underlying raw-object fetch complete so the cache still warms even if the initiating caller aborts.

### CORS Null Override

- Replace `opts.corsProxy ?? resolveDefaultCorsProxy()` with explicit presence detection.
- Keep omitted/undefined as default behavior.
- Keep explicit `null` as direct mode.

### File Content

- Avoid decoding natural base64 to UTF-8 by default.
- Either expose `encoding: "base64"` with the original `size`, or convert bytes to the worker-compatible binary string and label it consistently.
- Make `FileManager` cache byte size, not JS string length, when natural reads provide byte size.

### Diff

- Split natural diff into pure tree comparison and blob-content rendering, similar to `gitworkshop`.
- Short-circuit identical subtree hashes before descending.
- Fetch unique changed blob hashes in parallel.
- Detect binary before decoding.
- Cache generated diff output by `baseHash:headHash` if repeated PR tab switching is common.

## Validation Plan For A Future Code Fix

- Run focused natural-read core tests after adding the extractor fixtures.
- Run UI router tests after fixing file content and CORS null behavior.
- Run core and UI typechecks.
- Manually browse the repos from the screenshots and confirm natural reads no longer emit `Invalid packfile header: shal`.
- Confirm fallback still activates on auth, CORS, filter-missing, and object-want failures.

## Residual Risks

- `gitworkshop` is a stable reference but not a complete protocol oracle; its vendored parser shares some limitations with Budabit.
- Hosted provider upload-pack behavior varies. GitHub, GitLab, Gitea, Codeberg, and GRASP should be tested separately after the extractor fix.
- Object-by-hash blob wants may still fail on some servers after the `shal` fix; fallback behavior must remain first-class.
