
# Communikeys

Defines a standard for creating, managing and publishing to communities by leveraging existing key pairs and relays.

This approach uniquely allows:

- Any existing npub to become a community (identity + manager)
- Any existing publication to be targeted at any community
- Communities to have their own selected content types

## Motivation

Current community management solutions on Nostr often require complex relay-specific implementations, lack proper decentralization and don't allow publications to be targeted at more than one community.

This proposal aims to simplify community management by utilizing existing Nostr primitives (key pairs and relays) while adding minimal new event kinds.

## Community Creation Event (kind:10222)

A community is created when a key pair publishes a [[kind-10222]] event. The pubkey of this key pair becomes the unique identifier for that community. One key pair can only represent one community.

The community's name, picture, and description are derived from the pubkey's [[kind-0]] metadata event.

```json
{
  "id": "<event-id>",
  "pubkey": "<community-pubkey>",
  "created_at": 1675642635,
  "kind": 10222,
  "tags": [
    // at least one main relay for the community + other optional backup relays
    ["r", "<relay-url>"],

    // one or more blossom servers
    ["blossom", "<blossom-url>"],

    // one or more ecash mints
    ["mint", "<mint-url>", "cashu"],

    // General section for comments, reactions, and labels (recommended for all communities)
    ["content", "General"],
    ["k", "1111"], // comments
    ["k", "7"],    // reactions
    ["k", "1985"], // labels
    ["a", "30000:<pubkey>:General", "<relay-url>"], // profile list with whitelisted pubkeys
    ["badge", "<badge-definition>"], // optional badge/engagement reference

    // one or more content sections for publishing
    ["content", "Chat"],
    ["k", "9"],
    ["a", "30000:<pubkey>:Chat", "<relay-url>"],
    ["badge", "<badge-definition>"],

    ["content", "Thread-creator"],
    ["k", "11", "threads"],
    ["a", "30000:<pubkey>:Thread-creator", "<relay-url>"],
    ["badge", "<badge-definition>"],

    ["content", "Apps"],
    ["k", "32267"],
    ["a", "30000:<pubkey>:Apps", "<relay-url>"],
    ["badge", "<badge-definition-member>"],
    ["badge", "<badge-definition-pro>"],
    ["badge", "<badge-definition-team>"],

    // Optional terms of service, points to another event
    ["tos", "<event-id-or-address>", "<relay-url>"],

    // Optional location
    ["location", "<location>"],
    ["g", "<geo-hash>"],

    // Optional description
    ["description", "A description text that overwrites the profile's description, if needed"]
  ],
  "content": "",
  "sig": "<signature>"
}
```

### Tag definitions

| Tag | Description |
|-----|-------------|
| `r` | URLs of relays where community content should be published. First one is considered main relay. |
| `blossom` | (optional) URLs of blossom servers for additional community features. |
| `mint` | (optional) URL of community mint for token/payment features. |
| `content` | Name of Content Type section that the Communikey works with. |
| `k` | Event kind, within a content type section. |
| `a` | (within content section) Addressable reference to a profile list [[kind-30000]] containing all whitelisted pubkeys (`p` tags) for this content section. Format: `30000:<pubkey>:<d-tag>`. |
| `badge` | Optional community badge reference for endorsements, achievements, onboarding, or other engagement. References a Badge Definition event, see [[NIP-58]]. Format: `30009:<pubkey>:<d-tag>`. Multiple `badge` tags can be specified per content section, but Budabit does not treat them as publish permission inputs. |
| `retention` | (optional) Retention policy in format [kind, value, type] where type is either "time" (seconds) or "count" (number of events). |
| `tos` | (optional) Reference to the community's posting policy. |
| `location` | (optional) Location of the community. |
| `g` | (optional) Geo hash of the community. |
| `description` | (optional) Description of the community. |

### Section kind uniqueness

Within one community definition, each exact `(kind, subtype)` pair belongs to at most one content section. The subtype is the third value in a `k` tag. An empty subtype is an exact empty subtype, not a wildcard.

Examples:

- `["k", "11", "room"]` and `["k", "11", "threads"]` are different permissions.
- `["k", "11"]` does not cover `["k", "11", "room"]` or `["k", "11", "threads"]`.
- `["k", "30033"]` can be assigned to only one section in a community.

Clients should reject new definitions that duplicate an exact `(kind, subtype)` pair. Existing malformed definitions may still be parsed defensively, but permission resolution should use a single direct section for each exact pair.

### Section lifecycle safety

Section names and profile-list identifiers are operational permission state. Renaming a section, moving a `(kind, subtype)` pair to another section, or removing a section can disconnect existing permissions, moderator ownership, application forms, and pending requests.

Budabit treats those edits as dangerous changes:

- Immediate warning modals protect against accidental edits and can reset only the triggering draft change.
- Final publish confirmation summarizes what changed, what can be migrated, and what will be dropped.
- Permission migration, when chosen, publishes and verifies replacement permission updates before publishing the new community definition.

Migration preserves admin-authoritative state only. Granted members are merged into a new admin-owned profile list for the new section. Active moderators receive new section permission requests and must accept them again. Active application forms may be copied as admin-authored forms for the new section. Pending requests are not migrated. Applicant-authored submissions and user-authored reports are never recreated or impersonated.

The pubkey of the key pair that creates this event serves as the unique identifier for the community. This means:

1. Each key pair can only represent one community
2. Communities can be easily discovered by querying for the most recent [[kind-10222]] event for a given pubkey
3. Community managers can update their settings by publishing a new [[kind-10222]] event

## Community Identifier Format

Communities can be referenced using an "ncommunity" format:

```
ncommunity://<pubkey>?relay=<url-encoded-relay-1>&relay=<url-encoded-relay-2>
```

This format follows the same principles as nprofile, but specifically for community identification. While the ncommunity format is recommended for complete relay information, the standard pubkey format can also be used when relay discovery is not needed.

## Listing a User's Communities

Since communities are just pubkeys, existing Nostr primitives can be used to list which communities a user is part of.

### Profile Lists

- **Follow list** [[kind-3]] — users can follow community pubkeys publicly, or privately in the encrypted content section
- **Bookmarks** [[kind-10003]] — users can bookmark community pubkeys publicly, or privately in the encrypted content section

Clients can filter these lists to show only pubkeys that have a [[kind-10222]] community definition event.

### Community Badges

Clients can look at a user's accepted community badges in their Profile Badges [[kind-30008]] event. Badge Definitions can include a `p` tag specifying which community the badge belongs to, see [[NIP-58]]. This gives clients engagement and endorsement context, but does not grant publishing rights in Budabit.

## Targeted Publication Event (kind:30222)

To target an existing publication at specific communities, users create a [[kind-30222]] event:

```json
{
  "id": "<event-id>",
  "pubkey": "<pubkey>",
  "created_at": 1675642635,
  "kind": 30222,
  "tags": [
    ["d", "<random-id>"],
    ["e", "<event-id-of-original-publication>"],
    ["k", "<kind-of-original-publication>"],
    ["p", "<community1-pubkey>"],
    ["r", "<main-relay1-url>"],
    ["p", "<community2-pubkey>"],
    ["r", "<main-relay2-url>"]
  ],
  "content": "",
  "sig": "<signature>"
}
```

The targeted publication event can reference the original publication in two ways:

1. Using an `e` tag with the event ID, relay hint, and pubkey hint
2. Using an `a` tag with the event address and relay hint

The `k` tag specifies the kind of the original publication, and the `p` tags list the communities that this publication is targeting.

Currently, we work with a maximum of 12 communities that can be tagged for one publication.

**Note:** For publishing new events, clients SHOULD create a targeted Publication event first (that only has an id) and reference it with an `h` tag in the main event.

## Community-Exclusive Publications

Chat messages [[kind-9]] and thread posts [[kind-11]] are exclusive by default. They can only belong to one community and cannot be targeted to multiple communities.

For these exclusive content types, we don't need a Targeted Publication event. Instead, they use an `h` tag to reference their community directly.

For chat messages within a community, users should use [[kind-9]] events with a community tag:

```json
{
  "id": "<event-id>",
  "pubkey": "<pubkey>",
  "created_at": 1675642635,
  "kind": 9,
  "tags": [
    ["h", "<community-pubkey>"]
  ],
  "content": "<message>",
  "sig": "<signature>"
}
```

The same pattern applies to thread posts, see [[kind-11]].

## Profile-List Write Access And Badges

Communities use profile lists for publishing permissions. Each content section has an `a` tag referencing allowed pubkeys. `badge` tags can reference [[NIP-58|Badge]] definitions for recognition or engagement around a section, but holding a badge does not make a user writable in Budabit.

```json
["content", "Apps"],
["k", "32267"],
["a", "30000:community-pubkey:Apps"],
["badge", "30009:community-pubkey:member"],
["badge", "30009:community-pubkey:pro"],
["badge", "30009:community-pubkey:team"]
```

In this example, Apps publishing is controlled by the profile list. "Member", "Pro", and "Team" badges can drive display, onboarding, achievements, or other engagement around Apps.

Admission forms can collect information before a moderator grants profile-list access. Badges may still be awarded after review as recognition, but they are not the permission check.

### Profile Lists

Each content section includes an `a` tag referencing a profile list [[kind-30000]] containing `p` tags for all whitelisted pubkeys. This allows clients to fetch all allowed pubkeys in a single event, avoiding the need to query potentially hundreds of badge award events.

**Granting access:** Because profile lists are the access source, awarding or revoking a badge does not change publish rights. Admin interfaces that grant or revoke access must update profile lists directly. Badge awards can be handled separately by:
- **Automated systems:** A hot-key solution that processes badge programs without exposing the community root key
- **Manual admin interfaces:** Apps that let admins award badges as recognition while keeping profile-list edits as the permission step

### Delegated Badge Awarding

The pubkey that awards badges does **not** have to be the same as the community's pubkey. The `badge` tag in a content section simply references a Badge Definition for engagement context — this badge can be created and awarded by any pubkey.

This enables important security patterns:

- **Separate award key:** Communities can use a dedicated pubkey for handling badge awards. This key can run on a live server to process badge programs without exposing the main community keypair.
- **Multiple award authorities:** Different badges can be managed by different pubkeys, allowing delegation of badge and engagement workflows.
- **Cold storage for community key:** The main community keypair can remain in cold storage, only used for updating the community definition event.

Example: A community's "builder" badge could be defined and awarded by a separate badge-bot pubkey that processes recognition workflows automatically, while the community's main key stays secure offline.

## Comments, Reactions, Labels, and Zaps

Communities SHOULD include a "General" content section that handles comments ([[kind-1111]]), reactions ([[kind-7]]), and labels ([[kind-1985]]) with one shared profile list. Optional badges can recognize contributors, but profile-list membership controls filtered interaction.

When a publication targets multiple communities, members from all those communities participate together:

**Comments, reactions, and labels** — filter by the General section's profile list from all targeted communities. Members from different communities meet in one shared discussion around the publication. No duplicates, no fragmented conversations across multiple places.

NOTE: Communities that don't want to be part of discussions with certain other communities can just not accept the events regarding them.

**Zaps** — anyone can zap community content. Query zap receipts on the community relays. No filtering — external appreciation is always welcome.

## Implementation Notes

Unlike [[NIP-29]] (Relay-based Groups), Communikeys work on **any standard Nostr relay**. Access control is enforced client-side, not by relays (although they can of course optimize for it).

**Client filtering workflow:**

1. Fetch the community's [[kind-10222]] event to get content sections and their `k` tags
2. Fetch the profile list referenced in each content section's `a` tag to get whitelisted pubkeys
3. Query for events of those kinds targeting the community (via `h` tag or Targeted Publication), filtering by the whitelisted pubkeys using the `authors` filter

**Media fallback:**

Community blossom servers SHOULD back up all media files referenced in community publications — even when the original URLs point to different servers. By storing files by their content hash, the community server becomes a reliable fallback when external URLs suffer link rot. Clients can try the community's blossom server when the original media URL fails.

**Additional recommendations:**

- Clients MAY cache community metadata and badge awards to reduce relay queries
- Clients SHOULD check profile-list membership before attempting to publish
- Relays MAY optionally optimize for profile-list checks or implement retention policies, but this is not required

## Benefits

1. No special relay required — works on any standard Nostr relay, unlike [[NIP-29]]
2. Easy onboarding — new users don't need to set up any personal relay or media server to join Nostr via a community. They can use the community's relay and blossom server immediately.
3. Any existing npub can become a community
4. Any existing publication can be targeted at communities (backwards compatible)
5. Communities are not permanently tied to specific relays
6. Communities can define their own content types with profile-list-based write access
7. Cross-community interaction via Targeted Publications
8. Users can request access by submitting Form Responses
9. Delegated badge awarding — separate keys can run community badge programs without exposing the main community keypair
