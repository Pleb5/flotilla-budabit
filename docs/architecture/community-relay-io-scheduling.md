# Community Relay I/O Scheduling

## Purpose

BudaBit must support authenticated and public Nostr relays without letting general feed traffic delay critical community state. The transport must also respect small strfry deployments with strict per-connection and per-request limits.

The first target is `wss://relay.budabit.club/`, which currently exposes:

| Constraint | Value |
| --- | ---: |
| NIP-42 authentication | Disabled |
| Active subscription IDs per connection | 10 |
| Filters per `REQ` | 5 |
| Maximum WebSocket message | 131,072 bytes |
| Maximum per-filter result limit | 200 |

The five-filter limit is deployment configuration and is not advertised by the relay's NIP-11 document. It therefore requires an explicit local policy or adaptive fallback.

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
  maxMessageBytes: number
}
```

Policy sources are applied in this order:

1. Explicit overrides for known relays.
2. NIP-11 relay metadata already loaded by `@welshman/app`.
3. Runtime evidence from AUTH challenges, `CLOSED`, and `NOTICE`.
4. Conservative defaults.

`wss://relay.budabit.club/` uses `auth: "none"`, 10 subscriptions, 5 filters per subscription, and a 128 KiB message limit.

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
| Live subscriptions | Persistent | Reserved |

For the small relay, the intended ten-ID budget is:

| Use | IDs |
| --- | ---: |
| Consolidated community live state | 2 |
| Priority finite community requests | 2 |
| Interactive and general finite requests | 3 |
| Background finite requests | 2 |
| Recovery reserve | 1 |

Unused lower-priority capacity may be borrowed by higher-priority work. Background work may not consume reserved priority or recovery capacity.

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
2. Make filter grouping policy-driven and cap replacement-relay groups at five.
3. Add connection-wide prioritized subscription scheduling in the Welshman patch.
4. Reserve live and priority capacity.
5. Reduce community live filters to the core stable set.
6. Route unrelated traffic away from the community relay.
7. Add adaptive array-size fallback and bounded diagnostics for unknown deployments.
8. Validate against authenticated mocks and the live public replacement relay.
9. Upstream the Welshman transport changes and remove the pnpm patch after upgrading.

## Acceptance Criteria

- No REQ to `relay.budabit.club` contains more than five filters.
- Normal operation deliberately uses no more than nine active IDs.
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

Manual live verification against `wss://relay.budabit.club/` covers five-filter chunking, finite waves beyond ten logical chunks, absence of AUTH, explicit CLOSE, and absence of overflow NOTICE. This should become an opt-in integration test.

Authenticated unit tests use controlled mocks to cover single-flight and forbidden authentication. A controlled challenge-relay integration test should additionally cover reconnection and one-time idempotent read replay.
