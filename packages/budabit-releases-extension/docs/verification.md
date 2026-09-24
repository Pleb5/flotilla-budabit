# Verification scope

The release remediation is tested without private accounts, public relay publication or executable content from the network.

## Cross-session recovery follow-up (2026-09-11)

The detail correction in `87cd2fb` was independently confirmed; the new finding concerns the older single-key publication journal. Three persistent shared-backend regressions failed against that baseline: both overlapping preparations claimed the slot, a stale publication completed against a later partial batch, and stale discard succeeded. Account/repository scope alone did not protect batch ownership.

The correction keeps one active batch per account/repository and adds unique batch IDs plus conditional creation, progress and deletion. Host `28ba443db` implements versioned reads and `storage:compareAndSet` under host-origin Web Locks shared across tabs; ordinary writes/removal and legacy read migrations participate too. Widget conflicts stop the stale action and reload recovery state. A refreshed batch requires a new user action and fresh discard consent. Older hosts fail closed; existing signed journals remain resumable without new signatures. This is atomic **local storage**, not atomic remote publication.

Fresh verification in this follow-up:

- Frozen-lockfile install and widget `pnpm verify` pass: lint, Svelte-check (**0 errors / 0 warnings**), **60 unit tests in 13 suites**, production build and **16 production-artifact Chromium tests**. Final coverage: **97.91% statements/lines, 100% functions, 88.63% branches**; gates/scope unchanged. Production HTML: **320.39 KB / 105.31 KB gzip**. The final combined browser run completed in **10.4 seconds**. Node25.2.1, pnpm8.15.0, installed Chromium; no remote CI run. The pnpm installer emits the previously recorded Node25 deprecation warning.
- Seven shared-backend unit cases cover overlapping preparation, stale same-session resume, valid/invalid stale discard, delayed old progress/cleanup after a later batch partially publishes, same-batch retries, and distinct batch identities. Additional publication cases cover unsupported/malformed atomic responses, transport errors without discard tokens, legacy journals, invalid batch identity and lost initial storage acknowledgement. No live signer or relay I/O.
- Two added production-browser cases use independent tabs sharing the fixture storage backend: a losing creator refreshes to the winner's batch with no signatures/publication from the losing tab; stale discard preserves the later batch, clears confirmation, and requires fresh consent. All prior live-detail/file-check regressions remain green.
- Host: **98 focused tests in eight suites** pass, including77 bridge tests, exact scope checks after lock waits, legacy compatibility, value limits, and the real Welshman pagination regression. Targeted TypeScript compilation of the storage module/browser fixture/spec/config passes.
- **Two host Chromium tests** pass in **1.6 seconds**, importing the production storage implementation in an isolated fixture with actual Web Locks and shared localStorage across separate same-origin tabs. Concurrent empty-slot claims yield one success and one conflict. Stale update/delete preserve the next batch; ordinary writes, removal and legacy migrations demonstrably wait for the same lock. These are not mocked lock callbacks or a module-local mutex.
- The actual repository-tab route's rename/remount/storage browser regression was rerun and passed (**5.0 seconds**, runner6.4s), using the correct existing full Budabit development stack, a fresh anonymous context and mocked relays. This tests route/bridge wiring separately from the isolated storage-engine browser tests.
- Session-owned warm helper: two isolated fixture clients reproduced stale confirmation after replacing batchA with batchB. The old action preservedB byte-for-byte, showed its release/batch ID and conflict notice, and removed old consent. Fresh consent then discardedB and restored creation, without extra synthetic publish attempts from the stale client. The screenshot was opened and inspected. The helper uses current development code; it is separate from production-artifact tests. No browser errors; the console contains Vite debug logs and existing `ArtifactSelector.svelte` non-reactive appId/version binding warnings. No functional failure from those warnings was reproduced. One scripted helper click was attempted before Svelte enabled the submit button (zero signer/publication calls); waiting for the actual enabled state corrected the probe. Dedicated browser and task-owned fixture server closed; existing host/watchers preserved.

Deploy host `28ba443db` **in addition to** the prior bridge/pagination commits and the widget's updated `storage:compareAndSet` permission. Close/reload old host/widget tabs: arbitrary direct storage changes and old unconditional writers are outside the concurrency protocol. Browser storage remains local and can be cleared; locks do not cancel in-flight remote publication. Live signers, deployed CDN redirects, full host/PWA behavior and native signatures remain outside the verified scope.

Reproduce the host storage browser gate with the full host development stack already running:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test --config=playwright.extension-storage.config.ts
```

## Recorded detail-effect follow-up (2026-09-11, before cross-session recovery)

The re-review confirmed all seven previous findings fixed, but found that the detail-loading effect tracked the entire reactive authority snapshot. This follow-up samples the latest authority getter under Svelte `untrack` while preserving both before/after-load checks and App's replacement/revocation handling. Intended reloads also clear obsolete file-verification statuses, not just their generation tokens.

Three new production-artifact Chromium cases reproduced the failure before the correction:

- Both unrelated release and unrelated application updates increased asset queries from **4 to 8**, detached the original file input, cleared its selection, and left a valid delayed hash at **“Checking…”**.
- Explicit asset retry also left the canceled check at **“Checking…”**, including after the delayed read finished.

With the correction, both unrelated-update cases keep **4 asset queries**, retain the original input/selection, and finish with **“SHA-256 matches signed metadata”**. Each also verifies that a subsequent real replacement resets the input/result and revocation removes downloads. Tests wait for the controller's post-event cache write before checking stability, rather than asserting before its coalesced emission. Explicit retry clears status before and after the old read finishes; the existing newer-mismatch/old-match race regression still passes.

Fresh follow-up verification: `pnpm verify` passes lint, Svelte-check (**0 errors / 0 warnings**), **50 unit tests in 12 suites**, production build and **14 Chromium tests** against built HTML (5.1 seconds). Domain coverage is **97.79% statements/lines, 100% functions, 88.19% branches**; thresholds and scope are unchanged. The self-contained production HTML is **318.41 KB / 104.62 KB gzip**. Runtime remains Node 25.2.1, pnpm 8.15.0, installed Chromium.

The session-owned warm browser also verified the current development fixture: a held synthetic file check survived unrelated release and application events with the original input and four asset queries, then displayed the full matching-hash result. A real replacement cleared the input/status, and application revocation removed the controls. Screenshots were opened and inspected; no browser errors, only Vite connection debug logs. The dedicated browser and newly started fixture server were closed; the existing Budabit development stack was untouched. This helper check is development-fixture evidence, separate from the production-artifact Chromium suite.

No Budabit host implementation changes were made for this follow-up. The **89 host tests and actual-route browser result below are recorded second-review evidence, not newly rerun host suites**. Live accounts, public publication, deployed CDN redirects, native signatures and a full host/PWA audit remain outside the verified scope.

## Recorded second-review gates (2026-09-11, before the detail-effect follow-up)

- Local runtime: Node 25.2.1, pnpm 8.15.0, installed Chromium; CI is configured for Node 22.12+ compatibility via Node 22 and the pinned pnpm version. The CI service itself was not run locally.
- Frozen-lockfile install, lint, Svelte-check (zero errors/warnings), **50 tests in 12 suites**, build and **11 production-artifact Chromium tests** pass via `pnpm verify`. The browser suite completed in 3.0 seconds.
- Domain coverage: **97.79% statements/lines, 100% functions, 88.17% branches** in the fresh combined run.
- Production artifact: one HTML file, **318.36 KB / 104.64 KB gzip**; tests verify no external script/stylesheets or development signer fixture are included.
- Host: **89 focused tests in seven suites** pass, including the actual installed Welshman batching/tracker implementation with mock relay adapters. The actual repo-tab route's focused browser test passes (3.8 seconds; runner 4.7 seconds, mocked relay transport, fresh anonymous context).
- Helper visual checks on the current development fixture: warm detail replacement/revocation leaves one subscription active and removes all downloads/metadata presentation; corrupt-journal confirmation is readable and successful local discard restores creation with zero publication attempts. A fresh cold 390×844 detail view keeps the filename readable, confines horizontal overflow to the asset table, and contains no media from hostile notes. Screenshots were opened and inspected. No browser errors; cold console contains only Vite connection debug messages. Both helper sessions are closed.
- Explicit implementation formatting and both repositories' diff checks pass. Host tests emit third-party missing-sourcemap warnings; the pnpm 8 installer emits a Node 25 deprecation warning. Neither is a product failure or silently treated as a failed gate.

The first-round 2026-09-10 result (40 unit tests, eight browser tests, 88 host tests; 97.55% statements/lines and 87.57% branches) is **historical**, not evidence for the seven subsequent review findings. Its “complete” assessment was reopened. Second-round implementation commits are host `a8716cfb9` and widget `de301f4`, `a4f634d`, `274c0f7`, followed by documentation/verification closeout `82551f0`. Detail-effect correction `87cd2fb` and the cross-session recovery follow-up above supersede that test/build count.

Commands used:

```sh
pnpm install --frozen-lockfile
TMPDIR="$HOME/.cache/opencode-v2/tmp/opencode" PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm verify

# In the Budabit checkout:
pnpm exec vitest run --project=main src/app/extensions/bridge.test.ts src/app/extensions/repo-context.test.ts src/app/extensions/url-policy.test.ts src/app/extensions/nostr-query.test.ts src/app/extensions/nostr-query.integration.test.ts src/app/extensions/host-capabilities.test.ts src/app/extensions/repo-tab-context.test.ts --silent
# Actual route regression uses a session-private config, no global account/auth setup.
pnpm exec playwright test --config=<private-focused-config> -g 'actual extension route'
```

## Domain regressions

`pnpm test:coverage` includes signature tampering, outsider publishers, exact repository linkage, publisher namespaces, deterministic replacements, application revocation, spoofed/ambiguous runs, asset lineage, independent asset metadata, required APK fields, safe URLs, local-file mismatch, pinned signer changes, corrupted journals, partial retry, async disposal, cache authority, relay cursors/partial responses, unresolved assets and Markdown sanitization. Offline manifest generation tests actual shell URL expansion and permissions/kinds.

Coverage is for `src/lib/**/*.ts` implementation only, excluding types/test fixtures. Gates: 95% statements/lines/functions and 85% branches. Svelte markup/CSS is not passed off as instrumented unit code; component behavior has separate Chromium tests. The former blanket 95% scaffold gate incorrectly counted uninstrumented component/style/config lines.

## Widget browser fixture

`pnpm e2e` builds the widget, then fulfills its iframe navigation inside `test-host/` at `http://localhost:5179/test-host/` with that self-contained production HTML. It uses the repo-tab sandbox and mock postMessage responses with genuine synthetic Nostr signatures. HTTPS popup requests are fulfilled by the test browser, not sent to external services.

Checks: unauthorized releases hidden; addressable replacement; logout/clear; stale fallback response; subscription cleanup; open-detail replacement/revocation and delayed asset responses; passive notes with zero unsolicited HTTPS requests observed through rendering; user-activated guide/asset popups preserving iframe navigation; local hash mismatch/match and selection invalidation; a delayed earlier match cannot overwrite a newer mismatch after a metadata retry; one-run selection; fixed-event resume after reload; same-session resume blocked by newer app revocation; corrupt journal retry/cancel/storage-failure/confirmed-discard recovery; incomplete discovery/retry; mobile table containment; production artifact excludes the test signer fixture. The fixture is not the Budabit host implementation.

The isolated `oc2-browser` warm/cold profiles are used separately for visual checks. Evidence remains in private session artifacts, not the repository. No personal browser is attached.

## Budabit integration

Host commit `c97928826` added focused bridge/query/context/origin tests, including delayed events beyond the former 500 ms cutoff, per-relay completion, known-ID completion, aborted/late queries, pinned scope, kinds, owned unsubscribe and accepted runtime origins. Its warning-free changed-Svelte compilation is first-round evidence; this round changes no host Svelte component.

`a8716cfb9` isolates the per-relay loader state and adds `nostr-query.integration.test.ts`. Its control runs the **real** shared `makeLoader` with `MockAdapter` delivery: overlapping 100-event pages give callbacks of 100/0, demonstrating the original failure. The corrected host function returns 100/100 even for concurrent bridge calls; inclusive follow-up pages return 1/51, giving all 150 unique events. It does not mock `load()` or open real relay sockets. The recorded second-review host selection contains 89 tests across seven suites.

The existing `repository-identity-integration.spec.ts` test **“the actual extension route preserves addresses and storage through rename and remount”** passed in the second review against the actual `/git/<naddr>/extensions/identity-review` surface on the correct full development stack. It uses mocked relays, an anonymous fixture widget and a fresh browser context. A session-private Playwright config avoids the host suite's unrelated artifact cleanup/global authentication setup. This validates the real route/bridge context and storage lifecycle, not live CDN redirects or production signer services.

## Not established by these checks

No live Nostr account signing or relay publication, APK/native certificate validation, reproducible builds, malware scanning, CDN redirect deployment, large executable downloads, or full Budabit build/E2E/PWA/offline audit. EOSE only reports a bounded relay response; trust policy still depends on the host's current repository authority and relay availability. Legacy releases without the required application link are intentionally hidden.

Legacy unlinked pipeline artifacts depend on completed discovery of current maintainers' delegations across repositories, not global key uniqueness or honest relay history. Every publication batch has an authority preflight, but a revocation can still race later sequential remote writes. Browser helper evidence uses the development fixture; persistent Chromium regressions use the built production artifact. Neither establishes real signer/CDN deployment behavior.

## Second-review reconciliation

| Finding                                                                | Correction and direct regression evidence                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Shared loader falsely reports exhausted pages                       | Independent loader per relay page, including simultaneous bridge requests. Host real-loader control reproduces 100/0 suppression; corrected queries recover all 150 events. Widget cursor/partial/shared-second regressions also pass.                                                                                                    |
| 2. Detail loses live replacement/revocation authority                  | App-owned controller survives navigation; detail requires a current-authority getter before and after asset queries. Unit probe now rejects revoked/superseded events; production browser updates open detail, removes revoked downloads and rejects held stale replies.                                                                  |
| 3. Saved/same-session publication uses obsolete application authority  | Every batch attempt reconciles live app revisions with embedded signed candidates. Three originally failing tests now stop same-session/restored publication on newer revocation or incomplete discovery with no new publish calls; newer linked revisions remain compatible. Browser covers same-session failure and reopening recovery. |
| 4. Reused publishers across repositories misattribute legacy artifacts | Scan all repository scopes of current maintainers before run selection; reject reused delegations. Signed `other-repo.bin` fixture can no longer acquire the current run/commit; distinct-key legacy and exact-linked cases pass; partial scans fail closed.                                                                              |
| 5. Invalid journal traps creation                                      | Explicit recovery state offers retry and confirmed scoped discard, warning that publication is not undone. Browser checks corruption, cancellation, storage failure, successful discard and pipeline restoration; unit tests reject changed/aborted account scope.                                                                        |
| 6. Quadratic cryptographic work during live backfill                   | Private immutable-record membership separates verification from authorization; 16 ms emission coalescing. 250-event regression initially made 31,875 crypto calls, now requires exactly 250 and one state emission. Deep-mutation/same-ID-copy tests prevent shortcutting the input trust boundary.                                       |
| 7. Sanitized notes load media resources automatically                  | Passive Markdown allowlist excludes media/embed/resource attributes. Browser test initially observed poster/audio requests; now records zero external requests through rendering, while user-clicked HTTPS guide/download links work. Unit coverage includes SVG, styles, source/srcset, embeds and ping.                                 |

## First-review reconciliation (retained regression scope)

| Original finding                                                 | Remediation and evidence                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outsider releases and repository/name heuristics                 | Independent signatures and exact owner/maintainer/application links; trust/context tests and attacker browser fixture.                                                                      |
| Spoofed pipeline actor/delegation and historical filename voting | Authenticated run signer, unambiguous publisher delegation, contradictory lineage rejection, explicit single-run selection; pipeline tests and creation flow.                               |
| Missing NIP-82 links/metadata                                    | Application coordinate, independent asset identity/version, filename/platform/APK fields retained and validated; builder/parser tests.                                                      |
| Signature confused with binary/native verification               | Bounded local-file hash checks and explicit caveats; mismatch and selection-invalidation browser regressions. Native signatures remain out of scope.                                        |
| Partial signing/publication and changed account                  | All-sign-before-publish, template verification, scoped journal, current-context checks and identical-ID retries; publication tests and reload/resume flow.                                  |
| Stale cache/addressable revisions                                | Canonical replacement keys, link revocation, reverified scoped cache without cached application authority; list-controller tests and replacement flow.                                      |
| Missed context/logout and late listeners                         | Reactive context/explicit clears, stale fallback guard and disposal-safe startup; lifecycle tests and delayed-response/logout browser checks.                                               |
| Silent truncated queries and unresolved assets                   | Per-relay EOSE/partial metadata, bounded cursors, no 500 ms first-event cutoff, unresolved IDs/retry; widget and host query/detail tests.                                                   |
| Denied unsubscribe and divergent repo-tab surface                | Manifest unsubscribe permission, owned cleanup tests, actual route context/readiness helpers and repo-tab integration test.                                                                 |
| Unsafe redirects/blocked external links                          | Exact origin/source policy and synchronized push destination; reviewed popup/download sandbox; host origin tests and intercepted Chromium popup flow. Live CDN redirect remains unverified. |
| Scaffold build/CI/tests/docs                                     | Svelte-check, production-artifact tests, real manifest CLI test, pinned supported runtimes/actions/branches and actual-contract documentation. No publishing workflow was executed.         |
