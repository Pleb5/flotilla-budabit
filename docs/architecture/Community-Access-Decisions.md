# Community access: decisions and policy boundaries

Status: **implemented in local source, private admission default off**. Updated
2026-09-17. This is the cross-repository decision record for Budabit and its strfry
fork, not a release or live-deployment claim. The earlier commit-synchronized
ReadGate design is superseded; its history is not evidence for the replacement.

## Document responsibilities

| Question | Authoritative reference |
| --- | --- |
| Wire identity, definitions, lists and signed private intent | [Communikeys](Communikeys.md) |
| Current roles, writes and content moderation | [Community moderation](Budabit-Community-Moderation.md) |
| Invitation connections, shared client data and tests | [Read-access client architecture](Community-Read-Control-Plan.md) |
| Publication destinations and external disclosure boundaries | [Relay publishing policy](Budabit-Relay-Publishing-Policy.md) |
| AUTH ownership, consent and request scheduling | [Relay I/O scheduling](community-relay-io-scheduling.md) |
| DM wire format and encryption | [Project NIP-4444 draft](NIP-4444.md) |
| Relay/plugin contract, defaults and implementation map | `strfry/deploy/budabit/READ-CONTROL-PLAN.md` in the sibling repository |
| Operator configuration, health, maintenance and rollback | `strfry/deploy/budabit/PRIVATE-READS.md` |
| Recorded deployment versus local verification evidence | strfry `RUNBOOK.md` and `READ-ADMISSION-VERIFICATION.md` in that directory |

Keep implementation facts, operator choices and deferred proposals labeled
separately. The signed protocol does not turn an operator's NIP-11 claims into
proof of enforcement. Shared Python/TypeScript vectors check role semantics, not
the trustworthiness or freshness of a running relay.

## 1. Preserve three deployment levels

| Level | Relay behavior | Client responsibility |
| --- | --- | --- |
| Client-only moderation | Ordinary public community reads; no Budabit write plugin required | Validate signed branch authority and current content admission |
| Public reads plus write enforcement | Reject unauthorized community writes using signed event authors | Still moderate retained history/imports; do not assume the relay curated them |
| Optional member-only reads | Enforcing write policy plus whole-relay REQ admission and periodic connection rechecks | Authenticate with consent; use ordinary shared storage, features and content checks |

The third level does not replace the first two. “Public reads” here refers to
community content: independent DM participant privacy remains mandatory in the
current relay fork. Admission is disabled by an empty `relay.readPolicy.plugin`,
not by a permissive response to a broken configured plugin.

Each private endpoint/database pins **one exact**
`32222:<owner>:<communityId>` authority coordinate in Python. Relay URLs are
infrastructure, not community identities. Auto-hosting is useful for public write
enforcement but prohibited in the private preset: discovering a new definition
must not silently expand who can read a private database.

### Hosting boundary: shared public writes, dedicated member-only reads

Budabit supports shared relays for publicly readable communities with independently
enforced write permissions. Member-only reads instead use one exact community
authority governing the entire relay endpoint/database. **Multi-community read
isolation within one database is deliberately deferred**, not a protocol prohibition
or a promised roadmap item.

For member-only communities, prefer a dedicated relay instance/database under
community control, either self-operated or entrusted to a chosen operator. This
aligns the read boundary with the deployment boundary. Separate private instances
may share a physical host, but different URLs pointing to the same database do not
establish separate reader populations. The host administrator remains trusted, and
shared infrastructure still couples availability and resource use.

The trade-offs are intentional:

- **Simpler read authorization:** one community decision covers ordinary stored
  events without community-specific result filtering, mixed-community query
  semantics or per-community live-subscription isolation. Independent DM participant
  restrictions still apply.
- **Reduced cross-community disclosure risk:** there is no supported shared private
  database in which a missed community check can expose another tenant's content.
  This does not eliminate implementation, configuration or host-compromise risks.
- **Higher operating cost:** each community or chosen operator must manage its
  instance's updates, monitoring, backups, recovery and availability. Dedicated
  instances sacrifice some hosting efficiency and convenience.
- **A different trust relationship, not guaranteed security:** self-hosting gives
  the community operational control; a well-run trusted service can be safer than a
  poorly maintained self-hosted instance. Private multi-tenant relays are not
  inherently unsafe, but require isolation mechanisms and verification absent here.
- **Public hosting still needs isolation:** public community content removes the
  community-read confidentiality boundary, not independent write-authority checks,
  moderation, spam controls, quotas or resource limits.

Dedicated hosting adds no encryption or downstream confidentiality. Operators can
access plaintext community content, authorized readers can retain or redistribute
it, and ordinary client storage/publication remains unchanged. Eventual revocation
cannot recall delivered copies; see sections 3 and 5.

Revisit this decision only for a concrete need to serve distinct reader populations
from one endpoint. That requires authorization covering each result's actual
community across history, live delivery and auxiliary read paths, plus explicit
revocation, query-completeness and cross-community isolation tests. Adding more
community addresses to the current whole-relay admission configuration is not that
design.

## 2. Separate identity, readership, writing and visibility

- **Identity:** NIP-42 proves control of a key on a connection. A valid nonmember
  proof still gets `OK true`. Budabit waits for the matching ACK; a signature alone
  is not authentication. Authentication consent does not grant unsigned-event trust.
- **Readership:** after a complete successful initial scan, the owner can bootstrap
  even without a definition. A non-owner needs an available definition, a structural,
  active-moderator or any-section-grant role, and no effective person ban. Referenced
  list owners remain structural while pending/declined; personal renunciations or
  local exclusion preferences are not reader authority. Any eligible verified AUTH
  key admits the connection's REQ; the core retains up to 32 keys.
- **Writing:** the event's verified author must satisfy the independent write rules.
  A reader is not automatically a writer in every section. Shaped nonmember
  application/moderator-request/star exceptions remain where the write policy
  permits them. Private mode requires AUTH before EVENT, not membership for every
  EVENT; read-policy unavailability need not block authorized repair writes.
- **Visibility:** a readable stored event is only a candidate. The client still
  applies exact branch targeting, supported sections, current author grants,
  reports/censorship and same-author deletion. Regrant can reveal retained history;
  read admission does not rewrite or curate storage.

The normal community UI remains available, including moderation and repair controls
subject to ordinary write permissions. Relay read admission is not a client feature
gate and does not imply permission to write.

## 3. Prefer whole-REQ admission and eventual consistency

C++ owns proof verification, connection/request lifecycle, bounded queues, plugin
IPC, rechecks and disconnects. Python owns the community coordinate, membership
derivation and its in-memory eligible-key cache. The interface passes only an
opaque request ID and verified keys, returning `allow`, `deny` or `unavailable`.
No event bodies, filters, rosters or branch coordinates cross it.

One allow covers a REQ's history and live subscription. There is no per-event
community callback, mixed-filter policy analysis, result buffering or stored-kind
exemption. DM participant checks remain independent. Separate persistent read and
write processes avoid coupling their serial IPC; this is not a resource-isolation
or production-capacity guarantee.

Python rebuilds from bounded local LMDB scans, never speculative write acceptance.
A completed pass replaces the cache; concurrent commits can still produce an older
or transient mixed view. Subsequent passes converge. Defaults are one second
between completed refresh passes, a five-second aggregate scan budget, ten-second
maximum age measured from successful scan start, and five seconds until a connection
recheck after a successful decision. Failed refreshes do not renew age; initial
failure blocks the owner too. Requests are lookups, not scans.

Periodic rechecks were chosen over next-REQ-only revocation so a live subscription
cannot keep its old allow indefinitely. They require no new client signature.
Observation/rebuild, the next check, scheduling and IPC all contribute to delay:
**five seconds is not a commit-to-revocation SLA**. There are no commit barriers,
database-policy epochs or final-send membership locks. Subscription lifecycle tokens
discard late work after CLOSE/replacement/disconnect without becoming policy checks.
Already transmitted data cannot be retracted.

## 4. Fail closed without hiding incompleteness

An anonymous REQ receives AUTH plus `CLOSED auth-required:` and may authenticate on
the same connection. A policy denial returns `CLOSED restricted:` and disconnects;
unavailability returns `CLOSED error:` and disconnects. Neither is a successful empty
query. Explicit invitation retry replaces a closed/failed pooled socket and obtains
a fresh proof; healthy or opening pooled connections are reused. The shared loader
reports denied, unavailable, timeout and cancellation outcomes separately from EOSE.
Normal loaders and live-subscription recovery remain in use; there is no second
private reader. Community background recovery stops on terminal denial for that
community/account/relay until explicit retry/access recovery, rather than reconnecting
every few seconds. Other identities and unrelated shared-client requests are not
blocked by that recovery state. Transport EOSE is not proof of complete authority or unlimited
history. Ordinary content-authority loading and moderation still apply.

## 5. Protect reads at the relay, not received client data

The selected contract is **relay-only read protection**. The relay decides whether
to deliver events using AUTH and membership admission. Once delivered, events are
ordinary client data: they enter the shared repository and persistent cache and can
participate in search, notifications, recovery, publication and all normal features.
Logout, account change, relay denial and revocation do not purge or hide cached data.
Downstream disclosure is not prevented by this contract.

Signed `['read-access', 'members']` remains preserved metadata, not a client routing
or export restriction. Unsolicited definitions cannot classify endpoints, register
private coordinates or block unrelated requests. Explicit invitations remember relay
hints for definition lookup and require authentication consent; that lookup has no
public discovery/outbox fallback. Subsequent ordinary application routing is not
confined to those hints. Neither the tag nor the invitation configures relay enforcement.

There is no isolated repository/socket/publisher, NIP-11 private-capability gate,
restricted renderer or private-context diagnostics boundary. Git, Blossom, media,
widgets, zaps and public fanout follow their ordinary paths. Diagnostics may include
community context and be armed/exported normally, while retaining credential/secret
sanitization, identity-safe signing and upload/readback verification.

Operators and authorized clients see plaintext community content. Removing relay
admission can expose retained data to new readers; received copies cannot be recalled.
No end-to-end encryption, retroactive secrecy or prevention of copying is claimed.

## 6. Keep DM protection and NIP-70 independent

Budabit's project DM draft uses kind `4444`, NIP-44 ciphertext and a kind-4-like
recipient-tag shape, not gift wraps/seals/rumors. The relay always protects reads of
`4444` and retained `4`/`1059` by authenticated participants, regardless of community
admission or optional restricted-kind settings. Broad/ID queries, COUNT and
Negentropy must not bypass that rule. AUTH-disabled relays keep these events
inaccessible rather than public. This adds no ciphertext or event-shape validation
and does not globally replace standard Nostr constants or legacy storage behavior.

`relay.nip70.enabled=false` means **ignore NIP-70 protection semantics**, not reject
events merely for carrying `['-']` or strip their tags. It also skips the NIP-70
embedded-repost restriction and omits NIP-70 advertisement; unrelated validation
and write policy remain intact. Explicit enable restores the NIP-70 checks.
Neither this switch nor community membership weakens mandatory DM participant reads.

## 7. Deferred discovery/joining and release boundaries

No discoverability switch, public-kind carve-out, applicant ACL or new joining UI
has been selected. Grant arrangement remains invitation-first through an
independently private-capable workflow, followed by explicit access retry.

Future choices include publishing a full `32222` definition versus a minimal
owner-signed descriptor, and structured `30168`/`1069`/`7`/`5` applications versus
encrypted `4444` contact. A full signed definition cannot be selectively redacted;
it may disclose list owners, sections, endpoints and provider metadata. Public
`1069` answers are plaintext tags, not private submissions. A positive review alone
is not membership; actual `30000` grants establish it. Applicant/moderator visibility
has not been selected, and ordinary-member visibility into private applications is
not implicitly authorized. Public querying alone does not supply a global directory;
a separate publication/discovery channel would still be needed. Disabling discovery
cannot retract metadata already disclosed.

Local native, Python, client and mocked-browser tests do not prove a deployed
proxy/signer/container path. Preflight and independent fresh-scan health checks do
not inspect the running read process's cache or prove member access. Release still
requires authorized immutable server publication and client conformance-pin update,
container startup/private-capable rollback verification, retention review and
controlled anonymous/outsider/member/fault probes before opening ingress. The old
published vector pin remains unchanged; no source-only documentation update closes
those release gates.
