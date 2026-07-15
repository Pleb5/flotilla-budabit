# Session Plan

## Objective

- Eliminate client-side relay starvation that causes existing community rooms, threads, calendar events, and goals to appear missing.
- Preserve strict relay safety while guaranteeing finite loaders can run under sustained live traffic.
- Consolidate duplicate persistent subscriptions across community activity, notifications, repositories, widgets, and extensions.
- Correct authentication, policy refresh, timeout/completeness semantics, and diagnostics.
- Keep the generic transport work suitable for eventual Welshman upstreaming while keeping Budabit policy application-specific.

## Constraints

- Current repository state is authoritative over this plan.
- `docs/session-checkpoint.md` is the compact authoritative resume source.
- Branch `dev` tracks `origin/dev`; each verified phase must be committed and pushed there.
- Preserve the unrelated modified files under `packages/nostr-git-core/`; never stage or alter them.
- The public relay hard limit is 10 active IDs, 5 filters per REQ, and 128 KiB per message.
- Budabit may manage at most 9 IDs on the public relay until diagnostics justify a server/client change.
- A timeout is incomplete evidence, never authoritative absence.
- Persistent live work must never consume all finite capacity.
- Do not partially install a logical live request.
- Stage only intentional phase files and never amend or force-push.
- After every phase push, reread the checkpoint and the entire plan, inspect repository state, and immediately continue unless the checkpoint says `Current Phase: Complete` or records a blocker.

## Phase 1: Starvation-Free Scheduler And Baseline

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make the Welshman request scheduler lifetime-aware and guarantee finite progress while adopting a direct, generous `9/5/2` public and unknown-relay baseline.

### Exit Criteria

- Scheduler distinguishes finite, critical-live, and background-live work.
- Public policy directly manages 9 IDs, permits 5 filters per ID, caps all live work at 7 IDs, caps background live at 5 IDs, and leaves at least 2 IDs available to finite work.
- Unknown-relay defaults no longer use 19 IDs and 1 filter per ID; they start at the direct 9/5 baseline subject to stricter metadata/runtime evidence.
- Finite requests may use all free capacity and continue in waves.
- A live request that exceeds its class budget fails before sending a partial first wave.
- Existing callers are safely classified from `autoClose`, with explicit lifetime available for migrations.
- Queue wait and physical start are observable enough for later diagnostics and response timeout separation.
- Tests reproduce the old live-starves-finite failure and prove finite progress, critical-live headroom, atomic live admission, and finite waves.
- Focused tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

### Steps

- Extend Welshman request policy/options with lifetime-aware live caps and start callbacks.
- Replace scalar scheduler accounting with total/finite/live/background-live accounting.
- Admit persistent chunks atomically; retain wave scheduling for finite chunks.
- Add finite fairness/aging without preempting already-sent requests.
- Refactor Budabit policy values to direct managed limits and install the 9/5/2 model.
- Add scheduler and policy regression tests.

### Verification

- `pnpm install --frozen-lockfile --ignore-scripts` after patch refresh, or update the lockfile intentionally if its patch hash changes.
- `pnpm exec vitest run src/app/core/welshman-request-patch.test.ts src/app/core/relay-policy.test.ts`.
- `pnpm check`.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing with completed evidence, verification, changed files, next phase, next exit criteria, next action, and risks.
- Commit and push the phase, including checkpoint/plan updates. This is a transition, not a stopping point.
- Reread the checkpoint after push.
- Do not consider the phase complete until checkpoint update, verification, commit, push, and checkpoint reread succeed.
- Do not consider the whole plan complete unless the checkpoint says so.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately begin the next phase startup without an intermediate user summary.

## Phase 2: Authentication And Adaptive Policy

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Make required authentication terminal-state correct and make relay limits refreshable, reversible, and adaptively safer.

### Exit Criteria

- Required-auth waiters ignore nonterminal statuses and resolve only on `Ok`, `Forbidden`, `DeniedSignature`, disconnect, or typed timeout.
- Concurrent reads share one authentication attempt per socket session; signer rejection and reconnect reset correctly.
- Public relays never pre-authenticate.
- First use, reconnect, and periodic active use refresh NIP-11 metadata without blocking ordinary public reads.
- NIP-11 lower limits apply safely; later relaxation is controlled rather than permanently poisoned by an earlier caller/request.
- `max_limit` is represented in policy metadata.
- Finite `arr too big` failures retry once with smaller filter groups; session-learned limits reset on reconnect.
- Realistic authentication-transition and policy adaptation tests pass.
- `pnpm check` and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

### Steps

- Correct `waitForCommunityRelayAuth` and signer-rejection handling.
- Add controlled socket/AuthState transition tests.
- Add relay profile refresh lifecycle and direct policy merge semantics.
- Add finite filter-array fallback and reversible session learning.
- Record `max_limit` for later pagination consumers.

### Verification

- Focused community auth, policy, and Welshman patch tests.
- `pnpm check`.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion for this phase.
- Update the checkpoint before committing with completed evidence, verification, changed files, next phase, next exit criteria, next action, and risks.
- Commit and push the phase, then reread the checkpoint.
- Do not stop at the phase boundary unless blocked or complete.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 3: Community Discovery And Completeness

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Ensure historical rooms, threads, calendar events, and goals are discoverable and never converted to absence merely because a request queued, timed out, disconnected, or was rejected.

### Exit Criteria

- Community startup performs finite historical discovery for room/thread roots and targeting wrappers after authority bootstrap.
- Existing calendar/goal wrappers trigger exact finite original hydration through repository-backed follow-up.
- Feature loaders explicitly use finite priorities and publish partial events immediately.
- Queueing, loading, complete, incomplete, and failed states are distinguishable where route empty/not-found decisions depend on them.
- Calendar/goal hydration does not mark completion on timeout.
- Detail routes do not display authoritative not-found until required relay reads complete successfully.
- Failed required-auth relays are excluded per operation without blocking healthy public relays.
- Incomplete authority evidence does not silently reject otherwise valid content as definitively unauthorized.
- Room menu/home/detail author rules agree.
- Focused room/thread/calendar/goal loading tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

### Steps

- Add grouped finite root/wrapper discovery to community layout/core helpers.
- Thread status-aware results through feature hydration and empty-state logic.
- Correct calendar and goal completion bookkeeping and bounded retry.
- Align room authorization and error-state behavior.
- Add cold-load and starvation-regression coverage.

### Verification

- Focused community live/state/feed and feature tests.
- `pnpm check`.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, update and advance the checkpoint, commit, push, and reread the checkpoint.
- Continue immediately unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 4: Activity Coordinator And Immediate Duplicates

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Remove per-component persistent activity requests and immediate duplicate community/repo live requests.

### Exit Criteria

- `EventActivity` is repository-driven and registers with one route-scoped activity coordinator.
- Historical activity is finite/background; post-mount activity is grouped by compatible `#E`, `#A`, and `#a` references.
- Community routes covered by core `COMMENT #h` open no extra activity live ID.
- Group replacement uses fixed route `since`, overlap, and make-before-break without gaps.
- `CommunityMenu` opens no duplicate room-root live subscription.
- Git issue-label prefetch is finite and closes at EOSE.
- One hundred covered community activity components add zero persistent IDs; uncovered compatible components use bounded grouped IDs.
- Focused tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

### Steps

- Add route-scoped activity registration, finite hydration, grouped live ownership, and cleanup.
- Convert `EventActivity` to repository derivation plus registration.
- Remove menu live ownership and fix issue prefetch lifetime/priority.
- Add grouping, teardown, fixed-since, and coverage suppression tests.

### Verification

- Focused activity, menu, issue, and scheduler tests.
- `pnpm check`.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, update and advance the checkpoint, commit, push, and reread the checkpoint.
- Continue immediately unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 5: Background Stream Consolidation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Bound app-wide notifications, repo watchers, repo foreground traffic, and widget updates by relay and ownership instead of source count.

### Exit Criteria

- Notification catch-up is finite and starts before grouped live monitoring.
- Community notification filters are partitioned by actual relay rather than broadcasting every community filter to every community relay.
- Foreground community coverage suppresses duplicate background community live traffic and restores it on route exit.
- Repo foreground and watcher traffic use one live owner per canonical repo/relay; ownership transfers safely.
- Repo persistent filters are bounded before installation and never partially install.
- Widget updates use explicit background-live classification and grouped/chunked targets.
- Primary navigation no longer bypasses intended background startup gating.
- Focused notification/repo/widget tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

### Steps

- Add shared relay-scoped background coordinators where current helpers duplicate load/live pairs.
- Partition community filters by relay and foreground coverage.
- Add repo foreground/background ownership registration.
- Bound widget update subscriptions and startup timing.
- Preserve source-specific repository-derived stores.

### Verification

- Focused notification source, repo watch, repo route utility, and widget update tests.
- `pnpm check`.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, update and advance the checkpoint, commit, push, and reread the checkpoint.
- Continue immediately unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 6: Extension Scheduling And Diagnostics

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Move extension subscriptions onto shared Welshman scheduling and expose enough ownership diagnostics to identify leaks and starvation.

### Exit Criteria

- Extension `nostr:subscribe` no longer creates a `SimplePool` per logical subscription.
- Logical extension IDs are preserved, events are matched only to original filters, and physical subscriptions are grouped by compatible relay/auth/failure domain.
- Extension detach/unload closes all owned subscriptions; SDKs use host-returned IDs.
- Extension relay-count and per-relay logical quotas are enforced.
- Extension traffic is classified as background live and respects shared policy/auth/byte/filter limits.
- Diagnostics expose active and queued IDs by finite/critical-live/background-live class, owner, age, filter count, notices, and queue delay.
- Bounded development warnings identify saturation, old queued priority work, and unexpected live growth.
- Focused extension/diagnostic tests, `pnpm check`, and `git diff --check` pass.
- Phase changes and checkpoint advancement are committed and pushed.

### Steps

- Implement an extension logical-subscription registry backed by Welshman requests.
- Correct bridge/SDK subscription ID and lifecycle handling.
- Export scheduler snapshots/events through a Budabit diagnostics module.
- Add ownership labels to major persistent request callers and bounded warning output.

### Verification

- Focused extension bridge/shared SDK and diagnostics tests.
- `pnpm check`.
- `git diff --check`.

### Mandatory Closeout

- Verify every exit criterion, update and advance the checkpoint, commit, push, and reread the checkpoint.
- Continue immediately unless complete or blocked.

### Continue

- If complete, perform the final response; otherwise immediately begin the next phase startup.

## Phase 7: End-To-End Validation And Upstream Preparation

### Phase Startup

- Read the session checkpoint.
- Read the entire session plan, including global objective, constraints, all phases, and this phase's closeout rules.
- Inspect current repository state before trusting either file.
- Restate this phase's goal and exit criteria briefly, then execute.

### Goal

- Prove the complete relay architecture under realistic load, document safe relay tuning, and isolate generic Welshman changes for upstreaming or a source fork.

### Exit Criteria

- Stress coverage proves cold community rooms, threads, calendar events, and goals load while maximum permitted live traffic is active.
- Public-relay requests remain at or below 9 managed IDs, 7 live IDs, 5 background-live IDs, 5 filters per ID, and 128 KiB.
- Timeout never produces authoritative absence in covered routes.
- Public relay sends no AUTH; required reads wait for terminal successful authentication.
- Full main tests, Svelte/type check, e2e type check, build, and whitespace checks pass, or a real blocker is recorded.
- Live public-relay probe passes when network access is available; otherwise the exact unrun verification is recorded.
- Architecture documentation records telemetry thresholds and recommends retaining server limit 10 until representative diagnostics justify 15.
- Generic Welshman changes and Budabit-specific policy boundaries are documented for upstream/fork extraction.
- Checkpoint says `Current Phase: Complete` with final evidence and residual risks.
- Final closeout commit is pushed and checkpoint is reread before final response.

### Steps

- Add/execute integrated stress scenarios and inspect diagnostic snapshots.
- Run broad verification and optional live relay probe.
- Update architecture documentation with measured limits, tuning gates, and upstream boundaries.
- Advance checkpoint to Complete, commit, push, and reread it.

### Verification

- `pnpm test -- --run`.
- `pnpm check`.
- `pnpm run e2e:check`.
- `pnpm run build`.
- `git diff --check`.
- Opt-in public relay probe when feasible.

### Mandatory Closeout

- Verify every exit criterion.
- Update the checkpoint to `Current Phase: Complete`, record final evidence, changed files, risks, and final-response next action.
- Commit and push final closeout changes.
- Reread the checkpoint and confirm it says Complete.
- Do not claim completion before that reread.

### Continue

- If the checkpoint says `Current Phase: Complete`, perform the final response.
- Otherwise immediately resume the unresolved phase or stop only for a recorded blocker.
