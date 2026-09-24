# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

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
