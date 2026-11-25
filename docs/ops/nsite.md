# Publishing Budabit as an nsite (NIP-5A)

Budabit's static production build can also be served from Blossom through public
NIP-5A gateways. This is a second hosting channel for the same app, independent of
the shared web host behind `budabit.club`.

## Current site

| Field         | Value                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Site address  | `35128:0a8ecba4868c13e1e84cc5cb58c02c1fd0880d9e5a25a5050ee96ad8a166d7c8:club`                  |
| Signer        | BudaBit community key (same namespace as the `call` and `stream` nsites)                       |
| Blob server   | `https://blossom.budabit.club` (manifest `server` tag)                                         |
| Relays        | `wss://relay.budabit.club`, `wss://relay.nsite.lol`, `wss://nos.lol`, `wss://relay.primal.net` |
| Primary URL   | `https://09h14xrgpe560i6z2325fqp4f2i337l13kxrvka7he8wsrqkzsclub.nsite.run/`                    |
| Alternate URL | `https://09h14xrgpe560i6z2325fqp4f2i337l13kxrvka7he8wsrqkzsclub.nwb.tf/`                       |

The label is the 50-character base36 community pubkey followed by the `d` tag.

## What is published

`scripts/nsite-manifest.mjs` turns `build/` into unsigned templates:

- one kind `35128` manifest mapping every path to its SHA-256 blob hash, with the
  NIP-5A aggregate `x` tag, `server`, `title`, `description`, and `source` tags;
- optionally one kind `5128` snapshot of the same paths (`--snapshot`).

Source maps, `.htaccess`, and `.well-known/*` are excluded. This matches the
service worker's precache filter, so its all-or-nothing install still succeeds.
`/404.html` is mapped to the SPA shell because NIP-5A gateways serve `/404.html`
for unknown paths, which makes first-visit deep links work.

Blossom stores the MIME type sent at upload and gateways forward it. `nak` derives
the type from the file extension, so `.webmanifest` is uploaded through an
identical `.json` staging copy (same hash, `application/json`).

## Release procedure

Build exactly like `scripts/deploy-main.sh` (production URLs, diagnostics off) from
a committed, clean checkout, adding `VITE_APP_UPDATE_MODE=auto` (see "Updates
without a button" below). Then:

```bash
# Previous manifest, so old tabs can still lazy-load their content-hashed chunks.
nak req -k 35128 -a <pubkey> -d club wss://relay.budabit.club | head -1 > previous.json

node scripts/nsite-manifest.mjs --build build --pubkey <pubkey> --d club \
  --out /tmp/budabit-nsite --server https://blossom.budabit.club \
  --title "BudaBit.club" --description "... <commit> ..." \
  --source https://github.com/Pleb5/flotilla-budabit.git \
  --previous previous.json --snapshot --gateway nsite.run --gateway nwb.tf

# Upload only missing blobs, in one signed nak process.
nak blossom -s https://blossom.budabit.club check $(cat /tmp/budabit-nsite/hashes.txt)
nak-account run --as <alias> -- blossom -s https://blossom.budabit.club upload <missing files...>

# Sign and publish the manifest (and snapshot) in one process.
{ jq -c . /tmp/budabit-nsite/manifest.template.json; jq -c . /tmp/budabit-nsite/snapshot.template.json; } |
  nak-account run --as <alias> -- event <relays...>

# Byte-for-byte gateway check of every path, plus deep links.
node scripts/check-nsite-gateway.mjs signed-manifest.json nsite.run
```

Upload `uploads.tsv` column 4 (the staged path), not the build path, for
`.webmanifest`. Verify every blob is present before signing the manifest. Read
the events back from each relay and check their signatures afterwards.

## Updates and atomicity

A NIP-5A v2 manifest is a single signed event, so a release switches every path at
once: there are no independently replaceable per-file events. Blobs are immutable
content hashes. Gateways still cache:

- nsite.run serves cached manifests and refreshes in the background;
- some gateways cache individual responses (for example `max-age=3600`).

An open tab or a stale cached shell can therefore request the previous release's
chunk paths after an update. Keep previous blobs on Blossom and pass `--previous`,
so the new manifest still maps the old `/_app/immutable/*` paths. The service
worker only installs a complete, version-matched cache and serves navigations from
it.

Rollback means publishing a new manifest containing the older path map. Never
delete release blobs while a published manifest, snapshot, or open client may
still need them.

## Updates without a button

nsite builds set `VITE_APP_UPDATE_MODE=auto`. Other builds keep the Reload prompt.

In auto mode, an open page detects and downloads the new build in the background:
`/_app/version.json` is checked every 30 seconds and on focus, visibility, and
reconnect. The downloaded build waits; the page shows no prompt and is never
replaced while in use. The prepared build is applied only at the next startup
(new tab, reload, link open, or browser restart). This happens before the app
renders: no page, widget iframe, wallet, signer, or session has started in that
document yet. It is skipped unless all of these hold:

- the page is visible and has had no input: pointer, touch, keys, IME
  composition, input, click, focus, paste, drop, or context menu;
- no reload is already in progress, this tab has no prepared local broadcast
  (restored from session storage), and this build was not already attempted in
  this tab;
- the waiting build is still the published `/_app/version.json` build;
- the waiting service worker reports, at activation time, that this page is the
  only window of the site.

Otherwise the running build continues. The prepared build waits for a later
qualifying startup, or the browser activates it once no window of the site
remains open.

Limitations:

- A returning visitor's first startup after a release usually runs the previous
  build while the new one downloads; the following startup applies it. First-time
  visitors load the published build directly.
- Builds published before auto mode (including `3599d872c-20261125172754`) keep
  their Reload prompt. Their users move to an auto-mode build after tapping
  Reload, or once every tab of the site has been closed. The auto-mode build
  then handles later releases.
- Activation still makes every older window of the site reload. The
  single-window check narrows this to windows that open during activation
  itself, which are fresh. A page held in the back/forward cache is not a
  window client. As with any service-worker activation, it can be evicted and
  reload when revisited.
- A waiting worker from a build without this handler never answers, so nothing
  is applied automatically.

## Gateway findings (2026-11-25)

| Gateway                               | Result                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nsite.run                             | Works. It adds a CSP without `wasm-unsafe-eval`: `nostr-wasm` falls back to JS, but Pomade/Argon2id (hash-wasm) login cannot run. It serves a stale, pubkey-wide cached `/favicon.ico`. Snapshot labels redirect to its homepage. |
| nwb.tf                                | Works, with no injected CSP. Snapshot labels return 404.                                                                                                                                                                          |
| nsite.lol                             | Broken for this origin. Blossom returns `gzip`/`zstd` with a compressed `Content-Length`. nsite.lol decompresses but forwards that length, which truncates JS, CSS, and HTML. It supports snapshot labels.                        |
| nosto.re, nsite.cloud, shakespeare.to | Not serving these named sites (502, 530, and 404).                                                                                                                                                                                |

Neither working gateway percent-decodes `/fonts/Satoshi%20Symbol.ttf`. The
`Satoshis` font face is currently unused, so this has no visible effect.

## Origin differences

Every gateway is a different browser origin from `budabit.club` and from the other
gateways:

- login state, local storage, IndexedDB, and the service worker are separate on
  each origin, so users sign in again;
- an unreachable origin cannot redirect itself. A returning visitor with an
  installed service worker still gets the cached shell; new visitors need an
  alternate link;
- `corsproxy.budabit.club` allows only Budabit origins, so browser Git-over-proxy
  requests fail on gateway origins;
- `calls.budabit.club` limits `frame-ancestors` to Budabit origins. Embedded calls
  are blocked, but the call widget's new-tab join and the standalone call nsite work;
- `VITE_APP_URL`/`VITE_PLATFORM_URL` stay `https://budabit.club`, so share,
  digest, and alert links point at the canonical domain.
