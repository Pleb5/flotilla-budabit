# Releases widget manifest

`pnpm manifest:generate` uses the locked SDK CLI to generate unsigned kind `30033` metadata in `dist/widget/`:

- `d`: `budabit-releases`
- type: `tool`
- title: Releases
- version: `0.2.0`, with a `changelog` summary for Budabit's widget update dialog
- icon: the hosted package/download artwork in [`assets/`](../assets/README.md), overridable with `WIDGET_ICON_URL`
- slot: `repo-tab`, label Releases, path `releases`
- app URL: `WIDGET_APP_URL`, defaulting to `http://localhost:5173` for development
- permissions: `nostr:sign`, `nostr:publish`, `nostr:query`, `nostr:subscribe`, `nostr:unsubscribe`, `storage:get`, `storage:set`, `storage:compareAndSet`
- Nostr kinds: `32267`, `30063`, `3063`, `1063`, `5401`, `30617` (repository announcement, read for its NIP-34 `relays`)

Each permission/kind is emitted as an individual `permission`/`nostrKinds` tag. The launch `button` tag carries the app URL. Production URLs must be HTTPS and should use an origin separate from Budabit.

```sh
WIDGET_APP_URL=https://your-cdn.example/releases.html pnpm manifest:generate
```

Generation is offline and does not sign or publish. The offline regression tests validate app/icon URL expansion, the default icon URL against the checked-in PNG's SHA-256, and exact permissions/kinds against actual CLI output. Publishing the widget is distinct from publishing software-release metadata inside the widget. Both require an explicit user action.

For a release, bump both package versions and the manifest's `--version` and `--changelog`, then publish a newer event using the same publisher and `d` identifier. Existing installations apply it through **Settings → Extensions → Update widget**, then close and reopen Releases. The update includes the current permissions and Nostr kinds as well as the new HTML URL.

Use an HTTPS image URL for custom artwork. The old `Tag` value was not a supported name in Budabit's `ExtensionIcon` renderer and displayed the generic puzzle fallback. The custom PNG works without a host update. An icon-only publication should replace the same publisher's kind `30033`/`d` coordinate while preserving the app URL, permissions, and community-targeting reference; it does not require redeploying the HTML or publishing a new community-targeting event.

On the supported host, declared write kinds constrain generic signing and publication. Do not assume that older Budabit versions enforce write-kind restrictions merely because the manifest declares them.

## Published 0.2.0 — 2026-09-30

- Publisher: Five, `d04ecf33a303a59852fdb681ed8b412201ba85d8d2199aec73cb62681d62aa90`.
- Widget event: `2d76c31510201ea7c087f55efbf14798248712ce3543c084e3af5179db424705`, kind `30033`, `d=budabit-releases`.
- Relay: `wss://relay.budabit.club`; success acknowledgement and independent exact-ID/address readbacks matched the signed event.
- [Production HTML](https://blossom.budabit.club/3d6298f0d7606d9136b963b95d32e0ebf3347452b303506d75d23ea36ac29cdd.html): 350,764 bytes, SHA-256 `3d6298f0d7606d9136b963b95d32e0ebf3347452b303506d75d23ea36ac29cdd`. HTTPS response bytes matched the production build, with `text/html` and no redirect or frame-blocking headers.
- The existing BudaBit community target `8dd6605ed5142fea81cc3cc4ea1ca5d94300030f6a3d1f154157225d1c5d7f3f` references the same widget address; its signature and community/source links were rechecked.

Release checks passed: lint, Svelte-check (zero errors/warnings), 91 unit tests, coverage gates (97.75% lines/statements, 97.16% functions, 88.59% branches), production build, and four focused Chromium regressions covering packaging, pipeline publication/recovery, live detail authority, and forge import.

A dedicated cold browser loaded the live Blossom HTML cross-origin in the repository's synthetic host fixture (initial navigation 1.819 seconds). The GitHub tab displayed 30 live Amber releases and importing `v6.6.6` prefilled its version, notes and classified assets. Screenshots were inspected; browser console/errors were empty and fixture signing/publication counts stayed zero. This verifies the hosted widget with a synthetic bridge and live read-only forge data; authenticated production-host installation and software-release publication were not exercised.
