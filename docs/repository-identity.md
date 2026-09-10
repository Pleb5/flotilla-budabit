# Repository identity and metadata

Budabit treats `30617:<owner-pubkey>:<identifier>` as the repository's exact identity.
The `name` tag is a display name, not an identifier. Older announcements without a
`name` display their `d` value. Settings expose `d` read-only: changing the display
name does not rename Git hosting, move local storage, change links, or migrate
issue/PR references. Historical coordinate-rename records remain readable.

Only the owner edits the announcement/settings/maintainer list. Repository state
and applied/resolved statuses retain the owner-or-directly-declared-maintainer
policy. Upstreams, EUC, other announcements, and verification badges do not extend
that authority or combine different coordinates.

## Creating and forking

- New repositories have a display name and an editable identifier. A deterministic
  ASCII suggestion (`My Great Repo!` → `my-great-repo`) stops following the name
  after a manual identifier edit. Unsupported suggestions require a chosen ID;
  there are no random or incrementing collision suffixes.
- Availability checks are scoped to the owner, configured relays and selected
  hosting destinations. An existing announcement, owner state, local repository,
  or unresolved recorded creation blocks a fresh create. Unknown checks do not
  prove availability. Same-window duplicate protection is not a global reservation.
- A genuine fork records its immediate source in `u`; conventional Git sources
  can use their Git URL. Adding hosting at the same owner/identifier preserves
  existing metadata and upstreams rather than adding a self-upstream.
- Independent forks retain the existing inherited-maintainer defaults for review,
  by product choice. These permissions come from the new owner's declaration,
  not from the upstream relationship itself.
- Settings preserve unrelated raw tags and content. Dirty forms reject newer
  announcements instead of overwriting them; publication rechecks the actor and
  draft before signing and delivery. Metadata-only edits publish no state. An
  intentional default-branch edit preserves the signed ref map and ancestry.

## Identity at integration boundaries

- Overview-generated `nostr://` clone URLs use the exact announcement `d`, not
  display text or a sanitized local path.
- Extension instance IDs, context IDs, repository addresses and storage namespaces
  use the owner/identifier coordinate. The legacy extension fields `name` and
  `repoName` mean the identifier; `displayName` and `repoDisplayName` expose display
  text separately. Pushed and polled contexts stay synchronized after metadata edits.
- Repo and local branch-discovery workers share `getRepoStorageKey`. This retains
  the existing conventional hex-owner and GRASP npub-owner storage conventions.
- Entries previously written under incorrect display-name extension namespaces
  are left untouched; there is no automatic migration or combining of those keys.
- New Repo and fork preflight check both local owner-key conventions, regardless
  of the newly selected host. An unavailable local check does not prove absence.

## Interrupted creation and hosting

`/git` shows pending repository operations for the active owner. Recovery uses the
journal's exact owner and identifier for announcement and state publication,
including opaque legacy identifiers containing `:` or `/`. It validates saved
events before replay or cleanup and rechecks the account before delivery. A saved
event with a different owner or identifier stays pending for manual resolution;
recovery never changes a signed event's identity to make it fit.

- **Metadata preparation** is distinct from **signed delivery**. New journals use
  `metadata-preparing` until an exact final pair exists. Older `metadata-pending`
  journals with zero or one final event also enter preparation safely.
- Each returned signed event and its relay receipts are saved before continuing.
  An active-pair record keeps archived attempts from being mistaken for a newly
  completed pair. Failed delivery retries reuse saved signed payloads.
- Before generating replacement metadata, recovery checks current exact-coordinate
  owner announcements on the recorded/source relays. Timeouts block replacement.
  If owner metadata changed, the operation enters `metadata-review` without
  discarding completed target receipts or repeating Git creation/push operations.
- Expand **Review current owner metadata**, inspect the name, maintainers,
  upstreams and full announcement, then choose **Use current metadata and finish
  hosting**. This applies only verified hosting changes to the reviewed owner
  announcement, preserving its content and unrelated tags. Another owner edit
  invalidates that approval; freshness is checked before signing and delivery.
- Exact signed-pair retries do not mint newer timestamps. If partial relay ACKs
  require a new relay-pruned replacement, the same freshness/review guard applies.

These checks are scoped to the available relay evidence, not a global Nostr lock.
Unknown Git outcomes and mismatched legacy journals still require manual attention.
Recovery does not delete an unresolved journal merely to unblock a fresh creation.

## PR/status compatibility

PR roots emit `b` for their immutable target branch, while reading older
`target-branch` roots. Conflicting or empty target tags block automatic merge.
`branch-name` continues to describe the source branch. Status relay hints live on
references, not in `r`; known merge/applied commits are indexed with `r`.
Runtime schemas accept both target-tag forms and hinted status references. The
maintainer-branch fork filter uses the shared target parser/resolver, excludes
ambiguous targets, and does not infer historical targets from today's default branch.
Kind-1624 description behavior and the custom label-removal `del` marker are unchanged.

## Unresolved state-addressing limitation

State replacement keys remain `(30618, signer, d)`. If Bob maintains both
Alice/project and Carol/project, Bob's two states collide at `30618:Bob:project`.
Adding a target `a` tag would not change that relay replacement key or recover an
event already replaced. This work introduces neither a new state-key convention
nor announcement merging; full coexistence needs a separate protocol decision.

## Verification

Focused core/UI Vitest tests cover metadata round-trips, fork provenance,
creation preflight, and PR/status tags. `tests/e2e/repository-identity.spec.ts`
uses the development-only `repository-identity.svelte.ts` component fixture;
its settings publisher records events in memory without real signatures, relay
publication or Git writes. Import regression fixtures also keep delivery/Git
operations mocked and use only a disposable test identity.

Initial verification on 2026-09-10 used the full development stack in this checkout at
`http://localhost:1847`, including current Git-package watcher output:

- Core, UI and app typechecks pass; `git diff --check` passes.
- Focused unit runs: core **110 passed / 3 existing failures**, UI **190 passed /
  4 existing failures**, app **118 passed / 4 existing failures**.
- All 11 failures reproduce against archived pre-change source using the installed
  dependencies. Ten concern relay-normalization expectations; one source-contract
  test expects two old publication call sites where the baseline has one. These
  comparisons are not a fully isolated historical dependency installation.
- All **14 targeted Chromium browser tests pass** (21.5 seconds). They cover display-only settings edits, upstream removal,
  owner/stale-draft guards, exact payload retries after partial/lost delivery,
  manual creation identifiers and unknown availability, import recovery after
  reload, and independent-fork versus same-coordinate hosting controls.
- Dedicated warm-browser visual checks include 390×844 settings/hosting forms.
  The hosting form retains its exact identifier and makes its display name
  read-only. No horizontal clipping was observed in those forms.

### Independent-review follow-up (2026-09-10)

The initial tests missed runtime validation, extension context/storage, overview
clone URLs, local branch paths, and the maintainer-branch target reader. All five
review findings were confirmed and corrected. A new route-level test also exposed
a stale polled extension context caused by a Svelte state proxy; the route now
shares the same unproxied instance with its bridge.

- Follow-up focused unit runs: core **119 passed / 1 existing TODO**, UI **44
  passed**, app **127 passed** (**290 passed**, no failures in this selection).
  The earlier unrelated baseline failures above were not bundled into this fix.
- Core/UI/app typechecks pass; `git diff --check` passes.
- **17 targeted Chromium tests pass** (31.1 seconds, two workers), including the
  original 14 and three new real-route regressions in
  `tests/e2e/repository-identity-integration.spec.ts`: builder-emitted `b` PR list
  and detail acceptance, clone-URL stability across renames, and extension
  address/storage isolation across renames, remounts and equal display names.
  An earlier four-worker run passed 16 tests but timed out once on the existing
  `/git` fixture's initial `New Repo` readiness check; no timeout was increased.
- New route tests use anonymous sessions, publicly known disposable fixture
  signatures, mocked relays/HTTP and a local fixture iframe. Cache insertion does
  not call the app's signing or relay-publication transport.
- A dedicated warm 390×844 overview check confirmed the exact clone URL after a
  Unicode display rename, with no outer horizontal overflow or page exceptions.
  That check used an injected fixture announcement; relay disconnect warnings
  are not live-service or Git-content verification.

Browser evidence uses controlled components, mock delivery/Git operations and
disposable identities, not live relay/GRASP creation. Cold-cache/PWA behavior,
real-account signer integration and live provider mutation were not verified.
No coordinate migration or new state-addressing convention is included. Existing
local path-sanitization behavior for unusual legacy identifiers is not redesigned
by this change; metadata edits preserve their raw `d` values.
