# Initial Repository Import

The supported importer is **new repository creation plus one-time initial data delivery**, not incremental forge synchronization. It is available from `/git` → **Import Repo**, or **New Repo** → **Create from GitHub**. `FEATURE_IMPORT_REPO=0` hides the entry points; the supported lane is otherwise enabled. The [legacy importer](./legacy-repository-import.md) remains dormant, not merged with this executor.

## Supported lane

- One public, nonempty GitHub repository. Both inspection and source Git reads are anonymous even when a history API token or saved worker credentials exist. Only the selected history API requests may use the optional token.
- One **new** GRASP destination and kind-30617 coordinate under the active Nostr account. Existing, provisioned-but-empty, and ambiguous destinations cannot be adopted by a fresh job.
- All advertised branch and tag tips, including their reachable history, within the limits below. There is no silent top-five branch selection or shallow-history default.
- Optional issues, current open/closed status, and issue conversation comments. GitHub PR objects encountered in the issues endpoint are skipped explicitly.
- No source mutation, hosted destination creation, multi-target migration, recurring reconciliation, or distributed deduplication.

Pull requests and their Git refs, private repositories, LFS object transfer, release assets, wikis, and submodule repository migration are not supported. Large or unusual jobs need a native migration. GitHub's size estimate is an admission check, not proof of the exact pack size or peak heap.

## Effect ordering

1. Validate source/public access, actor, destination/coordinate availability and all branch/tag refs. Check both planned metadata events fit before the first publication. Review has no remote mutation and does not retain full history.
2. The user approves public effects. Save a version-1 IndexedDB job with frozen source identity, actor, destination, category choices, cutoff and refs.
3. Sign kind **30617**, verify the signer preserved its planned identity, and save the exact signed pending event **before sending**. Require the selected GRASP relay's explicit ACK. A provisioned endpoint or missing explicit relay outcome is not an ACK.
4. Await GRASP receive-pack provisioning, then clone the source into one transaction-owned local mirror, without a worktree checkout or repository-cache entry. Require a completed clone receipt and verify local tips against the reviewed refs; refs alone do not prove an interrupted clone contains complete history.
5. Sign, save and obtain the required ACK for kind **30618**, containing those exact branch/tag refs and HEAD, **before pushing any Git data**.
6. Refuse divergent destination refs and conflicting coordinate metadata, including when resuming with a previously admitted state. Push missing pinned refs without force or automatic repair fetch. Verify the exact destination branch/tag set and announcement/state visibility after GRASP promotion. Purgatory admission does not require pre-push readback; promotion does.
7. Mark Git verified independently of history completion. Remove only the job-owned local mirror after known worker settlement, then stream optional history sequentially.

The first recorded publication attempt is the public boundary, even if its ACK is lost. Announcements can remain after clone failure. Accepted pushes and published Nostr events cannot be reliably rolled back; the new executor has no remote-delete or compensating-publication callback.

GRASP availability/ref checks use the direct endpoint used by the push, not a proxy's absence response. Failed ref discovery is unknown, never permission to push. The worker rechecks each destination tip and refuses a differing tip, even if Git could fast-forward it. These are optimistic client checks, not a server-side lock against concurrent owner actions; final verification can detect a race but cannot undo an accepted push.

## History delivery and trust

The working set is an issue page plus its currently active comment page, one template and one signed pending event. Delivery awaits the required relay before advancing the stream. There is no full-history plan, pre-signing buffer, event retry array, or whole-store hydration on resume.

Events are signed by the repository owner, not fabricated forge-user keypairs. `imported`, `proxy`, `source-author`, `source-key`, `original_date` and `original_updated_at` describe the source attribution asserted by that importer. A source key contains the forge origin, stable GitHub repository ID, object type and global object ID. Original authors do not gain control of the importer's Nostr signature.

An `imported` tag **never grants status authority**. Repository owner/direct-maintainer authority is still required for imported baselines. Native root-author status behavior is unchanged. Issue detail and conversation UI explicitly distinguish GitHub attribution from the Nostr signer.

All selected metadata and history go to the **same required GRASP relay**, avoiding root/comment graphs scattered across unrelated successful relays. The route uses isolated publication with `publishLocally: false`; the main event cache is not an import retry queue. Exact reads use isolated, EOSE-complete, small-query budgets. Publication is paced at least 1.25 seconds apart; failures stop for user-directed recovery rather than retaining automatic retry jobs.

## Durable state and continuation

Database: `nostr-git-initial-import`, stores `jobs` and `receipts`.

- A unique `[owner, name]` job index prevents a second local job for the same coordinate.
- Each job stores at most one signed pending event, exact signed announcement/state, pinned refs, current worker operation ID, Git/history status and numeric confirmed counters.
- After an ACK (or an exact readback of a previously pending history event), one transaction writes a compact source-key → event-ID/type receipt, increments counters and clears the pending body. Delivered history bodies are not retained.
- Indexed lookups skip receipts without building an in-memory history index. Templates for confirmed source keys are not rebuilt.
- Identity and source/destination/config are immutable within a job. Tokens, key material and credential-bearing URLs are not journal fields. Signer output is copied to plain wire fields and cryptographically checked before storage. Recovery revalidates signatures without trusting mutable verification caches, metadata against the approved plan, pending source/destination scope, counters/stages and pending-event budgets. Stale saves cannot discard a pending event or confirmed progress.
- One browser Web Lock serializes the import lane across tabs. An outstanding cancelled signer prompt also blocks another prompt for that actor until it settles.
- Stop retains that lock while a relay read/send reaches its deadline (10 seconds for reads, 30 seconds for publication). Rapid retries therefore cannot accumulate detached relay transports. A late confirmed ACK can still be journaled; no next effect is scheduled.
- Unmounting the dialog defers store/transport disposal until its active operation has settled and saved recovery. Idle dialogs close their IndexedDB handle. The partial-history action holds the same lock, captures its job identity and disables navigation until its write settles.

**Resume is same-job continuation, not sync.** It rechecks public source identity and actor, settles known worker receipts, retries the exact signed pending event, and rescans source streams while skipping confirmed receipts. New source items after the creation cutoff are excluded. Unprocessed bodies/statuses are read afresh: source edits, deletions or pagination movement during an interruption can affect the remaining import. No frozen-snapshot or exactly-once transport claim is made.

Before retrying metadata, any visible conflicting coordinate metadata blocks replacement. Before delivering pending history, the saved repository announcement must still be the current visible announcement. Unknown workers, incomplete clones, divergent refs or changed announcement scope stop for manual inspection. Reload does not turn an unknown Git operation into a safe retry.

**Stop** prevents further scheduled effects, requests scoped worker cancellation, and retains recovery rather than terminating the shared worker. An in-flight send/push may still complete. “Repository created” and “selected initial history complete” are separate results. **Keep repository; stop history** preserves a usable partial repository and the record of any unconfirmed event. Closing a dialog does not delete public data. Clearing site data loses local recovery; a new job must not reconstruct/adopt the existing destination.

## Resource budgets

| Resource                                     | Limit                                                 |
| -------------------------------------------- | ----------------------------------------------------- |
| GitHub-reported repository size              | 50 MiB                                                |
| Clone/push HTTP body                         | 64 MiB per request/response                           |
| Git ref advertisement / GitHub JSON response | 2 MiB                                                 |
| Branch/tag refs                              | 100                                                   |
| Source page size / pages per stream          | 30 items / 200 pages                                  |
| Source items scanned per attempt             | 5,000, including skipped PRs                          |
| Delivered history                            | 1,000 events / 8 MiB cumulative signed bytes per job  |
| Signed event / job record                    | 32 KiB / 128 KiB                                      |
| Saved local jobs                             | 50 globally; no age-based dropping of unresolved work |
| Exact relay read                             | 10 events / 64 KiB, 10-second request deadline        |

Limits stop with a partial result, never silent truncation. IndexedDB has a job/receipt budget as well as browser quota; persistence failure stops the next effect. HTTP limits are applied during body consumption, before aggregation/JSON parsing where the transport allows it. Browser Git still needs transient packing, inflation and delta buffers: **64 MiB transferred is not a guaranteed 64 MiB heap ceiling**, and unusually large expanded objects remain a reason to use native Git.

Upload aggregation copies chunks immediately into a geometrically grown byte buffer, rather than retaining a chunk-object array. This handles producers that reuse their views and bounds allocation overhead even for tiny chunks. A growth step can temporarily retain both buffers, and fetch/Git can make additional copies; this is not a peak-Git-heap guarantee. Aborted uploads are not sent, HTTP error bodies are cancelled, and consumed response readers release their locks. Initial-import ref RPCs have a 30-second transport deadline; internal clone/push ref advertisements also retain the 2 MiB cap rather than inheriting the larger pack budget.

## Verification and limits of evidence

- Unit tests cover identity/URL limits, stream backpressure, byte caps, event provenance/trust, signer mutation, ACK admission, exact retry, changed actor/scope, storage failure, reload via a new store instance, unknown worker outcomes and ref divergence.
- Worker tests cover anonymous no-checkout/full-history clone options, pinned head/tag pushes, failed/ref-changed probe rejection, no force and no unbounded repair fetch. Existing new/fork/GRASP tests remain in place.
- `tests/e2e/initial-repository-import.spec.ts` verifies approval → lost ACK → partial result → same-job completion, both within one dialog and after reload, plus partial-save UI ownership and unmount during publication, with mocked Git/publication and real browser IndexedDB.
- Its isolated retention fixture streams 250 issue pages (500 events, over 5 MiB), then retries one pending event 25 times. Chromium GC/heap measurements require less than 3 MiB retained growth; the follow-up review run measured 40,768 bytes (about 40 KiB). This isolates importer retention from unrelated app hydration. `fake-indexeddb` is used for correctness, **not heap evidence**, because it retains completed transactions.
- This is not live GRASP/GitHub or a full browser-Git peak-memory certification. See the [manual acceptance checklist](../features/initial-repository-import.md).

## Primary implementation

- `packages/nostr-git-ui/src/lib/utils/initial-import{,-source,-metadata,-store,-git}.ts`
- `packages/nostr-git-ui/src/lib/components/git/InitialImportDialog.svelte`
- `packages/nostr-git-core/src/git/{abort-controller,bounded-http-client,isomorphic-git-provider}.ts`
- `packages/nostr-git-core/src/worker/{worker,progress}.ts` and `worker/workers/repos.ts`
- `src/app/core/git-commands.ts`, `src/app/util/fetch-relay-events.ts`, `src/routes/git/+page.svelte`
