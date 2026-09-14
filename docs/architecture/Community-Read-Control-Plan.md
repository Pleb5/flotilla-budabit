# Optional private community reads — cross-repository plan

Status: **proposal, not implemented or enabled**. Prepared 2026-09-14.

The complete server/client design and phased implementation plan is in the
Budabit strfry fork:

- Local workspace: `strfry/deploy/budabit/READ-CONTROL-PLAN.md`.
- From this directory: [cross-repository plan](../../../strfry/deploy/budabit/READ-CONTROL-PLAN.md)
  when the `budabit` and `strfry` repositories are sibling checkouts.

The linked document is newly proposed local work, not a claim that an upstream
URL or released implementation already exists.

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

Existing documentation describing public reads remains the current/default
behavior until implementation ships. Update Communikeys, community architecture,
moderation, relay publishing, and relay I/O scheduling documents together at
release, rather than prematurely claiming the proposal is supported.
