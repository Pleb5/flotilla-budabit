# Repository Import Architecture

This document describes the implemented repository import lifecycle in Budabit. Import is a transaction across Nostr relays, GRASP Git servers, and optional hosted Git providers. Repository metadata must be admitted before irreversible Git work begins, and repository state must authorize each GRASP push before `git-receive-pack` starts.

## Scope

The import flow supports:

- importing an existing public Git repository;
- targeting one or more GRASP servers;
- targeting hosted Git providers such as GitHub or GitLab;
- hybrid imports that combine GRASP and hosted targets;
- reusing an existing GRASP repository announcement;
- importing pull-request refs when the source provider exposes them;
- recovering or rolling back partially completed transactions.

The flow is implemented primarily in:

- `packages/nostr-git-ui/src/lib/hooks/useImportRepo.svelte.ts`;
- `packages/nostr-git-ui/src/lib/utils/remote-sync.ts`;
- `packages/nostr-git-ui/src/lib/utils/grasp-pipeline.ts`;
- `packages/nostr-git-ui/src/lib/utils/repo-creation-transaction.ts`;
- `packages/nostr-git-ui/src/lib/utils/repo-creation-recovery.ts`;
- `packages/nostr-git-ui/src/lib/utils/worker-operation-session.ts`;
- `src/app/core/git-commands.ts`;
- `src/app/util/fetch-relay-events.ts`.

## Terms

### Repository announcement

A kind `30617` replaceable event that identifies the repository and advertises its clone URLs, web URLs, maintainers, and repository relays.

### Repository state

A kind `30618` replaceable event that records the repository's refs. GRASP uses this event to authorize and stage an incoming push.

### Repository relays

The relays selected for the repository's Nostr metadata. During initial admission, this set consists of the configured metadata relays plus every new selected GRASP target relay, with duplicate GRASP origins removed.

### GRASP relay

The Nostr relay associated with a selected GRASP Git target. A GRASP relay may also be a repository relay, but admission still requires an explicit ACK from each newly selected GRASP target's relay.

### Provisional announcement

The initial kind `30617` event published before cloning, remote creation, or pushing. It proves that the repository coordinate is admitted by the required relays. For a new GRASP repository, ngit-grasp keeps this event in purgatory until Git data arrives.

### Final announcement

The reconciled kind `30617` event published after synchronization. It advertises only successful targets and the selected repository relays.

## Core Invariants

The import flow preserves these invariants:

1. Metadata admission precedes source cloning, hosted repository creation, and Git pushes.
2. The provisional announcement must receive at least one repository-relay ACK.
3. Every newly selected GRASP target must ACK its provisional announcement on its own relay.
4. Existing GRASP targets reuse their current announcement rather than replacing it with a provisional event.
5. A GRASP target must be ready for Smart HTTP before Budabit clones the source repository.
6. A matching state event must be published and ACKed before each GRASP push.
7. GRASP targets are processed before hosted Git targets.
8. A failed target is excluded from final clone and web URLs.
9. Repository metadata never gains relays outside the user's selected repository relays.
10. An exact post-push read is successful only when the expected event is returned, not merely when a relay completes a query.
11. Rollback targets only relays that ACKed provisional events.
12. Recovery publishes newer reconciled metadata instead of replaying stale provisional metadata.

## Import Lifecycle

### 1. Validate the request

Budabit validates the source URL, repository identity, selected metadata relays, selected targets, credentials, and provider-specific constraints. The transaction records the operation identity, sanitized target plan, relay ACK evidence, completed target results, signed final events, and pending Nostr compensations.

Validation happens before metadata publication. No target should be provisioned for a request that cannot produce a valid repository coordinate or announcement.

### 2. Build the target plan

The importer separates targets into:

- new GRASP targets;
- existing GRASP targets;
- hosted Git targets.

GRASP targets are ordered before hosted targets. This resolves the Nostr-native path before hosted repositories are created and makes partial-success reconciliation deterministic.

Each GRASP target keeps its own relay, Git endpoint, and exact admitted announcement. New targets normally share the signed provisional event. Existing targets retain the current event fetched from their relay. All of these events use the same repository coordinate.

### 3. Publish the provisional announcement

Before cloning or creating remotes, Budabit signs the repository announcement and publishes it to:

- the selected repository relays; and
- each new GRASP target's own relay.

The import is admitted only when:

- at least one selected repository relay returns a matching successful `OK`; and
- every new GRASP target's relay returns a matching successful `OK` for that target's signed event.

The publisher records ACK evidence by event ID and relay. A queued send, an open WebSocket, an `EOSE`, or an unrelated relay response is not admission evidence.

An existing GRASP repository is different. Budabit queries its current kind `30617` event and reuses it for readiness and synchronization. It does not publish a replacement provisional announcement that could hide or disturb an already usable repository.

If admission fails, the transaction stops before cloning, hosted repository creation, or pushing. Rollback is limited to relays that actually ACKed a provisional event.

### 4. Wait for GRASP provisioning

For every new GRASP target, Budabit polls the target's Smart HTTP endpoint after announcement admission. A successful announcement ACK means the server accepted the Nostr event; it does not by itself prove that Git storage and HTTP routing are ready.

The import proceeds only when each required GRASP endpoint is ready. Provisioning failure is attributed to the affected target rather than being confused with a source-clone failure.

On ngit-grasp, a newly accepted announcement is normally acknowledged with a `purgatory:` message. The event is intentionally hidden from ordinary relay `REQ` queries while the corresponding Git repository is empty. Smart HTTP readiness, rather than an immediate `REQ` readback, is the valid pre-push check.

### 5. Clone the source

Only after metadata admission and GRASP readiness does the worker clone the source repository. Progress is streamed to the UI. The journal records whether the transaction-owned local mirror is planned, being created, created, awaiting cleanup, cleaned, failed, or unknown. Successful imports remove the temporary mirror after every worker mutation has reached a terminal or explicitly unknown state.

Source cloning may discover more concrete repository information, such as the default branch and refs, but it must not broaden the selected repository relay set.

### 6. Synchronize targets

Targets are synchronized sequentially, with GRASP targets first.

#### GRASP target

For a GRASP target, Budabit:

1. reuses the target's already signed announcement and admission result;
2. confirms the target is ready;
3. derives the refs that the push will create or update;
4. signs a kind `30618` state event for those refs;
5. publishes the state event to the target relay;
6. requires a matching successful `OK` for that state event;
7. pushes the Git refs;
8. queries the target relay for the exact announcement and state event IDs.

The state-before-push order is required by ngit-grasp authorization. Publishing state after starting `git-receive-pack` is too late.

The successful state ACK is commonly marked `purgatory:`. The event remains hidden from normal reads until the push succeeds and ngit-grasp promotes the announcement and state together.

#### Hosted Git target

For a hosted target, Budabit:

1. creates or resolves the destination repository through the provider API;
2. adds the destination remote;
3. pushes the repository refs;
4. records the clone and web URLs only after target success.

Hosted failures are isolated to their target. Budabit does not reinterpret a hosted API response as Nostr relay evidence.

### 7. Synchronize pull-request refs

When the source provider exposes pull-request refs, Budabit can push those refs after the main repository synchronization. Worker results are checked strictly: partial or unsuccessful ref pushes are failures, not successful completion with warnings.

Pull-request refs do not change the repository's metadata relay set. A failed optional ref synchronization is reported separately from the main target's repository push where possible.

### 8. Verify GRASP promotion

After a successful GRASP push, Budabit performs exact event reads for the expected kind `30617` and kind `30618` event IDs.

The query distinguishes:

- the exact expected `EVENT`;
- a completed query with no event (`EOSE`);
- relay disconnect;
- timeout.

Only the exact event is positive evidence. An empty completed query is not treated as success.

Budabit does not blindly replay the announcement after a push. ngit-grasp owns promotion from purgatory to visible relay storage. Replaying the announcement could create a newer replacement at the wrong time and is not evidence that the original transaction was promoted.

### 9. Reconcile final metadata

After all targets have settled, Budabit constructs the final announcement from successful results only.

The final announcement:

- preserves the repository coordinate;
- contains clone and web URLs only for successful targets;
- contains only the selected repository relays;
- preserves successful existing GRASP URLs;
- excludes failed GRASP and hosted destinations.

If the successful target set differs from the provisional plan, Budabit signs a newer reconciled announcement. The newer timestamp ensures replaceable-event ordering converges on the reduced, truthful target set.

Final publication is attempted on the selected repository relays and applicable successful target relays. Per-relay signed event reuse avoids generating unnecessary replacement events during the same synchronization.

## Success and Failure Modes

### Pure GRASP import

Success requires announcement admission, Smart HTTP readiness, state admission, Git push success, exact post-push visibility, and final metadata reconciliation.

If the GRASP target fails and no other target succeeds, the transaction fails and compensates provisional metadata where possible.

### Pure hosted import

The announcement admission barrier still precedes source cloning and hosted repository creation. Provider creation and push then determine target success. Final metadata advertises the hosted destination only after it succeeds.

### Hybrid import

GRASP targets run first, followed by hosted targets. A target failure does not automatically invalidate successful targets. The final announcement is narrowed to the successful subset.

| Result                              | Final metadata                                                  |
| ----------------------------------- | --------------------------------------------------------------- |
| GRASP succeeds, hosted target fails | Advertise GRASP only                                            |
| GRASP fails, hosted target succeeds | Advertise hosted target only                                    |
| One of several GRASP targets fails  | Advertise successful GRASP targets only                         |
| All targets fail                    | Fail the transaction and compensate admitted provisional events |

Partial success is an explicit reconciled result, not permission to retain URLs for failed targets.

## Rollback, Recovery, and Cancellation

### Rollback

Rollback uses transaction evidence rather than the original target list. Only relays that returned matching successful ACKs for provisional events are eligible for compensating metadata publication.

The import hook performs this provisional-event rollback when synchronization fails without any successful target. The shared synchronization helper can also delete a transaction-created hosted repository immediately when it can prove that the destination is empty. It deliberately retains unknown or partially populated remotes to avoid data loss.

Rollback does not delete GRASP Git data. A partial target success suppresses provisional-event rollback so final metadata can describe the surviving target set. Temporary local deletion runs only after tracked worker operations settle; failed or unavailable deletion remains a retryable journal state.

### Recovery

The versioned transaction journal records local ownership, each target and ref stage, remote receipts, event-specific ACK evidence, signed events, worker terminal receipts, cleanup state, manual-attention reasons, and pending Nostr compensations. It persists immediately around create, publish, push, verify, cleanup, and target-settlement boundaries. Initial persistence and later pre-side-effect checkpoints fail closed. Credentials are removed or rejected, and unresolved records are retained without a time-to-live.

For a `metadata-pending` record that contains the exact signed final announcement and state, recovery republishes the pair, intersects their ACKed relay sets, verifies retained GRASP events, and signs newer reconciled metadata when the usable relay set shrinks. Existing successful GRASP URLs are preserved. Recovery never restores a failed destination merely because it appeared in the original provisional event.

Startup recovery also classifies `syncing`, `failed`, and `cleanup-pending` records. It probes checkpointed commit IDs through advertised refs and checks exact GRASP announcement/state visibility. It never automatically repeats an ambiguous hosted create or push. Verified survivors produce newer reconciled final metadata; known failures compensate only exact provisional ACK scopes; inconclusive probes remain visible for manual attention. Pending event and local cleanup remains journaled for retry.

### Cancellation

Every mutating worker call receives a unique operation ID. The worker exposes cancellation, status, and terminal-wait RPCs; propagates abort signals into clone, push, provider fetch, and supported provider requests; and records when a side-effect boundary may have been crossed. The hook requests cancellation before aborting its UI wait, then waits for every tracked child operation to become `completed`, `failed`, `cancelled`, or `unknown` before compensation or local cleanup.

`cancelled` means cancellation settled before any side-effect boundary. If cancellation follows a local mutation or a request that a remote server may have accepted, the terminal state is `unknown`. An unknown terminal receipt is persisted and suppresses automatic event, remote, and local deletion. Cancellation cannot recall an HTTP request already accepted by a provider, so recovery remains evidence-based rather than assuming exactly-once behavior.

## Relay Publication Semantics

Budabit's publication result is event-specific. For each relay attempt, it tracks:

- event ID;
- relay URL;
- connection and send attempt;
- matching `OK true` or `OK false`;
- `NOTICE` and `AUTH` frames;
- timeout, error, and close conditions.

Repository event publication follows the destination policy in `Budabit-Relay-Publishing-Policy.md`. Import admission also includes every new user-selected GRASP target relay in the provisional announcement's relay set and requires a target-specific ACK there.

## Development Diagnostics

Development builds expose transport diagnostics for publication failures. Logs correlate:

- event ID and publication attempt;
- pooled socket wrapper identity;
- underlying WebSocket generation;
- queue and send transitions;
- matching relay `OK` frames;
- `NOTICE` and `AUTH` frames;
- socket errors and closes.

These diagnostics distinguish an event waiting in a client queue from an event written to a WebSocket but rejected, disconnected, or acknowledged after the caller's timeout. The diagnostic code does not create a fresh relay pool or reset sockets speculatively.

## Progress Reporting

The UI reports structured import phases and detailed step messages. Clone forwards real object, delta, and worktree counts; target synchronization forwards real target/ref counts. Packing and upload stay indeterminate when the Git implementation provides no truthful denominator. Child worker operation IDs are correlated to the parent import operation so unrelated concurrent progress is ignored. The `remotes` phase contains announcement admission, GRASP provisioning, source mirror preparation, target creation, state publication, pushes, verification, and reconciliation.

| Phase               | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| Connecting          | Parse the source and validate access                |
| Repository          | Fetch source repository data                        |
| Remote sync         | Admit metadata and synchronize selected Git targets |
| Repository metadata | Convert and publish repository events               |
| Issues              | Import issue events when enabled                    |
| Pull requests       | Import pull requests and their refs when enabled    |
| Comments            | Import comments when enabled                        |
| User profiles       | Publish discovered user profiles                    |
| Complete            | Import and final reconciliation succeeded           |

Provider API rate limits and relay timeouts are reported with their own context. Retrying a provider request must not duplicate already admitted Nostr events or repeat a successful Git push.

## Testing Expectations

The import architecture is covered by tests for:

- admission before clone, create, and push;
- per-relay ACK requirements;
- existing GRASP announcement reuse;
- Smart HTTP readiness;
- state-before-push ordering;
- exact post-push read semantics;
- pure GRASP, pure hosted, and hybrid results;
- failed-target exclusion from final metadata;
- pull-request ref partial failures;
- rollback scope;
- recovery with a reduced successful target set;
- transaction persistence and cleanup failures;
- transport diagnostics and timeout behavior.

Changes to import ordering or success criteria should update these tests and this document together.
