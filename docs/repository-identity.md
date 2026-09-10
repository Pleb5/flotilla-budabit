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

## PR/status compatibility

PR roots emit `b` for their immutable target branch, while reading older
`target-branch` roots. Conflicting or empty target tags block automatic merge.
`branch-name` continues to describe the source branch. Status relay hints live on
references, not in `r`; known merge/applied commits are indexed with `r`.
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

Verification on 2026-09-10 used the full development stack in this checkout at
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

Browser evidence uses controlled components, mock delivery/Git operations and
disposable identities, not live relay/GRASP creation. Cold-cache/PWA behavior,
real-account signer integration and live provider mutation were not verified.
No coordinate migration or new state-addressing convention is included. Existing
local path-sanitization behavior for unusual legacy identifiers is not redesigned
by this change; metadata edits preserve their raw `d` values.
