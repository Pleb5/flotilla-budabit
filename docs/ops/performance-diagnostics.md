# Performance Diagnostics

Budabit has an opt-in diagnostics build for measuring exact Community Home routes and `/git`. The feature observes existing state; it does not initiate route requests or change loading decisions.

## Enable Capture

Build or deploy with:

```sh
VITE_PERFORMANCE_DIAGNOSTICS=1 pnpm build
```

Open **Settings → Performance Diagnostics**:

1. Enter `/git`, a full site URL, or an exact `/c/naddr...` Community Home path.
2. Choose **Arm next launch**.
3. Close and reopen the app on that route. For cold assets, clear the browser HTTP cache without clearing local storage, which holds the one-shot arm.
4. Capture starts during client bootstrap and stops at Community settlement. `/git` records foreground settlement separately, then retains a bounded background telemetry tail. A watchdog requests failure after 60 seconds, but main-thread saturation can delay timer delivery.
5. Return to Settings to inspect and download the result, or choose **Upload & publish** while logged in.

**Arm and open now** is convenient for warm-session diagnostics but does not produce a genuinely cold browser load. A small status control on the target page links back to the diagnostics settings while a capture is running or available.

The artifact schema is `budabit-performance-run-v2`. Captures include route milestones, bounded state samples, long tasks, resources, relay scheduler snapshots, capture-local scheduler counters, warnings, build metadata, and browser environment data. Known secret fields and secret-shaped values are redacted before serialization, and relay paths are omitted.

`/git` foreground settlement means a current positive card projection remained stable through two animation frames. Background repository acquisition is recorded separately until it becomes terminal or a bounded 10-second telemetry tail expires. Authoritative empty results still require background acquisition to become terminal.

Best-effort browser telemetry also records final navigation timing, bounded Long Task attribution, and Event Timing interaction samples where the browser supports those APIs. Interaction samples contain timing metadata only; input values and element text are not captured.

Community Home records core readiness, widget discovery, frame loading, and initial layout as separate milestones. Final settlement waits for the first widget catalog attempt and each selected frame's initial resize or 15-second layout deadline; later background recovery and manual retries do not keep the bounded capture open.

Upload defaults:

- Blossom: `https://blossom.budabit.club`
- Manifest relay: `wss://relay.budabit.club`
- Manifest kind: `30078`
- Immutable d-tag: `budabit-performance-run:<run-id>`
- Latest d-tag: `budabit-performance-latest`

The artifact is gzip-compressed when supported and hashed before upload. The active account signs a hash-scoped Blossom upload authorization and both manifests, and publication requires at least one relay acknowledgement for each manifest.

## Deterministic Harness

### Wallet operations

Test deployments enable `VITE_DIAGNOSTICS=1` and `VITE_PERFORMANCE_DIAGNOSTICS=1`.
Under **Debug info**, select **Cashu wallet**, start recording, reproduce the wallet
action, then stop and download the existing debug artifact. The category defaults
off, and probes are inactive without a build gate and an active capture.

Wallet records include operation/event categories, outcomes, lookup row counts and
budget exhaustion, cache work, mint-check proof counts, background queue delay and
elapsed time. They use a closed allowlist: no raw SDK objects, errors, tokens, proofs,
seeds, operation IDs, mint URLs, invoices or amounts enter these records.

An armed Community Home or `/git` performance capture also includes `cashu:*`
records for concurrent wallet initialization/work. This is the startup measurement
path; a manually started debug recording covers subsequent wallet activity. Both
use the existing bounded recorders and export/publication machinery. Recording does
not initiate wallet scans, status checks or network activity.

### Root-route harness

Run the production-build benchmark:

```sh
pnpm perf:roots
```

It runs serial desktop and Pixel 7 viewport/4x CPU profiles against deterministic mock relays. Each profile measures cold-data and service-worker-warm assets for an exact community fixture and `/git`. Correct fixture projection and settlement are assertions; timing values are informational.

Outputs are ignored build artifacts under `test-results/performance-roots/`:

- `desktop.json`
- `mobile-4x.json`
- `summary.md`

Use `PERF_REUSE_BUILD=1 pnpm perf:roots` only when the existing `build/` was produced by the performance preparation step and no relevant source changed.

## Retrieve

The Home Manager-managed OpenCode skill is `budabit-performance-diagnostics`. Ask it for the latest artifact or a run ID. Identity may be a local `nak-account` alias, an `npub`, or a 64-character hex pubkey; the default alias is `five`.

Retrieval is read-only. The skill selects an exact-author manifest, verifies its signature, downloads by Blossom hash, verifies byte size and SHA-256, decompresses it, validates both schemas, and only then saves final files for analysis.
