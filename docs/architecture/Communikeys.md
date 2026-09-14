# Communikeys V2

## Status

This is the normative Communikeys V2 wire specification used by Budabit. The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are interpreted as described in BCP 14.

V2 is a clean protocol generation. This document does not define V1 discovery, mappings, aliases, route compatibility, state conversion, or dual publication. Historical V1 behavior is archived in `history/Communikeys-v1-kind-10222.md`.

## Identity Model

```text
communityId       = stable 32-byte identifier encoded as lowercase hex
definition d      = communityId
community event h = communityId
owner        = definition event author
definitionAddress = 32222:<ownerPubkey>:<communityId>
canonical pointer = naddr(definitionAddress, relay hints)
```

There is one stable community ID. A definition address identifies one exact owner branch. Different owners MAY publish definitions with the same community ID; those definitions are distinct branches and MUST NOT replace one another. A owner MAY publish any number of definitions with distinct community IDs.

### Community ID

A community ID MUST contain exactly 64 lowercase hexadecimal characters. Current creation derives this identifier from a secp256k1 public key for uniqueness, but readers MUST treat it as an opaque identifier and MUST NOT require it to lift to a curve point.

For a new community, the creator MUST use a cryptographically secure random source to generate a secp256k1 keypair, retain the x-only public key as the community ID, and immediately discard the private key. The discarded key MUST NOT be persisted, logged, backed up, exported, or used to sign an event. A migrated community MAY instead retain the stable pubkey value already present in immutable community references.

Owner and community-reference parsers validate canonical lowercase 64-character hexadecimal encoding only. Whether a owner is a usable signing key is established by verification of the referenced definition event, not by curve-lifting the reference. Likewise, targeting-wrapper admission resolves and admits the referenced original publication; parsing the wrapper does not repeat cryptographic validation of cached trusted events.

A value read from a community-ID position, including definition `d`, content `h`, or the identifier of a marked community `a`, grants no signing, person, profile, relay, or administrative meaning. Implementations MUST NOT use that field value by itself as an event author, person `p` tag, outbox or profile lookup, DM recipient, NIP-05 identity, administrator, or permission-list signer.

The same 32-byte value MAY independently appear in an explicitly typed signer or person position. In particular, `ownerPubkey` MAY equal `communityId`. In that case owner authority comes only from the valid definition signature and author component of the exact definition address; equality with `d` or `h` confers nothing. Likewise, a role-specific `p` tag may identify that real owner or person, but a `p` tag MUST NOT encode community association.

### Owner And Branch

The owner is the `pubkey` that signs a community definition. Owner authority applies only to that exact definition address. The owner and community ID are interpreted by position and MAY contain the same value.

Branch identity is the tuple `(kind=32222, ownerPubkey, communityId)`. Relay hints are retrieval hints and are not part of branch equality.

## Community Definition

A community definition is an addressable `kind:32222` event.

```json
{
  "kind": 32222,
  "pubkey": "<owner-pubkey>",
  "tags": [
    ["d", "<community-id>"],
    ["name", "Buda Builders"],
    ["description", "A community for builders"],
    ["picture", "https://example.com/picture.png"],
    ["banner", "https://example.com/banner.png"],
    ["website", "https://example.com"],
    ["r", "wss://relay.example"],
    ["blossom", "https://blossom.example"],
    ["content", "General"],
    ["k", "1111"],
    ["k", "7"],
    ["k", "1985"],
    ["a", "30000:<list-owner>:<community-id>-general", "wss://relay.example"]
  ],
  "content": ""
}
```

### Definition Validity

A valid definition MUST satisfy all of these rules:

1. Its kind is `32222`, and its signature and ID are valid.
2. Its content is the empty string.
3. It has exactly one `d` tag with exactly two values and a valid community ID.
4. It has no community-identifying `h` tag.
5. It has exactly one valid `name` tag and at least one valid `r` tag.
6. Every recognized singleton tag satisfies its cardinality and validation rule.
7. It has at least one content section, and every content section satisfies the section rules below.

A missing, empty, malformed, or duplicate `d` invalidates the definition. Readers MUST reject invalid definitions rather than partially interpreting them.

### Definition Metadata

### Optional members-only read intent

The top-level extension `['read-access', 'members']` (JSON wire form
`["read-access","members"]`) MAY occur once, before the first `content` section.
It declares the owner's intent to distribute this branch only through member-only
relays. It does **not** enable relay enforcement, prove membership, or provide
encryption. Absence preserves public behavior. Unknown values, malformed or
duplicate occurrences MUST be ignored by the base definition parser and MUST NOT
invalidate an otherwise valid definition. Editors MUST preserve these extensions.
Publishers that cannot interpret a present read-access extension MUST refuse to
publish that definition or its scoped data, rather than assume public intent.

Budabit's members publisher requires explicit destinations contained in the
definition's `r` tags. Each destination must advertise both NIP-11
`limitation.auth_required: true` and
`budabit.read_control: {version: 1, mode: "members", scope: "relay"}`. A generic
auth requirement or mere extension presence is insufficient. NIP-11 is an operator
claim, not cryptographic proof of enforcement; operators and readers still trust
the host. AUTH confirms a key, not eligibility. Client content admission and
moderation remain separate from whole-relay reader authorization.

Do not remove or weaken private intent as an ordinary metadata edit. Changing to
public reads, sharing an invitation publicly, or sending retained events to a
public relay is a disclosure operation; already copied or previously public data
cannot be retracted. Git HTTP, Blossom, media, widgets and payment providers need
independent access protection. Budabit's initial private view disables those
exports, retains events only in a scope-owned in-memory repository, and stores only
invitation coordinates/endpoints in session storage.

### Other definition metadata

Lengths are UTF-8 bytes after trimming leading and trailing ASCII whitespace. URLs are measured after normalization.

URL normalization uses the WHATWG URL parser and serializer. A URL is invalid if it has credentials, a fragment, or an empty host. Scheme and host are lowercase and default ports are removed by serialization. A terminal `/` is removed only when it is the complete path and there is no query. Other paths and queries are retained. Relay and GRASP URLs require `wss:`; HTTPS resources require `https:`. Duplicate comparison uses this normalized string.

| Tag           | Cardinality | Rule                                                                    |
| ------------- | ----------: | ----------------------------------------------------------------------- |
| `d`           | Exactly one | Valid community ID; exactly two tag values.                             |
| `name`        | Exactly one | 1 to 100 bytes.                                                         |
| `description` | Zero or one | 1 to 4096 bytes when present.                                           |
| `picture`     | Zero or one | Absolute HTTPS URL, at most 2048 bytes.                                 |
| `banner`      | Zero or one | Absolute HTTPS URL, at most 2048 bytes.                                 |
| `website`     | Zero or one | Absolute HTTP or HTTPS URL, at most 2048 bytes.                         |
| `r`           |   One to 20 | Normalized `wss://` relay URL, at most 2048 bytes.                      |
| `blossom`     |  Zero to 20 | Absolute HTTPS URL, at most 2048 bytes.                                 |
| `grasp`       |  Zero to 20 | Normalized `wss://` URL, at most 2048 bytes; order is preference order. |
| `mint`        |  Zero to 20 | Absolute HTTPS URL; optional type is at most 32 ASCII bytes.            |
| `location`    | Zero or one | 1 to 256 bytes when present.                                            |
| `g`           | Zero or one | Lowercase geohash, 1 to 12 characters.                                  |
| `tos`         | Zero or one | Non-empty event ID or address and optional normalized relay hint.       |
| `service`     |  Zero to 50 | Service extension described below.                                      |

Duplicate singleton tags invalidate the definition. Exceeding a stated maximum cardinality invalidates the definition. Within the maximum, readers MUST ignore duplicate normalized relay, Blossom, GRASP, mint, or service declarations after the first occurrence. Editors SHOULD remove these duplicates when intentionally updating a definition.

Recognized top-level tags have exact arity: `d`, `name`, `description`, `picture`, `banner`, `website`, `r`, `blossom`, `grasp`, `location`, and `g` contain exactly two values; `mint` and `tos` contain two or three; `service` contains exactly six. Extra values make a recognized tag invalid and therefore invalidate a definition in which it appears.

Community metadata comes only from definition tags. A owner's `kind:0` is a personal profile and MUST NOT override or fill community metadata.

### Service Tags

Budabit service declarations use:

```text
["service", <name>, <servicePubkey>, <requestRelay>, <handlerAddress>, <handlerRelay>]
```

The service name MUST match `[a-z0-9][a-z0-9-]{0,31}`. `email-digest` and `community-alerts` are the currently interpreted names. Other valid names are preserved extensions and are not interpreted by a reader that does not implement them.

`servicePubkey` MUST be a real signing pubkey. `handlerAddress` MUST be a valid addressable-event coordinate with a real signing pubkey and a non-empty identifier of at most 200 UTF-8 bytes. Request and handler relays MUST be normalized `wss://` URLs. Duplicate identity is the complete normalized six-value tuple; declarations that differ in any field are distinct.

### Content Sections

A section starts with `["content", <sectionName>]` and extends until the next `content` tag or the end of the definition. Names MUST be 1 to 100 UTF-8 bytes and unique under ASCII case-folding.

The following tags belong to the current section:

| Tag         | Rule                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `k`         | Event kind in value 1 and optional subtype in value 2.                 |
| `a`         | Optional exact `kind:pubkey:d` profile-list reference with relay hint. |
| `badge`     | Exact badge-definition address with optional relay hint.               |
| `retention` | Kind, positive integer value, and `time` or `count`.                   |

Each section MUST have at least one valid `k` and MAY have zero or more valid profile-list `a` tags. A section without profile lists contributes no section-specific member grants. The definition owner retains inherent authority, and every non-owner pubkey referenced as a profile-list owner anywhere in the definition retains the structural community-wide member/write role described below, including while its invitation is pending or declined. Each exact `(kind, subtype)` pair MUST occur in at most one section. Empty subtype is exact, not a wildcard.

`content` contains exactly two values. `k` contains two or three values. Its kind is canonical unsigned decimal with no sign or leading zero except `0`, in the range 0 through 65535; its optional subtype is 1 to 64 UTF-8 bytes. A profile-list `a` contains two or three values, parses as exact kind `30000`, has a real signer pubkey and a section-scoped identifier as defined below, and has an optional normalized relay. A `badge` follows the same arity and address rules with kind `30009`. `retention` contains exactly four values; its kind follows the `k` integer rule, its value is canonical positive decimal within JavaScript's safe-integer range, and its type is exactly `time` or `count`.

A recognized section-local tag before the first `content` tag invalidates the definition. Unknown tags before the first section remain top-level extensions. Unknown tags after a `content` tag belong to that section.

Profile-list tags reference real signer-owned `kind:30000` coordinates. The effective section-specific grant set is the union of current valid `p` tags from all referenced lists. Missing evidence contributes no `p`-tag grant. Referenced non-owner list owners receive structural community-wide member/write access independently of that evidence; publishing a current non-declined list activates the narrower moderator capabilities associated with the referenced section. A section does not require a placeholder profile-list event until it needs member grants or delegated authority.

### Unknown Tags And Editing

Readers MUST ignore unknown definition tags. Editors MUST preserve them byte-for-byte and in original relative order unless the user explicitly removes them.

An editor update replaces the recognized tags it exposes while merging untouched unknown top-level and section-local tags from the accepted current definition. Automated owner or moderator updates follow the same rule.

Section-local unknown tags are attached to the original section's case-folded name. Reordering sections moves those tags with their section and preserves their relative order. Renaming a section moves its unknown tags to the renamed section. Removing a section removes its section-local unknown tags only after the explicit user confirmation required for section removal. An editor MUST NOT publish an ambiguous merge from an invalid definition with duplicate case-folded section names.

## Replacement And Deletion

Definitions replace only events at the same exact definition address. The current valid definition is selected by greatest `created_at`, then lexicographically lowest event ID when timestamps are equal. Selection MUST be independent of relay and arrival order.

A branch deletion is a valid owner-authored `kind:5` containing exactly one unmarked `a` for the exact definition address. A `k=32222` SHOULD be included. It tombstones definitions at that address with `created_at` less than or equal to the deletion timestamp. A later definition with greater `created_at` recreates the branch. At equal timestamps deletion wins. An `e`-only deletion does not delete the branch coordinate.

Owners do not gain authority to rewrite, re-sign, reattribute, or globally delete other authors' events.

### Authority Event Replacement

Every replaceable or addressable event used to derive Communikey authority, including profile lists, forms, moderator requests, settings, and service state, uses greatest `created_at` and then lexicographically lowest event ID at one exact coordinate. Consumers MUST validate event signature, event ID, expected kind, author, and exact `d` before comparison.

A profile-list authority event is a valid signed `kind:30000` event at a coordinate referenced by the selected definition, with exactly one matching non-empty `d`. Only valid real signing pubkeys from its `p` tags contribute grants; malformed `p` tags are ignored.

A same-author `kind:5` address deletion tombstones an authority coordinate through its deletion timestamp. A later valid replacement recreates it; deletion wins at an equal timestamp. Event-ID-only deletion removes only that exact event version from consideration. These rules apply before a current authority event or grant set is derived.

### Deletion Requests

NIP-09 gives every `a` tag on a `kind:5` a fixed meaning: a request to delete the signer's addressable event at that coordinate. Relays enforce it: an `a` whose pubkey differs from the signer makes the whole event invalid on strfry, and an owner-signed `a` naming the definition address tombstones the definition. A community-scoped deletion request therefore MUST NOT carry the marked community `a` used by other authority-sensitive events.

A community-scoped deletion request carries exactly one `h=<communityId>`, the `e` (with the workflow's role marker where one is defined, such as `report`) or unmarked `a` tags that name what it deletes, and SHOULD carry a `k` for the deleted kind. The deleted event already carries the exact branch, so a same-author deletion of an exact event ID is a retraction in every branch that admitted that event. Readers MUST accept the legacy shape that also carried a marked community `a` while it names the reader's exact branch, and MUST treat any `a` on a `kind:5` as an NIP-09 target when interpreting deletions generically.

```json
{
  "kind": 5,
  "pubkey": "<report-author>",
  "tags": [
    ["h", "<community-id>"],
    ["e", "<report-id>", "", "<report-author>", "report"],
    ["k", "1984"]
  ],
  "content": ""
}
```

The same constraint applies to any kind where a NIP already assigns target semantics to `a` tags: Communikeys role markers MUST NOT be placed on such tags.

## Stable Association And Exact Authority

```text
h=<communityId>
a=<definitionAddress> with marker "community"
```

A community-native event acquired through `#h` MUST carry exactly one `h=<communityId>` unless a workflow below explicitly defines repeated target pairs.

An authority-sensitive event MUST also carry exactly one branch reference:

```text
["a", "32222:<owner>:<communityId>", "<optional-relay>", "community"]
```

The address identifier MUST equal the community `h`. A mismatch invalidates the event for Communikeys processing. Unmarked and differently marked `a` tags retain their workflow-specific meanings.

| Event class                                | Stable association                    | Exact branch reference                           |
| ------------------------------------------ | ------------------------------------- | ------------------------------------------------ |
| Definition                                 | `d=<communityId>`                     | Its own address.                                 |
| Room/thread roots                          | Exactly one `h`                       | Not required.                                    |
| Room messages and replies                  | Exactly one `h`                       | Not required.                                    |
| Comments, reactions, labels                | Exactly one `h` when community-scoped | Required when branch authority is evaluated.     |
| Deletion requests                          | Exactly one `h` when community-scoped | Never; any `a` on a `kind:5` is an NIP-09 target. |
| Reports and report reviews                 | Exactly one `h`                       | Required marked community `a`.                   |
| Admission forms, responses, and reviews    | Exactly one `h`                       | Required marked community `a`.                   |
| Moderator requests and decisions           | Exactly one `h`                       | Required marked community `a`.                   |
| Permission-list shards                     | Section-scoped addressable `d`        | Referenced by the accepted definition.           |
| Badge definitions, awards, and moderation  | Exactly one `h`                       | Required marked community `a`.                   |
| Stars, bookmarks, and renunciations        | Exactly one `h`                       | Required marked community `a`; no community `p`. |
| Targeting wrappers                         | One `h` per target pair               | One marked community `a` per pair.               |

Real authors, recipients, members, moderators, owners, services, and report targets MAY appear in `p` tags, including when a person's pubkey equals the community ID value. Community association itself MUST NOT be encoded as `p=<communityId>`.

## Targeted Publications

Targetable originals retain their targeting ID in `h`; community associations are resolved through addressable `kind:30222` wrappers.

```json
{
  "kind": 30222,
  "tags": [
    ["d", "<targeting-id>"],
    ["a", "31922:<publication-author>:<publication-d>", "wss://author-relay"],
    ["k", "31922"],
    ["h", "<community-id-1>"],
    ["a", "32222:<owner-1>:<community-id-1>", "wss://community-relay-1"],
    ["h", "<community-id-2>"],
    ["a", "32222:<owner-2>:<community-id-2>", "wss://community-relay-2"]
  ],
  "content": ""
}
```

A wrapper MUST contain exactly one non-empty `d` and one valid `k`. An explicit address source is `["a", <address>, <optionalRelay>]`, and its address kind MUST equal `k`. An explicit event source is `["e", <eventId>, <optionalRelay>, <optionalAuthorPubkey>]`; an empty relay placeholder preserves the optional author position. A wrapper has at most one source of either form. Without a source, the original MUST use the wrapper `d` as its targeting `h` and have the same author as the wrapper. Because kind `30222` is a closed targeting grammar, every unpaired `a` or `e` is interpreted as the source and any additional or malformed reference invalidates the wrapper.

Each community target is an adjacent ordered pair:

```text
["h", <communityId>]
["a", <definitionAddress>, <optionalRelay>]
```

The `a` MUST immediately follow its `h`; its address kind MUST be `32222`, and its identifier MUST equal that `h`. These semantics identify it as a community target without a role marker. An unmatched, malformed, duplicate-address, or mismatched pair invalidates the wrapper. A wrapper MUST contain 1 to 12 pairs. Two branches with the same community ID MAY both be targets.

Target identity is the exact definition address. Removing a target publishes a newer wrapper at the same wrapper address without that complete pair. Source tags and remaining target order MUST be preserved. Wrappers are discovered by `#h=<communityId>`. `p=<communityId>` targeting is invalid.

## Workflow Reference Markers

Other workflows use markers when their event kind and reference structure do not determine the role:

- `community`: exact community definition outside kind `30222`;
- `form`: admission form;
- `response`: admission response;
- `report`: community report;
- `badge`: badge definition; and
- `request`: moderator request.

Address role markers occupy tag index 3: `["a", <address>, <optionalRelay>, <marker>]`. Event role markers occupy index 4 after the optional relay and author hints. Empty placeholders preserve marker position. Each required role occurs exactly once. Duplicate or conflicting marked references invalidate the event for that workflow. Kind `30222` is the exception: its source and adjacent `h` plus kind-`32222` community pairs are semantic parts of its closed grammar and carry no role markers. Reports MAY retain reason-bearing `e`, `p`, or `a` targets; those are not community references.

## Section-Scoped Addressable Identifiers

An addressable event that is referenced by a specific definition `content` section uses a `d` identifier of this form:

```text
<communityId>-<section-purpose>[.<shard>]
```

The complete community ID MUST NOT be truncated or hashed. `section-purpose` is a stable lowercase ASCII token containing letters, digits, and single hyphens, with no leading or trailing hyphen or period. It identifies the section purpose, such as `general`, `room-creator`, or `repositories`; it is not the community's display name. The optional `shard` is a canonical decimal integer beginning at `2`. The period is a reserved shard separator, so a multi-word or numbered section such as `general-2` remains distinct from its second shard `general-2.2`. The complete `d` MUST be at most 200 UTF-8 bytes.

For example, two `kind:30000` grant-list shards for the General section may have these exact coordinates:

```text
30000:<list-author>:<communityId>-general
30000:<list-author>:<communityId>-general.2
```

The accepted definition references both coordinates with separate `a` tags inside the General `content` section, and the effective grant set is the union of their current valid `p` tags. Placement of each exact `a` reference under a section is authoritative; readers MUST NOT infer section membership from an unreferenced identifier.

This convention is only for addressable events that need section association and optional sharding. It is not a generic identifier format for forms, badges, moderator requests, shared configuration, or other community events. It MUST NOT contain the community `name`, an application name such as `budabit`, or any other mutable display label. Renaming the community therefore does not change these coordinates.

The addressable event author remains a real signer. The community ID appears only as part of `d`; this identifier MUST NOT be used as an `h` value. Community-native event scope remains exactly `h=<communityId>`.

## Canonical Naddr And Routing

The canonical pointer is a NIP-19 `naddr` containing kind `32222`, the owner pubkey, the community ID as identifier, and zero to three normalized relay hints.

Pointer equality compares kind, owner, and community ID and ignores hints. State keys use the structured coordinate or canonical address, not the hint-bearing naddr string.

Canonical emission includes at most the first three valid definition `r` relays in declared order. Duplicate normalized hints are removed by first occurrence. Fallback, indexer, tracker, and untrusted input relays MUST NOT be added to share output.

The canonical Budabit route is `/c/<community-definition-naddr>/<optional-suffix>`.

An event containing only `h=<communityId>` does not identify a branch. A client MUST use an explicit branch reference, the selected branch context that admitted the event, or a branch chooser. It MUST NOT silently select a branch from ID-only association.

## Discovery, Permissions, And Retrieval

Exact resolution queries kind `32222`, the naddr owner, and `#d=<communityId>`. Owner discovery MAY return all authored definitions. ID discovery MAY query `#d`, but MUST expose all matching branches and MUST NOT choose one silently.

Results are grouped and replaced by exact definition address. Bounded discovery exposes incomplete state rather than claiming an exhaustive sibling list.

Relays provide transport, not Communikey grant enforcement. For a selected branch, a client resolves its exact definition, loads every referenced list coordinate, selects replacements deterministically, unions real-person grants, discovers stable content with `#h=<communityId>`, and admits events locally using the selected branch's current authority and moderation state.

The owner has root authority for its branch. Referenced list authors are real delegated signers. The community ID grants no authority.

## Same-ID Branches And Future Fork Flow

Same-ID branches are valid independent definitions selected by different naddrs. Clients MUST keep their metadata, relays, permissions, moderation, services, state, and navigation separate.

A future unilateral fork may copy original signed events, commit to exact imported event IDs in a cryptographic snapshot, publish a same-ID definition under another owner, and reference its predecessor and snapshot. Such a fork is not authorized succession and does not rewrite authorship.

This records the identity model only. Snapshot encoding, fork tooling, import validation, succession, and recovery are not specified or required for V2 application conformance.

## Conformance Summary

A conforming client MUST use exact definition coordinates for branches, `d` and stable `h` for community ID, definition-native metadata, marked branch references for authority workflows, deterministic replacement/deletion, lossless unknown-tag edits, definition naddr pointers, and full-ID section-purpose identifiers for section-referenced addressable shards. It MUST keep same-owner siblings and same-ID branches independent, derive identity and authority from typed field positions rather than value equality, never infer person or signer meaning from a community-ID field, and keep mutable community or application names out of section-scoped coordinates.
