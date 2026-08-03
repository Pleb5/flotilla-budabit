# Critical Relay Transport Isolation

Budabit normally multiplexes relay reads and writes through Welshman's shared `Pool`. This is efficient for ordinary application traffic because connections, authentication state, and subscriptions are reused. It is not appropriate for repository transactions whose correctness depends on receiving an exact relay acknowledgement before the next irreversible step.

## Problem

Welshman's subscription scheduler is scoped to a `Socket`. A popular relay can reach its active subscription limit while additional finite and live requests wait in the scheduler. `publish()` does not itself enter that subscription scheduler, but it still shares the socket's outbound queue, inbound receive queue, and server-side WebSocket message loop with those requests.

This creates several forms of head-of-line coupling:

- a large or slow `REQ` can delay later messages on the same connection;
- relay responses can wait behind unrelated inbound events;
- an `OK` can arrive too late for the publication timeout even though the relay is healthy;
- retrying through the same shared socket repeats the same contention instead of creating an independent attempt.

Reloading does not necessarily avoid this condition. If application startup recreates the same large subscription set, the shared relay scheduler can become saturated again deterministically.

## Solution

Critical repository operations use an operation-scoped `Pool`:

1. Create one isolated pool for a create, import, fork, augmentation, or settings-save operation.
2. Serialize repository metadata publications within that operation.
3. Reuse the operation pool for its announcement and state events so connection and NIP-42 state are retained.
4. Do not run ordinary application subscriptions through the operation pool.
5. If a publication receives no ACK before timeout, remove that relay's socket so the next retry creates a new connection.
6. Abort signing and publication, close sockets, and dispose the pool when the operation completes, is cancelled, or its UI unmounts.
7. Run strict transactional reads through separate short-lived pools and dispose them after the query.

The implementation is centered in:

- `src/app/core/git-commands.ts` via `createRepoPublishTransport()`;
- `src/app/util/fetch-relay-events.ts` via isolated loaders;
- the create, import, fork, and settings integrations under `src/routes/git/`.

## Guarantees

Isolation guarantees that critical work does not wait behind Budabit's shared relay subscription scheduler or reuse its congested socket queues. It also makes a timeout retry independent after the timed-out socket is removed.

Isolation does not guarantee that:

- the relay is online or responsive;
- the network will deliver a frame;
- the relay will accept an event;
- NIP-42 authentication will succeed;
- a GRASP Git endpoint is ready merely because its Nostr event was ACKed.

The workflow must still require an exact event-ID-matched `OK`, preserve explicit relay rejections, and verify GRASP provisioning and promotion separately.

## When To Use It

Use an isolated transport when all of the following are true:

- progress depends on an exact response from a specific relay;
- a timeout must have deterministic retry semantics;
- the operation mutates durable or remote state;
- sharing a connection with unrelated subscriptions can violate ordering or admission assumptions.

Examples include repository announcements, repository state events that authorize GRASP pushes, exact rollback deletions, and exact preflight or promotion reads.

Do not create isolated pools for ordinary feeds, background discovery, or best-effort hydration. Those operations benefit from shared scheduling, batching, and connection reuse. Excess isolation would add WebSocket/TLS handshakes, repeat authentication, and increase relay connection pressure.

## Navigation

Transaction completion must not route through a discovery-heavy intermediate page merely to force a remount. Same-coordinate augmentation stays on the current repository and hydrates the replacement events locally. A real fork navigates directly to its target `naddr` with a bounded wait. This prevents successful critical writes from immediately blocking on unrelated shared-scheduler work.
