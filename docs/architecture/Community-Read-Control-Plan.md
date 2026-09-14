# Optional private community reads — cross-repository plan

Status: **implemented and verified on feature branches; default off, not live-deployed**. Prepared 2026-09-14. Publication/cache guards and operator guidance are included; see limitations below.

The complete server/client design and phased implementation plan is in the
Budabit strfry fork:

- Local workspace: `strfry/deploy/budabit/READ-CONTROL-PLAN.md`.
- From this directory: [cross-repository plan](../../../strfry/deploy/budabit/READ-CONTROL-PLAN.md)
  when the `budabit` and `strfry` repositories are sibling checkouts.

This does not claim that a published upstream revision or released private-client
implementation already exists.

Operator guide in sibling checkouts: [private configuration, health and rollback](../../../strfry/deploy/budabit/PRIVATE-READS.md).
Before merge/release, an authorized server publication and immutable client
conformance-pin update are still required. Local vectors agree; the old remote
pin does not yet contain the reader section.

## Invitation reader (Phase 6)

Use `/c/<naddr>?read-access=members`, with the endpoint hints encoded in the naddr,
or add repeated `&relay=wss%3A%2F%2Frelay.example` parameters. Explicit query hints
override the naddr hints; the route never expands them through public discovery,
owner outboxes or relays learned from the returned definition. The marker and
endpoints persist in session storage for navigation/reload, not in an event cache.
Removing the query does not silently make a known private scope public.

The separate access shell runs before definition lookup, requires a real signer
and authentication consent, and uses dedicated sockets and a memory-only
repository. Public child routes/loaders are not mounted. An authenticated denied
socket can retry after a grant without another signature; a revoked/disconnected
connection needs fresh authentication. Cancellation/account changes clear the
view and stop old callbacks. Missing, failed or saturated reads are incomplete,
not an empty community. The initial archive view requests up to 200 retained events
per relay and explicitly reports saturation rather than claiming complete history.
It does not render remote media, widgets, Git actions, uploads or zaps.

Signed `["read-access","members"]` intent is preserved by editors. The private
shell supports owner-definition bootstrap and plain-text posts, never public
fanout. Each publication fetches bounded, non-redirecting NIP-11 information from
the explicit endpoints and requires version 1, members, relay scope **and**
`auth_required: true`. Unsupported intent/capability blocks before signing.
Identity changes and cancelled/changed sockets also block already-queued sends.
Read AUTH consent does not grant unsigned-event trust. Private retained input is
deletion-aware, including e-only NIP-09 grant deletion without older-grant revival;
global persistence, notifications, search and extensions do not consume it.

Browser regression (full `pnpm dev` stack required):

```sh
pnpm exec playwright test -c tests/e2e/private-community.config.ts
```

This test uses isolated cold contexts, controlled NIP-07 keys, the existing mock
relay helper and blocked off-origin HTTP. It signs AUTH and one explicitly allowed
controlled text fixture, never writes to a real relay, and verifies denied access,
grant retry without another AUTH, capability rejection before signing, private
posting, shared repository exclusion, reload and revocation.
`PRIVATE_TEST_OUTPUT` can place artifacts outside the checkout.

## Recommended contract

- Read restrictions default off and require active Budabit write enforcement.
- The initial private mode uses one operator-pinned exact community per relay
  endpoint/database, with auto-hosting disabled.
- A valid NIP-42 identity with any current community role may read the relay;
  effective person bans revoke non-owner read access. Current content-admission
  and moderation checks remain mandatory in the client.
- Reader authorization uses committed moderation state, not the write plugin's
  speculative pre-storage state. Existing subscriptions and queued output must
  be invalidated on revocation or unavailable policy.
- Python exports a bounded atomic reader-snapshot file. C++ checks its active
  epoch, exact sequence, pinned enforcing configuration, and short liveness lease.
  Pre-commit invalidation and synchronized final-send authorization remain
  mandatory: post-commit sequence updates and queued termination alone were
  rejected by Phase 0 deterministic safety counterexamples.
- Private mode requires AUTH before reads and EVENT, enabling truthful standard
  NIP-11 `limitation.auth_required`. Existing signed-author write rules remain;
  valid AUTH does not prove membership. COUNT/Negentropy are disabled initially.
- NIP-42 retains multiple authenticated keys. An initially denied socket may
  retry after a grant; a revoked, terminated socket reconnects/authenticates.
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

## Client work covered by the full plan

1. Shared Python/TypeScript reader-eligibility vectors and a small Communikeys
   amendment for private publication intent.
2. Generation-safe Welshman auth and explicit idempotent-read replay semantics.
3. Relay metadata/runtime policy resolution without permanent public-URL auth
   overrides; separate authentication consent from trusting unsigned events.
4. Bunker-aware timeout budgets and reuse of existing NIP-46 receiver recovery.
5. Cold private-invitation bootstrap, per-relay access outcomes, and useful guest,
   pubkey-only, signing, denied, unavailable, and retry-after-grant states.
6. Publication/notification/extension routing audit; disable unsafe external
   features initially rather than silently exporting private context.
7. Private data provenance and memory-only/account-isolated handling before any
   later offline-cache feature.
8. Deterministic race tests, raw-relay integration, targeted isolated browser
   verification, and a dedicated private-relay rollout.

Public reads remain the current deployment/default. Communikeys, community
architecture, moderation, publishing and relay I/O documents describe the optional
private override together; this does not claim all public workflows are available
privately. Incomplete/saturated private history disables authoring rather than
pretending complete authority. No encryption, retroactive secrecy or external
provider protection is implied.
