# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-30

### Workflows compatibility and NIP-82 packaging

- List GitHub, GitLab and Gitea releases of the repository named by the announcement's `clone`/`web` URL on their own tab beside the Nostr releases, in the same card layout, marked unverified and never part of authority, read over unauthenticated HTTPS (public repositories, no tokens). Maintainers can import one: the release form is prefilled (version from tag, notes, assets with download URLs, NIP-82 MIME/platform classification); a forge-published checksum (GitHub asset `digest`) fills `x`, otherwise the download or a local copy is hashed in the widget. `assets.ts` now recognises architecture tokens containing separators (`x86_64`, `armeabi-v7a`), which it previously split apart and missed, and guesses nothing when a filename names an OS the MIME type cannot target.
- Stop disabling publication when some relays are unreachable. Discovery proceeds on the relays that answered; relays that did not are named in a non-blocking notice stating that releases known only to them are not shown and that a new publication will not reach them. Publication is disabled only when no relay completed. Previously one dead relay in the repository's declared set (Amber's `wss://relay.mostr.pub` is a permanent HTTP 301) disabled publication for every user forever.
- Show store-published applications and releases. Applications no longer need an `a` link to the Budabit repository coordinate (zapstore/`zsp` never write one): a maintainer-signed application is shown when it binds itself here or when its `repository` URL is one of the announcement's `clone`/`web` URLs, so a maintainer's other applications stay out of this repository. Releases resolve their application by `i` when the `a` coordinate is absent, as zapstore's current publisher omits it; a present coordinate must agree. Previously every real zapstore app (e.g. Amber) was rejected and the widget listed nothing.
- Discover and publish on the relays the repository announcement declares (NIP-34 `relays`) plus the store relays, instead of the relay hints the host derives from the naddr. Hints only locate the announcement (kind `30617`, now declared in the manifest); an unreachable hint no longer blocks the release history or publication. If the announcement cannot be read — including on hosts still running a manifest without kind `30617` — the host's hints stay in use and the reason is logged to the console.
- Remove `wss://nos.lol` from the discovery relays: it never sends EOSE for any subscription, so the host reported it as timed out on every load and the widget showed "Relay results are incomplete" and disabled publication regardless of results. An incomplete result now names the relays the host reports as timed out or failed instead of a generic message.
- Discover runs and artifacts on `wss://relay.budabit.club`, accept runs referencing the repository by its legacy `30618` state coordinate, and accept runs pinned to a branch head (empty or absent `commit` tag, as the Workflows tab writes it); a present `commit` must be a full SHA.
- Accept maintainer co-signed kind 1063 attestations produced by the Workflows tab's Attestations view: a copy of a worker hash is folded into that artifact (`attestedBy`), a maintainer-only hash referencing exactly one authenticated run becomes its own artifact. Outsider copies are ignored.
- Add `assets.ts`: NIP-82 Appendix A/C classification. Infer the MIME type and platforms of CI artifacts from their filenames, refuse generic archives, `.deb`/`.rpm` packages, unknown platform identifiers, platform/MIME mismatches and native executables without an `f` tag, and warn about unclassified MIME types. The artifact selector exposes MIME/platform controls and blocks non-conforming selections; `buildAssetEvent` re-checks before signing.
- Publish store-listing metadata on kind 32267 (summary, description, icon, screenshots, website, repository, license, tags, derived `f` platforms) for new applications and for updates of applications the signing account owns.

### Packaging

- Include the release version and changelog in the widget manifest so Budabit can display update details for the existing `budabit-releases` widget.

## [0.1.0] - 2026-09-11

### Security and correctness

- Protect publication recovery across tabs with distinct batch identities and host-atomic compare-and-set (`28ba443db`). Initial save cannot replace an active batch; stale progress, completion and discard cannot damage a later one. Conflicts refresh recovery state and reset discard consent. Add shared-backend and real cross-tab Web Locks regressions; require the new `storage:compareAndSet` manifest permission and preserve legacy signed-ID recovery.
- Keep asset loading and local-file checks stable during unrelated live authority updates by sampling authority without subscribing the detail effect to the whole list. Preserve replacement/revocation checks and clear canceled verification status on explicit asset retry; production-browser regressions cover input identity, query counts and delayed hash completion.
- Correct the host completeness dependency: relay pages need isolated Welshman loader/tracker instances (`a8716cfb9`); shared-loader deduplication could conceal older history.
- Keep application/release authority live while detail is open, update replacements and remove revoked downloads, including during delayed asset resolution.
- Reuse only immutable, internally verified events and coalesce live updates; a 250-event regression now performs 250 signature checks rather than 31,875.
- Re-discover application authority before every publication/resume attempt, including embedded application journals and same-session retry; reconcile newer revocations first.
- Add retry and confirmed scoped discard for invalid publication recovery data, preserving it on cancellation/storage failure and warning that remote publication is not undone.
- Check publisher delegation reuse across current maintainers' repository scopes before accepting legacy pipeline artifacts.
- Restrict notes to passive Markdown elements/attributes; Chromium tests verify media/poster markup causes no automatic third-party requests.

- Verify Nostr signatures and current maintainer authority with exact repository/application coordinates; reject unlinked legacy releases and cross-repository heuristics.
- Reconcile addressable revisions by publisher/d-tag and process linkage revocations.
- Authenticate pipeline run signers and publisher delegations; select one run instead of historical filename voting.
- Preserve independent asset identity/version, filenames, platforms and APK metadata; expose bounded local-file SHA-256 checking without claiming native-signature verification.
- Pin signer/repository scope, sign all templates first, and resume a locally saved fixed-event publication after partial outcomes.
- Handle logout/context changes, late subscription startup/disposal, partial relay pages and unresolved assets explicitly.
- Correct unsubscribe permission, host sandbox/origin expectations and manifest URL expansion.

### Verification and packaging

- Replace scaffold tests with signed domain fixtures and controlled-host Chromium flows.
- Use Svelte-check; measure executable domain coverage separately from browser-tested Svelte markup.
- Require Node 22.12+, cover the master branch in CI and use supported artifact/cache actions.
- Document the actual Budabit repo-tab/SDK 0.2 wire contract and security limits.

### Added

- Initial project scaffolded with `create-budabit-widget`
- Svelte 5 iframe app with bridge protocol demo
- Smart Widget manifest generation via `budabit-sdk`
- Unit tests (Vitest) and E2E tests (Playwright)
- CI/CD pipeline with GitHub Actions
- Publishing workflows (Blossom, GitHub Releases, manual)
