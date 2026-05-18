# Budabit Community Implementation Plan

This document tracks the implementation phases for the Communikey-based Budabit redesign described in `docs/architecture/Budabit-Community-Architecture.md`.

The target is a clean break from relay-as-community. Each phase should leave the repository in a working state, be verified, then committed and pushed before continuing.

## Phase 0: Protocol Primitives

Implement pure helpers and tests before changing app behavior.

Scope:

- Add Communikey constants for community definitions, targeted publications, profile lists, badges, badge awards, forms, and form responses.
- Parse community inputs: raw hex pubkey, `npub`, and `ncommunity://<pubkey>?relay=<url>`.
- Parse `kind:10222` community definitions into a normalized model.
- Parse content sections, section kinds, profile-list refs, relays, blossom servers, mints, terms, location, and description.
- Parse and build `kind:30222` targeted publication templates.
- Add profile-list based write-permission helpers.

Exit criteria:

- Focused unit tests pass for input parsing, definition parsing, section parsing, targeting, and write checks.

## Phase 1: Community Session And Bootstrap

Introduce active community state without fully replacing all old routes yet.

Scope:

- Add active community session store with `communityPubkey`, relay hints, and latest definition ID.
- Persist selected community separately from user identity.
- Load latest `kind:10222` for selected community.
- Load community `kind:0` metadata.
- Load referenced `kind:30000` profile lists.
- Add community input labelled `Community npub, hex, or ncommunity`.
- Remove home entry dependency on legacy platform relay config.

Deferred notes:

- Minimal initial community setup flow is deferred, but must be revisited.

## Phase 2: Routing Rewrite

Replace relay-encoded route identity with community identity.

Target route family:

| Current | Target |
|---|---|
| `/spaces/[relay]` | `/c/[community]` |
| `/spaces/[relay]/[h]` | `/c/[community]/rooms/[roomId]` |
| `/spaces/[relay]/threads` | `/c/[community]/threads` |
| `/spaces/[relay]/calendar` | `/c/[community]/calendar` |
| `/spaces/[relay]/goals` | `/c/[community]/goals` |
| `/spaces/[relay]/git` | `/c/[community]/git` |

Route param rule:

- Parse raw hex, `npub`, and `ncommunity` in route params and inputs.
- Generated links may normalize to `npub`, but route parsing must support all three forms.

## Phase 3: Community Feed Loading

Replace platform-relay content loading with community-definition based loading.

Scope:

- Use `r` relays from latest `kind:10222`.
- Query exclusive events by `#h = communityPubkey`.
- Query room messages by `#h = communityPubkey` and `#E = roomRootId`.
- Query targeted publications through `kind:30222` with `#p = communityPubkey`.
- Remove `isPlatformRelay` gates from community content.

## Phase 4: Rooms Redesign

Replace `ROOM_META` room metadata with immutable `kind:11` room roots.

Scope:

- Create rooms as `kind:11` with `h = communityPubkey`, `room` marker, and `title`.
- Use room root event ID as canonical room ID.
- Derive room lists from `kind:11` room roots.
- Exclude room roots from forum thread lists.
- Remove room-name-as-ID behavior from the new community path.

## Phase 5: Room Messages

Make community room chat use NIP-C7 `kind:9` messages.

Scope:

- Publish room messages with `h = communityPubkey`, root `E`, and `K = 11`.
- Publish replies with an additional NIP-C7 `q` tag to the parent message.
- Query room messages by `#h` and `#E`.
- Remove global roomless community chat.
- Keep direct DMs unaffected.

## Phase 6: Forum Threads

Keep forum threads as `kind:11`, separate from rooms by convention.

Scope:

- Publish forum roots with `h = communityPubkey`, `title`, and no `room` marker.
- Keep replies as `kind:1111` comments.
- Ensure forum lists filter out room roots.

## Phase 7: Targeted Publications

Implement `kind:30222` for selected public publication types.

Targeted kinds:

- `31922` calendar events.
- `9041` goals.
- `30617` repo announcements.
- `1623` git permalinks.
- `30033` smart widgets.

Scope:

- Original event gets `h = targetingId`.
- `kind:30222` gets matching `d = targetingId`.
- `kind:30222` references original via `a` or `e` and includes `k`, `p`, and `r` tags.
- Publish original to user write relays plus community relays.
- Publish targeting event to community relays.

Deferred notes:

- Target-management during edit flows is deferred, but must be revisited.

## Phase 8: Write Permissions

Enforce section write permissions from profile lists.

Scope:

- Gate room creation by `Rooms`.
- Gate room messages by `General` `kind:9` subtype `room-message`.
- Gate forum thread creation by `Forum`.
- Gate comments, reactions, and labels by `General`.
- Gate targeted publication creation by the matching section.
- Badge UX is separate from write permissions. Grant/revoke workflows require profile-list manager authority.

## Phase 9: Admin Tools

Add practical one-community administration.

Scope:

- Show sections, authoritative profile lists, and current writers.
- Grant access only when logged-in user can update the section profile list.
- Revoke access by removing from profile list. Badges remain separate community endorsements.
- Archive rooms through authoritative `kind:1985` labels.
- Community root editor can be added later.

## Phase 10: Cleanup

Remove relay-as-community dead code from the new core model.

Scope:

- Remove or isolate `ROOM_META`, `ROOM_DELETE`, and `ROOM_CREATE_PERMISSION` from community flows.
- Remove `loadPlatformChannels` from community flows.
- Remove platform relay trust UI from community entry.
- Use `VITE_DEFAULT_COMMUNITY` and `VITE_INDEXER_RELAYS` for the new community entry path.
- Remove or rewrite tests that assume legacy relay-space routes.

## Phase 11: Verification

Run full verification after the migration is complete.

Expected commands:

- `npm run check`
- Focused unit tests for community parser, state, routing, rooms, and targeting.
- `npm run test:main`
- Focused e2e tests for community selection, rooms, room messages, forum threads, and targeted publications.
- `npm run build`
