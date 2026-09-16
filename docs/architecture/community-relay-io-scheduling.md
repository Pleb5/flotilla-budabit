# Community Relay I/O Scheduling

## Purpose

### Private transport override

Optional private community reads now use one ACK-confirmed auth owner per socket
and one idempotent REQ replay owner. Signing has a 90-second budget; the matching
AUTH ACK has a separate 10-second budget. Identity/challenge/transport generations
invalidate stale signatures, callbacks and queued sends. AUTH succeeds
only with an unchanged requested proof, verified signature/recomputed ID, and the
selected account's pubkey. Each loader and socket policy owns a counted interest:
one cancellation detaches that caller; the last cancellation invalidates pending
AUTH/probes and waiting reads. A later caller starts a fresh attempt. This cannot
withdraw a remote signer's prompt, but its late result cannot reach the wire.
Reconnects authenticate
before replay. No EVENT or Negentropy message is implicitly replayed. Runtime
`auth-required:` evidence overrides stale public metadata; authentication consent
does not grant unsigned-event trust.

Explicit invitation scopes use only pinned endpoints and dedicated non-pooled
sockets plus in-memory repositories. Shared reads targeting known private endpoints
or leaking private coordinates receive a local restricted CLOSED outcome, not EOSE.
The general community loader reports per-relay denied/cancelled/timeout/unavailable
outcomes and permits one bounded unavailable-policy retry without re-signing.
The private shell disposes denied/revoked sockets; explicit full-filter retry
creates and authenticates a fresh socket when the old one is disposed. This is
separate from bounded AUTH recovery on a still-live connection, and never becomes
an automatic denial-signing/reconnect loop. Partial or saturated results never
claim complete history. Private publish checks
run before signing and at final queued transmission. See
[Community-Read-Control-Plan.md](Community-Read-Control-Plan.md) for the current
bounded archive and unsupported-provider limits. The deployment figures below
describe public scheduling context, not private relay guarantees.

### Public scheduling context

BudaBit must support authenticated and public Nostr relays without letting general feed traffic delay critical community state. The transport must also respect small strfry deployments with strict per-connection and per-request limits while keeping relay discovery separate from client-side community admission.

The last recorded public `2fc1b38` deployment of `wss://relay.budabit.club/` has the
following limits, from the sibling strfry `deploy/budabit/RUNBOOK.md`. These are
recorded deployment facts, not a new live probe or universal client defaults:

| Constraint                             |         Value |
| -------------------------------------- | ------------: |
| NIP-42 authentication                  |      Disabled |
| Active subscription IDs per connection |            10 |
| Filters per `REQ`                      |             5 |
| Maximum events per filter              |           200 |
| Maximum WebSocket message              | 131,072 bytes |
| Maximum event                          |  65,536 bytes |
| Maximum tags per event                 |         2,000 |
| Ordinary event retention               |      One year |
| Write rate                             |       Limited |

The five-filter limit, event-size limit, tag limit, retention period, and write-rate
policy are deployment configuration described in human-readable relay metadata
rather than structured NIP-11 limitation fields. The relay advertises subscription,
result, and message limits through NIP-11. Do not confuse those serving limits with
the larger client scheduling ceilings below; the client does not parse every
restriction from free-form metadata.

Profile-list grants can exceed one event's size or tag budget. A content section may therefore repeat `a` references to distinct `kind:30000` shards; clients fetch each exact coordinate and use the union of current `p` tags. Transport scheduling must not assume that one profile-list event contains every writer.

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
- Keep one shared socket per relay for public traffic rather than evading limits
  with extra connections. Private scopes intentionally use dedicated, non-pooled
  sockets for isolation, not as a capacity workaround.
- Put connection-wide guarantees in Welshman, where all request paths can participate.
- Keep BudaBit-specific relay policy and feature priority in BudaBit.
- Group only related filters with the same relay, priority, lifetime, and failure domain.
- Treat timeout as incomplete, never as authoritative absence.
- Discover permission-governed content with stable structural `#h` or `#p` filters and apply current grants client-side.
- Fail closed when current definition or profile-list evidence is unavailable; relay matches are candidates, not authorization.
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

Policy is composed, not selected by a single precedence list:

1. Defaults and explicit relay overrides establish client scheduling ceilings.
2. Positive structured NIP-11 subscription, message and result limits clamp those
   ceilings downward; live budgets are also clamped to the resulting capacity.
3. AUTH uses an explicit auth override where one exists, otherwise NIP-11:
   `auth_required` means required; a known profile without NIP-42 means none;
   otherwise it is optional.
4. Runtime `auth-required:` evidence overrides even a stale public/auth-none profile.
   Challenges can initiate optional AUTH; read-replay remains idempotent-REQ-only.

`relay-policy.ts` retains 28 managed subscriptions, 10 filters per subscription,
at most 24 live / 18 background-live subscriptions, a 128 KiB message ceiling and
result limit 200 as its public-relay scheduling baseline. It no longer pins that
URL permanently to `auth: "none"`. A served ten-subscription NIP-11 limit reduces
managed capacity to ten and live/background-live budgets to at most eight; the
old 30-ID assumption is not a claim about the current recorded deployment.

The five-filter server limit is not a structured NIP-11 field consumed by this
policy, so the ten-filter client baseline is not evidence that a ten-filter REQ
will be accepted there. Server rejections remain failures, not complete history.
The private shell's two disjoint filters fit this recorded server limit.

Unknown relays start with the same client ceilings. Their authentication remains
optional until metadata or runtime behavior resolves it. A default result ceiling
is not sufficient completeness evidence for private authority: the private reader
requires the endpoint's explicit positive `max_limit` and unfiltered-kind claims.

## Authentication

Public relays do not run pre-authentication. This avoids Welshman's challenge wait when no challenge will arrive.

Required-auth relays use one in-flight authentication attempt per relay socket. Priority reads wait for a successful NIP-42 response before sending. Forbidden authentication produces a typed error.

Optional or unknown relays send public reads immediately. An observed AUTH challenge or auth-required rejection can trigger authentication and one replay of an idempotent read. Publishes are never replayed implicitly.

Authentication state is scoped to the socket session and resets on disconnect.

## Request Lanes

Finite requests use independent Welshman loader instances so unrelated feature traffic is not physically grouped together.

| Lane                                        | Batch window | Priority        |
| ------------------------------------------- | -----------: | --------------- |
| Community definition and authority          |        50 ms | Highest         |
| Widget curation and exact bridge references |        50 ms | High            |
| Interactive route data                      |       100 ms | Medium          |
| General feed and profile hydration          |       200 ms | Low             |
| Live subscriptions                          |   Persistent | Lifetime-capped |

For the public relay, the 30-ID server budget is divided by class:

| Budget                                          | IDs |
| ----------------------------------------------- | --: |
| Budabit-managed total                           |  28 |
| Maximum live                                    |  24 |
| Maximum background-live                         |  18 |
| Capacity left for finite work at maximum live   |   4 |
| Outside managed budget for recovery and overlap |   2 |

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

### Bounded permissioned history

Community history scans maintain a cursor independently for each relay and each structural filter. Each page is bounded and counted by raw relay events before current-grant admission, so a page of outsiders advances the scan rather than masquerading as an empty authorized result.

Nostr's `until` cursor is inclusive and has no event-ID tiebreaker. When a raw page reaches its limit, more events may share the oldest timestamp; Budabit marks the scan saturated and incomplete even if it continues with `until = oldestTimestamp - 1`. Exhausting the page budget, reaching the time budget, disconnecting, or receiving `CLOSED` is likewise incomplete. Partial admitted events remain usable, but an incomplete zero-admission result is not authoritative emptiness.

## Live Subscription Scope

The community relay keeps only core community state live:

- Community definition updates.
- Community-targeted publications.
- Community-exclusive `#h` events.
- Authority and profile-list changes.
- Essential moderation state.

Dynamic exact original-event filters are finite queries. A new targeting event triggers an exact priority load followed by CLOSE. They are not added permanently to the live subscription.

Growing per-ID filters for deletes, reports, and form responses should use the same finite-query pattern where possible. Related broad filters may be consolidated when client-side post-validation preserves authorization semantics.

Community-native and targeted-wrapper live transport uses stable structural `#h=<communityId>` filters, with `#k` where needed. Authority-sensitive candidates must also carry the workflow's marked exact `a=<32222:owner:communityId>` branch reference; community association is never a `p` tag. Current grants are applied after receipt to live and cached events. A grant revocation refilters existing results, while a regrant restarts structural acquisition so matching history can reappear.

Exact author filters remain appropriate for definitions, profile-list shards, grant-capable forms, personal metadata and lists, explicit address coordinates, implicit originals bound to a wrapper signer, and same-author deletes. These exact identity or authority filters must not be widened while removing ACL-derived writer arrays from content transport.

## Notification And Shared Consumer Rules

Global notification acquisition may subscribe broadly before grant evidence finishes hydrating, but rows are admitted only after bounded definition, profile-list, report, and report-delete hydration completes for that community. Cached authority events do not make a pending or failed refresh authoritative. Admission reviews are discoverable from applicant/app relays; bounded review relay hints bootstrap only the exact signed definition, which is refreshed on its declared relays before community-partitioned workflow and authority reads begin. Completion is tracked per community, including when communities share a physical relay, and unchanged completed scopes survive unrelated source reconfiguration. A hostile or unavailable context therefore cannot suppress or continuously reset unrelated decisions. Repository-watch authority queries and completion use the same partition, and renounced communities are excluded from retained ban-notice seeds. Its finite catch-up uses the same bounded raw-event history loader as community routes. Active-community badges, route projections, activity/reaction summaries, repository watchers, and extension queries apply current grants and the same targeting authority as their destination views. Repository announcements instead require one direct `h=<communityId>` binding plus a current repository-section grant; community engagement also requires the referenced root to pass admission.

Live ownership is coordinated by `(community, relay)`, and repository-watch ownership by `(repository address, relay)`. If a foreground consumer owns coverage, the notification background consumer removes only duplicate live filters for that pair; its finite catch-up may still run, and other communities or repositories sharing the relay retain their coverage. Grant changes rebuild local selectors and relevant subscriptions instead of trusting previously admitted rows.

## Error Semantics

- `CLOSED` is scoped to a subscription ID and fails only its logical chunk.
- Explicit local policy prevents `bad req: arr too big` on known relays. A future adaptive fallback may learn a lower filter count for unknown deployments.
- `NOTICE: too many concurrent REQs` pauses new sends and lowers effective concurrency.
- Timeout returns received events with `complete: false`.
- Page-budget exhaustion and same-timestamp saturation return received events with `complete: false`.
- Disconnect and `CLOSED` make the affected relay/filter scan incomplete.
- EOSE is not treated as CLOSE or proof that a live monitor was accepted.
- Empty UI states require a complete relay result or valid cached authority evidence.
- A nonempty authority filter set with no valid relay remains incomplete and contributes to the global partial-history warning; it is never normalized into a completed empty query.

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
- Saturated, disconnected, or page-budget-limited community scans do not produce authoritative empty UI states.
- Structural community discovery does not depend on ACL-sized current-writer arrays.
- Missing grant evidence admits no permission-governed rows.
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

Budabit-specific policy remains in the application: known-relay overrides, the shared 28/24/18/10 public and unknown-relay budget, request priorities, community authentication choices, background ownership coordination, extension quotas, warning thresholds, and UI completeness semantics. Until the generic changes are accepted upstream or maintained in a source fork, `patches/@welshman__net@0.8.16.patch` is the extraction boundary.
