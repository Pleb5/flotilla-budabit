# Self-Hosting Budabit

This is the no-BS path for running your own Budabit.

Budabit is a static SPA/PWA. You do not need to run your own email service, Anchor stack, or other backend just to get the app online.

The current architecture is community-first. A deployment can point at a default Communikey community, but the deployment itself is not the community identity. Community identity comes from a community pubkey and its latest `kind:10222` definition event. That definition provides community relays, Blossom servers, sections, and write-permission list references.

## Fast Path

```sh
git clone https://github.com/Pleb5/flotilla-budabit.git budabit
cd budabit
git submodule sync --recursive
git submodule update --init --recursive
pnpm run build-in-production
```

Upload the contents of `build/` to your host.

That is enough for a basic deployment.

## Minimum `.env`

For a community-first deployment, create `.env` in the repo root. Use `.env.example` as the full reference. A practical deployment starts with:

```env
VITE_APP_URL=https://your-domain.com
VITE_APP_NAME=Your Budabit
VITE_APP_ACCENT=#0f766e
VITE_APP_ACCENT_CONTENT=#ecfdf5
VITE_APP_LOGO=https://your-domain.com/logo.png
VITE_DEFAULT_COMMUNITY=npub1...
VITE_INDEXER_RELAYS=wss://relay-1.example.com,wss://relay-2.example.com
VITE_SIGNER_RELAYS=wss://relay.damus.io,wss://nos.lol
VITE_GIT_RELAYS=wss://relay.ngit.dev,wss://gitnostr.com
VITE_DEFAULT_PUBKEYS=hexpubkey1,hexpubkey2
```

Notes:

- `VITE_APP_URL` should be the final public URL of the app.
- `VITE_APP_NAME`, `VITE_APP_URL`, and `VITE_APP_LOGO` provide runtime app metadata. `VITE_APP_LOGO` is also used as the source for generated PWA assets.
- `VITE_APP_ACCENT`, `VITE_APP_ACCENT_CONTENT`, `VITE_APP_SECONDARY`, and `VITE_APP_SECONDARY_CONTENT` control the DaisyUI theme colors.
- `VITE_DEFAULT_PUBKEYS` is worth setting even if `.env.example` makes it look optional.
- `VITE_DEFAULT_COMMUNITY` should be a community hex pubkey, `npub`, or `ncommunity` value. `ncommunity` relay hints are used first.
- `VITE_INDEXER_RELAYS` should include relays that can resolve the default community profile and `kind:10222` definition before the app knows that community's own relays.
- `VITE_SIGNER_RELAYS` are used for NIP-46 signer discovery.
- `VITE_GIT_RELAYS` are used for top-level `/git` repository discovery and Git-related Nostr events. Community repository catalogs are still selected through `/c/<community>/git` and targeted publication events.

`build.sh` currently post-processes generated HTML and `manifest.webmanifest` from `VITE_PLATFORM_NAME`, `VITE_PLATFORM_SHORT_NAME`, `VITE_PLATFORM_DESCRIPTION`, `VITE_PLATFORM_ACCENT`, and `VITE_PLATFORM_URL`. Set those too if you need install-card, Open Graph, and manifest metadata to differ from the built-in Budabit defaults. Runtime metadata still comes from `VITE_APP_*`.

Optional but useful for community media:

```env
VITE_DEFAULT_BLOSSOM_SERVERS=https://blossom-1.example.com,https://blossom-2.example.com
```

Community-specific Blossom servers should live in the community `kind:10222` definition. `VITE_DEFAULT_BLOSSOM_SERVERS` is a fallback, not community identity.

Optional widget discovery:

```env
VITE_SMART_WIDGET_RELAYS=wss://relay.yakihonne.com,wss://relay.sharegap.net,wss://nos.lol
```

If this is empty, Budabit uses built-in widget relay defaults for direct widget lookups. Default extensions are loaded from `VITE_DEFAULT_COMMUNITY`: the app validates that community's latest `kind:10222` definition and shows its curated `kind:30033` widgets as installed and enabled. Users can disable those defaults but cannot uninstall them. Additional direct `naddr` installs live under Settings > Extensions > Advanced.

## Community Definition Checklist

Self-hosting Budabit does not create a community by itself. Before setting `VITE_DEFAULT_COMMUNITY`, make sure the community pubkey has public Nostr state that Budabit can resolve:

- A `kind:0` profile with name, about, website, and picture for the recommended community card and community pages
- A latest `kind:10222` Communikey definition authored by the community pubkey
- `r` relay tags in the definition for community reads and writes
- `content`, `k`, and `a` tags for the sections you want to expose and their `kind:30000` profile-list write permissions
- Optional `blossom` tags for community-owned media storage

Relays are infrastructure, not identity. Do not configure a deployment as if one relay URL is the community. The app routes community state through `/c/<community>`, where `<community>` is parsed as a hex pubkey, `npub`, or `ncommunity` value.

## Optional Alerts

External email digests and web push alerts are disabled by default with `FEATURE_ALERTS=0`. That is the current expected self-hosting mode.

In-app unread badges and notification sounds do not require notifier values and remain available without `FEATURE_ALERTS=1`.

Set `FEATURE_ALERTS=1` only if you want to expose external alert delivery setup, then configure:

```env
VITE_NOTIFIER_RELAY=
VITE_NOTIFIER_PUBKEY=
VITE_NOTIFIER_HANDLER_ADDRESS=
VITE_NOTIFIER_HANDLER_RELAY=
VITE_VAPID_PUBLIC_KEY=
```

If these values are absent while `FEATURE_ALERTS=0`, users still get in-app indications for new activity.

## Optional Account Service

Budabit does not need an account backend for normal Nostr-signer use. If you run a hosted email/password account service, set:

```env
VITE_BURROW_URL=https://your-burrow.example.com
```

Leave it empty to hide those flows.

## Hosting Requirements

Any static host is fine if it can do SPA fallback.

Requirements:

- Serve the app from the domain root, like `https://your-domain.com/`
- Rewrite unknown routes to `/index.html`
- Do not strip the generated `.htaccess` if you use LiteSpeed or Apache

### Apache / LiteSpeed

The generated `build/.htaccess` already handles:

- SPA rewrites
- cache rules for hashed assets
- no-cache/no-store for `service-worker.js`, `sw.js`, `manifest.webmanifest`, and `_app/version.json`
- CORS headers for `/.well-known/`

If you are on Apache, upload `build/` as-is.

On shared hosting, prefer Apache/PHP-FPM over OpenLiteSpeed for Budabit unless you have verified the headers below. We have seen OpenLiteSpeed/LSCache serve correct files while ignoring or overriding `.htaccess` `Header` and `AddType` rules. Symptoms include `/settings` returning `200`, but `service-worker.js` and `sw.js` still getting a positive `max-age`, `manifest.webmanifest` being served as `application/octet-stream`, and `/_app/immutable/*` missing the long immutable cache header.

If your host has these toggles, use:

- Apache/PHP-FPM enabled
- LSCache disabled
- Force HTTPS/SSL enabled

Some shared hosts override or ignore parts of `.htaccess`. After deployment, verify the live headers:

```sh
node scripts/check-deploy-cache.mjs https://your-domain.com
```

If this fails, fix the hosting-panel cache rules before trusting app updates. `.htaccess` changes normally apply immediately; repeated failures usually mean the web server or host-level cache is ignoring or overriding those directives.

### Other Static Hosts

Set the equivalent rule:

- if request matches a real file, serve it
- otherwise serve `/index.html`

If your host cannot do SPA fallback, direct links like `/settings`, `/git/...`, or `/c/...` will break.

## Container Runtime

The included Dockerfile builds the static app and serves `build/` with `serve` in SPA mode.

```sh
podman build -t budabit .
podman run -d --name budabit -p 1847:1847 budabit
```

The runtime image defaults to `PORT=1847`. Override it if needed:

```sh
podman run -d --name budabit -e PORT=3000 -p 3000:3000 budabit
```

## Frequent Updates

If this is your own instance and you update often, your normal cycle is:

```sh
git pull --rebase
git submodule sync --recursive
git submodule update --init --recursive
pnpm run build-in-production
```

Then upload the new `build/` contents.

## Deploying with SFTP/LFTP (Recommended Strategy)

If you deploy with `lftp mirror -R --delete` over SFTP, be aware of one important detail:

- Budabit emits cache-busted assets under `/_app/immutable/*`.
- Filenames are content-hashed, so each new build creates new names.
- `--delete` removes old hash files one-by-one on the remote host.

If you deploy often, this can create very long delete phases as old immutable files accumulate.

### Why this happens

- **Hashed immutable assets are intentional.** They let browsers cache files safely for a long time.
- **Users do not download every file in `/_app/immutable`.** Browsers request only the files referenced by the current `index.html` plus route chunks needed for navigation.
- **Delete storms are a deployment-side cost.** SFTP deletes are still per-file operations, so removing thousands of old hashes is slow even when transfer size is small.

### Recommended approach

Use the ordered deploy wrapper after building:

```sh
pnpm run build-in-production
BUDABIT_SFTP_HOST='sftp://example.com' \
BUDABIT_SFTP_USER='your-user' \
BUDABIT_REMOTE_PATH='.' \
./scripts/deploy-static-lftp.sh
```

The script prompts for the SFTP password with `read -rsp` unless `LFTP_PASSWORD` is already set. Do not put passwords in command arguments.

For less typing, create an untracked `.deploy.local.env`:

```sh
BUDABIT_SFTP_HOST='sftp://example.com'
BUDABIT_SFTP_USER='your-user'
BUDABIT_REMOTE_PATH='.' # e.g. '/public_html'
```

Then normal deploys are:

```sh
pnpm run build-in-production
./scripts/deploy-static-lftp.sh
```

The wrapper runs three passes:

1. Upload new `/_app/immutable/*` files without deleting old immutable files.
2. Upload mutable files with delete enabled, excluding `/_app/immutable/*` and `/_app/version.json`.
3. Upload `/_app/version.json` last so browsers do not see an update before all files exist.

Preview the generated lftp commands without connecting:

```sh
./scripts/deploy-static-lftp.sh --dry-run
```

Notes:

- Do **not** add `--delete-excluded` to the mutable pass, or excluded immutable files may be removed.
- If your SFTP server is unstable, set `BUDABIT_LFTP_PARALLEL=2` or `BUDABIT_LFTP_PARALLEL=4`.
- After deployment, run `node scripts/check-deploy-cache.mjs https://your-domain.com`.

### Remote storage growth and cleanup

Because immutable files are not deleted on every deploy, remote storage will grow over time. That is expected.

Recommended policy:

- Keep fast, safe deploys day-to-day with `scripts/deploy-static-lftp.sh`.
- Run cleanup only in a low-traffic maintenance window after your retention window has passed.
- Keep at least the current and previous build's immutable files. Pass the previous build directory with `--keep-build-dir` when you have it archived.
- Browser Cache Storage cleanup is automatic: the service worker keeps the current and previous `budabit-app-*` caches.

Preview remote immutable cleanup first. Dry-run is the default:

```sh
./scripts/cleanup-static-lftp.sh --dry-run --keep-build-dir /path/to/previous-build
```

Apply only after reviewing the dry-run output:

```sh
./scripts/cleanup-static-lftp.sh --apply --keep-build-dir /path/to/previous-build
```

The cleanup script only targets `/_app/immutable/`; it does not touch mutable app files or `/_app/version.json`.

## External Runtime Dependencies

Budabit is static, but it still talks to public network services from the browser:

- Nostr relays from `VITE_INDEXER_RELAYS`, `VITE_GIT_RELAYS`, user relay lists, and the active community definition
- Blossom servers from user settings, the active community definition, and optional fallback env values
- Git HTTP remotes, usually through a CORS proxy
- Dufflepud at `https://dufflepud.onrender.com`, currently wired as the Welshman backend service URL and used for link preview service calls
- Optional Burrow account service if `VITE_BURROW_URL` is set
- Optional notifier/push services only when `FEATURE_ALERTS=1`

Git-over-HTTP operations use a CORS proxy. If you do not set one, Budabit falls back to `https://corsproxy.budabit.club`.

If you want to be fully independent, set your own:

```env
VITE_GIT_DEFAULT_CORS_PROXY=https://your-cors-proxy.example.com
```

## Things That Will Bite You

- Do not deploy under a subfolder unless you plan to rework base-path assumptions.
- Do not skip submodule sync/update on fresh clones or after submodule changes.
- Do not use a dumb file server without SPA rewrites and expect deep links to work.
- Do not point `VITE_DEFAULT_COMMUNITY` at a user profile that has no resolvable `kind:10222` community definition.
- Do not rely on legacy `/spaces/[relay]` routes. They were removed in the Communikey pivot.
- Do not expect external email or push delivery unless `FEATURE_ALERTS=1` and notifier values are configured. In-app badges are the default notification path.

## Sanity Check

Before uploading, this should work locally:

```sh
npx serve -s build -p 3000
```

Then open `http://localhost:3000` and test a deep route directly.
