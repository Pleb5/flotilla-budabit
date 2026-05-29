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

## Community-Bound Publication

Community-bound events are scoped to one community or a small explicit set of communities. They should use scoped community relays, not all active community relays.

| Event | Kind | Publish relays | Why |
|---|---:|---|---|
| Community definition | `10222` | The community's configured relays, plus explicit setup/admin targets. | The definition establishes the relay set and should be discoverable at its own relays. |
| Section profile list | `30000` | Scoped community relays and explicit authority relay hints. | Profile lists are access-control state for the community. |
| Admission form template | `30168` | Scoped community relays. | Forms are community moderation workflow state. |
| Admission form response | `1069` | Scoped community relays for the selected community. | Applicant state belongs to the community reviewing it. |
| Admission review reaction | `7` | Scoped community relays. | Review decisions must be close to the response and profile-list state. |
| Community report/person ban | `1984` | Scoped community relays. | Moderation evidence is contextual and should not become global gossip. |
| Report review label | `1985` | Scoped community relays. | Review labels are moderation workflow state. |
| Community badge definition | `30009` | Scoped community relays and explicit issuer relays when needed. | Badge definitions are community endorsement infrastructure. |
| Community badge award | `8` | Scoped community relays and explicit badge issuer/recipient targets when needed. | Awards should be discoverable in community profile views. |
| Room root | `11` | Scoped community relays. | Room identity is community-local. |
| Room message/reply | `9` | Scoped community relays. | Chat content belongs to the selected community room. |
| Thread root | `11` | Scoped community relays. | Thread identity is community-local. |
| Thread reply/comment | `1111` | Scoped community relays and event reply hints where applicable. | Replies should stay close to the community thread. |
| Community star/reaction | `7` | Scoped community relays, user outbox, indexers where current community-star helpers require discovery. | Community preference discovery benefits from both scoped and user-owned locations. |

If an event targets multiple communities explicitly, publish to the union of those communities' relays. Do not add unrelated active communities.

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
| Targeted publication association | `30222` | Scoped target community relays and the publication's normal relays. | Association belongs to the community being targeted. |

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
