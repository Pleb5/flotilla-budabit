# Feed And Subscription Ownership Plan

## Goals

- Restore reliable live updates without causing route-navigation churn.
- Keep initial/history loading separate from live subscriptions.
- Make `/git` repo-scoped pages use the repo layout as the subscription owner.
- Move community live subscriptions to community state/layout ownership in a later pass.
- Avoid hardcoded platform relay lists for community feeds.

## Welshman Feed Semantics

Welshman `FeedController` has two separate modes:

- `load(limit)` performs paginated/backfill requests. In Welshman this goes through `requestPage(..., autoClose: true)`, so those network requests close after EOSE or timeout.
- `listen()` opens live requests. Welshman maps filters to `limit: 0` and does not set `autoClose`, so those requests remain live until the caller aborts.

Budabit's `makeFeed` wrapper currently uses `makeFeedController(...).load(...)` for scroll/backfill and does not call `listen()`. It also listens to local `repository` updates and inserts matching events. Welshman app already publishes inbound relay events into `repository` through its global socket listener, so Budabit live requests do not need to manually publish received events.

The practical consequence is that route-level or layout-level live subscriptions are still required if a page should update while mounted.

## Git Current State

The canonical Git routes are under `/git`:

- `/git` loads self repositories, starred/legacy bookmarked repositories, snippets, and search/discovery results.
- `/git/[id=naddr]/+layout.svelte` owns repo context stores: repo relays, maintainer-set addresses, issues, PRs, statuses, comments, repo feed activity, trust metrics, and repo actions.
- `/git/[id=naddr]/issues/+page.svelte` consumes repo context but still opens its own live comment request for visible issue roots.
- `/git/[id=naddr]/prs/+page.svelte` consumes repo context but still opens its own live comment request for PR roots and keeps a local `comments` array.

Compared with the old `/spaces/[relay]/git` implementation, issue roots, PR roots, issue comments, and PR comments were not materially subscribed differently after the canonical route move. The deeper issue/PR pages already owned some live requests before and still do now. The weakness is structural: the repo layout already owns repo data, but live subscriptions are still split between layout and child pages.

## Git Implementation Plan

### Ownership

`src/routes/git/[id=naddr]/+layout.svelte` should be the single owner of repo-scoped live subscriptions.

Child routes should render from layout-owned stores and may continue to trigger user-initiated event publication. Child routes should not need to open long-lived live subscriptions for repo roots or comments, and should not manually insert successfully signed events after `publishThunk(...)` because Welshman already does that optimistically.

### Initial Loading

Keep existing initial/backfill loading in the repo layout:

- Repo announcement and repo state loads.
- Initial issue/PR/status loads by effective repo address.
- Effective-address incremental loads as maintainer-set addresses become known.
- PR root status loads.
- Comment loads by root id.
- Delete hydration.

This avoids changing the main loading model while adding reliable live behavior.

### Live Subscriptions

Add one repo-layout live subscription manager keyed by sorted relay, address, root-id, PR-root-id, and viewer values.

It should open live `request(...)` calls against repo-scoped relays with `limit: 0` filters. Received relay events are inserted into `repository` by Welshman's global socket listener, so these live requests should not use `onEvent` just to manually publish events.

Address-scoped live filters:

- `GIT_ISSUE` by `#a` effective repo addresses.
- `GIT_PULL_REQUEST` by `#a` effective repo addresses.
- `GIT_PULL_REQUEST_UPDATE` by `#a` effective repo addresses.
- status kinds by `#a` effective repo addresses.

Root-scoped live filters:

- `COMMENT` by `#E` root ids.
- `COMMENT` by `#e` root ids.
- `GIT_LABEL` by `#e` root ids.
- cover-letter kind `1624` by `#e` root ids.
- status kinds by `#e` root ids.

Viewer-scoped live filters:

- `GIT_ISSUE`, `GIT_PULL_REQUEST`, and `GIT_PULL_REQUEST_UPDATE` by `#p` viewer pubkey, preserving the current behavior for mentions and assigned/review-request style events.

### Churn Control

- Use stable sorted keys rather than Svelte array identity.
- Do not return the live-sub cleanup directly from a reactive effect that may rerun with the same content key; manage the `AbortController` manually and abort only when the stable key changes or the layout is destroyed.
- Do not toggle route loading state for live events.
- Do not clear stores when live subscriptions rotate.
- Use existing chunk sizes for large address/root-id sets.

### Child Page Adjustment

- Expose layout comment events through context so PR pages can derive comments from the layout store.
- Remove child-page long-lived comment requests where layout live subscriptions now cover the same filters.
- Keep page-specific edit/label prefetch where it is still doing initial loading, unless the layout later takes over those initial loads too.

### Verification

- Typecheck or targeted Svelte check if available.
- Run tests that cover changed modules when practical.
- Manually inspect that no stale imports remain after removing child live requests.

## Community Current State

Community routes are under `/c/[community]` and use consolidated community state:

- `activeCommunityDefinition` resolves the active community definition.
- `activeCommunityRelays` chooses definition relays when present, otherwise bootstrap relay hints plus discovery/user relays.
- Section pages build community-specific filters using `community-feeds.ts` helpers.
- `makeFeed` and `makeCalendarFeed` provide scroll/windowed loading for room messages, threads, goals, and calendar events.

The old `/spaces/[relay]` global sync opened broad live subscriptions with a relay from the route. That was removed with legacy relay spaces. Restoring that exact model would be wrong for `/c/[community]` because community relays are now definition-driven and should not depend on hardcoded platform relays.

## Community Plan

### Ownership

Community live subscriptions should be owned by the community layout or a community sync helper keyed by `activeCommunityDefinition` and `activeCommunityRelays`.

The community layout should provide active relay and definition context. Section pages should keep their feed loading and rendering logic.

### Loading

Keep existing page-owned loading:

- Room pages use `makeFeed` with `makeCommunityRoomMessagesFilter(...)`.
- Threads pages use `makeFeed` with forum thread and reply filters.
- Goals pages use `makeFeed` with targeted goal/original/comment filters.
- Calendar pages use `makeCalendarFeed` with targeted event filters.
- Detail pages may keep targeted initial `request(...)` calls for root/reply hydration.

### Live Subscriptions

Add a central community live layer after community state is fully trusted on route entry.

The live layer should:

- Use `activeCommunityRelays`, not `PLATFORM_RELAYS`.
- Subscribe to community-exclusive events by `#h` community pubkey for room, message, thread, comment, reaction, delete, label, and report/moderation kinds needed by the UI.
- Subscribe to targeted publication events by `#p` community pubkey for targetable sections.
- Open live requests and rely on Welshman's global socket listener to insert received events into `repository`, so existing page feeds can observe repository updates.
- Abort and recreate only when the stable community pubkey/relay/filter key changes.

Implementation notes:

- `src/routes/c/[community]/+layout.svelte` owns the live request lifecycle.
- `src/app/core/community-live.ts` builds stable `limit: 0` filters for community definition updates, `#h` community-exclusive events, `#p` targeting wrappers, targeted originals, authority profile-list references, admission form responses/reviews/deletes, moderation reports/deletes, and moderator request/review/delete state.
- The community layout also does a one-shot recent `MESSAGE` history preload by broad community `#h`, matching the old platform-relay layout warmup behavior so room feeds do not depend only on room-specific `#E` backfill.
- Section pages keep their initial hydration, scroll loading, and rendering logic. Page-owned `request(...)` calls that overlap the central live layer should use `autoClose: true` so they do not become duplicate long-lived subscriptions.

### Community Git

`/c/<community>/git` remains out of scope for the current Git subscription implementation. It should be handled after community live subscriptions are consolidated, because it needs both community targeting rules and repo-scoped Git rules.

## Rollout Order

1. Implement Git repo-layout live subscriptions and context-based comment consumption.
2. Remove duplicate long-lived issue/PR comment requests if layout coverage is sufficient.
3. Verify Git route behavior and type safety.
4. Implement community layout live subscriptions using `activeCommunityRelays`.
5. After community live sync is stable, decide how `/c/<community>/git` combines community targeting with repo subscriptions.
