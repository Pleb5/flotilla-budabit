# Budabit Community Architecture

This document describes Budabit's community architecture after the pivot from relay-as-community to Communikeys.

Budabit treats this as a clean redesign of the community foundation. Legacy relay spaces, relay URL identity, and NIP-29 room metadata are not part of the model.

The [access decision record](Community-Access-Decisions.md) explains deployment
levels, the identity/read/write/content boundaries, eventual consistency, independent
DM protection and deferred discovery/joining. This document describes community
structure; [Communikeys](Communikeys.md) owns the wire specification.

## Summary

### Optional private branch scope

The default remains public reads with client moderation (and optional relay write
enforcement). Member-only relay reads are now implemented as an opt-in third level;
see [Community-Read-Control-Plan.md](Community-Read-Control-Plan.md). Each private
endpoint/database pins one exact branch, requires enforcing Python write control
and default-off plugin REQ admission, and serves retained history only after NIP-42
authentication and a plugin membership decision. Active connections are periodically
rechecked; membership is eventually consistent, not commit-synchronized. C++ does
not hold the community roster or address. It is not E2E encryption.

An explicit `/c/<naddr>?read-access=members` invitation remembers relay hints before
definition lookup, without a public discovery fallback for that lookup. Login,
signer and AUTH/retry controls accompany the normal community layout. Relay challenges
authenticate automatically through the shared socket coordinator.
They use pooled sockets and shared loaders, not a separate reader or content gate.
Denial and unavailable policy are not successful empty history.

Once delivered, events enter normal shared storage and persistent caches and may
flow through notifications, search, publication and external providers. Logout,
account change and revocation do not purge or hide cached events. Normal moderation
and write permissions remain. Signed read-access metadata does not restrict client
publication or classify relay endpoints; no private NIP-11 capability gate remains.
This is relay-only protection, not client confidentiality or a live-deployment claim.

### Public/default architecture

Budabit community branches are identified by an exact definition address:

```text
32222:<ownerPubkey>:<communityId>
```

The canonical external pointer is the definition `naddr`. The owner publishes the addressable `kind:32222` definition. Its tags are authoritative for community metadata, relays and other infrastructure, supported content sections, profile lists used for write permissions, and optional badge references for engagement.

Relays are infrastructure. They are not identity.

The selected exact branch is the root of the application session. Users enter its canonical definition `naddr`, which contains kind `32222`, the owner, the `communityId` identifier, and optional relay hints.

## Core Principles

| Principle                 | Decision                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Community identity        | Stable association uses `communityId`; exact branch identity is `32222:<owner>:<communityId>` and its canonical pointer is the definition `naddr`. |
| Relay identity            | Relay URLs are never community IDs. They are relay hints and publication targets.                                                                       |
| Session scope             | A Budabit session stores the selected exact definition address and optional relay hints.                                                                |
| Community visibility      | Budabit admits permission-governed content under current section grants. Matching events may remain publicly retrievable from relays.                   |
| Write access              | Profile lists are the effective write-permission source.                                                                                                |
| User-community membership | App-wide membership is derived from community definitions plus section profile lists: admin, moderator/list owner, or member/grantee.                   |
| Badges                    | Badges drive engagement and endorsements; profile list inclusion is what Budabit enforces for write access.                                             |
| Rooms                     | Rooms are immutable `kind:11` roots with a `room` marker.                                                                                               |
| Room messages             | Room messages are `kind:9` chat events scoped to the community and room root.                                                                           |
| Threads                   | Threads remain `kind:11`, distinguished from rooms by absence of a `room` marker.                                                                       |
| Global chat               | There is no global community chat. Every chat message belongs to a room.                                                                                |
| Targeted publications     | Calendar events, goals, permalinks, and smart widgets use `kind:30222`.                                                                                 |
| Direct repository binding | A community repo announcement has exactly one `h=<communityId>` and is admitted under the current repository-section grant.                            |
| Exclusive content         | Rooms, room messages, threads, comments, reactions, labels, deletes, reports, profile data, badges, forms, lists, and repo announcements are not targeted publications. |
| Migration                 | This is a clean break. Legacy relay-space architecture is not preserved as a compatibility layer.                                                       |

## Community Resolution

Budabit should offer an input field labelled along these lines:

```text
Community definition naddr
```

Resolution flow:

1. Parse the canonical definition `naddr` and require kind `32222`, a owner, and a valid `communityId` identifier.
2. Extract up to three normalized relay hints.
3. Fetch valid definitions at exact `kind + author + #d` coordinates.
4. Select the current replacement at that exact address deterministically.
5. Read community metadata from the accepted definition tags.
6. Fetch every exact profile-list coordinate referenced by its content sections.
7. Build the active branch model from the exact definition address and accepted definition.

Raw pubkeys, `npub`, and `ncommunity` do not identify an exact V2 branch and are not accepted as canonical resolution inputs.

## Session Model

The session must persist community identity separately from user identity.

Suggested shape:

```json
{
  "userPubkey": "<logged-in-user-pubkey>",
  "communityId": "<stable-community-id>",
  "communityDefinitionAddress": "32222:<owner-pubkey>:<community-id>",
  "communityRelayHints": ["wss://relay.example.com"],
  "communityDefinitionId": "<accepted-kind-32222-event-id>"
}
```

`userPubkey` answers who is using Budabit.

`communityDefinitionAddress` answers which exact branch Budabit is currently viewing. `communityId` is the stable association value, not a person or signer.

Guests can select a community and read content that passes Budabit's current community admission rules. Logged-in users can publish only when they satisfy the section's write rules.

## Community Definition

Budabit community branches are defined by addressable `kind:32222` events at `32222:<owner>:<communityId>`.

Community `name`, `description`, `picture`, `banner`, and `website` metadata comes only from definition tags. The owner's `kind:0` is a personal profile and does not fill or override community metadata.

Example target shape:

```json
{
  "kind": 32222,
  "pubkey": "<owner-pubkey>",
  "tags": [
    ["d", "<community-id>"],
    ["name", "Buda Builders"],
    ["description", "A community for builders"],
    ["picture", "https://community.example/picture.png"],
    ["r", "wss://main.community.relay"],
    ["r", "wss://backup.community.relay"],
    ["blossom", "https://blossom.community.example"],
    ["grasp", "wss://preferred.grasp.example"],
    ["grasp", "wss://backup.grasp.example"],
    ["mint", "https://mint.community.example", "cashu"],
    ["g", "u4pruydqqvj"],

    ["content", "General"],
    ["k", "1111"],
    ["k", "7"],
    ["k", "1984"],
    ["k", "1985"],
    ["k", "9", "room-message"],
    ["a", "30000:<list-pubkey>:<community-id>-general", "wss://main.community.relay"],
    ["a", "30000:<list-pubkey>:<community-id>-general.2", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Room-creator"],
    ["k", "11", "room"],
    ["a", "30000:<list-pubkey>:<community-id>-room-creator", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:room-admin"],

    ["content", "Thread-creator"],
    ["k", "11", "threads"],
    ["a", "30000:<list-pubkey>:<community-id>-thread-creator", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Calendar-event-creator"],
    ["k", "31922"],
    ["k", "31923"],
    [
      "a",
      "30000:<list-pubkey>:<community-id>-calendar-event-creator",
      "wss://main.community.relay"
    ],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Fundraiser-goals-creator"],
    ["k", "9041"],
    [
      "a",
      "30000:<list-pubkey>:<community-id>-fundraiser-goals-creator",
      "wss://main.community.relay"
    ],
    ["badge", "30009:<issuer-pubkey>:member"],

    ["content", "Code-curator"],
    ["k", "30617"],
    ["k", "1623"],
    ["a", "30000:<list-pubkey>:<community-id>-code-curator", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:code-curator"],

    ["content", "Widget-curator"],
    ["k", "30033"],
    ["a", "30000:<list-pubkey>:<community-id>-widget-curator", "wss://main.community.relay"],
    ["badge", "30009:<issuer-pubkey>:widget-curator"],

    ["content", "Marketplace"],
    ["k", "32765"],
    ["k", "32766"],
    ["k", "32767"],
    ["k", "32768"],
    ["k", "1986"],
    ["k", "30402"],
    ["a", "30000:<list-pubkey>:<community-id>-marketplace", "wss://main.community.relay"]
  ],
  "content": ""
}
```

Repeated `["grasp", "wss://..."]` tags are ordered: they declare, in preference order, GRASP servers that the community endorses or offers to members. The `g` tag remains the community geohash and must not be interpreted as a GRASP server.

A user's `kind:10063` Blossom list describes that user's blob hosts, while `kind:10317` describes that user's preferred GRASP servers. NIP-61 `kind:10019` is Nutzap receiving configuration rather than a generic mint list; Budabit may use its mint tags as person-level recommendation evidence. These events are not community infrastructure authority, and Budabit does not automatically dual-publish them from `kind:32222`. A declaration from an eligible, non-renounced community is viable recommendation evidence, but applying a recommendation always requires an explicit **Add** action.

The third value in a `k` tag is a Budabit subtype convention. It is needed when one event kind supports more than one community section.

| Tag                          | Meaning in Budabit           |
| ---------------------------- | ---------------------------- |
| `["k", "11", "room"]`        | `kind:11` room roots.        |
| `["k", "11", "threads"]`     | `kind:11` thread roots.      |
| `["k", "9", "room-message"]` | `kind:9` room chat messages. |

Each exact `(kind, subtype)` pair should appear in only one section per community definition. Empty subtype is exact and does not match non-empty subtypes. This lets publish gates, application forms, and member grants resolve to one section without fallback or wildcard behavior.

Budabit's new-community and restored defaults are **General**, **Room-creator**, **Thread-creator**, **Calendar-event-creator**, **Fundraiser-goals-creator**, **Code-curator**, **Widget-curator**, and **Marketplace**. Marketplace groups SatShoot services (`32765`), orders (`32766`), jobs (`32767`), proposals (`32768`), QTS reviews (`1986`), and NIP-99 classified listings (`30402`), all without a subtype. These kinds share the section's profile-list grants. Workspaces come from community-targeted Freelance and Classifieds Smart Widgets; section defaults do not install widget code. Existing definitions require an explicit owner edit: use **Add Marketplace** when its kinds are unassigned, or rename the existing Freelance section and add `30402`. See [Community Marketplace and Freelance](../features/freelance.md).

Section names and their profile-list references are part of the permission lifecycle. Admin edits that rename a section, move a `(kind, subtype)` pair, or remove a section should be treated as dangerous changes. Budabit warns immediately while editing, then summarizes migration effects before publishing.

When migration is selected, Budabit publishes and verifies replacement permission updates before publishing the new community definition. Granted members are merged into a new admin-owned list for destination sections. Moderators must accept new destination-section permissions. Active forms may be copied by the admin. Pending requests, applicant submissions, and user-authored reports are not copied.

### Profile-list sharding

A section may contain repeated `a` tags with distinct `kind:pubkey:d` coordinates. Budabit loads each exact coordinate and treats the union of the current `p` tags as the section grant set. This allows large sections to stay within relay event-size and tag-count limits instead of requiring one unbounded `kind:30000` event.

Each shard remains independently replaceable by its coordinate author. Missing shard evidence contributes no `p`-tag grants or moderator authority. A non-admin shard owner still receives the app's structural community-wide member/write access while the latest definition references that coordinate.

## Access Control

Budabit uses Communikey grants for both publish permission and client-side community visibility. This is curation, not confidentiality: relays may serve the underlying signed events to other clients, and Budabit does not rely on relays to enforce section policy.

Permission workflow:

1. Read the accepted current `kind:32222` definition at the active exact address.
2. Find the content section for the attempted publication.
3. Fetch every exact `kind:30000` coordinate referenced by the section.
4. Union their current `p` tags, include structural member access for referenced non-admin list owners, and include moderator authority only for coordinates with a current non-declined list event.
5. Allow publishing or community rendering only when the relevant author has a current grant and the event passes structural validation.

Badges remain important as community endorsements and engagement primitives, but they are not access-control inputs. For Budabit enforcement, profile list inclusion is authoritative.

The same current grants govern historical and live content. A revocation hides an author's previously visible direct content and targeting wrappers without deleting those events from relays. A regrant invalidates the old admission state and restarts structural acquisition, allowing matching history to be refetched and reappear. Budabit does not preserve a separate “was authorized when published” grant for normal community views.

If the definition or relay read is incomplete, Budabit fails closed. A complete read that finds no target-owned moderator list is settled evidence of a pending invitation, not a loading failure.

### Optional Relay-Side Enforcement

Client-side admission is the authoritative model and must always work. A community relay operator MAY additionally run a write-policy plugin that rejects community-scoped writes the client would not admit under the current signed state: authors without a current section grant, effectively person-banned authors, and structurally invalid Communikeys events. The relay executes the signed definition, profile-list shards, and reports; it never owns them. Enforcement gates new writes only; if the relay disappears, nothing about identity, rules, or history is lost.

The reference implementation plan is the strfry write-control plugin: `strfry/deploy/budabit/WRITE-CONTROL-PLAN.md` in the Budabit strfry fork (`https://github.com/Pleb5/strfry`). It pins relay decisions to this document, `Communikeys.md`, `Budabit-Community-Moderation.md`, and the client rules in `src/app/core/community-permissions.ts` and `community-reports.ts` through exported golden test vectors.

Guardrails that remain in force with an enforcing relay:

- Budabit MUST keep applying current-grant admission and the render-time authority check; the relay is a spam and scale optimisation, not a trust source.
- Budabit MUST NOT change its fetch profile (for example dropping structural admission because of a relay claim) until an owner-signed enforcement declaration is specified. The V1 `["r", url, "enforced"]` marker is invalid in V2 because `r` has exactly two values.
- Reads stay public and NIP-42 stays unused. Write rejections are plain NIP-01 `["OK", id, false, "blocked: ..."]` responses, and publish flows should surface them as retryable policy outcomes.
- Community-scoped `kind:5` deletion requests carry only `h` plus their `e`/`k` references, never the marked community `a` (`Communikeys.md`, "Deletion Requests"). Relays apply NIP-09 to every `a` on a `kind:5`, so the old shape was rejected for non-owners and tombstoned the definition for owners.

Conformance between the client and an enforcing relay is pinned by golden vectors: `src/app/core/community-policy-vectors.test.ts` builds fixture communities with the production helpers and records, for a matrix of candidate events, whether `canWriteCommunityTarget`, `canPublishCommunity*Report`, `getEffectiveCommunityReportState`, and `parseCommunityDefinition` admit them. Run it with `POLICY_VECTORS_OUT` set to regenerate `deploy/budabit/tests/vectors/budabit-policy-vectors.json` in the strfry fork whenever these rules change.

An enforcing relay MAY advertise itself in NIP-11 under a `budabit` object (`policy_version`, `mode`, `enforced_branches`, optional `auto_host`). This is an operator claim and is not a trust input.

Relay rejection details, partial delivery recovery, the protected-kind deletion rule, and the required cross-repository CI reference are documented in [Relay Publish Outcomes](Relay-Publish-Outcomes.md). NIP-11 also distinguishes `dry_run` from `enforcing` and advertises `protected_deletion_kinds`; none of these fields relax client admission.

Proposed, not adopted: an owner-signed declaration as a top-level definition tag `["enforced-relay", "<wss url>"]` (zero to 20; each value MUST also be an `r` relay; ignored, never invalidating, when malformed). A client that adopts it MAY prefer that relay for community reads and MAY skip client-side author filtering for that relay's results after spot-checking a sample against current grants, falling back to full admission the moment an unadmitted event is observed. Adopting it requires a Communikeys amendment and a client change; until then the fetch profile is unchanged.

## App-Wide User Community Membership

Budabit should derive a canonical app-wide list of communities the active user is part of. Feature-specific systems such as Blossom must consume that list instead of re-implementing their own community-membership rules.

A user is part of a community when at least one of these is true:

- Admin: the selected exact `kind:32222` definition is controlled by the user.
- Moderator: a section in the accepted `kind:32222` definition references a `kind:30000` profile-list address owned by the user, and Budabit has seen that user-authored `kind:30000` event.
- Invited list owner/member: the latest definition references a non-admin `kind:30000` coordinate owned by the user. Missing and declined responses retain community-wide member/write access while the reference remains, but confer no moderator, grant, or report-review authority.
- Member/grantee: a referenced section profile-list event contains a `p` tag for the user.

Non-admin users are excluded when effective community report state contains a person-ban for that user. The community admin is never excluded by a person-ban in their own community.

Discovery should keep `kind:30000` profile-list events as a first-class entrypoint. A branch reference must be `32222:<owner>:<communityId>` and, where it conveys branch authority, use marker `community`. Budabit validates the role against the loaded exact `kind:32222` section references before treating the user as a moderator.

Community-scoped data used to validate membership, including referenced section profile lists and moderation reports, should be loaded from the relays declared by the loaded `kind:32222` definition. Indexer relays may help discover exact definitions, but they are not fallback sources for scoped membership or moderation state.

## Badge Display And Access Revocation

NIP-58 badge awards are immutable `kind:8` events. The NIP-58 text defines how badges are created, awarded, and displayed, but it does not define a standard revocation event that deletes or invalidates a badge award.

NIP-58 users can choose whether to display badges through their profile badge event. That is user-side acceptance/display, not issuer-side revocation.

For Budabit section access, effective revocation is profile-list removal:

```json
{
  "kind": 30000,
  "pubkey": "<list-manager-pubkey>",
  "tags": [
    ["d", "<community-id>-general"],
    ["p", "<still-allowed-pubkey>"]
  ],
  "content": ""
}
```

When a user is removed from every shard in the relevant section's current profile-list union, Budabit must treat that user as no longer allowed to publish or remain visible as a section author, even if an old badge award event still exists. Removing the user from only one shard does not revoke a grant that remains in another current shard.

Admin tooling that grants or revokes access must update profile lists. Badge awards may be published separately as recognition or onboarding context, but they are not effective permission state:

| Action           | Badge event                                | Profile list event                    | Effective result                         |
| ---------------- | ------------------------------------------ | ------------------------------------- | ---------------------------------------- |
| Grant access     | Optional endorsement award                 | Add pubkey to a section shard         | User can publish.                        |
| Revoke access    | Existing badge award remains display state | Remove pubkey from all section shards | User cannot publish.                     |
| User hides badge | User updates profile badges                | No required change                    | Display changes, write access unchanged. |

If a future standard defines explicit badge revocation, Budabit can support it for badge display and engagement. Profile lists remain the access-control source of truth unless Budabit intentionally adopts another permission signal.

## Event Taxonomy

| Budabit feature           |                  Kind | Targeted with `kind:30222` | Target model                                                                                       |
| ------------------------- | --------------------: | -------------------------- | -------------------------------------------------------------------------------------------------- |
| Room root                 |                  `11` | No                         | Community-native immutable room root with stable `h=<communityId>` and `room` marker.              |
| Room message              |                   `9` | No                         | Community-native chat event with stable `h=<communityId>` and room-root reference.                 |
| Room reply                |                   `9` | No                         | Same as room message, plus NIP-C7 `q` tag to parent message.                                       |
| Room archive label        |                `1985` | No                         | Admin label against room root.                                                                     |
| Thread root               |                  `11` | No                         | Community-native thread with stable `h=<communityId>`, no `room` marker.                           |
| Thread reply              |                `1111` | No                         | NIP-22 comment against thread root.                                                                |
| Calendar event            |               `31922` | Yes                        | Public publication targeted to the community.                                                      |
| Calendar comments         |                `1111` | No                         | Comments against calendar event.                                                                   |
| Goal                      |                `9041` | Yes                        | Public publication targeted to the community.                                                      |
| Goal comments             |                `1111` | No                         | Comments against a goal.                                                                           |
| Repo announcement         |               `30617` | No                         | Directly bound to one community by exactly one `h=<communityId>`. Controlled by the Code curator section. |
| Repo state                |               `30618` | No                         | Repo infrastructure state. Inherits repo context.                                                  |
| Git issue                 |                `1621` | No                         | Repo-scoped collaboration. Inherits repo context.                                                  |
| Git PR                    |                `1618` | No                         | Repo-scoped collaboration. Inherits repo context.                                                  |
| Git PR update             |                `1619` | No                         | Repo-scoped update. Inherits PR context.                                                           |
| Git statuses              |      `1630` to `1633` | No                         | Repo/issue/PR state.                                                                               |
| Git cover letter          |                `1624` | No                         | Repo/issue/PR body update.                                                                         |
| Git inline/file comments  |                `1111` | No                         | Comments against issue/PR/code root.                                                               |
| Git labels                |                `1985` | No                         | Repo/issue/PR labels.                                                                              |
| Git permalink             |                `1623` | Yes                        | Public code reference targeted to the community. Controlled by the Code curator section.           |
| Smart widget              |               `30033` | Yes                        | Public widget/app publication targeted to the community.                                           |
| Reactions                 |                   `7` | No                         | General interaction event.                                                                         |
| Generic comments          |                `1111` | No                         | General interaction event.                                                                         |
| Labels                    |                `1985` | No                         | General/admin/moderation event.                                                                    |
| Deletes                   |                   `5` | No                         | Deletion request or moderation action.                                                             |
| Reports                   |                `1984` | No                         | Moderation signal.                                                                                 |
| Zaps                      |       `9734` / `9735` | No                         | Payment signal and receipt. Anyone may zap.                                                        |
| Profile metadata          |                   `0` | No                         | Personal identity metadata only.                                                                   |
| Follow list               |                   `3` | No                         | User graph and community following.                                                                |
| Relay list                |               `10002` | No                         | User relay configuration.                                                                          |
| Messaging relay list      | `10050` or equivalent | No                         | User DM relay configuration.                                                                       |
| Mute list                 |               `10000` | No                         | User preference.                                                                                   |
| Blossom server list       |               `10063` | No                         | User blob-hosting configuration and recommendation evidence.                                       |
| GRASP server list         |               `10317` | No                         | User preference and recommendation evidence.                                                       |
| Nutzap information        |               `10019` | No                         | Nutzap receiving configuration; mint tags may provide person-level recommendation evidence.        |
| App settings and Git auth |               `30078` | No                         | User-private app data.                                                                             |
| DMs                       |                `4444` | No                         | Private messaging.                                                                                 |
| Badge definition          |               `30009` | No                         | Engagement and endorsement infrastructure.                                                         |
| Badge award               |                   `8` | No                         | Engagement and display infrastructure.                                                             |
| Profile list              |               `30000` | No                         | Section grant and moderation infrastructure.                                                       |
| Form template             |               `30168` | No                         | Admission workflow infrastructure.                                                                 |
| Form response             |                `1069` | No                         | Admission request.                                                                                 |
| Community definition      |               `32222` | No                         | Addressable branch configuration and community metadata.                                           |
| Targeted publication      |               `30222` | Not applicable             | Association between publication and community.                                                     |

## Targeted Publications

Budabit uses `kind:30222` for public publications that can be associated with one or more communities.

Targeted kinds:

|    Kind | Feature             |
| ------: | ------------------- |
| `31922` | Calendar events.    |
|  `9041` | Fundraiser goals.   |
|  `1623` | Git permalinks.     |
| `30033` | Smart widgets.      |

Budabit convention:

| Field                        | Meaning                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Original publication `h` tag | Targeting identifier, not community identity.                                         |
| Targeting event `d` tag      | Same targeting identifier used in the original publication's `h` tag.                 |
| Targeting event target pair  | Adjacent `h=<communityId>` then marked `a=<definitionAddress>` for each exact branch. |

This preserves a strict split:

| `h` value        | Used by                                                  |
| ---------------- | -------------------------------------------------------- |
| `communityId`    | Community-native content.                                |
| `targeting d/id` | Targetable publications associated through `kind:30222`. |

Budabit discovers wrappers by stable `#h=<communityId>`, then requires each target to be an adjacent `h` and `a` pair whose `a` has marker `community` and names the selected exact definition address. It admits only wrappers whose signer has the current section grant from that branch. An explicit source `e` or `a` uses marker `source`; without one, the original is implicit and must have `h = targeting d` and the same signer as the admitted wrapper. Community association through `p=<communityId>` is invalid.

Repository announcements are a deliberate exception to this targeting model. Budabit currently supports only direct repository association: a community `kind:30617` MUST contain exactly one `h=<communityId>` and belongs to no other community. Catalogs query `kind:30617` with `#h=<communityId>` and locally require a current repository-section writer. Generic targeting and repository-context plumbing remains available for a future explicit multi-community repository feature, but current clients MUST NOT publish, request, or admit `kind:30222` as a repository association.

Repository association writers emit only that `h` tag, optionally with a community relay hint; they do not add a community definition `a` tag. Readers retain support for exact definition hints in older announcements. Repository cards, overview, header, and settings resolve display metadata from matching `kind:32222` definitions. An `h`-only association remains visible while its definition loads, and does not select an arbitrary owner when multiple branches share the stable ID. Editing unrelated repository metadata preserves the existing association.

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
    ["a", "31922:<author-pubkey>:calendar-event-id", "wss://author-relay.example", "source"],
    ["k", "31922"],
    ["h", "<community-id>"],
    ["a", "32222:<owner-pubkey>:<community-id>", "wss://main.community.relay", "community"]
  ],
  "content": ""
}
```

Budabit should support one selected community in the first implementation, but the targeting model should allow up to 12 communities per targeted publication later.

## Target Removal

Targeting is mutable through the addressable `kind:30222` event.

To remove a publication from a branch, publish a newer `kind:30222` with the same `d` tag and without that branch's complete adjacent `h`/marked-`a` pair.

The original publication is not deleted or modified.

## Exclusive Community Content

Community-native content uses exactly one stable `h=<communityId>`. Authority-sensitive events additionally carry exactly one `a=<definitionAddress>` with marker `community`.

Exclusive content includes rooms, room messages, threads, comments that naturally belong to roots, reactions, labels, deletes, and reports.

Example exclusive thread:

```json
{
  "kind": 11,
  "tags": [
    ["h", "<community-id>"],
    ["title", "Thread topic"]
  ],
  "content": "Thread body"
}
```

Example thread reply:

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
  "tags": [["h", "<community-id>"], ["room"], ["title", "General"]],
  "content": "Room description"
}
```

Room root rules:

| Rule            | Decision                                                  |
| --------------- | --------------------------------------------------------- |
| Kind            | `11`.                                                     |
| Community scope | Exactly one `h=<communityId>`.                            |
| Room marker     | Include a `room` tag.                                     |
| Title           | Use NIP-7D `title`.                                       |
| Description     | Use `content`.                                            |
| Mutability      | Immutable. Create a new room if identity needs to change. |
| Canonical ID    | Event ID.                                                 |
| URL identity    | No relay URL in canonical ID.                             |

Thread roots are also `kind:11`, but they do not include a `room` tag.

## Room Messages

Room messages are NIP-C7 chat events using `kind:9`.

A room message must be scoped to both the community and the room root:

```json
{
  "kind": 9,
  "tags": [
    ["h", "<community-id>"],
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
    ["h", "<community-id>"],
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
  "#h": ["<community-id>"],
  "#E": ["<room-root-id>"]
}
```

Budabit should never query room messages by `#h = roomId`. Community-native scope uses the stable community ID in `h`.

## Room Archive Labels

Room archiving is represented by an admin label event.

Example:

```json
{
  "kind": 1985,
  "tags": [
    ["h", "<community-id>"],
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

| Event type                      | Publish relays                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Community-native events         | All `r` relays from the accepted exact `kind:32222` definition.                         |
| Original targetable publication | User write relays plus community relays.                                                |
| `kind:30222` targeting event    | Community relays.                                                                       |
| Badge/profile-list admin events | Relays referenced by the community definition plus relevant issuer/list-manager relays. |
| User-private app data           | User relays only.                                                                       |

This keeps community discovery reliable without making original publications permanently dependent on one community's relay set.

## Fetching Workflow

Community bootstrap:

```json
{
  "kinds": [32222],
  "authors": ["<owner-pubkey>"],
  "#d": ["<community-id>"]
}
```

Exclusive room roots:

```json
{
  "kinds": [11],
  "#h": ["<community-id>"],
  "#room": [""]
}
```

Some relays may not handle empty-value tag queries consistently. Budabit can fetch `kind:11` by `#h` and filter for the presence of `room` client-side.

Exclusive forum threads:

```json
{
  "kinds": [11],
  "#h": ["<community-id>"]
}
```

Budabit must filter out `kind:11` events that contain a `room` tag.

Targeting events for community publications:

```json
{
  "kinds": [30222],
  "#h": ["<community-id>"]
}
```

After loading and admitting `kind:30222`, Budabit fetches an explicit original via its `e` or `a` tag, or an implicit original via the wrapper's `d` targeting ID.

These are transport filters, not authorization filters. Community-native content and targeting wrappers are discovered by stable `#h=<communityId>` plus feature structure such as kind, root IDs, `#k`, or date tags. Authority-sensitive candidates must also contain the marked exact definition `a` required by their workflow. Budabit applies current-grant author admission locally instead of putting an ACL-sized `authors` array on the wire.

An `authors` field remains on exact authority, identity, or coordinate queries: community definitions; profile-list shards; grant-capable forms; personal profile and list metadata; `kind:pubkey:d` references; implicit originals tied to the wrapper signer; and same-author delete requests. These are singleton or semantically exact authors, not section ACL arrays.

Historical acquisition uses bounded raw-event cursor scans independently for each relay and structural filter. Budabit counts raw relay events before local admission. A full page is saturated because Nostr's inclusive `until` cursor cannot prove that more events do not share the oldest timestamp; page-budget exhaustion, timeout, disconnect, or `CLOSED` likewise makes the scan incomplete. Partial admitted rows may render with an incomplete warning, but zero admitted rows from an incomplete scan must not render as authoritative emptiness.

## Notifications And Shared Consumers

Active-community notification candidates, global notification rows, route projections, activity/reaction consumers, and extension queries use the same current-grant admission as their destination views. Broad `#h=<communityId>` notification acquisition may run before profile-list hydration, but no permission-governed row is emitted without complete referenced profile-list and report-state evidence. Authority-sensitive rows must identify the selected branch with the workflow's marked exact definition `a`. Targeted notification roots use the same explicit-external and implicit-same-wrapper rules as routes, and community engagement rows require their referenced community root to pass admission too.

Foreground and background consumers coordinate live ownership by community and relay; repository watchers do the same by repository address and relay. When a foreground session already owns matching live coverage, the background notification consumer suppresses only its duplicate live subscription. Bounded finite catch-up may still run, and another community or repository on the same relay keeps its own live filters. Every consumer revalidates repository and live events when grant evidence changes so revocation removes rows and regrant can refetch them.

## Admin Key Model

Budabit should not require the branch owner key to be hot.

| Key            | Role                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner key | Signs the exact branch's `kind:32222` definition. Should be cold or rarely used.                                                            |
| Moderator key  | Updates delegated profile lists, reviews applications, creates community endorsements, and publishes admin labels. Can be hot or delegated. |
| User key       | Publishes user content when included in the relevant profile list.                                                                          |

The profile list `a` tags may reference lists managed by delegated pubkeys. Badge definitions and awards are discovered by badge-specific views and should not be required for community bootstrap or section access checks.

This allows Budabit to support practical admin workflows without exposing the owner key in a browser or server process.

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

| Current concept     | Target concept                                          |
| ------------------- | ------------------------------------------------------- |
| `/spaces/[relay]`   | Community route keyed by canonical definition `naddr`.  |
| Relay URL in route  | Exact definition `naddr` in route/session.              |
| Room path `[h]`     | Room path by room root event ID.                        |
| Platform relays env | Optional default definition `naddr` or bootstrap hints. |

The deployed website may default to a Budabit definition `naddr`, but the app architecture must not derive community identity from deployment relays.

## Clean Break Scope

The target architecture removes these assumptions:

| Removed assumption                    | Replacement                                                 |
| ------------------------------------- | ----------------------------------------------------------- |
| Relay URL is the community.           | Exact `kind:32222` definition address identifies a branch.  |
| `h` identifies a room.                | Stable `h=<communityId>` associates community events.       |
| `39000` room metadata drives rooms.   | `kind:11` immutable room roots drive rooms.                 |
| Platform relays define the app space. | `kind:32222` defines community metadata and infrastructure. |
| Relay auth is the main access model.  | Profile-list write permission is the client-side model.     |
| Global roomless space chat exists.    | Every chat message belongs to a room.                       |

## Implementation Guardrails

This document describes the implemented community model, not the implementation phase plan.

Important guardrails:

1. Do not introduce relay URL based compatibility shims into the new core model.
2. Keep community admission distinct from privacy; current grants control Budabit visibility but do not make relay events confidential.
3. Keep stable `h=<communityId>` for community-native association and require marked exact definition `a` tags where branch authority is evaluated.
4. Keep `h = targeting identifier` reserved for targetable publications that have a `kind:30222` association.
5. Treat the union of current section profile-list shards as the effective grant source for publishing and Budabit visibility.
6. Treat room root event IDs as canonical room IDs.
7. Keep one active community in the first UI, but model targeted publications as multi-community capable.
8. Never treat `communityId` as a person or encode community association in a `p` tag.
