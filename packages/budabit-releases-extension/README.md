# Budabit Releases

A Svelte 5 repository-tab widget for discovering and publishing Nostr-signed software release metadata. Relay connections, account signing and storage are delegated to Budabit through the in-tree `budabit-sdk` workspace; private account keys never enter the widget.

Releases is maintained in the Budabit monorepo at
`packages/budabit-releases-extension`. Submit changes against Budabit `dev`.
See [import provenance](IMPORT.md) and the [workspace guide](../../docs/development/workspaces.md).

## What it verifies

- Application (`32267`) and release (`30063`) signatures, current repository owner/maintainer authorship, and exact repository/application coordinates.
- Addressable replacement order: newest timestamp, then lowest event ID on a timestamp tie, within each publisher's namespace. An open detail view stays subscribed: replacements update the view, and application revocation removes downloads.
- Pipeline run (`5401`) signer and artifact (`1063`) publisher delegation, checked for reuse across all discovered repository scopes of current maintainers. Artifacts are selected from **one run**, not voted across historical filenames.
- SHA-256 and optional size of an explicitly selected local file, up to 512 MiB. Creation requires a matching local copy for each selected artifact.

**A metadata signature is not a native/APK signature check, a signed Git tag, a reproducible-build guarantee, or proof that software is safe.** Downloads are not automatically fetched, executed or hashed. See [security and trust policy](docs/security.md).

Legacy releases without an exact application `a` link, or applications linked only by a repository URL/display name, are excluded rather than presented as trusted releases.

## Develop and verify

Requirements: Node **22.12+** (Jod), pnpm **10.12.4**. Install once from the
Budabit root; the root lockfile covers the widget and its local SDK.

```sh
pnpm install --frozen-lockfile  # from the Budabit root
pnpm dev:releases              # widget + local SDK watcher; normally embedded by Budabit
pnpm test:releases             # root Vitest project
pnpm build:extensions         # all widget and SDK outputs
```

For widget-only scripts, use `pnpm --filter budabit-releases-extension run <script>`
from the root, or change into this directory after the root install:

```sh
pnpm test                   # signed fixtures and domain regressions
pnpm typecheck              # Svelte-check, including component logic
pnpm test:coverage          # domain TypeScript coverage
pnpm build                  # packages/iframe-app/dist/index.html
pnpm exec playwright install chromium  # explicit one-time browser setup
pnpm e2e                    # builds and tests production HTML in a controlled host fixture
pnpm verify                 # lint, Svelte-check, coverage, build, browser tests
```

To use an already installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for `pnpm e2e`. The host fixture runs at `localhost:5179/test-host/`; automated tests fulfill its iframe navigation with the freshly built production HTML. Tests use disposable fixture identities and intercept external HTTP; they do not publish to real relays. `test-host/` is a separate development entrypoint and is not included in the production HTML.

Unit coverage measures executable domain TypeScript, not uninstrumented Svelte markup/CSS. Gates are 95% lines/statements/functions and 85% branches; component behavior is covered separately by Chromium flows. Coverage is not a substitute for the named trust and lifecycle regressions.

## Host compatibility

Use Budabit with bridge integration `c97928826`, independent relay-page fix `a8716cfb9`, **and atomic recovery storage `28ba443db`**, or an implementation of the [same wire contract](docs/host-bridge.md). `c97928826` alone could falsely report completeness because the shared Welshman loader deduplicated across relay pages. Older hosts lacking explicit query completeness show a partial-results warning and cannot initiate a new publication. Without atomic storage support, creation/recovery fails closed before signing; browsing remains available. Atomic storage requires Web Locks on the host origin (HTTPS or localhost). The actual repo-tab surface is supported; it must not be assumed identical to ordinary `WidgetFrame`.

The widget declares `nostr:sign`, `nostr:publish`, `nostr:query`, `nostr:subscribe`, **`nostr:unsubscribe`**, `storage:get`, `storage:set` and **`storage:compareAndSet`**, with kinds `32267, 30063, 3063, 1063, 5401`. Deploy the updated permission manifest as well as the HTML, and close/reload older widget and Budabit tabs before publishing; older code may still perform unconditional journal writes.

## Create a release

1. Sign in as a current repository owner/maintainer and wait for complete discovery.
2. Choose an existing application (including its publisher) or create one under your key.
3. Select a specific authenticated pipeline run. Verify local artifact copies, then select assets.
4. Review identifier/version, platform and APK metadata. Asset identifier/version may legitimately differ from the release. APKs require a version code and certificate SHA-256 metadata from a trusted inspection tool; the widget does **not** validate the APK certificate itself.
5. Submit. All fixed metadata templates are signed and checked first, then saved locally, then published in application → assets → release order.

Publishing is **not atomic**. On a partial/unknown outcome, return with the same account and use **Resume publication** to resend the saved event IDs without new signatures. Local acceptance markers are not treated as proof of relay persistence. Signing timeouts do not cancel a host signer prompt, but no events are published before all signatures are verified and the journal is saved.

Every publication attempt, including same-session retries, re-discovers current application authority. A saved application event participates in replacement reconciliation; it cannot override a newer revocation. Incomplete discovery or lost authority blocks publication. Invalid recovery data offers **Retry recovery** and a confirmed **Discard local recovery data** action. Discard affects only this repository/account's journal, does not undo published events, and loses identical-ID retry capability for that batch.

There is **one active recovery batch per repository/account**. Every preparation gets a distinct batch ID, and its initial save atomically claims an empty slot. Concurrent creators may both finish signing, but only the winner can start publication. Progress saves, completion and discard compare the exact observed storage revision; stale sessions cannot overwrite/delete a later batch or recreate a cleared slot. A conflict reloads recovery state and requires a new user action, including fresh discard confirmation. Existing valid journals remain resumable without new signatures.

The same application/version under your publishing key is one addressable release, even across different channels. Changing channel replaces that release; it does not create an independent channel namespace.

## Package the widget

```sh
pnpm build
WIDGET_APP_URL=https://your-cdn.example/releases/index.html pnpm manifest:generate
```

Manifest generation writes unsigned kind `30033` metadata to `dist/widget/` and makes no network publication. Host the built HTML on a **separate HTTPS origin** from Budabit. Explicitly run `widget:publish:*` commands when you intend to upload/sign/publish; the former standalone tag-publishing workflow is not active in the monorepo. Keep signer credentials in private environment/secret storage, never source files or generated public artifacts.

## Known bounds

- Up to eight relays, five 100-event pages per relay, inclusive timestamp cursors. Overflow at a shared second is reported incomplete instead of silently skipping events.
- Relay EOSE means completion of that bounded response, not global history completeness or proof that no newer revision exists elsewhere.
- Any incomplete discovery disables new publication and prevents starting/resuming a saved batch. Detail keeps unresolved asset IDs visible and offers retry; known application revocations invalidate even an already open detail view.
- Notes allow passive Markdown, not media or automatic third-party resource loads. HTTPS links open only on user activation.
- Legacy unlinked pipeline artifacts rely on a unique delegation within completed current-maintainer discovery across repositories, not a global guarantee that a publisher key has never been reused.
- Cached releases are hints, not application authority. See [storage](docs/storage.md).
- Native signatures, live signer services, CDN redirects in deployment, offline/PWA behavior and large real binary downloads require separate operational verification.

## Implementation guide

- [Architecture](docs/architecture.md)
- [Bridge contract](docs/host-bridge.md)
- [Lifecycle](docs/lifecycle.md)
- [Security](docs/security.md)
- [Storage](docs/storage.md)
- [Verification evidence](docs/verification.md)

NIP-82 interoperability targets the published draft event `68eaa1e4cde654ba098625e83f1a6828d87849f98c756fd385a93e0d6e36c78a` (kind `30817`, identifier `82`, published 2026-08-12). This is a draft, not a claim that NIP-82 is merged into the NIPs master repository.

License: MIT.
