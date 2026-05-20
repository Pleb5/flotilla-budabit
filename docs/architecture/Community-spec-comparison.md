This is a comparison of 3-4 approaches to communities on Nostr: **Communikeys**, **NIP-72** (including Chorus-style implementations), and **Relay-as-Community** (using relays themselves as the community container, with Nip-29 rooms as sub-set of that).

NOTE: This article was updated based on comments and things that needed clarification.

## Relay Requirements

### Communikeys

Works on any standard Nostr relay. No special relay implementation is required. Relays MAY optimize for Communikeys by only storing events from badgeholders, but it's optional.

### NIP-72

Works on standard relays. Uses membership lists (approved, declined, banned) stored as addressable events, plus moderator approval events. See [github.com/andotherstuff/chorus](https://github.com/andotherstuff/chorus) for Chorus-style implementations.

### Relay-as-Community

The relay itself IS the community. Requires running and maintaining a dedicated relay instance. The relay URL becomes the community identifier. Complex configuration across multiple NIPs:

- NIP-11 for relay metadata (owner pubkey, identity)
- NIP-29 for rooms/groups within the relay
- NIP-42 for authentication and access control
- NIP-43 for member lists and invite codes
- NIP-86 for admin editing capabilities

If the relay goes down, the community is out.

---

## New Event Kinds Introduced

### Communikeys

**2 event kinds**:

- `kind:10222` — Community Definition
- `kind:30222` — Targeted Publication

Uses existing primitives for everything else: badges (NIP-58), forms (NIP-101), profile metadata (kind:0).

### NIP-72

**11+ event kinds** (Chorus-style):

- `kind:4550` — Post approval
- `kind:4551` — Post removal
- `kind:4552` — Join request
- `kind:4553` — Leave request
- `kind:4554` — Close report
- `kind:34550` — Community definition
- `kind:34551` — Approved members list
- `kind:34552` — Declined members list
- `kind:34553` — Banned members list
- `kind:34554` — Pinned posts list
- `kind:34555` — Pinned groups list

### Relay-as-Community

**14+ event kinds** spread across multiple NIPs:

- `kind:9` — Chat message
- `kind:9000` — Add user
- `kind:9001` — Remove user
- `kind:9002` — Edit metadata
- `kind:9003` — Add permission
- `kind:9004` — Remove permission
- `kind:9005` — Delete event
- `kind:9006` — Edit group status
- `kind:9021` — Join request
- `kind:9022` — Leave request
- `kind:39000` — Group metadata
- `kind:39001` — Group admins
- `kind:39002` — Group members
- `kind:39003` — Group roles

Plus relay-specific configuration not stored as events (NIP-11, NIP-42, NIP-43, NIP-86).

---

## Write Access Control

### Communikeys

Content sections (Chat, Posts, Articles) have specific event kinds and profile-list write rules. Different sections can point at different profile lists, giving granular per-content-type permissions. Badges can add engagement and onboarding context, but they do not grant access in Budabit.

Access requests use Forms (NIP-101), allowing communities to require anything: email verification, captcha, payments, invite codes, questionnaires, etc. Requirements are transparent in the Form Template events, and approved access is reflected in profile lists.

### NIP-72

Membership lists (approved, declined, banned) control who can participate. Join/leave request system. No content-type-specific permissions — approved members can post anything.

### Relay-as-Community

Role-based access managed per relay. Roles grant capabilities (delete, edit, etc.) but definitions are relay-specific and non-standardized. Each relay can define its own roles. Interoperability is difficult — access rules are invisible and vary between relays.

---

## Content Type Discovery

### Communikeys

The community definition explicitly lists which content types (event kinds) it handles via content sections. This is an elegant signal: "we are a place for Articles", "we curate Emoji Packs", "we host an App Catalog".

Users and apps can discover communities by content type. Looking for places that publish long-form articles? Query for communities with `k:30023`. Want to find emoji pack curators? Look for `k:30030`. App catalogs, book publishers, video channels — all discoverable by their declared content types.

Nothing more, nothing less. You know exactly what a community is about before you look inside.

### NIP-72, NIP-29, and Relays

No content type declaration. Communities are generic containers. You don't know what content types to look for until you're already inside browsing around. Apps can't filter communities by specialization. Discovery is manual exploration rather than structured queries.

---

## Targeting Publications

### Communikeys

Any existing Nostr event can be targeted to a community via a Targeted Publication event (`kind:30222`). Full backwards compatibility. The association can be updated or removed without affecting the original content.

A single publication can be targeted to up to 12 communities via one Targeted Publication event. The creator's intended audience is explicit and transparent — anyone can see which communities a piece of content was meant for. This can serve as an organic disovery route for related Communities + lowers the bar for bootstrapping new ones.

### NIP-72 and NIP-29

Events must include the community/group tag (`a` or `h`) when created. Content is permanently tied to the community. Cross-posting via reposts is possible but confusing.

The creator's intent is baked into the original event, but there's no open-ended "target audience". Content just belongs to a group.

### Relay-as-Community

No targeting mechanism. You just publish to the relay. Content isn't "targeted" — it's just there, in the same way it might be on a thousand other relays. No way to express intended audience.

Best you can do is poletly ask the relay to not propagate your publication (with `-`tag), which goes against one of the main value props of the Nostr protocol.

---

## Fetching Community Content

### Communikeys

Per-section REQ query:

1. Fetch the profile list (kind:30000) referenced in the content section's `a` tag — single event with all whitelisted pubkeys
2. REQ the content kinds filtered by those pubkeys

No need to query potentially hundreds of badge award events — the profile list gives you all allowed pubkeys in one fetch. Different content sections can have different whitelists, so you only fetch pubkeys relevant to the section you're viewing. REQ-level filtering, efficient and granular.

### NIP-72

1. Fetch approved members list (all members)
2. REQ content kinds filtered by those member pubkeys

Similar REQ-level filtering, but no per-section granularity. You fetch ALL members for ALL content types.

### Relay-as-Community

Just connect to the relay URL. Members are assumed to be allowed there. But this creates a tradeoff:

- Either the relay only stores member events — limiting, since you often want non-member events too
- Or the relay stores everything from anyone

For NIP-29 rooms within a relay, you can REQ by `h` tag to filter group-specific content. But for the relay-as-community case (the relay itself is the community), you're stuck with the member-only tradeoff.

Information is also scattered across multiple NIPs (NIP-11, NIP-29, NIP-42, NIP-43).

---

## Comments, Reactions, Labels, Zaps

### Communikeys

A standard "General" content section handles comments (kind:1111), reactions (kind:7), and labels (kind:1985) with one shared profile list. Optional badges can recognize participants. Fetch the list, filter responses by those pubkeys.

- **Comments, reactions, labels:** Filter by the General section's profile list. Only members' responses are shown.
- **Zaps:** Anyone can zap. Query zap receipts on the community relay.

Creators publish once, list the communities they want to target, and members from all those communities meet in one shared comments section. One discussion, multiple communities participating together. No duplicates, no fragmented conversations to check.

### NIP-72 and NIP-29 and Relays

Comments and reactions filter by members (Nip-72) or by relay, straightforward.

But with Nip-72 and Nip-29 your content is permanently tied to one community. To reach multiple communities, you must post duplicates. Discussions fragment — creators have to check each community separately for responses to what is essentially the same content.

With just Relays, you don't even know if you're in the right place for the discussion.

---

## Blossom Media

### Communikeys

Community definition specifies Blossom server(s). Smart community servers can store all media posted in publications based on content hashes — even if the original URLs differ. Media referenced in community content lives on the community's infrastructure, preventing link rot.

### NIP-72

Can specify Blossom servers in community definition (similar capability). Media persistence depends on implementation.

### Relay-as-Community

No built-in media solution. Members use their own Blossom servers or external hosting. Media links can rot if members' servers go offline. No transparent way to announce community media servers without additional conventions.

---

## Infrastructure & Learning Curve

### Communikeys

Communikeys piggyback on everything profiles already have or need:

**Social graph** — the npub already has a social network around it. Servers and services already analyze how profiles link to each other. Communities inherit all of this for free.

**Identity with agency** — an npub is not just an address, it's an identifier that can sign things. Attestations flow both ways — to and from the profile. The community can vouch for members, members can vouch for the community. This is fundamentally different from a URL or relay address.

**Publishing capabilities** — profiles already publish announcements, app recommendations, mute lists, follow lists. Communities get these features automatically. No new specs needed.

**Key management solutions** — nsec leaking, "this profile is compromised", "this is my new profile" — these problems are being solved for profiles anyway. Communities using npubs inherit these solutions. NIP-29 and NIP-72 would need to add extra tags or specs to handle community key rotation, compromise recovery, etc.

Badge awarding can be delegated to a separate keypair, allowing assistants or automated systems to handle membership without access to the main community keypair.

### NIP-72

Communities are separate addressable events, not tied to a brand's npub. Loses all the profile-level features. Requires managing membership lists and approval workflows from scratch.

### Relay-as-Community

Highest complexity. Must run a relay, configure NIP-11 metadata, set up NIP-42 auth, manage NIP-43 member lists, configure NIP-29 rooms, and enable NIP-86 admin tools. Information is scattered across multiple NIPs.

The relay URL is a DNS-dependent identifier without agency — it can't sign anything, can't participate in web-of-trust, can't be analyzed by social graph tools. Eventually, relay-based communities will need an identity layer anyway to escape DNS dependencies.

---

## Migration & Portability

### Communikeys and NIP-72

Portable identifiers. Switch relays by updating your community definition — all references stay intact. Communikeys can also switch blossom servers the same way (and by copying and serving the media based on the hashes).

### Relay-as-Community and NIP-29

The relay URL IS the identity. Want to switch hosting? Every reference breaks. Every member's saved links break. NIP-29 group IDs are relay-scoped — migrate to a new relay and your h-tags are suddenly very confusing, since based on coming across a community event alone, I have no idea where to go look for the new url that works. Same goes for blossom media.

For migration to work in any way smoothly, the community ID would also need to be portable and, thus, sufficiently unique — independent of where it's hosted. At that point, you might as well use npubs.

---

## Conclusion

If you take the Nip-72, Nip-29 and Relay-as-Community approaches seriously and try to address their limitations, you'd need to add:

- **An identifier with agency** — Relays and NIP-29 use URLs as identifiers. URLs can't sign things, can't participate in social graphs, can't be analyzed by web-of-trust tools. You'd have to go look for maybe-up-to-date admin profiles behind them. NIP-72 uses separate addressable events, also without agency. You'd need... an npub.

- **Migration without breaking everything** — If your community ID is a relay URL (Relay-as-Community) or tied to a specific relay (NIP-29), switching hosting is a nightmare. All references break. For migration to work smoothly, the ID needs to be portable and sufficiently unique. So why not use an npub anyway?

- **Per-content-type access control** — NIP-72, NIP-29, and Relays treat communities as generic containers. No different rules for chat vs articles vs apps. You'd need content sections with kind declarations and profile-list write rules.

- **Content type discovery** — None of these solutions announce which content types they handle. Apps can't find communities by specialization. You'd need communities to declare which kinds they support.

- **Multi-community targeting** — NIP-72 and NIP-29 permanently tie content to one community. Creators fragment discussions across duplicates. You'd need a separate targeting event that can reference multiple communities.

- **Flexible admission and engagement flows** — NIP-72 uses approval workflows, NIP-29 uses relay-specific roles. Neither supports forms, payments, invite codes, questionnaires, or badge-driven community engagement as first-class context.

- **Backup relays** — Relay-as-Community and NIP-29 tie you to one server. You'd need relay lists in the community definition.

- **Blossom servers** — Relays and NIP-29 have no integrated media solution. You'd need blossom tags.

Follow these paths to their logical conclusions and you arrive at something that looks like Communikeys: communities as npubs, content sections with profile-list write rules, targeted publications, badge-driven engagement, and integrated infrastructure tags.

Communikeys isn't an alternative to these approaches — it's what you get when you play them out.
