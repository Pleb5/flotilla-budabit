# Deferred Memory Retention Risks

This note records non-notification memory risks found while investigating the
regression after `71f8a5be`. They are intentionally deferred while notification
retention is addressed first.

## Community And Repository Loading

Cache-first loading and route-driven hydration can retain completed community
bootstraps, hydration keys, report evidence, profile attempts, and repository
initial-load promises for the application lifetime. Some caches predate the
regression, but later features feed them more communities, relays, and events.

Likely fixes:

- Bound completed caches with TTL and LRU eviction.
- Key entries by canonical community or repository identity rather than evolving
  relay lists.
- Store compact IDs or snapshots instead of duplicate event arrays.
- Propagate route-owned abort signals through finite loads.
- Remove superseded hydration keys when definitions or relay selections change.

## Repository Route Lifecycle

Repository initialization can install a store subscription after its route has
already been destroyed if initial loading resolves late.

Likely fixes:

- Subscribe synchronously and gate callbacks on readiness, or guard delayed
  subscription with an idempotent destroyed flag.
- Bound successful entries in the repository initial-load cache.

## Commit Discussions

Commit pages cancel live discussion requests but not every finite history,
delete, and profile load when navigating away.

Likely fixes:

- Share one route-owned abort signal across finite and live discussion work.
- Resolve profiles only for visible comments.

## Curated Widget Snapshots

Curated widget snapshots use an unbounded module-level map keyed by community.

Likely fixes:

- Use a bounded TTL/LRU cache keyed by canonical community identity.
- Retain compact widget references instead of complete events.

## Git Worker Operations

The singleton Git worker historically retained terminal operations and large
receipts. `1c19687d` added bounds and compaction, so this does not match the
still-reproducible navigation leak. Keep registry and receipt sizes observable.

## Relay, Profile, Pool, And Repository State

New authors and communities can expand relay selections, sockets, tracker
metadata, and profile resolver maps. Welshman's singleton pool and repository
amplify features that continually discover relays or publish events.

Likely fixes:

- Bound profile attempt and completion bookkeeping.
- Canonicalize relay selections before using them in cache keys.
- Give pooled sockets explicit ownership or idle eviction semantics.
- Add source-aware repository retention that updates every secondary index.
