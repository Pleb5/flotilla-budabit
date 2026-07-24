# Deferred Performance Improvements

This note records performance improvements identified during the 2026-07 audit
that were intentionally deferred because they carry more implementation risk or
complexity than the changes that landed. The landed changes covered: dev-only
window globals, curated highlight.js languages, chunked blob-to-string
conversion, deduped `ensureRepo` refresh fetches, lazy avatar images, git
detail-page subscription churn, room message pipeline throttling, LRU bounds on
long-lived caches, compact issue search keys, route-owned aborts, feed-scoped
trackers, and incremental commit-diff fetch escalation.

## Git Worker Response Transport

`packages/nostr-git-core/src/worker/worker.ts` wraps nearly every response in
`toPlain`, a `JSON.parse(JSON.stringify(...))` round trip that runs on top of
Comlink's structured clone. Large payloads such as `getCommitDetails` and
`getDiffBetween` diff hunks are serialized twice. No transferables are used
anywhere, so file contents cross the worker boundary as large latin-1 strings.

Likely fixes:

- Replace `toPlain` with targeted plain-object construction for the few types
  that actually need it (class instances, functions, prototypes).
- Return file contents as `Uint8Array` and pass them through Comlink transfer
  lists for near-zero-copy handoff; decode text on the receiving side.

## Bespoke Profile Hydration Versus makeLoadItem

`src/app/core/community-state.ts` (`hydratePubkeyProfiles`, `profileHydratedAt`,
`profileHydrationPromises`) and `src/app/core/profile-resolver.ts` hand-roll
TTL freshness, pending-promise dedupe, and retry policies. Welshman's
`makeLoadItem` in `@welshman/store` already provides freshness tracking,
in-flight dedupe, and exponential backoff, and can race or duplicate
welshman's own `loadProfile` freshness window.

Likely fixes:

- Rebuild the profile hydration paths on `makeLoadItem` with pluggable
  `getFetched`/`setFetched` so budabit and welshman share one freshness model.
- Bound the remaining hydration keys (`profileHydratedAt`,
  `communityReportDeleteHydratedAt` in `community-state.ts`) or key them by
  canonical identity instead of author-list and relay-list joins.

## List Rendering Without Windowing

No route virtualizes long lists. Room chat
(`src/routes/c/[community]/rooms/[room]/+page.svelte`) and the repo activity
feed (`src/routes/git/[id=naddr]/feed/+page.svelte`) render every loaded event;
scrollback grows the DOM without bound. Threads and detail reply lists render
complete arrays.

Likely fixes:

- Prefer a simple rendered-window cap (slice plus "show older" anchor) over a
  virtualization library; it captures most of the win without new dependencies
  or scroll-anchoring complexity.
- Apply first to room chat and the repo activity feed, which see the largest
  element counts.

## Markdown Parse Caching

Every `ChannelMessage` and repo list card mounts `Markdown.svelte`, which runs
Marked tokenization, custom tokenizers, and `DOMPurify.sanitize` per render.
Event content is immutable per event id, so repeated parsing is wasted work
during scrollback and re-renders.

Likely fixes:

- Cache sanitized HTML keyed by event id (bounded LRU) and reuse it across
  mounts.
- Defer highlighting of offscreen code blocks where practical.

## Relay Backfill Efficiency

`@welshman/app` ships negentropy-aware `pull`, which transfers only missing
events on NIP-77 relays, but budabit backfill paths use plain `load`/`request`.
`LOCAL_RELAY_URL` cache-first reads are used in only a couple of files even
though the IndexedDB-hydrated repository could serve many detail-page reads
instantly.

Likely fixes:

- Use negentropy `pull` for community and repo backfill against relays that
  advertise support.
- Include `LOCAL_RELAY_URL` in read paths that currently go straight to the
  network for events that are usually cached.

## Feed Controllers And The Global Tracker

Feed controllers now share a feed-scoped `Tracker`, which dedupes verification
across relays and pages within one feed. Sharing the app-global persisted
tracker instead would extend dedupe across sessions, but it distorts windowed
pagination: already-tracked events do not count toward page fill, so windows
grow aggressively and `until` never advances from duplicate events. Revisit
only together with changes to `FeedController` windowing semantics.

## Remaining Unbounded Or Hot-Path State

Smaller items observed during the audit, in rough priority order:

- `src/app/extensions/recommendation-context.ts` -
  `recommendationContextsByWidgetLineId` appends contexts (retaining definition
  and profile-list events) per widget per community with only a global clear.
- `src/routes/git/+page.svelte` - `repoCardsByContext` keeps full card arrays
  for every `mode:tab:searchQuery` string for the page lifetime.
- `src/app/core/requests.ts` - `insertEvent` does a linear scan per insert
  (O(n^2) over a feed session), and each active feed runs `matchFilters` over
  every repository update.
- `src/app/components/ProfileFeed.svelte` - the controller is never stopped on
  unmount and `buffer`/`events` grow unboundedly while mounted.
- `src/app/components/NewNotificationSound.svelte` - `notifications.subscribe`
  unsubscriber is discarded in `onMount`.
- `src/app/components/GitIssueItem.svelte` - latent per-item live `request`
  when `fetchRepoAndStatus` is enabled; would exhaust the live subscription
  budget on any sizable list if a caller ever enables it.
- `packages/nostr-git-core/src/git/git.ts` - the 60 second `repoDepthCache` TTL
  causes repeated deepening fetches for file operations on quiet repos.
- `packages/nostr-git-core/src/git/merge-analysis.ts` - `checkIfPRApplied`
  falls back to a depth-500 `git.log` linear scan after `isDescendent` already
  returned false.
- `packages/nostr-git-core/src/worker/worker.ts` -
  `tryGitNaturalCommitsAheadOfTip` can walk up to 50 branch histories
  sequentially over HTTP.
- `src/app/core/sync.ts` and `src/app/core/git-requests.ts` - long-lived
  requests without `lifetime`/`priority`/`owner` lane metadata sit outside the
  relay scheduler accounting.
- `src/lib/components/EmojiPicker.svelte` - `emoji-picker-element` is imported
  statically into the chat chunk instead of on first picker open.
- `vite.config.ts` - no `manualChunks`; `@nostr-git/ui` `ConfigProvider` at the
  root layout pulls the package graph toward the entry chunk.
