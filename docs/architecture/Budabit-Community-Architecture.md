# Budabit Community Architecture

This document describes Budabit's target community architecture after the pivot from relay-as-community to Communikeys.

Budabit should treat this as a clean redesign of the community foundation. Legacy relay spaces, relay URL identity, and NIP-29 room metadata are not part of the target model.

## Summary

Budabit communities are identified by a pubkey.

The community pubkey publishes a `kind:10222` Communikey definition event. That event defines the community's relays, blossom servers, supported content sections, profile lists used for write permissions, and optional badge references for engagement.

Relays are infrastructure. They are not identity.

The selected community is the root of the application session. A user may enter either an `npub` or an `ncommunity` value. `ncommunity` provides relay hints, but bare `npub` must be enough.

## Core Principles

| Principle | Decision |
|---|---|
| Community identity | The community pubkey is the canonical durable identifier. |
| Relay identity | Relay URLs are never community IDs. They are relay hints and publication targets. |
| Session scope | A Budabit session stores the selected community pubkey and optional relay hints. |
| Read visibility | All community content is publicly readable for now. |
| Write access | Profile lists are the effective write-permission source. |
| User-community membership | App-wide membership is derived from community definitions plus section profile lists: admin, moderator/list owner, or member/grantee. |
| Badges | Badges drive engagement and endorsements; profile list inclusion is what Budabit enforces for write access. |
| Rooms | Rooms are immutable `kind:11` roots with a `room` marker. |
| Room messages | Room messages are `kind:9` chat events scoped to the community and room root. |
| Forum threads | Forum threads remain `kind:11`, distinguished from rooms by absence of a `room` marker. |
| Global chat | There is no global community chat. Every chat message belongs to a room. |
| Targeted publications | Calendar events, goals, repo announcements, permalinks, and smart widgets use `kind:30222`. |
| Exclusive content | Rooms, room messages, forum threads, comments, reactions, labels, deletes, reports, profile data, badges, forms, and lists are not targeted publications. |
| Migration | This is a clean break. Legacy relay-space architecture is not preserved as a compatibility layer. |

## Community Resolution

Budabit should offer an input field labelled along these lines:

```text
Community npub or ncommunity
```

Resolution flow:

1. Parse input as `ncommunity`, `npub`, or raw hex pubkey.
2. Extract the community pubkey.
3. Extract relay hints if the input is `ncommunity`.
4. Fetch the latest `kind:10222` event authored by the community pubkey.
5. Fetch the community `kind:0` profile metadata.
6. Fetch profile lists referenced by the `kind:10222` content sections.
7. Build the active community model from the community pubkey and latest valid definition.

Bare `npub` resolution should use best-effort discovery through bootstrap relays, indexer relays, outbox discovery, and eventually any relays found from prior cache state.

## Session Model

The session must persist community identity separately from user identity.

Suggested shape:

```json
{
  "userPubkey": "<logged-in-user-pubkey>",
  "communityPubkey": "<selected-community-pubkey>",
  "communityRelayHints": ["wss://relay.example.com"],
  "communityDefinitionId": "<latest-kind-10222-id>"
}
```

`userPubkey` answers who is using Budabit.

`communityPubkey` answers which community Budabit is currently viewing.

Guests can select a community and read public content. Logged-in users can publish only when they satisfy the section's write rules.

## Community Definition

Budabit communities are defined by `kind:10222` events authored by the community pubkey.

The community profile name, picture, and default description come from the community pubkey's `kind:0` metadata event. A `description` tag in `kind:10222` can override the profile description for Budabit community display.

Example target shape:

```json
{
  "kind": 10222,
  "pubkey": "<community-pubkey>",
  "tags": [
    ["r", "wss://main.community.relay"],
    ["r", "wss://backup.community.relay"],
    ["blossom", "https://blossom.community.example"],

    ["content", "General"],
    ["k", "1111"],
    ["k", "7"],
    ["k", "1985"],
    ["k", "9", "room-message"],
    ["a", "30000:<list-pubkey>:General", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Rooms"],
    ["k", "11", "room"],
    ["a", "30000:<list-pubkey>:Rooms", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:room-admin"],

    ["content", "Forum"],
    ["k", "11", "forum"],
    ["a", "30000:<list-pubkey>:Forum", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Calendar"],
    ["k", "31922"],
    ["a", "30000:<list-pubkey>:Calendar", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Goals"],
    ["k", "9041"],
    ["a", "30000:<list-pubkey>:Goals", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Repositories"],
    ["k", "30617"],
    ["a", "30000:<list-pubkey>:Repositories", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:repo-curator"],

    ["content", "Permalinks"],
    ["k", "1623"],
    ["a", "30000:<list-pubkey>:Permalinks", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Widgets"],
    ["k", "30033"],
    ["a", "30000:<list-pubkey>:Widgets", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:app-curator"]
  ],
  "content": ""
}
```

The third value in a `k` tag is a Budabit subtype convention. It is needed when one event kind supports more than one community section.

| Tag | Meaning in Budabit |
|---|---|
| `["k", "11", "room"]` | `kind:11` room roots. |
| `["k", "11", "forum"]` | `kind:11` forum thread roots. |
| `["k", "9", "room-message"]` | `kind:9` room chat messages. |

## Access Control

Budabit uses Communikey access control only for write permissions in the first version.

Read access is public. Budabit should not hide community content based on badges or profile lists.

Write access workflow:

1. Read the active community's latest `kind:10222` definition.
2. Find the content section for the attempted publication.
3. Fetch the section's referenced `kind:30000` profile list.
4. Check whether the user's pubkey is in that list.
5. Allow publishing only when the user is listed.

Badges remain important as community endorsements and engagement primitives, but they are not access-control inputs. For Budabit enforcement, profile list inclusion is authoritative.

## App-Wide User Community Membership

Budabit should derive a canonical app-wide list of communities the active user is part of. Feature-specific systems such as Blossom must consume that list instead of re-implementing their own community-membership rules.

A user is part of a community when at least one of these is true:

- Admin: the latest `kind:10222` definition is authored by the user.
- Moderator: a section in `kind:10222` references a `kind:30000` profile-list address owned by the user, and Budabit has seen that user-authored `kind:30000` event.
- Member/grantee: a referenced section profile-list event contains a `p` tag for the user.

Non-admin users are excluded when effective community report state contains a person-ban for that user. The community admin is never excluded by a person-ban in their own community.

Discovery should keep `kind:30000` profile-list events as a first-class entrypoint. If the user-authored profile list includes an `a` tag pointing to `10222:<community-pubkey>:` with a relay hint, Budabit may use that relay hint to find the community definition. Budabit should still validate the role against the loaded `kind:10222` section refs before treating the user as a moderator.

Community-scoped data used to validate membership, including referenced section profile lists and moderation reports, should be loaded from the relays declared by the loaded `kind:10222` definition. Personal outbox and indexer relays may help discover root `kind:10222` definitions, but they are not fallback sources for scoped membership or moderation state.

## Badge Display And Access Revocation

NIP-58 badge awards are immutable `kind:8` events. The NIP-58 text defines how badges are created, awarded, and displayed, but it does not define a standard revocation event that deletes or invalidates a badge award.

NIP-58 users can choose whether to display badges through their profile badge event. That is user-side acceptance/display, not issuer-side revocation.

For Budabit section access, effective revocation is profile-list removal:

```json
{
  "kind": 30000,
  "pubkey": "<list-manager-pubkey>",
  "tags": [
    ["d", "General"],
    ["p", "<still-allowed-pubkey>"]
  ],
  "content": ""
}
```

When a user is removed from the relevant section list, Budabit must treat that user as no longer allowed to publish in that section, even if an old badge award event still exists.

Admin tooling that grants or revokes access must update profile lists. Badge awards may be published separately as recognition or onboarding context, but they are not effective permission state:

| Action | Badge event | Profile list event | Effective result |
|---|---|---|---|
| Grant access | Optional endorsement award | Add pubkey to section list | User can publish. |
| Revoke access | Existing badge award remains display state | Remove pubkey from section list | User cannot publish. |
| User hides badge | User updates profile badges | No required change | Display changes, write access unchanged. |

If a future standard defines explicit badge revocation, Budabit can support it for badge display and engagement. Profile lists remain the access-control source of truth unless Budabit intentionally adopts another permission signal.

## Event Taxonomy

| Budabit feature | Kind | Targeted with `kind:30222` | Target model |
|---|---:|---|---|
| Room root | `11` | No | Community-exclusive immutable room root with `h = communityPubkey` and `room` marker. |
| Room message | `9` | No | Community-exclusive chat event with `h = communityPubkey` and room-root reference. |
| Room reply | `9` | No | Same as room message, plus NIP-C7 `q` tag to parent message. |
| Room archive label | `1985` | No | Admin label against room root. |
| Forum thread | `11` | No | Community-exclusive thread with `h = communityPubkey`, no `room` marker. |
| Forum reply | `1111` | No | NIP-22 comment against forum thread. |
| Calendar event | `31922` | Yes | Public publication targeted to the community. |
| Calendar comments | `1111` | No | Comments against calendar event. |
| Goal | `9041` | Yes | Public publication targeted to the community. |
| Goal comments | `1111` | No | Comments against a goal. |
| Repo announcement | `30617` | Yes | Public repo publication targeted to the community catalog. |
| Repo state | `30618` | No | Repo infrastructure state. Inherits repo context. |
| Git issue | `1621` | No | Repo-scoped collaboration. Inherits repo context. |
| Git PR | `1618` | No | Repo-scoped collaboration. Inherits repo context. |
| Git PR update | `1619` | No | Repo-scoped update. Inherits PR context. |
| Git statuses | `1630` to `1633` | No | Repo/issue/PR state. |
| Git cover letter | `1624` | No | Repo/issue/PR body update. |
| Git inline/file comments | `1111` | No | Comments against issue/PR/code root. |
| Git labels | `1985` | No | Repo/issue/PR labels. |
| Git permalink | `1623` | Yes | Public code reference targeted to the community. |
| Smart widget | `30033` | Yes | Public widget/app publication targeted to the community. |
| Reactions | `7` | No | General interaction event. |
| Generic comments | `1111` | No | General interaction event. |
| Labels | `1985` | No | General/admin/moderation event. |
| Deletes | `5` | No | Deletion request or moderation action. |
| Reports | `1984` | No | Moderation signal. |
| Zaps | `9734` / `9735` | No | Payment signal and receipt. Anyone may zap. |
| Profile metadata | `0` | No | User/community identity metadata. |
| Follow list | `3` | No | User graph and community following. |
| Relay list | `10002` | No | User relay configuration. |
| Messaging relay list | `10050` or equivalent | No | User DM relay configuration. |
| Mute list | `10000` | No | User preference. |
| Blossom server list | `10063` or equivalent | No | User preference. |
| App settings and Git auth | `30078` | No | User-private app data. |
| DMs | `4444` | No | Private messaging. |
| Badge definition | `30009` | No | Access-control infrastructure. |
| Badge award | `8` | No | Access-control infrastructure. |
| Profile list | `30000` | No | Access-control infrastructure. |
| Form template | `30168` | No | Admission workflow infrastructure. |
| Form response | `1069` | No | Admission request. |
| Community definition | `10222` | No | Community root configuration. |
| Targeted publication | `30222` | Not applicable | Association between publication and community. |

## Targeted Publications

Budabit uses `kind:30222` for public publications that can be associated with one or more communities.

Targeted kinds:

| Kind | Feature |
|---:|---|
| `31922` | Calendar events. |
| `9041` | Goals. |
| `30617` | Repo announcements. |
| `1623` | Git permalinks. |
| `30033` | Smart widgets. |

Budabit convention:

| Field | Meaning |
|---|---|
| Original publication `h` tag | Targeting identifier, not community pubkey. |
| Targeting event `d` tag | Same targeting identifier used in the original publication's `h` tag. |
| Targeting event `p` tags | Community pubkeys being targeted. |
| Targeting event `r` tags | Main relay hints for the corresponding communities. |

This preserves a strict split:

| `h` value | Used by |
|---|---|
| `communityPubkey` | Exclusive community-native content. |
| `targeting d/id` | Targetable publications associated through `kind:30222`. |

Example targeted calendar publication:

```json
{
  "kind": 31922,
  "tags": [
    ["d", "calendar-event-id"],
    ["h", "targeting-calendar-event-id"],
    ["title", "Demo Day"],
    ["start", "1770000000"],
    ["end", "1770003600"]
  ],
  "content": "Event details"
}
```

Example targeting event:

```json
{
  "kind": 30222,
  "tags": [
    ["d", "targeting-calendar-event-id"],
    ["a", "31922:<author-pubkey>:calendar-event-id", "wss://author-relay.example"],
    ["k", "31922"],
    ["p", "<community-pubkey>"],
    ["r", "wss://main.community.relay"]
  ],
  "content": ""
}
```

Budabit should support one selected community in the first implementation, but the targeting model should allow up to 12 communities per targeted publication later.

## Target Removal

Targeting is mutable through the addressable `kind:30222` event.

To remove a publication from a community, publish a newer `kind:30222` with the same `d` tag and without that community's `p`/`r` pair.

The original publication is not deleted or modified.

## Exclusive Community Content

Exclusive community-native content uses `h = communityPubkey`.

Exclusive content includes rooms, room messages, forum threads, comments that naturally belong to roots, reactions, labels, deletes, and reports.

Example exclusive forum thread:

```json
{
  "kind": 11,
  "tags": [
    ["h", "<community-pubkey>"],
    ["title", "Forum topic"]
  ],
  "content": "Thread body"
}
```

Example forum reply:

```json
{
  "kind": 1111,
  "tags": [
    ["E", "<thread-event-id>", "wss://main.community.relay", "<thread-author-pubkey>"],
    ["K", "11"],
    ["P", "<thread-author-pubkey>", "wss://main.community.relay"]
  ],
  "content": "Reply body"
}
```

## Rooms

Rooms are immutable `kind:11` root events.

The canonical room ID is the room root event ID.

Room root example:

```json
{
  "kind": 11,
  "tags": [
    ["h", "<community-pubkey>"],
    ["room"],
    ["title", "General"]
  ],
  "content": "Room description"
}
```

Room root rules:

| Rule | Decision |
|---|---|
| Kind | `11`. |
| Community scope | `h = communityPubkey`. |
| Room marker | Include a `room` tag. |
| Title | Use NIP-7D `title`. |
| Description | Use `content`. |
| Mutability | Immutable. Create a new room if identity needs to change. |
| Canonical ID | Event ID. |
| URL identity | No relay URL in canonical ID. |

Forum thread roots are also `kind:11`, but they do not include a `room` tag.

## Room Messages

Room messages are NIP-C7 chat events using `kind:9`.

A room message must be scoped to both the community and the room root:

```json
{
  "kind": 9,
  "tags": [
    ["h", "<community-pubkey>"],
    ["E", "<room-root-id>", "wss://main.community.relay", "<room-root-pubkey>"],
    ["K", "11"]
  ],
  "content": "GM"
}
```

Room message replies follow NIP-C7 by adding a `q` tag for the parent chat message:

```json
{
  "kind": 9,
  "tags": [
    ["h", "<community-pubkey>"],
    ["E", "<room-root-id>", "wss://main.community.relay", "<room-root-pubkey>"],
    ["K", "11"],
    ["q", "<parent-message-id>", "wss://main.community.relay", "<parent-message-pubkey>"]
  ],
  "content": "nostr:nevent1...\nyes"
}
```

Room message query for one room:

```json
{
  "kinds": [9],
  "#h": ["<community-pubkey>"],
  "#E": ["<room-root-id>"]
}
```

Budabit should never query room messages by `#h = roomId`. `h` is reserved for the community pubkey in exclusive content.

## Room Archive Labels

Room archiving is represented by an admin label event.

Example:

```json
{
  "kind": 1985,
  "tags": [
    ["h", "<community-pubkey>"],
    ["E", "<room-root-id>", "wss://main.community.relay", "<room-root-pubkey>"],
    ["K", "11"],
    ["L", "budabit:room"],
    ["l", "archived", "budabit:room"]
  ],
  "content": ""
}
```

Only labels authored by pubkeys with the relevant admin/write permission should be authoritative for Budabit's room archive state.

To unarchive, Budabit can publish a newer authoritative label that removes or supersedes the archived state, or use a paired label value such as `active`. The exact conflict-resolution rule should be timestamp-based and scoped to trusted admin authors.

## Publishing Relay Policy

| Event type | Publish relays |
|---|---|
| Exclusive community events | All `r` relays from latest `kind:10222`. |
| Original targetable publication | User write relays plus community relays. |
| `kind:30222` targeting event | Community relays. |
| Badge/profile-list admin events | Relays referenced by the community definition plus relevant issuer/list-manager relays. |
| User-private app data | User relays only. |

This keeps community discovery reliable without making original publications permanently dependent on one community's relay set.

## Fetching Workflow

Community bootstrap:

```json
{
  "kinds": [10222],
  "authors": ["<community-pubkey>"],
  "limit": 1
}
```

Exclusive room roots:

```json
{
  "kinds": [11],
  "#h": ["<community-pubkey>"],
  "#room": [""]
}
```

Some relays may not handle empty-value tag queries consistently. Budabit can fetch `kind:11` by `#h` and filter for the presence of `room` client-side.

Exclusive forum threads:

```json
{
  "kinds": [11],
  "#h": ["<community-pubkey>"]
}
```

Budabit must filter out `kind:11` events that contain a `room` tag.

Targeting events for community publications:

```json
{
  "kinds": [30222],
  "#p": ["<community-pubkey>"]
}
```

After loading `kind:30222`, Budabit fetches referenced original publications via their `e` or `a` tags.

## Admin Key Model

Budabit should not require the community root key to be hot.

| Key | Role |
|---|---|
| Community root key | Signs `kind:0` and `kind:10222`. Should be cold or rarely used. |
| Moderator key | Updates delegated profile lists, reviews applications, creates community endorsements, and publishes admin labels. Can be hot or delegated. |
| User key | Publishes user content when included in the relevant profile list. |

The profile list `a` tags may reference lists managed by delegated pubkeys. Badge definitions and awards are discovered by badge-specific views and should not be required for community bootstrap or section access checks.

This allows Budabit to support practical admin workflows without exposing the main community key in a browser or server process.

## Admission Workflow

Budabit can support simple admission before implementing richer forms.

Minimum useful flow:

1. User requests access to a section or community role.
2. Admin reviews the request.
3. Admin adds the user's pubkey to the relevant `kind:30000` profile list.
4. Budabit treats the user as writable for that section.
5. Admin may award a community badge as separate recognition or onboarding context.

Future form-based flow:

1. A section application form is published as a NIP-101 form template.
2. User submits a `kind:1069` form response.
3. Admin or bot processes the response.
4. Admin or bot updates the profile list and may award a badge as recognition.

Access revocation remains list removal. Badge revocation, if standardized later, affects badge display unless Budabit explicitly adopts it as an additional permission signal.

## Routing Direction

The route model should move away from relay-encoded spaces.

Target direction:

| Current concept | Target concept |
|---|---|
| `/spaces/[relay]` | Community route keyed by pubkey or ncommunity-derived identifier. |
| Relay URL in route | Community pubkey in route/session. |
| Room path `[h]` | Room path by room root event ID. |
| Platform relays env | Optional default community npub or bootstrap hints. |

The deployed website may default to the Budabit community npub, but the app architecture must not derive community identity from deployment relays.

## Clean Break Scope

The target architecture removes these assumptions:

| Removed assumption | Replacement |
|---|---|
| Relay URL is the community. | Pubkey is the community. |
| `h` identifies a room. | `h` identifies the community for exclusive events. |
| `39000` room metadata drives rooms. | `kind:11` immutable room roots drive rooms. |
| Platform relays define the app space. | `kind:10222` defines community infrastructure. |
| Relay auth is the main access model. | Profile-list write permission is the client-side model. |
| Global roomless space chat exists. | Every chat message belongs to a room. |

## Implementation Guardrails

This document is the target design, not the implementation phase plan.

Important guardrails for future implementation:

1. Do not introduce relay URL based compatibility shims into the new core model.
2. Keep read visibility public until Budabit intentionally implements real relay-side or encryption-based privacy.
3. Keep `h = communityPubkey` reserved for exclusive community-native events.
4. Keep `h = targeting identifier` reserved for targetable publications that have a `kind:30222` association.
5. Treat profile lists as the effective write-permission source.
6. Treat room root event IDs as canonical room IDs.
7. Keep one active community in the first UI, but model targeted publications as multi-community capable.
