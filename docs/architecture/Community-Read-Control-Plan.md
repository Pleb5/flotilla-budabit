# Optional member-only relay reads — client architecture

Status: **relay admission implemented in source; default off, not live-deployed**.
Updated 2026-09-17. The filename is retained for existing links. This is the current
client contract, superseding the isolated private reader/publisher design.
For rationale and independent policy boundaries, see
[Community-Access-Decisions.md](Community-Access-Decisions.md).

The relay implementation and operator procedures remain in the sibling strfry checkout:

- [Relay architecture](../../../strfry/deploy/budabit/READ-CONTROL-PLAN.md)
- [Configuration, health and rollback](../../../strfry/deploy/budabit/PRIVATE-READS.md)
- [Verification record](../../../strfry/deploy/budabit/READ-ADMISSION-VERIFICATION.md)

The client simplification does not change relay enforcement, publish a server revision
or update `community-policy-conformance.json`. Its old remote pin still lacks the
reader vectors; authorized server publication and a pin update remain release work.

## Security boundary and ordinary client handling

The relay is the only read-access security boundary. It verifies NIP-42 identity,
checks membership before REQ admission and periodically rechecks active connections.
AUTH proves a key, not membership. A valid proof needs a matching positive relay ACK;
an ACK does not turn a denied query into an empty successful result.

Once the relay delivers an event, it follows normal client handling:

- Shared repository and persistent cache, including across reload, logout,
  account change, denial and revocation.
- Normal community routes, current author permissions, targeting and moderation.
- Ordinary search, notifications, publication, recovery and export.
- Ordinary media, widgets, Git, Blossom and other providers, without an added
  member-community restriction.

There is no local private registry, endpoint blacklist, separate repository, socket
pool, publisher, bounded private archive or private-capability/completeness gate.
The client does not promise confidentiality for received data or prevent downstream
disclosure. It does not purge or hide cached events when relay access is lost.
Existing content moderation remains independent of relay admission.

## Invitation and connection lifecycle

Use `/c/<naddr>?read-access=members`, with relay hints encoded in the naddr, or add
repeated `&relay=wss%3A%2F%2Frelay.example` parameters. Explicit query hints override
the naddr hints. Malformed explicit invitations show an error before starting community loaders.
Session storage remembers the hints for subsequent navigation/reload; it is not an
event-isolation mechanism. Removing the query does not discard remembered hints.

Invitation **definition lookup** uses those hints without owner-outbox or public
discovery fallback. It publishes returned events into the ordinary shared repository.
Afterward, normal loaders/features can use their ordinary routing; invitation hints
are not an application-wide destination restriction.

`CommunityRelayAccess.svelte` places login, signer and explicit AUTH/retry controls
beside the normal `CommunityLayout.svelte`. It is not a content gate. The panel
reports connection/admission results, not whether all community history is complete.
Cached content remains available while disconnected or signed out.

Retry uses Welshman's pooled socket. It replaces closed, failed, disposed or
AUTH-forbidden connections, but reuses healthy and opening connections. It grants
identity-specific authentication consent, awaits the shared AUTH coordinator, then
queries the exact definition through the normal status-aware loader. A completed
query triggers normal community bootstrap recovery. Denial and unavailability are
distinct from completion; a later grant can be followed by explicit retry.

Community background history, follow-up, delete and live reads pause on terminal
membership or authentication failures, scoped to community/account/relay. Remounting
or a late sibling EOSE does not clear the denial. A successful explicit invitation
retry, or an explicit bootstrap access-recovery action, clears the affected relay
state. Unrelated shared-client requests and other identities remain independent.
Policy-unavailable retries are bounded; component timers do not renew an exhausted
finite-loader retry budget. Transport retry timers back off from 5.5 seconds to at
most 60 seconds. This recovery state is not a global endpoint blacklist or cache gate.

Cancellation and identity/signer changes stop the connection attempt and invalidate
stale signing work. Account-change socket cleanup does not clear the repository.
AUTH consent never grants unsigned-event trust. The coordinator retains verified
proof checks, matching ACK handling and separate signing/ACK time budgets. Normal
transport recovery is shared by all reads; publishes are not implicitly replayed.

## Signed metadata and publication

Editors preserve top-level `['read-access', 'members']` and unknown extension tags.
These are metadata, not client privacy enforcement. Receiving a definition cannot
register a private endpoint or suppress unrelated reads/publication.

Publication uses the normal destination selection, permissions, signer and transport.
There is no private-only publisher or restriction to capability-advertising relays.
NIP-11 still supplies ordinary AUTH and scheduling information; member/read-policy
extensions are not a client capability gate or proof of confidentiality.

## Diagnostics

Debug and performance diagnostics can capture member-community context, persist
armed targets and use the normal artifact publication flow. No route taint, private
reference redaction or private-context upload veto remains. General credential and
secret sanitization remains, as do stable artifact byte copies, identity checks,
upload verification and manifest readback verification.

## Verification

Focused unit regressions cover shared intake, noninterference from unsolicited
definitions, normal publication, metadata preservation, diagnostics sanitization,
pooled invitation retry, cancellation and retained events after account changes.
Existing AUTH/coordinator, loader, moderation and publication tests remain applicable.
Independent optional repository deletion semantics are retained and tested in
Welshman; they are not a private-data boundary.

Browser regression (requires the full `pnpm dev` stack):

```sh
pnpm exec playwright test -c tests/e2e/private-community.config.ts
```

It uses fresh browser contexts, a disposable NIP-07 identity, the existing mock relay
and blocked off-origin HTTP. Only AUTH for the fixture relay can be signed. It checks
login/consent, denial, explicit retry, shared repository intake, IndexedDB persistence,
normal child routes, reload, retained data after logout and malformed invitations.
It also verifies that a revoked live community read is not recreated over a
12-second observation window, and that successful explicit retry clears its block.
`PRIVATE_TEST_OUTPUT` can place artifacts outside the checkout. This is mocked evidence,
not a deployed relay/proxy/signer test. The removed native isolated-archive test is
not evidence for the new shared client path.

The independent socket fix preserves pending CLOSED reasons on peer disconnect or
error without draining queued EVENT/EOSE, and discards them on local cancellation.
`socket-terminal.test.ts` covers this separately from the mocked browser flow.
The adjacent AUTH/CLOSED replay-ordering finding was fixed in `f576df3f7`.
AUTH challenges update state at wire ingress, before adjacent closures are classified;
a consented challenge-probe continuation gets one microtask to start signing.
Requested state alone never suppresses a terminal CLOSED, and read replay waits for
the matching positive AUTH ACK. Suppressed closures are removed from both receive
and pending disconnect-flush queues. `auth-replay-order.test.ts` covers wire ordering,
ACK matching, absent consent, superseding challenges and disconnect behavior;
`relay-auth-coordinator.test.ts` covers the existing-probe continuation race.

`community-read-recovery.test.ts` covers scoped denials, remount/late-EOSE behavior,
explicit reset, bounded policy retries and transport backoff, including execution
of the production live effect with controlled dependencies.

## Client implementation map

| Responsibility | Source |
| --- | --- |
| Invitation hints and session metadata | `src/app/core/private-community-scope.ts` |
| Explicit pooled connection/retry | `src/app/core/community-relay-access.ts` |
| Connection controls and normal layout | `src/app/components/CommunityRelayAccess.svelte`, `CommunityLayout.svelte` |
| Shared loading, bootstrap and recovery | `src/app/core/community-state.ts` |
| Scoped background read recovery | `src/app/core/community-read-recovery.ts` |
| AUTH consent/coordinator | `src/app/core/relay-auth-consent.ts`, `relay-auth-coordinator.ts` |
| Shared AUTH/replay/repository | `packages/welshman/packages/net/src/auth.ts`, `read-replay.ts`, `repository.ts` |
| Current content permissions/moderation | `src/app/core/community-permissions.ts`, `community-reports.ts` |
| Shared reader semantics and immutable pin | `src/app/core/community-read-access.ts`, `community-policy-vectors.test.ts`, `community-policy-conformance.json` |
| Ordinary diagnostics and artifact export | `src/app/core/performance-diagnostics.ts`, `debug-diagnostics.ts`, `diagnostics-artifact-publish.ts` |

## Release boundaries

Local client changes/tests do not constitute a private-relay rollout. Container
startup, private-capable rollback, deployed proxy/real-signer probes and retention
review remain separate release work. Discovery/joining and applicant ACLs remain
deferred; there are no new relay public-kind exceptions. Independent encrypted DM
handling, relay participant checks and NIP-70 policy are unchanged. Relay access
control is not end-to-end encryption, retroactive secrecy or private external hosting.
