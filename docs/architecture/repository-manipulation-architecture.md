# Repository Manipulation Architecture

Budabit treats repository import, creation, and fork as durable transactions across local Git storage, Nostr relays, GRASP servers, and hosted Git providers. This document describes the shared lifecycle, progress, recovery, cleanup, and cancellation contracts. Import-specific GRASP details remain in `import-repo-architecture.md`.

## Shared Invariants

1. Validate the owner, destination plan, credentials, metadata relays, exact coordinate, publisher evidence, and compensation capability before mutation.
2. Publish and admit a provisional kind `30617` announcement before local initialization, source clone, hosted creation, or push.
3. Require every new GRASP target to ACK its own admitted announcement and become Smart HTTP ready.
4. Process GRASP targets before hosted targets.
5. Publish and ACK kind `30618` state before each GRASP push.
6. Record side-effect boundaries before and after create, publish, push, verify, cleanup, and target settlement.
7. Reconcile final metadata from verified successful targets only.
8. Compensate events only on relays with event-specific successful ACK evidence.
9. Never repeat or delete an ambiguous remote mutation automatically.
10. Never persist provider tokens, signing secrets, or credential-bearing URLs.

## Flow Differences

| Policy                      | Import                                    | New                                                         | Fork                                        |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Source Git work             | Clone existing source                     | Initialize canonical local repository                       | Clone existing source into temporary mirror |
| Existing remote destination | May reuse an explicitly discovered target | Reject                                                      | Reject                                      |
| Existing Nostr coordinate   | Ownership-aware import path may reuse     | Reject                                                      | Reject                                      |
| Successful local state      | Delete temporary mirror                   | Retain canonical repository                                 | Delete temporary mirror                     |
| Failed local state          | Delete only after worker settlement       | Delete only transaction-owned state proven not to pre-exist | Delete only after worker settlement         |

New repository creation performs both a preflight local existence check and a worker-side `mustNotExist` claim immediately before `git.init`. An exclusive filesystem directory reservation rejects cross-worker/tab races and any existing residue; a keyed worker-local lock also serializes calls within one worker.

## Lifecycle

### Preconditions And Admission

The hooks build a complete target plan before obtaining mutation permission. Hosted and GRASP destinations are checked authoritatively with existing-target reuse disabled for new and fork. Every relevant metadata relay is queried for the exact kind `30617` coordinate. Timeout, disconnect, incomplete relay evidence, missing credentials, or a stale/pending UI availability result blocks the transaction.

The journal must persist successfully before admission. The provisional announcement is then published to selected repository relays and every new GRASP target relay. Only matching successful `OK` results establish rollback scope.

### Local Git And Target Synchronization

After admission and GRASP readiness:

- import and fork clone into unique transaction-owned mirrors;
- new initializes its canonical repository with atomic non-existence enforcement;
- remote synchronization processes GRASP before hosted targets;
- each target and ref transition is checkpointed;
- hosted creation, every push attempt, and cleanup use unique worker mutation IDs;
- exact advertised refs and GRASP metadata establish target success.

Partial success is valid only after a newer final announcement excludes failed targets. A failed target cannot remain in final clone or web tags.

### Completion And Cleanup

Import and fork remove temporary mirrors after all tracked worker mutations reach terminal or explicitly unknown status. New retains its successful canonical local repository. Failed local deletion remains `cleanup-pending`; unknown worker outcomes remain `unknown` and suppress speculative cleanup.

## Worker Operation Contract

Mutating worker RPCs accept an optional `operationId`:

- `cloneRemoteRepo`;
- `createLocalRepo`;
- `createRemoteRepo`;
- `pushToRemote`;
- `deleteRepo`;
- `deleteRemoteRepo`.

The worker also exposes:

- `cancelOperation({operationId, reason})`;
- `getOperationStatus({operationId})`;
- `waitForOperationTerminal({operationId, timeoutMs})`.

An operation status contains its ID, mutation type, current stage, timestamps, serializable error/receipts, and `sideEffectMayHaveOccurred`. Terminal states mean:

| State       | Meaning                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `completed` | The worker received a successful result.                                                                |
| `failed`    | The operation failed without a cancellation request; side-effect evidence remains explicit.             |
| `cancelled` | Cancellation settled before any side-effect boundary.                                                   |
| `unknown`   | Cancellation occurred after local mutation began or after a remote request/push may have been accepted. |

Operation IDs are unique child IDs under a flow ID. The registry isolates concurrent status, cancellation, progress, and waiters. Clone, push, fetch/probe, retry delays, Nostr-provider push, and supported provider HTTP calls observe the operation signal. A remote server can still commit a request before observing disconnect, so `unknown` is intentionally not treated as clean cancellation.

## UI Cancellation Sequencing

Each hook owns a `WorkerOperationSession` that registers active child IDs. User cancellation follows this order:

1. request cancellation for every active child operation;
2. abort the UI orchestration wait so no later target begins;
3. wait for tracked child operations to reach a terminal state, with timeout represented as synthetic `unknown`;
4. persist terminal receipts in the transaction journal;
5. run compensation or local cleanup only when no operation outcome is unknown.

This order prevents rollback from racing an accepted provider request or an in-flight push. Relay publication outside the Git worker remains governed by exact event ACK evidence and the hook abort controller.

## Durable Journal And Recovery

The version 2 journal records:

- operation identity and local ownership/stage;
- sanitized target plans and per-ref stages;
- remote URLs, creation evidence, push results, and cleanup state;
- exact signed events and requested/ACKed/failed relay evidence;
- worker terminal receipts;
- pending compensations and manual-attention reasons.

Initial persistence fails closed. Later checkpoint failure stops before the next side effect. Legacy records migrate without credentials, and unresolved records are not dropped by age.

Startup recovery handles `syncing`, `metadata-pending`, `cleanup-pending`, and `failed` records. It probes advertised refs and exact GRASP event IDs. It may reconcile verified survivors, retry exact metadata publication, compensate known failures, and retry local cleanup. It does not recreate hosted repositories, replay ambiguous pushes, or delete partially populated/unknown remotes.

## Progress Truthfulness

All three flows have a stable parent progress ID. Child mutation events are correlated to that parent while unrelated concurrent events are ignored.

- Clone shows real counting, receiving, delta-resolution, and worktree counts supplied by isomorphic-git.
- Synchronization shows real target and ref totals.
- Push ref boundaries are determinate only from the requested ref set.
- Packing, network upload, provider waits, and relay waits remain active but indeterminate unless the underlying API supplies a real denominator.
- Indeterminate activity shows elapsed time and last activity rather than a fabricated percentage.

## Responsive Interaction

Import, new, and fork dialogs use dynamic viewport heights, fixed modal chrome, a single scrollable body, mobile-stacked actions, wrapping for long URLs/errors, bounded dropdowns, and at least 40px primary touch targets. Cancellation remains available while an operation is active. Desktop spacing and visual language are preserved at larger breakpoints.

## Residual Limits

- Hosted providers do not offer a universal idempotency key for repository creation. A disconnected accepted request may require manual inspection.
- Abort signals cannot recall a push or HTTP request already committed by a server.
- Exact GRASP success still depends on state admission, Git receive completion, and exact post-push event visibility.
- Browser storage failure prevents a transaction from starting; storage failure after final completion can leave a stale recovery record but must not roll back a successful repository.
- Recovery is deliberately conservative when credentials are unavailable or evidence is incomplete.

## Primary Implementation

- `packages/nostr-git-core/src/worker/operations.ts`
- `packages/nostr-git-core/src/worker/worker.ts`
- `packages/nostr-git-core/src/worker/workers/repo-management.ts`
- `packages/nostr-git-ui/src/lib/utils/worker-operation-session.ts`
- `packages/nostr-git-ui/src/lib/utils/remote-sync.ts`
- `packages/nostr-git-ui/src/lib/utils/repo-creation-transaction.ts`
- `packages/nostr-git-ui/src/lib/utils/repo-creation-recovery.ts`
- `packages/nostr-git-ui/src/lib/hooks/useImportRepo.svelte.ts`
- `packages/nostr-git-ui/src/lib/hooks/useNewRepo.svelte.ts`
- `packages/nostr-git-ui/src/lib/hooks/useForkRepo.svelte.ts`
