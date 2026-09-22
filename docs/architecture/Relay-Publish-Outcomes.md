# Relay publish outcomes and conformance

## Client integration

`src/app/core/relay-publish-outcomes.ts` classifies relay results and preserves
the original NIP-01 OK detail. Only a successful status counts as acceptance;
even `duplicate:` on an OK-false reply is not success.

- Loading, relay errors, rate limits, and timeouts explain when to retry.
- Missing grants explain cross-relay list propagation and ask the user to refresh
  permission evidence. They do not assert that the user actually has a grant.
- Bans, disabled kinds, and other restrictions explain the prerequisite change.
- Invalid, deleted/replaced, and protected-deletion events disable unchanged retry.
- Required-relay failure remains failure despite optional-relay success.
- Readback errors are verification failures, not empty reads or write rejections.

Inline status, recovery toasts, Notifications → Publications, and legacy thunk
details share the presentation. Direct community/profile publishing, repository
EventIO, and renunciation failures retain relay-specific reasons too.

A bounded observer captures late rejections after the first ACK confirms an
operation. These are delivery reports, not a claim that accepted copies failed.
Reports survive toast dismissal and remain in Notifications → Publications.
Reports and signed retry payloads are session-local (maximum 100); observers
expire after 60 seconds. Publication recovery cleanup clears them.

Delivery retries use the exact signed event, only unsuccessful retryable
destinations, and the original publishing account. They never sign another event,
pay, authenticate, widen destinations, or automatically resume an administration
workflow. Refresh/readback is needed to verify that workflow afterward. Ordinary
operation and legacy thunk retries retain previous ACKs and skip accepted relays.
Existing operation-specific retry validation remains in force. No automatic retry
loop or relay-based relaxation of client admission was added.

The shared feedback component renders relay text as text. Diagnostics retain
classified reason codes, not arbitrary relay messages or signed payloads.

## Learned write-kind restrictions

All Welshman `publishOne`, `publish`, and `publishThunk` paths share the local
publish-policy hook in `packages/welshman/packages/net/src/publish.ts`. Budabit
installs `src/app/core/relay-write-capabilities.ts` once in the root layout.
Publish sites continue supplying their ordinary destinations.

Unknown relay/kind combinations are attempted normally. Only an actual matching
OK-false reply with an unqualified kind-wide denial, such as
`blocked: kind 32222 is not allowed`, records negative evidence. Community grants,
author restrictions, repository references, payment/auth requirements, malformed
events, connection failures and timeouts do not establish a kind restriction.
NIP-11 and empty reads are not evidence of write support.

The cache is keyed by normalized relay URL and outgoing event kind, bounded to 512
entries, and persisted as individual `relay.writeCapabilities.v2:` keys in browser
localStorage. Each decision reads that relay/kind's current key, so additions and
acceptance-driven removals in other tabs are visible immediately, without waiting
for a storage event. Writes update only the observed pair, never a tab's stale
snapshot. The old v1 snapshot is not imported, to avoid resurrecting cleared evidence.
Evidence expires after 24 hours; expiry permits the next real publication or
explicit retry. A later OK-true response clears the restriction. Denied or corrupt
storage falls back to memory. The policy performs no network preflight, background
probes, signing, or synthetic event publication. Attempted destinations retain
their existing timeout and retry behavior.

A fresh restriction produces terminal `skipped` status before acquiring an
adapter. It is never an ACK, never satisfies a required relay, and an all-skipped
operation cannot succeed. Shared feedback separates attempted and skipped counts,
for example `Accepted by 3/3 attempted relays; 1 skipped (kind unsupported).`
The original rejection remains a failed attempt; subsequent skips retain its
reason in delivery reports. Retries go through the same centralized policy.

Peer disconnect/error teardown preserves queued `OK` and `CLOSED` frames in wire
order, including terminal frames in an already-popped receive batch. Matching
publication ACKs therefore reach both the publisher and capability observer before
the transport is reset. Local cancellation still discards queued work, and a bare
disconnect without a matching ACK retains the ordinary publication timeout.

## Protected-kind deletions

The active Budabit relay policy rejects any kind-5 request containing a `k` tag
for 32222/30000 or an `a` coordinate of either kind. It also recognises e-only
references to currently tracked definitions/shards. Mixed requests are rejected
whole with:

```text
blocked: Deletion of kinds 32222 and 30000 is not allowed
```

This operator restriction is additional to Communikeys admission, not a NIP-09
change. It applies to owners, explicitly tagged unhosted coordinates, and
kind-30000 moderator requests/personal lists. Replace definitions and list
contents instead. Report-only kind-1984 retractions remain allowed.
Historical/imported deletions still affect authority state. Unknown e-only ids
contain no kind information and do not trigger a blocking database lookup.
The previously documented deletion-replay edge case remains accepted, not fixed.

## Cross-repository CI

`community-policy-conformance.json` is Budabit's immutable strfry reference.
The dedicated workflow runs on `dev`, `main`, and `master` pushes/PRs, exports the
tested client's vectors, compares with the pinned fixture, and runs the pinned
Python conformance test against the fresh export.

Only top-level `generatedAt` and `budabitCommit` are excluded from semantic
comparison. Both are validated separately, including the fresh source revision.
Every other field and all array order are significant. Unrelated client commits
do not force fixture churn, but changed cases, decisions, or parsing semantics do.

For policy changes, publish the reviewed compatible strfry fixture/plugin first,
then update the immutable reference. Do not use a floating branch or merely
change a digest. The reference must name a commit already published to
`Pleb5/strfry` so GitHub CI can check it out. The current pin includes the
protected-kind deletion policy and its regression tests.
The protected-deletion restriction has separate relay tests because the client
permission oracle is not the operator's storage policy.

Local check, without overwriting the committed relay fixture:

```sh
POLICY_VECTORS_OUT=/path/to/scratch/fresh.json pnpm exec vitest run --project=main src/app/core/community-policy-vectors.test.ts
node scripts/check-community-policy-vectors.mjs /path/to/scratch/fresh.json ../strfry/deploy/budabit/tests/vectors/budabit-policy-vectors.json "$(git rev-parse HEAD)"
```
