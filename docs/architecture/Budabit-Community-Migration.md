# Budabit Community Migration

## Status

This document synthesizes the current design direction for migrating, succeeding, recovering, and forking Communikey communities.

It is an architecture proposal, not a normative protocol specification or implementation plan. Event kinds, tag names, snapshot formats, recovery policies, user prompts, and branch-selection rules remain future design decisions unless this document explicitly states an invariant.

## Purpose

Communikey communities currently use one pubkey as both durable community identity and root authority. The latest accepted `kind:10222` event authored by that pubkey defines the community's infrastructure, sections, and permission-list references.

This model makes relays replaceable without changing community identity, but it does not yet define how a community should:

- Transfer control deliberately to a new key.
- Recover when the current root key is lost or compromised.
- Fork after a governance disagreement.
- Preserve and verify inherited history across a controller change.
- Migrate member grants and moderator authority safely.
- Help users discover and choose between successor branches.

The migration model must preserve Nostr's signed-event provenance. A new controller cannot become the author of old events, replace predecessor-owned lists, or globally invalidate activity on another branch.

## Existing Architecture Constraints

### Identity And Authority

- A community is currently identified by the pubkey that authors its `kind:10222` definition.
- The community pubkey is also the root administrator.
- Community routes, sessions, caches, stars, renunciations, reports, forms, and membership derivation are keyed primarily by that pubkey.
- A new controller pubkey is therefore a new Communikey identity unless a future protocol introduces a separate stable lineage identifier.

### Content Scope

- Exclusive community content uses `h = communityPubkey`.
- Targeted publications use `kind:30222` associations whose `p` tags contain community pubkeys.
- Forms, reports, lists, and other workflow events commonly reference the exact community definition address.
- Existing clients query only the selected community pubkey. They do not automatically query predecessor keys or follow succession links.

### Replaceable State

Community definitions, profile lists, targeting associations, forms, and several other authority records are replaceable or addressable events. Relays may discard older replacements. A migration design cannot assume that every historical version remains available later.

### Current Historical Visibility

Most current community surfaces derive allowed authors from the latest section profile lists and include those pubkeys in relay or repository filters. Removing a writer from the current list can therefore make that writer's historical roots disappear from default community views even without an event report or person-ban.

This is the dominant behavior for threads, rooms, calendars, goals, permalinks, and the strict community repository view. Some repository and widget paths currently behave differently. Migration must not assume that only person-bans affect historical visibility, and a future historical-authorization policy should be applied consistently across content types.

## Terminology

| Term | Meaning |
| --- | --- |
| Community root | The pubkey that authors a branch's current `kind:10222`. |
| Genesis community | The first Communikey community in a lineage. |
| Lineage | A set of community branches that claim descent from the same genesis community. |
| Branch | One independently controlled Communikey community in a lineage. |
| Predecessor | The branch from which another branch imports history or authority. |
| Successor | A branch authorized by its predecessor to continue the community under a new key. |
| Fork | A new branch that claims historical descent without becoming the sole continuation of its predecessor. |
| Recovery | A controller change authorized through a policy established before root-key loss or compromise. |
| Transition | A signed relationship between predecessor and successor branches. |
| Snapshot | A cryptographic commitment to the exact predecessor state or history imported by a branch. |
| Cutoff | A human-readable transition time or query bound. It is not, by itself, a cryptographic publication-order guarantee. |

## Core Invariants

### Forks And Successions Are Different

A successor's unilateral predecessor claim can establish provenance for a fork. It cannot establish an authoritative succession.

Planned succession requires authorization from the predecessor root. Recovery without the predecessor root requires authority established before the loss or compromise, such as predeclared guardians or threshold custody.

### Invalidation Is Branch-Scoped

A new branch cannot globally invalidate predecessor events. It can declare that its own view imports predecessor state only through a specific snapshot.

Predecessor activity outside that snapshot may remain valid and visible on the predecessor branch or another fork.

### Timestamps Are Not Security Boundaries

Nostr event authors choose `created_at`. A compromised predecessor or former writer can publish a new event with a timestamp earlier than a declared cutoff.

A cutoff timestamp may help clients query and explain a transition, but strict historical acceptance requires exact event anchors, snapshot inclusion, a signed append-only checkpoint, or another cryptographic proof of pre-transition inclusion.

### Transition Evidence Must Be Immutable

The durable authorization for a succession or recovery should be an immutable signed artifact. A replaceable `kind:10222` may advertise and help discover a transition, but it should not be the only copy of the handoff because relays may replace or discard older definitions.

### Old Authorship Must Be Preserved

Migration must copy original signed events without rewriting their authorship. Applicant submissions, user reports, member posts, moderator decisions, and other user-authored records must not be recreated as if authored by the successor.

### New Authority Uses New Coordinates

The successor cannot update predecessor-owned or moderator-owned profile lists at their existing addresses. Continuing to reference those addresses would leave them mutable by the old keys.

Successor permissions should use fresh, community-scoped list coordinates under the successor or newly accepted moderators.

## Transition Classes

### Explicit Fork

An explicit fork is created when a new root publishes a `kind:10222` that identifies a predecessor definition or branch and optionally commits to imported history.

The predecessor does not need to authorize the relationship. The fork claim means only that the new branch considers the predecessor part of its history.

An explicit fork should not automatically inherit:

- Canonical status.
- User follows, stars, or renunciations.
- Trust or endorsement.
- Member consent.
- Moderator authority.
- Bans or moderation policy.
- Infrastructure authority.

Clients may display the provenance and imported archive while making clear that the predecessor did not authorize a handoff.

### Planned Succession

A planned succession is a mutually authenticated transition:

1. The successor signs a proposal identifying the predecessor, successor key, intended lineage, and proposed configuration or configuration hash.
2. The predecessor signs an immutable handoff that references the exact successor proposal, accepted predecessor definition, and imported snapshot.
3. The successor publishes a `kind:10222` that references the handoff and begins the new branch.
4. Transition artifacts are published and verified across predecessor and successor infrastructure.

The predecessor signature establishes authorization. The successor signature establishes acceptance and proves control of the new key.

If the predecessor signs multiple incompatible handoffs, clients must treat them as competing branches unless a future canonical-selection rule resolves them.

### Recovery

Recovery applies when the predecessor root cannot provide a trustworthy handoff.

A recovery claim is valid only under a recovery policy committed before the key loss or compromise. Candidate policies include:

- A quorum of predeclared guardian pubkeys.
- Threshold signing or FROST custody that preserves the existing pubkey.
- A precommitted recovery key.
- A combination of guardian attestations and delayed user confirmation.

A post-compromise claim from previously unknown guardians is not cryptographic recovery. It is a socially evaluated fork.

## Candidate Transition Artifacts

The following shapes illustrate the required relationships. Exact kinds and tag names remain future design decisions.

### Successor Proposal

The successor proposal should be an immutable regular event signed by the new root. It should commit to:

- Predecessor pubkey and accepted definition event ID.
- Successor pubkey.
- Lineage or genesis identifier.
- Proposed generation.
- Proposed initial definition or its canonical hash.
- A unique nonce to prevent replay into another transition.

### Predecessor Handoff

The predecessor handoff should be an immutable regular event signed by the old root. A candidate shape is:

```json
{
  "kind": "<regular-transition-kind>",
  "pubkey": "<predecessor-pubkey>",
  "tags": [
    ["p", "<successor-pubkey>", "", "successor"],
    ["e", "<successor-proposal-event-id>"],
    ["e", "<accepted-predecessor-definition-id>"],
    ["x", "<snapshot-sha256>"],
    ["lineage", "<genesis-community-pubkey>"],
    ["generation", "2"]
  ],
  "content": ""
}
```

The handoff must bind the exact successor proposal rather than merely naming a pubkey. Otherwise an unrelated definition from the same key could be substituted later.

### Successor Definition

A candidate successor `kind:10222` may advertise its lineage and transition:

```json
[
  ["lineage", "<genesis-community-pubkey>"],
  ["predecessor", "<predecessor-pubkey>"],
  ["transition", "<handoff-event-id>"],
  ["snapshot", "<snapshot-sha256>"],
  ["generation", "2"]
]
```

A unilateral fork should use a distinct relationship so clients do not confuse provenance with authorization:

```json
[
  ["lineage", "<genesis-community-pubkey>"],
  ["fork", "<predecessor-pubkey>", "<source-definition-event-id>"],
  ["snapshot", "<snapshot-sha256>"],
  ["generation", "2"]
]
```

## Snapshot Model

### Why A Snapshot Is Needed

A timestamp cannot prove that an event existed before transition. A single "last event" ID is also insufficient because ordinary Nostr events do not form one ordered chain.

A snapshot gives the successor an exact, signed answer to two questions:

1. Which predecessor authority state is inherited?
2. Which predecessor history is displayed as part of this branch?

### Authority Snapshot

An authority snapshot should identify exact accepted versions of state such as:

- The predecessor `kind:10222` definition.
- Every inherited section profile list.
- Active targeting associations.
- Active forms and application workflow definitions.
- Active reports, bans, and moderation decisions if those are inherited.
- The predecessor relay set and other infrastructure needed to retrieve referenced events.

Authority snapshot entries should use exact event IDs in addition to addresses. Addresses alone resolve to mutable state.

### Historical Snapshot

A historical snapshot may be represented by:

- A complete manifest of imported event IDs.
- A Merkle tree whose root is committed by the transition.
- A content-addressed archive containing original signed Nostr events.
- A relay-signed append-only checkpoint with verifiable inclusion proofs.

The transition should commit to a cryptographic hash of the manifest or archive. The data should be mirrored to successor relays and durable content-addressed storage rather than relying on one predecessor relay.

### Branch Acceptance

Under strict snapshot validation, a predecessor-scoped event belongs to the successor branch's inherited history only if the event is included in the committed snapshot.

New successor activity uses the successor pubkey as its community scope. Successor-aware clients query inherited predecessor scopes for archived history and the successor scope for current activity.

## Permission And Moderator Migration

### Member Grants

The successor root can migrate current public grants without possessing predecessor list keys:

1. Resolve the exact source profile-list versions committed by the snapshot.
2. Read their public `p` tags.
3. Merge grants according to the selected migration policy.
4. Publish fresh successor-owned profile lists under community-scoped identifiers.
5. Verify the replacement lists on successor community relays.
6. Reference those lists from the successor definition only after verification succeeds.

Private list entries, unknown tags, and state not included in the source events cannot be recreated safely without additional authorization or data.

### Moderators

Predecessor moderator-owned lists should not be reused by default because those pubkeys would retain authority over successor permissions.

The successor should issue fresh moderator invitations using successor-community-scoped coordinates. A pending invitation must not confer publication, grant, report, or moderation authority. Authority begins only after the moderator signs an explicit acceptance.

The current implementation treats some referenced list owners as authorized before invitation acceptance and may grant them community-wide write access. That behavior must be resolved before it can safely support migration.

### Publication Ordering

Migration resources should be published before the successor definition that activates them:

1. Snapshot or archive.
2. Successor-owned member lists.
3. Moderator invitation or acceptance state required at activation.
4. Transition authorization.
5. Successor `kind:10222`.

Important writes should require relay acknowledgement and exact readback before later authority records are activated.

## Historical Content Policy

Migration should distinguish historical acceptance from current write permission.

Potential inputs are:

- Snapshot inclusion.
- Permission at publication time.
- Current permission.
- Current person-ban state.
- Current event-report state.
- Original author deletion requests.

Using only current writer lists rewrites visible history whenever permissions change. Using only historical grants can preserve content that the current community no longer endorses. A snapshot allows the transition authority to preserve a defined archive while current reports and bans remain separate overlays.

Whichever policy is selected should be shared by threads, rooms, calendars, goals, repositories, permalinks, widgets, extension queries, direct detail routes, and notifications.

## Discovery And User Experience

Transition evidence should be published to:

- Predecessor community relays.
- Successor community relays.
- Predecessor and successor outbox relays.
- Community indexer relays.
- Any durable archive locations committed by the transition.

A client resolving the predecessor should be able to discover successor or fork claims even when the predecessor's former main relay is offline.

Clients should preserve the distinction between:

- A predecessor-authorized successor.
- A guardian-authorized recovery.
- An unauthorized but historically related fork.
- Multiple competing valid branches.

Older clients will continue treating each pubkey as an independent community. Migration cannot make them understand lineage retroactively.

## Validation Requirements

A lineage-aware resolver should:

- Verify every event signature independently.
- Bind transition references to exact event IDs and pubkeys.
- Reject self-predecessors, cycles, repeated keys, and invalid generation changes.
- Use deterministic replacement ordering for definitions and addressable state.
- Apply authorized deletion handling without discarding evidence needed by another branch.
- Keep branch-specific acceptance separate from the global event repository.
- Treat conflicting handoffs as branches rather than selecting one by arrival order.
- Require complete transition evidence before presenting a claim as authorized succession.
- Preserve relay provenance as retrieval evidence, not authority.
- Bound lineage traversal and snapshot acquisition to resist resource-exhaustion attacks.

## Implementation Impact

Community migration requires more than parsing new `kind:10222` tags.

### Definition Resolution

All community-definition consumers should use one accepted-authority resolver with signature verification, deletion handling, deterministic timestamp and event-ID ordering, and lineage validation.

### Session And Route State

The application will need to distinguish at least:

- Selected branch pubkey.
- Current controller pubkey.
- Genesis or lineage identifier if adopted.
- Predecessor chain and imported snapshots.
- Selected branch when multiple successors exist.

### Queries

Successor-aware views may need to query:

- Current events scoped to the successor pubkey.
- Archived events scoped to one or more predecessor pubkeys.
- Exact snapshot events and manifests.
- Transition and recovery evidence.

Events must then be validated against the selected branch rather than accepted solely because they match an `h` or `p` filter.

### Storage

Local storage must preserve exact authority and snapshot events even when normal repository replacement logic would discard older versions. Branch-specific rejection must not globally remove an event that remains valid on another branch.

### Membership And Trust

Stars, follows, renunciations, bans, reports, badges, forms, notifications, repository associations, and trust evidence currently refer to exact community pubkeys or definition addresses. Each needs an explicit branch and succession policy.

### Compatibility

Definitions without lineage tags remain ordinary genesis Communikey communities. Clients that do not implement migration continue to treat predecessor and successor pubkeys as separate communities.

## Security Considerations

### Backdating

Timestamp-only cutoffs permit post-transition backdating. Strict imported history requires snapshot inclusion or equivalent proof.

### Root-Key Compromise

A predecessor signature issued after compromise cannot distinguish the legitimate operator from the attacker. Recovery must rely on authority committed before compromise or be presented as a socially evaluated fork.

### Equivocation

A predecessor or guardian set may authorize multiple successors. Clients must surface conflicting branches and retain the signed evidence.

### Relay Loss And Pruning

Identity continuity does not imply data continuity. Transition artifacts and exact historical versions must be replicated before predecessor infrastructure disappears.

### Mutable List Ownership

Referencing predecessor or former-moderator lists allows those keys to change successor permissions. Successor state should use fresh coordinates unless continued authority is deliberate.

### Replay And Cycles

Transition proposals need unique nonces and exact lineage bindings. Clients must reject cycles, repeated transitions, and reuse of a handoff in another lineage.

### False Membership Claims

Copying a pubkey into a fork's permission list grants access but does not prove that the user chose to join or endorse the fork. User consent and administrator-granted capability should remain distinguishable.

## Future Design Decisions

The following questions remain intentionally unresolved.

### Identity And Branches

- Whether the stable user-facing identity remains the current branch pubkey or becomes a separate genesis or lineage identifier.
- Whether planned succession should redirect old community references automatically, prompt users, or remain a separately followed branch.
- How clients select a branch when multiple predecessor-authorized successors exist.
- Whether generation numbers are necessary and who validates them.

### Event Format

- The event kind or kinds used for successor proposals, handoffs, recovery attestations, and snapshot manifests.
- Final tag names and indexed query fields.
- Whether fork and succession metadata belongs directly in `kind:10222`, immutable transition events, or both.
- How a successor proposal commits to its initial definition without creating circular event references.

### Snapshot Scope

- Whether strict snapshots include all community events or only authority and mutable state.
- Whether historical manifests use explicit event IDs, Merkle trees, content-addressed archives, relay checkpoints, or a combination.
- How snapshots are paginated, mirrored, discovered, and garbage-collected.
- Whether a human-readable timestamp cutoff remains part of the protocol as a query optimization.

### Historical Visibility

- Whether ordinary historical roots remain visible after current permission revocation.
- Whether authorization is evaluated at publication time, snapshot time, current time, or through layered policy.
- Whether replies and reactions follow the root's historical acceptance or require independent current authorization.
- How existing feature-specific visibility inconsistencies are migrated.

### Deletes And Replacements

- Whether post-transition deletion requests from original content authors remain effective in successor archives.
- Whether post-transition replacements of user-owned addressable publications update inherited views or remain pinned to snapshot versions.
- How predecessor targeting removals published after transition affect successor archives.
- How successor moderation hides predecessor events without impersonating their authors or deleting them globally.

### Membership And Moderation

- Whether planned succession carries member grants automatically.
- Whether a fork may copy grants directly or must convert them into opt-in invitations.
- Whether predecessor bans, reports, forms, pending applications, badges, and review history are inherited.
- Whether moderators accept authority per section or for the whole community.
- How moderator list identifiers are scoped to avoid reuse across unrelated communities.

### Recovery

- Whether recovery uses guardians, threshold signing, a recovery key, or another mechanism.
- How guardians are selected, rotated, revoked, and displayed.
- The required recovery threshold and whether a delay or user challenge period applies.
- How clients distinguish a legitimate recovery from a guardian-assisted hostile takeover.

### Discovery And Social Choice

- Which relays and indexes must retain transition evidence.
- Whether follows, stars, renunciations, notification subscriptions, and trust relationships move automatically.
- How clients communicate authorized succession, recovery, and unilateral forks without implying false consensus.
- Whether users can pin a branch and refuse later redirects.

### Interoperability And Rollout

- Whether migration should become a standalone Communikey specification or a broader NIP proposal.
- How old clients and partially upgraded clients behave during long transition periods.
- Whether compatibility adapters should expose successor history through legacy community views.
- What test vectors, conformance rules, and multi-client implementations are required before activation.

## Recommended Design Sequence

Before implementing community migration, the project should settle the future decisions in this order:

1. Define historical visibility independently from current write permission.
2. Define fork, planned succession, and recovery as separate trust classes.
3. Choose branch identity and user-facing redirect behavior.
4. Specify immutable transition artifacts and conflict handling.
5. Specify snapshot scope, storage, and inclusion validation.
6. Correct moderator invitation authority and list-coordinate scoping.
7. Centralize accepted community-definition resolution.
8. Define membership, moderation, deletion, and targeting inheritance.
9. Add branch-aware acquisition, storage, routing, and discovery.
10. Publish protocol test vectors and validate interoperability before treating migration as authoritative.
