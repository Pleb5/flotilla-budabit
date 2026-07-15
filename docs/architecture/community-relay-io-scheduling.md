# Community Relay I/O Scheduling

## Purpose

BudaBit must support authenticated and public Nostr relays without letting general feed traffic delay critical community state. The transport must also respect small strfry deployments with strict per-connection and per-request limits.

The first target is `wss://relay.budabit.club/`, which currently exposes:

| Constraint | Value |
| --- | ---: |
| NIP-42 authentication | Disabled |
| Active subscription IDs per connection | 30 |
| Filters per `REQ` | 10 |
| Maximum events per filter | 200 |
| Maximum WebSocket message | 131,072 bytes |
| Maximum event | 65,536 bytes |
| Maximum tags per event | 2,000 |
| Ordinary event retention | One year |
| Write rate | Limited |

The ten-filter limit, event-size limit, tag limit, retention period, and write-rate policy are deployment configuration described in human-readable relay metadata rather than structured NIP-11 limitation fields. They therefore require explicit local policy where applicable. The relay advertises the subscription, result, and message limits through NIP-11.

## Protocol Model

A NIP-01 subscription has one subscription ID and one or more OR-ed filters:

```json
["REQ", "subscription-id", {"kinds": [1]}, {"kinds": [7]}]
```

The following concerns are separate:

1. Batching collects logical application queries for a short period.
2. Filter union reduces compatible filter objects without changing query meaning.
3. Grouping sends related filters under one subscription ID.
4. Chunking bounds filters and serialized bytes per subscription ID.
5. Scheduling bounds concurrent subscription IDs on the shared relay connection.

Grouping reduces protocol and subscription-state overhead, but the relay still parses, scans, and live-monitors every filter. EOSE completes only the initial stored-event scan. Ordinary subscriptions remain live until `CLOSE`, ID replacement, or disconnect. `limit: 0` suppresses stored events but still creates a live subscription.

## Design Principles

- Reuse Welshman's pool, socket, request, auth, and relay-profile abstractions.
- Keep one shared socket per relay rather than evading limits with extra connections.
- Put connection-wide guarantees in Welshman, where all request paths can participate.
- Keep BudaBit-specific relay policy and feature priority in BudaBit.
- Group only related filters with the same relay, priority, lifetime, and failure domain.
- Treat timeout as incomplete, never as authoritative absence.
- Close finite subscriptions immediately after EOSE.
- Keep permanent live filters small and stable.
- Route general profile, Git, and feed traffic away from the community relay unless explicitly community-scoped.

## Relay Policy

Each relay resolves to a policy:

```ts
type RelayPolicy = {
  auth: "none" | "optional" | "required"
  maxSubscriptions: number
  maxFiltersPerSubscription: number
  maxLiveSubscriptions: number
  maxBackgroundLiveSubscriptions: number
  criticalLivePriority: number
  maxMessageBytes: number
  maxLimit?: number
}
```

Policy sources are applied in this order:

1. Explicit overrides for known relays.
2. NIP-11 relay metadata already loaded by `@welshman/app`.
3. Runtime evidence from AUTH challenges, `CLOSED`, and `NOTICE`.
4. Conservative defaults.

`wss://relay.budabit.club/` uses `auth: "none"`, 28 client-managed subscriptions, 10 filters per subscription, at most 24 live subscriptions, at most 18 background-live subscriptions, a 128 KiB message limit, and a result limit of 200. The two IDs outside the client-managed budget remain available for recovery, diagnostics, and reconnect overlap.

Unknown relays start with a bounded 16-subscription, 10-filter baseline, including at most 12 live and 8 background-live subscriptions. Stricter structured NIP-11 limits and runtime evidence reduce either policy.

## Authentication

Public relays do not run pre-authentication. This avoids Welshman's challenge wait when no challenge will arrive.

Required-auth relays use one in-flight authentication attempt per relay socket. Priority reads wait for a successful NIP-42 response before sending. Forbidden authentication produces a typed error.

Optional or unknown relays send public reads immediately. An observed AUTH challenge or auth-required rejection can trigger authentication and one replay of an idempotent read. Publishes are never replayed implicitly.

Authentication state is scoped to the socket session and resets on disconnect.

## Request Lanes

Finite requests use independent Welshman loader instances so unrelated feature traffic is not physically grouped together.

| Lane | Batch window | Priority |
| --- | ---: | --- |
| Community definition and authority | 50 ms | Highest |
| Widget curation and exact bridge references | 50 ms | High |
| Interactive route data | 100 ms | Medium |
| General feed and profile hydration | 200 ms | Low |
| Live subscriptions | Persistent | Lifetime-capped |

For the public relay, the 30-ID server budget is divided by class:

| Budget | IDs |
| --- | ---: |
| Budabit-managed total | 28 |
| Maximum live | 24 |
| Maximum background-live | 18 |
| Capacity left for finite work at maximum live | 4 |
| Outside managed budget for recovery and overlap | 2 |

Finite work may use all managed capacity not occupied by live work. Lifetime caps, rather than priority reservations, prevent persistent traffic from consuming finite capacity. Background-live traffic has the strictest cap; critical live traffic can borrow its headroom without exceeding the overall live cap.

## Finite Query Lifecycle

Each finite physical chunk:

1. Acquires a scheduler slot.
2. Sends at most the relay policy's filter count and byte limit.
3. Collects and publishes valid events as they arrive.
4. Sends `CLOSE` immediately after EOSE.
5. Releases its scheduler slot after CLOSE enters the socket send queue.
6. Allows the next queued chunk to run.

Abort, timeout, disconnect, and `CLOSED` also release the slot. A strfry `NOTICE` reporting too many concurrent REQs pauses the connection queue and lowers effective concurrency.

## Live Subscription Scope

The community relay keeps only core community state live:

- Community definition updates.
- Community-targeted publications.
- Community-exclusive `#h` events.
- Authority and profile-list changes.
- Essential moderation state.

Dynamic exact original-event filters are finite queries. A new targeting event triggers an exact priority load followed by CLOSE. They are not added permanently to the live subscription.

Growing per-ID filters for deletes, reports, and form responses should use the same finite-query pattern where possible. Related broad filters may be consolidated when client-side post-validation preserves authorization semantics.

## Error Semantics

- `CLOSED` is scoped to a subscription ID and fails only its logical chunk.
- Explicit local policy prevents `bad req: arr too big` on known relays. A future adaptive fallback may learn a lower filter count for unknown deployments.
- `NOTICE: too many concurrent REQs` pauses new sends and lowers effective concurrency.
- Timeout returns received events with `complete: false`.
- EOSE is not treated as CLOSE or proof that a live monitor was accepted.
- Empty UI states require a complete relay result or valid cached authority evidence.

## Rollout

1. Add relay policy and skip auth for the public replacement relay.
2. Make filter grouping policy-driven and cap public-relay groups at ten.
3. Add connection-wide prioritized subscription scheduling in the Welshman patch.
4. Add lifetime caps that preserve finite capacity under sustained live traffic.
5. Reduce community live filters to the core stable set.
6. Route unrelated traffic away from the community relay.
7. Add adaptive array-size fallback and bounded diagnostics for unknown deployments.
8. Validate against authenticated mocks and the live public replacement relay.
9. Upstream the Welshman transport changes and remove the pnpm patch after upgrading.

## Acceptance Criteria

- No REQ to `relay.budabit.club` contains more than ten filters or exceeds 128 KiB.
- Normal operation deliberately uses no more than 28 managed IDs, 24 live IDs, or 18 background-live IDs.
- Public replacement-relay reads make no NIP-42 attempt.
- Required-auth relays share one auth attempt and wait for its terminal result.
- Community state is not batched with general feed traffic.
- Finite subscriptions send CLOSE after EOSE.
- Startup produces no concurrent-REQ NOTICE under expected load.
- Timeouts do not produce authoritative empty UI states.
- Cached widgets and exact event references render while refresh continues.
- Priority community state begins without waiting for background feed batches.

## Verification

Unit tests cover filter chunking, byte bounds, scheduler limits, priority ordering, EOSE/CLOSE lifecycle, live slot retention, timeout cleanup, auth policy, and runtime limit adaptation.

The opt-in `pnpm probe:public-relay` check validates structured NIP-11 values, ten-filter REQs, a 28-ID active ceiling, a second finite wave after explicit CLOSE, absence of AUTH, and absence of overflow NOTICE or CLOSED responses. It performs no writes.

Authenticated unit tests use controlled mocks to cover single-flight and forbidden authentication. A controlled challenge-relay integration test should additionally cover reconnection and one-time idempotent read replay.

## Telemetry And Tuning

Scheduler diagnostics report configured and learned limits, active and queued work by lifetime class, owner, filter count, queue age, physical start delay, and relay notices. Development warnings are bounded and identify total saturation, stale priority work, and unexpected live growth.

The public policy should only move closer to the 30-ID server ceiling after observing production telemetry across startup, route transitions, reconnects, and extension activity. Keep at least two IDs outside Budabit's managed budget and at least four managed slots available to finite work at maximum live load. Lower the 28/24/18 client limits if relay notices, prolonged finite queueing, or reconnect churn appear; do not raise them merely because a short probe succeeds.

## Upstream Boundary

Generic Welshman candidates are lifetime-aware scheduling, atomic persistent admission, finite wave scheduling and aging, request start callbacks, reversible NIP-11/runtime limit learning, one-time finite array-size repartitioning, scheduler snapshots, and reconnect reset behavior. These belong in `@welshman/net` without Budabit relay URLs, priorities, or product ownership labels.

Budabit-specific policy remains in the application: known-relay overrides, the 28/24/18/10 public budget, the 16/12/8/10 unknown baseline, request priorities, community authentication choices, background ownership coordination, extension quotas, warning thresholds, and UI completeness semantics. Until the generic changes are accepted upstream or maintained in a source fork, `patches/@welshman__net@0.8.16.patch` is the extraction boundary.
