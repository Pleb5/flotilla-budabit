# Profile Discoverability Implementation Plan

This plan addresses intermittent missing profile names/avatars and broader user-data discoverability. It keeps Welshman as the core Nostr data layer while adding Budabit-specific relay policy, community context, retry behavior, and component simplification.

## Problem Summary

Budabit often renders profiles through `ProfileCircle`, `ProfileName`, `ProfileInfo`, and `ProfileDetail`, which depend on Welshman's `deriveProfile` and `loadProfile`. Most of the time this works. Rarely, a profile `kind:0` is missed until page reload.

The likely failure mode is a race between early bare-pubkey profile loads and later better relay-hinted loads. Welshman's generic item loader deduplicates and backs off by pubkey only, so a no-hint load can suppress a later load with community relay hints while the profile is still missing.

There are also direct image rendering paths that can produce broken images, especially empty `src=""` values.

## Design Constraints

| Constraint | Decision |
|---|---|
| Welshman is still the data layer | Reuse Welshman repository, router, profile parsing, NIP-65 outbox loading, and stores. |
| Budabit needs community-aware routing | Add a Budabit wrapper for profile loading and publishing policy instead of replacing Welshman. |
| Keep `url` behavior stable | `url` remains a single relay/event-source hint. Add `relays` or `profileRelays` instead of changing `url` semantics. |
| Do not use repo relays for profiles | Repo relays are not profile storage relays unless they are also community/indexer/outbox relays. |
| No pre-membership profile fanout | Community relays are used for personal user-data publication only on explicit update and only for active validated communities. |
| Avoid blank images | Shared avatar logic must provide a fallback and never emit empty `img src`. |

## Phase 1: Document And Test Relay Policy Baseline

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 1 work before starting Phase 2.

| Task | Output |
|---|---|
| Add relay publishing policy reference | `docs/architecture/Budabit-Relay-Publishing-Policy.md`. |
| Add tests for helper behavior before wiring callers | Unit tests for relay merging, community filtering, and repo announcement targeting. |
| Capture current `url` prop behavior | Tests or snapshots for profile path generation, modal relay hints, and event-source interactions. |

Validation:

- Existing profile routes with `npub` and `nprofile` keep working.
- `ProfileDetail` still builds `makeProfilePath(pubkey, relayHints)` correctly.
- No repo relays are added to profile read helpers.

## Phase 2: Add Relay Policy Helpers

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 2 work before starting Phase 3.

Create small helpers rather than spreading relay merge logic across UI components.

| Helper | Responsibility |
|---|---|
| `activeUserCommunityRelays` | Derived union of `activeUserCommunityRefs.flatMap(ref => ref.relayHints)`. |
| `getActiveUserCommunityRelays()` | Synchronous getter for command paths. |
| `getUserDataPublishRelays(baseRelays)` | Normalize and merge existing targets with active user community relays at explicit update time. |
| `getScopedCommunityPublishRelays(communityPubkeys)` | Resolve only the requested communities' relays. |
| `getRepoAnnouncementPublishRelays(params)` | Merge git indexers, user outbox, user GRASP relays, repo relays, and h-tagged community relays only. |

Rules to enforce:

- Personal user data gets active community relays only when the user updates the event.
- Community-bound events get only scoped community relays.
- Repo events remain repo-relay scoped unless the repo announcement is explicitly h-tagged with a community.

## Phase 3: Publish Personal User Data To Active Community Relays On Update

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 3 work before starting Phase 4.

Update publishing paths to use `getUserDataPublishRelays(...)`.

| Area | Current path to audit | Expected change |
|---|---|---|
| Profile metadata | `updateProfile` | Add active user community relays to existing outbox/indexer targets when profile is saved. |
| Relay policy | `setRelayPolicy` | Add active user community relays when outbox relays are changed. |
| Messaging relay policy | `setMessagingRelayPolicy` | Add active user community relays when messaging relays are changed. |
| Blossom server list | settings Blossom save path | Add active user community relays when personal Blossom servers are saved. |
| GRASP server list | `postGraspServersList` | Add active user community relays when GRASP servers are saved. |
| Follow/mute/search/blocked lists | Welshman command wrappers or Budabit call sites | Add active user community relays on explicit update. |
| App settings | `publishSettings` | Add active user community relays on explicit update. |
| Extension settings | `postExtensionSettings` | Add active user community relays on explicit update. |
| Git auth backup | git auth persist relay selection | Add active user community relays on explicit update. |
| Repo watch | `updateRepoWatch` | Add active user community relays on explicit update. |

Do not add a background job that republishes old events merely because `activeUserCommunityRefs` changes.

## Phase 4: Fix Repo Publishing Relay Selection

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 4 work before starting Phase 5.

Repo-related publishing should be explicit and narrow.

| Event group | Expected relay behavior |
|---|---|
| Repo announcement | Publish to git indexers, user outbox, user GRASP relays, repo relays, and h-tagged community relays if present. |
| Community repo announcement | If the announcement has an `h` tag with a community pubkey, publish to that community's relays only, not all active communities. |
| Repo state | Publish to repo relays and GRASP-backed repo targets. |
| Issues, PRs, updates, statuses, labels, comments | Publish to repo relays. |
| Deletes | Publish to the same relay scope as the deleted event. |
| Targeted publications | Publish to the target community relays and the publication's normal relays. |

Validation:

- A repo announcement h-tagged for community A does not publish to community B just because the user is also a member of B.
- Regular repo issue/PR actions do not inherit active community relays.
- Git indexer relays remain part of repo announcement discovery.

## Phase 5: Add Budabit Profile Resolver Wrapper

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 5 work before starting Phase 6.

Build a thin wrapper over Welshman profile APIs.

| Responsibility | Detail |
|---|---|
| Reuse Welshman | Use `profilesByPubkey`, `deriveProfile`, `loadProfile`, and `forceLoadProfile`. |
| Context-aware hints | Merge indexers, explicit profile hints, active/scoped community relays, and optional nprofile hints. |
| Retry on improved hints | Track attempts by `pubkey + normalized relay set`; if new relays are added and the profile is missing, force a new load. |
| Avoid repo relays | Do not include repo relays in profile fetch hints by default. |
| Keep store API simple | Expose `deriveBudabitProfile(pubkey, options)` and `deriveBudabitProfileDisplay(pubkey, options)` or equivalent. |

Suggested options shape:

```ts
type ProfileResolutionOptions = {
  url?: string
  relays?: string[]
  communityRelays?: string[]
  includeActiveCommunityRelays?: boolean
}
```

The wrapper should normalize relay lists, dedupe, and only retry aggressively while the profile is missing. Once a profile is loaded, normal Welshman store updates should drive rendering.

## Phase 6: Simplify Profile Components

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 6 work before starting Phase 7.

Update common profile components to use the Budabit resolver.

| Component | Change |
|---|---|
| `ProfileCircle` | Use resolver and always render a fallback avatar. |
| `ProfileName` | Add `relays?: string[]`; keep `url?: string`; use resolver display. |
| `ProfileInfo` | Use resolver with `url + relays`. |
| `Profile` | Continue accepting `url` and `relays`; pass them consistently. |
| `ProfileLink` | Add `relays?: string[]`; pass both to `ProfileName` and `ProfileDetail`. |
| `ProfileDetail` | Use resolver and preserve `url` for event info and nprofile route hints. |
| `NostrGitProfileComponent` | Pass any available relays without treating repo relays as profile relays. |

Regression guard:

- Do not remove the `url` prop.
- Do not reinterpret `url` as a community pubkey or a general profile source object.
- Prefer adding `relays` over changing existing call signatures.

## Phase 7: Remove Empty Image Sources

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 7 work before starting Phase 8.

Centralize avatar rendering and harden the generic image component.

| Task | Expected result |
|---|---|
| Replace direct `$profile?.picture || ""` avatar usages | Use `ProfileCircle` or shared avatar component. |
| Harden `ImageIcon` | Empty, null, or whitespace `src` should render an icon/fallback, not `<img src="">`. |
| Audit package UI avatars | Ensure empty `AvatarImage src` cases have fallback content or avoid rendering the image. |
| Add tests or story fixtures | Missing profile, missing picture, invalid image URL, and slow-loading profile should not show broken image UI. |

Known target: `ChannelMessage` currently renders an empty `src` when `$profile?.picture` is missing.

## Phase 8: Propagate Community Profile Hints Where Appropriate

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 8 work before starting Phase 9.

Use community relay hints for profile reads in community surfaces.

| Surface | Hint policy |
|---|---|
| Active community pages | Use active community relays for profile reads. |
| Community selector/cards | Use the community definition/session relay hints. |
| Community profile lists and moderation views | Use scoped community relays, because these are community membership surfaces. |
| Chat and DMs | Use indexers, counterparty outbox, messaging relay discovery hints, and active community relays only when relevant to the surface. |
| Repo views | Do not pass repo relays as profile hints unless also community scoped. |

This phase should prefer narrow, explicit data flow over global defaults.

## Phase 9: Observability And Diagnostics

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 9 work before starting Phase 10.

Add low-noise diagnostics in development builds.

| Diagnostic | Purpose |
|---|---|
| Profile load source summary | See which relay sets were tried for a pubkey. |
| Missing-profile retry reason | Distinguish first load, improved hints, and manual force load. |
| Empty-image warning | Catch new `src=""` paths during development. |
| Publish relay summary | Confirm personal update events include active community relays and repo events do not. |

Do not log private event contents, decrypted settings, git tokens, or secret material.

## Phase 10: Test Matrix

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 10 work before starting Phase 11.

| Scenario | Expected result |
|---|---|
| Bare npub profile route | Fetches from indexers and outbox; no crash if profile missing. |
| nprofile route with relay hints | Hinted relays are tried even if a prior bare load failed. |
| Active community member profile | Community relays are used for profile reads. |
| Banned community member | Excluded from active community relay fanout. |
| User updates profile | Publishes to outbox, indexers, and active community relays. |
| User joins community but makes no updates | No automatic fanout of old personal user-data. |
| User updates messaging relays | Publishes to existing targets plus active community relays. |
| h-tagged community repo announcement | Publishes to git indexers, user outbox, user GRASP relays, repo relays, and that h-tagged community's relays only. |
| Repo PR/comment/status | Publishes to repo relays only. |
| Missing profile picture | Renders fallback avatar, not broken image. |
| Slow profile load | Fallback updates to profile avatar/name when metadata arrives. |

## Phase 11: Final Five-Pass Review And Improvement Loop

Phase gate:

- Start by reading `docs/architecture/Budabit-Relay-Publishing-Policy.md` and this implementation plan.
- Finish by committing and pushing the completed Phase 11 work after the fifth review-improve pass is complete.

The final phase is an explicit code review and correction loop. Each pass should look for bugs, inconsistencies, simplification opportunities, and optimization opportunities, then apply fixes before the next pass.

| Pass | Focus | Required action |
|---:|---|---|
| 1 | Correctness | Review relay selection against `Budabit-Relay-Publishing-Policy.md`; fix any event type sent to the wrong relay set. |
| 2 | Regression risk | Review `url` and `relays` propagation; fix any behavior that changes existing modal links, nprofile paths, event info, deletes, or reactions. |
| 3 | Simplification | Remove duplicated relay merge logic and duplicated avatar/name resolution code; keep helpers small and explicit. |
| 4 | Performance | Review profile resolver retry behavior, batching, and store subscriptions; avoid unbounded force loads or hot reactive loops. |
| 5 | UI and failure states | Review missing profile, broken image, empty relay, failed relay, and slow relay states; fix fallback and loading inconsistencies. |

After each pass:

1. Apply corrections immediately.
2. Re-run the relevant unit/type checks.
3. Re-review the changed files before starting the next pass.
4. Stop only when all five review-improve cycles are complete.

The goal of this final phase is not only to catch bugs but to leave the implementation simpler than the first working version.
