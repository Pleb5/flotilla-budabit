# Optional private community reads — client architecture

Status: **plugin-owned REQ admission implemented in source; default off, not live-deployed**.
Updated 2026-09-16. The filename is retained for existing links; this is the current
client contract, not an unexecuted phased plan. For the rationale and policy
boundaries, start with [Community-Access-Decisions.md](Community-Access-Decisions.md).

The server architecture, plugin interface and decisions are in the Budabit strfry fork:

- Local workspace: `strfry/deploy/budabit/READ-CONTROL-PLAN.md`.
- From this directory: [relay architecture](../../../strfry/deploy/budabit/READ-CONTROL-PLAN.md)
  when the `budabit` and `strfry` repositories are sibling checkouts.

This does not claim that a published upstream revision or released private-client
implementation already exists.

Operator guide in sibling checkouts: [private configuration, health and rollback](../../../strfry/deploy/budabit/PRIVATE-READS.md).
Before merge/release, an authorized server publication and immutable client
conformance-pin update are still required. Local vectors agree; the old remote
pin does not yet contain the reader section.

## Invitation and socket lifecycle

Use `/c/<naddr>?read-access=members`, with the endpoint hints encoded in the naddr,
or add repeated `&relay=wss%3A%2F%2Frelay.example` parameters. Explicit query hints
override the naddr hints; the route never expands them through public discovery,
owner outboxes or relays learned from the returned definition. The marker and
endpoints persist in session storage for navigation/reload, not in an event cache.
Removing the query does not silently make a known private scope public.

The separate access shell runs before definition lookup, requires a real signer
and authentication consent, and uses dedicated sockets and a memory-only
repository. Public child routes/loaders are not mounted. A denied socket is
disposed; explicit retry after a grant creates a new socket and authenticates it.
There is no automatic denial-signing/reconnect loop. Cancellation/account changes
clear the view and stop old callbacks. Missing, failed or saturated reads are incomplete,
not an empty community. An anonymous `auth-required:` response may recover through
normal AUTH and REQ replay; a denied/revoked connection cannot be reused. Late
EVENT/EOSE/CLOSED/disconnect callbacks cannot restore a terminated view.

## Bounded authority and content admission

Per relay, one live subscription has two disjoint bounded filters: authority kinds
`[5,1984,30000,32222]` and text kind `1`. Each has its own limit of at most 200
(or the lower advertised `max_limit`). Inaccessible unrelated
records cannot consume the authority query's budget. The endpoint must explicitly
advertise `budabit.read_control.unfiltered_kinds` covering every queried kind:
these kinds undergo no post-limit involved-key filtering for authenticated readers.
Missing/unsupported claims, unknown limits or either scan reaching its effective cap
leave authority incomplete, even after EOSE. Posts and authoring stay hidden until
the bounded scan is complete; unreturned bans/shards are not presumed absent.
Text requires exact `h` and branch `a` targets, a supported kind-1 section, current
author permission and no censorship in that section. Grant, definition and report
updates recompute this view; retained storage is not admission.
It does not render remote media, widgets, Git actions, uploads or zaps.

## Private publication and relay capabilities

Signed `["read-access","members"]` intent is preserved by editors. The private
shell supports owner-definition bootstrap and plain-text posts, never public
fanout. Each publication fetches bounded, non-redirecting NIP-11 information from
the explicit endpoints and requires members, relay scope **and** `auth_required: true`.
Legacy version1 remains recognized; version2 additionally requires generic
`read_policy` version1, `admission: req`, `consistency: eventual`, and a positive
integer `recheck_seconds` in 1–300. Unsupported intent/capability blocks before signing.
Identity changes and cancelled/changed sockets also block already-queued sends.
Read AUTH consent does not grant unsigned-event trust.

Example NIP-11 fields at the default five-second interval (normal relay limits are
also required for completeness):

```json
{
  "limitation": {"auth_required": true, "max_limit": 200},
  "read_policy": {"version": 1, "admission": "req", "consistency": "eventual", "recheck_seconds": 5},
  "budabit": {"read_control": {"version": 2, "mode": "members", "scope": "relay", "unfiltered_kinds": [1, 5, 1984, 30000, 32222]}}
}
```

The core generates the generic `read_policy`/AUTH facts; the operator supplies the
Budabit members/relay semantics. `unfiltered_kinds` supports bounded completeness,
not public-kind exceptions or unlimited history. Version-1 compatibility does not
prove old commit-synchronized guarantees, and generic AUTH alone does not prove
member-only access. NIP-11 remains an operator claim, not confidentiality evidence.

## Retention, isolation and diagnostics

Private retained input is deletion-aware, including e-only NIP-09 grant deletion
without older-grant revival. Global persistence, notifications, search and
extensions do not consume it.
App-wide debug/performance diagnostics redact known private locators, encoded
coordinates, event IDs and endpoint context before retention/serialization. A
capture that visits a private route is marked even if exported after leaving or
switching accounts. Such captures cannot be exported publicly: artifact bytes
(including gzip) and manifest context are checked before upload authorization,
Blossom upload or publication, and rechecked across asynchronous signing steps.
Unrelated public diagnostics remain available; these checks are not an explicit
private-disclosure workflow.
Persistent diagnostics arming also refuses known-private route/context targets
before writing localStorage (including invitation queries before URL normalization).
Restore discards legacy private arms; learning private intent or a private event ID
purges any matching arm immediately, without requiring another settings visit.
Unrelated public `/git` and community targets retain their normal arming behavior.

## Verification

Browser regression (full `pnpm dev` stack required):

```sh
pnpm exec playwright test -c tests/e2e/private-community.config.ts
```

This test uses isolated cold contexts, controlled NIP-07 keys, the existing mock
relay helper and blocked off-origin HTTP. It signs AUTH and one explicitly allowed
controlled text fixture, never writes to a real relay, and verifies denied access,
grant retry on a newly authenticated socket, capability rejection before signing,
private posting, shared repository exclusion, reload and revocation.
`PRIVATE_TEST_OUTPUT` can place artifacts outside the checkout.

Opt-in production-loader/native-core regression (initialized, built local strfry
checkout; isolated loopback port 40584, controlled raw AUTH, no TLS proxy or live accounts):

```sh
STRFRY_SOURCE=/path/to/strfry pnpm exec vitest run --project=main src/app/core/private-community-native.test.ts
```

It retains the default involved-key DM restrictions, reproduces the old broad
query's omitted older ban/grant/deletion, and verifies the isolated authority
filter fetches the evidence before exposing text. The supplied TMPDIR must be a
session-owned test directory; the fixture creates/removes only its own database.

## Implemented contract

- Community read admission defaults off; the Budabit private preset requires active
  write enforcement. Independent DM participant restrictions do not default off.
- The initial private mode uses one operator-pinned exact community per relay
  endpoint/database, with auto-hosting disabled.
- A valid NIP-42 identity with any current community role may read the relay;
  effective person bans revoke non-owner read access. Current content-admission
  and moderation checks remain mandatory in the client.
- A separate Python read plugin maintains an eventually consistent membership
  cache from bounded local scans, not the write plugin's speculative acceptance.
  C++ asks it once before each REQ and periodically for active connections
  (default five seconds). Denial closes the connection; failure never permits new
  reads. No per-event community checks or inspection of query results is required.
- C++ holds no reader roster or community address. Snapshot files, database epochs,
  exact commit sequences, pre-commit barriers and commit-synchronized final sends
  are removed. Plugin refresh time plus recheck/IPC time determines revocation
  delay; bytes already sent cannot be recalled. This explicitly relaxes the old
  zero-window guarantee rather than claiming the old race tests still prove it.
- Private mode requires AUTH before reads and EVENT, enabling truthful standard
  NIP-11 `limitation.auth_required`. Existing signed-author write rules remain;
  valid AUTH does not prove membership. COUNT/Negentropy are disabled initially.
- NIP-42 retains multiple authenticated keys. Denied/revoked sockets are disposed;
  explicit retry reconnects/authenticates rather than repeatedly prompting on denial.
- Auth and read access are separate states, alongside existing content-authority
  completeness. Auth requires a matching positive relay ACK, not just a
  completed signature. Logout/account changes replace private sockets.
- One shared auth attempt and one read-replay owner prevent duplicated bunker
  requests. Auth recovery never implicitly replays publishes.
- Private bootstrap is invite-first, with login/consent before definition reads
  and no public discovery fallback. The client needs an access shell even when
  the community definition is not yet available.
- Private publishing needs signed owner intent, constrained relay/provider
  routing, and account-safe cache/view behavior. A relay gate alone does not
  make existing public/hybrid publication workflows private.
- The server switch is default-off C++ config with an agreement-check script,
  not a Python-only flag or config renderer. Owner bootstrap reads require a
  complete successful scan; unavailable policy blocks owner reads too.
- This is relay access control, not end-to-end encryption, retroactive secrecy,
  private Blossom/Git hosting, or prevention of copying by authorized members.
- Kind4444 participant-only reads remain independent of community admission; the
  fork also retains protection for old kind4/1059 data. NIP-70 is separately default
  off and ignores its protection semantics without deleting or rejecting tags.

## Client implementation map

Paths are relative to the repository root; companion tests live beside the modules.
Within a row, bare filenames share the first file's directory.

| Responsibility | Source |
| --- | --- |
| Invitation hints and session privacy markers | `src/app/core/private-community-scope.ts` |
| Access lifecycle, fresh retry and terminal callback guards | `src/app/core/private-community-access.ts` |
| Signed intent and destination/capability guards | `src/app/core/private-community-policy.ts`, `private-community-publish.ts` in the same directory |
| Explicit unfiltered-kind and result-limit evidence | `src/app/core/private-relay-profile.ts` |
| Reader predicate and current content permissions | `src/app/core/community-read-access.ts`, `community-permissions.ts`, `community-reports.ts` |
| Isolated route shell | `src/app/components/CommunityAccessShell.svelte`, `src/routes/c/[community]/+layout.svelte` |
| AUTH consent/coordinator | `src/app/core/relay-auth-consent.ts`, `relay-auth-coordinator.ts` |
| Shared AUTH/replay and deletion-aware repositories | `packages/welshman/packages/net/src/auth.ts`, `read-replay.ts`, `repository.ts` |
| Diagnostics capture/export/arming boundary | `src/app/core/diagnostics-privacy.ts`, `performance-diagnostics.ts`, `debug-diagnostics.ts` |
| Role conformance and immutable publication pin | `src/app/core/community-policy-vectors.test.ts`, `./community-policy-conformance.json` |

## Release and unsupported workflows

Implementation and local tests do not constitute a dedicated private-relay rollout.
The server publication/client pin, container execution and private-capable rollback,
deployed proxy/real-signer probes and production retention review remain release
work. See the sibling relay's
[verification record](../../../strfry/deploy/budabit/READ-ADMISSION-VERIFICATION.md).
Discovery, joining UI and applicant ACLs remain deferred; no public stored-kind
exceptions are provided.

Public reads remain the current deployment/default. Communikeys, community
architecture, moderation, publishing and relay I/O documents describe the optional
private override together; this does not claim all public workflows are available
privately. Incomplete/saturated private history disables authoring rather than
pretending complete authority. No encryption, retroactive secrecy or external
provider protection is implied.
