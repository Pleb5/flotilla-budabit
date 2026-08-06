# Budabit Relay Publishing Policy

This document defines where Budabit should publish events. It separates personal identity data, community-bound data, and repository-related data so relay selection stays intentional and discoverability improves without broad, accidental fanout.

## Core Rules

| Rule | Policy | Why |
|---|---|---|
| Relay URLs are infrastructure | Relays are publication targets and discovery hints, not identities. | Community identity is the community pubkey, not a relay URL. |
| Do not publish before membership | Community relays are included for personal user-data updates only after Budabit has validated the user as a current community admin, moderator, or member/grantee. | Avoids letting non-members use community relays as a default profile broadcast surface. |
| Publish to community relays only on update | When the user updates supported personal user-data events, include all active community relays at that time. Do not backfill automatically just because membership changes. | Reduces unnecessary attack surface while making future updates easier to discover inside communities. |
| Exclude banned memberships | Active community relays come from validated memberships minus communities where the user is effectively person-banned. Community admins are not excluded from their own community by person-ban reports. | Matches the community membership model and avoids disseminating through communities that currently reject the user. |
| Do not use repo relays for profiles | Repository relays are not profile storage relays unless they are also indexer, user outbox, or relevant community relays. | Repo infrastructure should not be treated as identity infrastructure. |
| Do not treat event provenance as author routing | `tracker.getRelays(eventId)` identifies relays where that exact event was seen. It is not the author's outbox relay list. | Prevents fetching or publishing profile data to unrelated event-source relays. |
| Prefer narrow scoped publication | Community-scoped events go to the scoped community relays, not every active community. Repo-scoped events go to repo relays, not every active community. | Limits data leakage and keeps relay load bounded. |
| Community writes require a definition | Community-bound writes use only normalized relays declared by the loaded community definition. Route hints, discovery relays, event provenance, and runtime widget hints are never write fallbacks. | Bootstrap destinations are discovery inputs, not community publication authority. |
| Empty scoped destinations fail closed | A scoped publish or explicit scoped delete with no valid relay must fail before creating a publish thunk. | Prevents router, tracker, URL, or library defaults from silently widening publication. |

## Relay Sets

| Relay set | Source | Used for |
|---|---|---|
| Indexer relays | `VITE_INDEXER_RELAYS`, exposed as `INDEXER_RELAYS` / `COMMUNITY_DISCOVERY_RELAYS` | Profile discovery, relay-list discovery, broad public identity fanout. |
| User outbox relays | User NIP-65 `kind:10002` write relays via Welshman router `Router.get().FromUser()` | Personal public data and user-owned app data publication. |
| User read relays | User NIP-65 read relays via `Router.get().ForUser()` | Reads and discovery, not normally direct publication. |
| Messaging relays | User messaging relay list `kind:10050` | DM delivery and messaging relay discovery. |
| Active community relays | Union of `definition.relays` from `activeUserCommunityRefs` | Personal user-data fanout when the user updates that data. |
| Scoped community relays | Relays from one specific community definition | Community-bound content, moderation, applications, and h-tagged community repo announcements. |
| Git indexer relays | `VITE_GIT_RELAYS` / `GIT_RELAYS` when used for git discovery | Repo announcement discovery and git app infrastructure. |
| Repo relays | Relays declared or selected for a repository | Repo state, issues, PRs, comments, labels, and status events. |
| User GRASP relays | User's GRASP server list, with app fallback where configured | Repo announcement and GRASP-backed repo discovery. |

## Active Community Relay Eligibility

Active community relays for personal user-data publication are computed from app-wide community membership.

| Role | Inclusion rule |
|---|---|
| Admin | User authored the latest loaded community `kind:10222` definition. |
| Moderator | A loaded section `kind:30000` profile-list event is authored by the user and referenced by the latest community definition. |
| Member/grantee | A referenced section `kind:30000` profile-list event contains a `p` tag for the user. |
| Banned non-admin | Excluded when effective community report state contains a person-ban for the user. |

Implementation source of truth: `activeUserCommunityRefs` in `src/app/core/community-state.ts`, derived through `selectUserCommunityRefs` in `src/app/core/community-membership.ts`.

## Personal User-Data Publication

Personal user-data events are not community-bound by content, but Budabit wants them discoverable close to the user's communities. The rule is: when the user explicitly updates one of these events, publish to the normal targets plus all active community relays.

The current policy rollout is intentionally limited to `kind:0` profiles. It does not add generic personal-metadata synchronization or change the existing publication behavior of the other records listed below.

Profile community destinations come only from the current `activeUserCommunityRefs` snapshot and each reference's `definition.relays`. Budabit selects at most two normalized relays per community and four community relays total, deterministically across communities sorted by pubkey. Stars, route hints, event provenance, newly discovered definitions, indexer results, NIP-65 results, and the configured default community do not establish community eligibility.

| Event | Kind | Normal targets | Add active community relays on user update | Why |
|---|---:|---|---:|---|
| Profile metadata | `0` | User outbox relays, indexer relays | Yes | Names and avatars should be easy to resolve inside communities. |
| Relay list | `10002` | Changed relay, indexer relays, user outbox relays | Yes | Lets community members discover the user's outbox data without relying only on global indexers. |
| Messaging relay list | `10050` | Indexer relays, user outbox relays | Yes | Helps community members discover DM inbox relays after the user intentionally updates them. |
| Blossom server list | `10063` | User outbox relays | Yes | Helps community contexts resolve user media preferences. |
| GRASP server list | app git list kind | User outbox relays, git indexer relays | Yes | Helps collaborators in the user's communities discover their GRASP-backed repository endpoints. |
| Follow list | `3` | User outbox relays | Yes | Public social/discovery graph can be useful in community contexts after explicit update. |
| Mute list | `10000` | User outbox relays | Yes | If the user updates it in Budabit, publish consistently with other user-data updates. |
| Search relay list | app/Welshman search relay list kind | User outbox relays | Yes | User-controlled discovery configuration should follow the same update-time fanout policy. |
| Blocked relay list | app/Welshman blocked relay list kind | User outbox relays | Yes | User-controlled relay policy should follow the same update-time fanout policy. |
| Profile badges | profile badge kind | User outbox relays, badge-related relays when applicable | Yes | Badge display is identity-adjacent and useful in community profile views. |
| App settings | `30078` with Budabit settings d-tag | User outbox relays | Yes | Encrypted settings remain user-controlled; update-time fanout improves restore/discovery from community relays. |
| Extension settings | `30078` with extension settings d-tag | User outbox relays, git indexer relays where currently used | Yes | Keeps extension state available from the user's collaboration contexts. |
| Git auth token backup | `30078` with git auth d-tag | User outbox relays, configured git fallback relays | Yes | Encrypted backup follows the explicit-update rule. Presence leakage is accepted only when the user updates it. |
| Repo watch settings | `30078` with repo-watch d-tag | User outbox relays | Yes | Encrypted user-owned repo preferences follow the explicit-update rule. |

Do not publish these events to community relays merely because a user logs in, views a community, or gains membership. The next explicit update is the dissemination point.

One signed profile replacement is sent concurrently to the selected indexer, current user-outbox, and capped accepted-community destinations. Profile save succeeds after the first relay both acknowledges the event and serves it as the current `kind:0` replacement. Budabit does not wait for every destination, require a quorum, or retry automatically. If no policy-compliant destination exists, profile save fails closed and preserves the submitted form.

## Community-Bound Publication

Community-bound events are scoped to one community or a small explicit set of communities. They should use scoped community relays, not all active community relays.

`activeCommunityRelays` remains bootstrap-capable and is used for loading and live reads. `activeCommunityPublishRelays` is definition-only and is the route/component source for community-bound writes. If the active definition is unavailable or declares no valid relays, publication is unavailable even when route hints or discovery relays were sufficient to load cached community state.

| Event | Kind | Publish relays | Why |
|---|---:|---|---|
| Community definition | `10222` | The community's configured relays, plus explicit setup/admin targets. | The definition establishes the relay set and should be discoverable at its own relays. |
| Section profile list | `30000` | Scoped community relays. | Profile lists are access-control state for the community. |
| Admission form template | `30168` | Scoped community relays. | Forms are community moderation workflow state. |
| Admission form response | `1069` | Scoped community relays for the selected community. | Applicant state belongs to the community reviewing it. |
| Admission review reaction | `7` | Scoped community relays. | Review decisions must be close to the response and profile-list state. |
| Community report/person ban | `1984` | Scoped community relays. | Moderation evidence is contextual and should not become global gossip. |
| Report review label | `1985` | Scoped community relays. | Review labels are moderation workflow state. |
| Community badge definition | `30009` | Scoped community relays. | Badge definitions are community endorsement infrastructure. |
| Community badge award | `8` | Scoped community relays. | Awards should remain in the community context. |
| Room root | `11` | Scoped community relays. | Room identity is community-local. |
| Room message/reply | `9` | Scoped community relays. | Chat content belongs to the selected community room. |
| Thread root | `11` | Scoped community relays. | Thread identity is community-local. |
| Thread reply/comment | `1111` | Scoped community relays. | Replies should stay with the community thread. |
| Community star/reaction | `7` | Scoped community relays. | Community preference events should not leak to unrelated relays. |
| Community widget and targeting association | `30033` / `30222` | Explicit target community relays. | Widget content and its community association remain within the selected communities. |

If an event targets multiple communities explicitly, publish to the union of those communities' relays. Do not add unrelated active communities. Every selected target must have accepted definition relays or publication fails closed.

Community-scoped zaps follow the same destination boundary. When an explicit `scopeH` or the target event's `h` tag establishes community scope, the zap request relay tag contains only normalized relay hints supplied by the scoped caller. Author inboxes, author read relays, event provenance, and generic fallback relays are not added; missing scoped hints produce an empty relay set.

Dedicated extension community publish capabilities derive destinations from `definition.relays` and fail when that set is empty. Generic `nostr:publish` rejects `h`-tagged events, verifies externally signed events before handing them to optimistic publication, and reports failure unless at least one requested relay accepts the event.

Finite community follow-up reads are partitioned per relay. Community relays receive community workflow filters and exact targeted-original filters. An external relay named by a targeting wrapper receives only exact filters for originals explicitly hosted by that relay; it never receives admission, moderation, report, review, delete, or another external relay's original identifiers.

## Repository Publication

Repository-related publishing is mostly repo-relay scoped. The exception is repo announcements, which are also discovery events.

| Event | Kind | Publish relays | Why |
|---|---:|---|---|
| Repo announcement | `30617` | Git indexer relays, user outbox relays, user GRASP relays, and repo relays when available. If the announcement is h-tagged with a community pubkey, also publish to that community's relays only. | Repo announcements are discovery records. Community-tagged repo announcements should be discoverable in that community, but not broadcast to all active communities. |
| Repo state | `30618` | Repo relays and GRASP-backed repo targets. | State belongs to the repo infrastructure. |
| Git issue | `1621` | Repo relays. | Issue collaboration is repo-scoped. |
| Git pull request | `1618` | Repo relays. | PR collaboration is repo-scoped. |
| Pull request update | `1619` | Repo relays. | Updates belong with the PR and repo. |
| Git status | `1630`-`1633` | Repo relays. | Statuses are repo/issue/PR state. |
| Git cover letter | `1624` | Repo relays. | Body updates are repo-scoped. |
| Git inline/file comment | `1111` | Repo relays and explicit reply relay hints when available. | Code discussion should stay with the repo context. |
| Git label | `1985` | Repo relays. | Labels are repo/issue/PR metadata. |
| Role label | `1985` | Repo relays. | Assignee/reviewer state is repo-scoped. |
| Repo delete/moderation marker | `5` or relevant marker kind | Same relays as the event being deleted or moderated. | Delete visibility should match original event visibility. |
| Git permalink | `1623` | Repo relays, and scoped community relays when explicitly community-targeted. | Permalinks are repo-scoped, with optional explicit community targeting. |
| Targeted publication association | `30222` | Scoped target community relays. | The association belongs to the explicitly targeted community. |

For h-tagged community repo announcements, the community relay set must come from the h-tagged community definition. Do not use all active community relays for repo announcements unless all of those communities are explicitly targeted.

## Read-Time Profile Discovery

Publishing policy and read discovery should align but remain separate.

| Profile read source | Use? | Notes |
|---|---:|---|
| Indexer relays | Yes | Broad fallback and bootstrap. |
| Author outbox relays | Yes | Load through Welshman/NIP-65. |
| Active or scoped community relays | Yes | Use for community profile surfaces and profile modals. |
| Relay hints from nprofile/ncommunity | Yes | Explicit hints should be honored. |
| Repo relays | No | Repo relays are not profile storage by default. |
| `tracker.getRelays(non-profile-event-id)` | No | Event provenance is not author profile routing. |

After accepted community references first become available for a signed-in identity, Budabit makes one nonblocking finite `kind:0` request to at most four deterministically selected definition relays. The request uses one author filter with `limit:1`, times out after three seconds, aborts on identity change, and is not retried during that login session. It installs no live subscription and does not rerun when membership state changes.

## Implementation Expectations

| Area | Expected helper |
|---|---|
| Active user community fanout | A helper that returns normalized `activeUserCommunityRefs.flatMap(ref => ref.relayHints)`. |
| Personal user-data publishing | A helper that merges each existing publish target with active community relays at update time. |
| Scoped community publishing | A helper that accepts explicit community definitions or community pubkeys and returns only those communities' relays. |
| Repo publishing | Repo-specific helpers should keep repo relays separate from community and personal fanout. |
| Profile reads | A Budabit wrapper around Welshman profile loading should accept explicit profile/community hints and retry when new hints appear. |

## Non-Goals

- Do not automatically publish a profile to a community before the user is a validated member, moderator, or admin.
- Do not republish all historical personal user-data just because community membership changes.
- Do not treat repo relays as profile relays.
- Do not add all active community relays to repo events that are scoped to one repo or one h-tagged community.
- Do not replace Welshman's router, repository, or profile stores with a Budabit-only rewrite.
