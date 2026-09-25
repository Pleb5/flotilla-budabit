# Cashu wallet integration

## Supported stack and boundaries

Budabit uses exact versions of `@cashu/coco-core` and `@cashu/coco-indexeddb`
**2.0.0**, with their supported `@cashu/cashu-ts` **5.0.0-rc.4**. Upgrade these
together and review the pinned patches before changing versions. Although newer
SDK release candidates exist, overriding Coco's exact dependency/peer contract
is not part of this migration.

The wallet accepts **sat-denominated secp256k1 ecash** (`00`/`01` keysets).
BLS/Nutroot (`02`) is disabled: Coco filters BLS mint keys and rejects BLS token
decoding, and Budabit applies an additional keyset admission/input policy.
Legacy `00` keysets are checked across the wallet for NUT-13 derivation-index
collisions, including inactive/untrusted cached keys. A colliding mint/keyset is
rejected without deleting existing wallet material.

Coco owns `Amount` values and decimal-string persistence. UI and extension
messages keep their numeric-sat contract through checked `.toNumber()`
conversions. User amounts must be positive safe integers; foreign units and
numeric overflow are rejected. Token previews use `getTokenMetadata`; receiving
resolves full keyset IDs through Coco before decoding compact tokens. The
independently packaged pipelines iframe's metadata-only parser supports both
its existing v3 numeric SDK and the host's v5 `Amount` API.

## Token receipts and redemption status

Chat cards look up local receive/send operations by a fingerprint of the mint,
unit and sorted proofs. Receipts survive component remounts and reloads, including
re-encoded copies of a token and receipts beyond the recent-history page. A
successful receipt records the amount after fees; it is not a current-balance
claim. Duplicate receives reuse the saved operation, including its recovery
outputs, and concurrent attempts are serialized within the wallet and across
browser tabs where Web Locks are available.

Outgoing tokens show **Not checked** until there is mint evidence. Opening or
refocusing wallet history checks at most ten unresolved tokens from the last
seven days, with a persisted one-minute throttle shared across tabs and requests
batched by mint. **Check
status** performs a read-only NUT-07 check. Partial/pending responses and failed
checks retain their distinct meaning; only a complete, validated all-spent
response finalizes a send. The timestamped display cache stores fingerprints and
amounts, not proof secrets, and is removed when replacing or clearing the wallet.
Chat previews do not fetch mint keys or check unfamiliar tokens automatically.

**Received** means this wallet has a durable receipt. **Redeemed** means the mint
confirmed the original token was spent, without identifying the recipient.
Short labels open click/tap explanations, with keyboard dismissal, in both chat
and wallet history. Browser coverage uses a synthetic mint and isolated wallets
(`tests/e2e/cashu-receipts.spec.ts`); it does not move real funds.

### Storage and active-use limits

`budabit-cashu-status-v1` is a separate, optional IndexedDB database:

- `checks`: at most **2,000** token summaries/attempt timestamps. Writes are
  per-record and transactional across tabs, with oldest-first eviction. Nonfinal
  observations expire after **30 days** (ignored on read, pruned on open/write).
  Spent observations can remain until cap eviction. Cached observations never
  establish a local receipt or replace recovery material.
- `operations`: a rebuildable fingerprint → operation-ID index, at most one
  receive and one send reference per token identity. It contains no proof secrets
  or duplicated recovery outputs. Its size follows wallet history rather than the
  disposable observation cap. Lookup reads the actual SDK operation and verifies
  the fingerprint before presenting a receipt. Missing indexes are rebuilt from
  SDK operations in **50-row pages**, yielding between pages, and updated from SDK
  operation events. A missing receive is checked afresh before a new receive starts.
- `meta`: a wallet-lifetime epoch. Reset changes it transactionally, rejecting
  stale writers from other tabs. Wallet clear/replacement/restore clear both
  derived stores; lock/reload close the connection and cancel obsolete work.

The legacy `budabit_cashu_token_checks_v1` localStorage blob is validated, trimmed,
and migrated once, then removed only after commit. Malformed or oversized blobs
(over two million characters) are disposable and discarded rather than parsed.
Quota/unavailable-cache failures fall back to bounded in-memory observations and
paged SDK lookups; they cannot turn a completed receive into a failure.

The tracker retains at most **128** raw-token previews and status/observation
entries, with a combined **500,000-character** raw-token budget and at most **256**
in-memory throttle entries. It does not retain full per-mint operation histories.
Mounted cards may keep their own small display result after tracker eviction.

These limits are shared by mobile and desktop, without viewport/device detection:

- No interval polling. Mounted wallet history reacts to focus, visibility return,
  and network reconnection. Chat previews only read local data.
- Automatic checks skip hidden/offline views and `Save-Data` connections, cancel
  on backgrounding or leaving history, and release paused attempts for resumption.
- One automatic mint batch at a time, at most **1,000 proofs per mint batch**,
  **100 proofs per request**, and a **10-second batch deadline**. Larger tokens
  remain explicitly checkable. Complete validated responses are required before
  summarizing; partial network responses never imply redemption.
- Explicit checks remain available despite connectivity hints, coalesce recent
  clicks, and retain the last successful observation if the mint cannot be reached.
- These rules govern optional redemption checks, not SDK issuance/payment recovery.

Eviction may require another status check; it never deletes wallet proofs or
durable receive operations. Receipts remain browser-local: a seed backup recovers
funds, not this device's complete transaction history. Neither cache is a promise
against browser-origin eviction or clearing site data.

## Storage migration and recovery material

The live database remains **`budabit-coco-wallet`**. The mnemonic and the
`bip39.mnemonicToSeedSync(mnemonic)` seed derivation are unchanged. Upgrading the
SDK does not require moving funds or recreating the wallet.

Before opening a v1 database (Dexie schema ≤17 / native IndexedDB version ≤170),
Budabit copies its full schema, indexes, primary keys and rows in one consistent
read transaction to **`budabit-coco-wallet-pre-coco-v2`**, object store
`snapshots`, key `wallet`. This includes proof secrets, counters, quote keys,
pending output secrets/blinding factors and history. It stays in the browser's
local IndexedDB and is never uploaded. Snapshot failure prevents migration;
the source is not cleared. Retry can refresh a snapshot while the source is
still v1. Once the source has upgraded, normal startup does not overwrite it.

The snapshot is sensitive wallet recovery material with the same browser-origin
protection as the live proof database. Encrypting the mnemonic alone does not
encrypt either proof database. Explicit wallet replacement/logout cleanup removes
both databases, following the existing wallet-reset behavior.

Database upgrades are transactional. An exception during migration must leave
the source version and rows intact; the regression fixture verifies this and a
subsequent successful retry. Migration/init errors appear as an unavailable
wallet with a retry action, rather than a zero balance. Close other Budabit tabs
before retrying a blocked upgrade.

### Pinned upstream fixes

`patches/@cashu__coco-indexeddb@2.0.0.patch` and
`patches/@cashu__coco-core@2.0.0.patch` cover reproduced gaps:

1. **Melt-quote primary key:** upstream schema 28 changes an existing key, which
   Dexie rejects with `Not yet support for changing primary key`. Intermediate
   schemas 27.1/27.2 stage rows and drop the old store; 28 recreates/restores it;
   28.1 removes staging. All steps share the atomic upgrade transaction. Original
   invoice text also survives operation backfill.
2. **`final_expiry`:** this metadata participates in `01` keyset ID verification.
   Preserve it through mint synchronization, IndexedDB and wallet cache creation.
   Schema 32.1 invalidates old mint-cache timestamps to fetch previously omitted
   metadata. Without this fix, the valid fixture keyset cannot be selected.
3. **Existing quote-lock keys:** v1 has no key-purpose discriminator. Schema 32.2
   marks purpose-less keys referenced by saved mint quotes/operations for legacy
   NUT-20 lookup, while retaining P2PK access and derivation indexes. New keys
   retain v2's normal purpose separation. This prevents a saved locked quote
   failing with `Missing NUT-20 mint quote key` after migration.
   Schema 32.3 repairs quote-only references from the legacy mint-quote table,
   including wallets that already ran 32.2 without marking those keys.

The current patched native database version is **323**. Future adapter upgrades
must account for these intermediate versions, metadata and legacy-key marker.
Do not simply remove the patches after checking that a fresh wallet opens.

### Rollback

Reverting the JavaScript bundle is **not** a database rollback: the v1 adapter
cannot open a newer database version. A snapshot is retained for explicit
recovery, not automatically replayed into the live wallet. It may contain proofs
spent after capture and must not replace newer counters or pending operations.

For recovery investigation, close other tabs, preserve copies of both databases
and the seed/encrypted-seed recovery material, and inspect copies with the
appropriate adapter version. Reconcile proof spend state and quotes with their
mints before restoring any old state. Seed-only recovery cannot reconstruct all
quote-lock and interrupted-operation material. No automatic downgrade/import UI
is provided.

Old standalone top-up invoices that were never persisted by Budabit v1 cannot be
reconstructed by this storage migration. Existing stored proofs and operations
are migrated; all newly created top-ups use the durable flow below.

## Operations and UI

- New Lightning top-ups create a **locked canonical quote**, then prepare a
  deterministic mint operation and persist its outputs before displaying the
  invoice. Identity is `{mintUrl, quoteId}`; operations are reused across polling,
  background settlement and reloads.
- If preparation fails, the saved quote has an explicit **Preparation incomplete**
  state. Its invoice text and QR are withheld until **Retry preparation** saves
  the deterministic outputs. Retries reuse the canonical quote and serialize
  preparation within the manager session.
- The Receive tab lists saved invoices. Closing the invoice view keeps the
  quote; reopening/reloading can resume it. Polling timeout pauses local checking
  and offers **Check again**. Only actual quote expiry is called expiration.
  Locally expired invoices remain available to check whether payment arrived
  while the wallet was offline.
- Paid/issued quotes are reconciled through Coco; completion is based on the
  stored operation, not merely seeing `PAID`. Persisted outputs support NUT-09
  recovery if the response is lost. Pending recovery is shown without asking
  the user to pay again.
- Coco 2.0 can report `finalized` with a recovery error when the mint has already
  issued but NUT-09 returns no proofs. These operations remain visible after
  reload as **Recovery required** in both invoices and history, without a success
  amount prefix. **Retry recovery** atomically requeues only that specific Coco
  error and executes the same operation/outputs. Successful finalized operations
  are never requeued, since their proofs may already have been spent. This also
  handles errored operations persisted by earlier Budabit bundles.
- Default mint settlement and melt recovery remain enabled. Only automatic
  polling of externally spent send proofs is disabled, as before. Coco can
  perform startup recovery before `initializeCoco()` returns even when ongoing
  processors/watchers are disabled.
- Reset/reload disposes the previous manager before closing its repositories;
  generation checks prevent obsolete initialization/refresh results from
  repopulating the UI. The wallet error action reinitializes without replacing
  the seed or clearing proof data.
- Receive amounts come from the operation's amount minus fees, avoiding races
  with unrelated balance updates. History uses stable operation identities and
  exposes states instead of describing pending/failed top-ups as completed.
- Coco's console logger is disabled because SDK error metadata can contain
  bearer tokens. User-facing errors remain available in the UI.

## Verification

Focused tests use public, never-funded seeds and a controlled mint transport
with actual secp256k1 blind signatures and DLEQ. They exercise:

- The real v1 adapter's schema-17 fixture opening under the patched v2 adapter;
  full proof/counter/key/quote/output/history preservation, native upgrade
  rollback, retry, snapshot failure and repeated opening.
- Spending migrated `00` and `01` proofs, completing a v1 pending locked quote,
  and recovering issuance after a crash with the original outputs/counters.
- Startup handling of pending, failed/unpaid and paid legacy melts.
- Current NUT-20 verification and legacy-only verification with rc.4's fallback
  retry, plus expiry-bearing `01` keysets.
- App lifecycle failures, concurrent claims, reload-resume, checked amounts,
  non-sat/BLS rejection and legacy derivation collisions.
- Production-default background processing for incomplete preparation and
  terminal issuance errors, including reload and successful later recovery;
  quote-only v1 migration and forward repair from native version 322.

```sh
pnpm exec vitest run --project=main src/app/core/cashu-*.test.ts \
  src/app/util/cashu-*.test.ts \
  src/lib/components/markdown/markdownRenderers.test.ts \
  src/lib/components/markdown/markdownTokenizers.test.ts
pnpm check
pnpm build
VITE_CASHU_WALLET_ENABLED=1 pnpm build
```

Source inspection of CDK v0.18.1 and Nutshell 0.21.0 found current and legacy
quote verification; Nutmix v0.7.0 uses legacy verification. Gonuts v0.4.2 supplies
a legacy `00` reference. Controlled tests model these protocol differences;
they are **not live-server or real-Lightning conformance tests**.

For browser reproduction, keep the full workspace watchers current and run
`node tests/helpers/cashu-browser-server.mjs` using Node with TypeScript stripping
support. This opt-in server uses a separate Vite cache at `localhost:1848`, enables
the Cashu UI, and exposes a synthetic mint at the same origin. In a dedicated
browser profile, use a public test seed and trust only that local mint. Create an
invoice, close/reload/resume it, then POST `/__fixture__/pay/<quoteId>` to change
its simulated state. Its invoice strings are deliberately unpayable. Mint state
is in memory; restarting this fixture server resets its quotes. Production code
does not include this server or its endpoints.

For issuance-recovery reproduction, POST `/__fixture__/issued/<quoteId>` to report
issuance without available proofs. Later POST `/__fixture__/recover/<quoteId>`
with `{outputs: [...]}` containing the saved operation's original blinded messages
to make their signatures available to NUT-09, then use **Retry recovery**.

To regenerate the v1 fixture, use `scripts/capture-cashu-v1-fixture.mjs` with the
original Coco IndexedDB 1.0.0 and Cashu-TS 3.3.0. Optional `CASHU_V1_ADAPTER` and
`CASHU_V1_SDK` package entrypoints allow explicitly retained old packages; both
versions are checked before writing the fixture. Never use a funded seed.
