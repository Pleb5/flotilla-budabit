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

For a community-first deployment, create `.env` in the repo root with at least:

```env
VITE_PLATFORM_URL=https://your-domain.com
VITE_PLATFORM_NAME=Your Budabit
VITE_PLATFORM_DESCRIPTION=Your Budabit instance
VITE_PLATFORM_ACCENT=#0f766e
VITE_PLATFORM_LOGO=https://your-domain.com/logo.png
VITE_DEFAULT_COMMUNITY=npub1...
VITE_INDEXER_RELAYS=wss://relay-1.example.com,wss://relay-2.example.com
VITE_GIT_RELAYS=wss://relay.ngit.dev,wss://gitnostr.com
VITE_DEFAULT_PUBKEYS=hexpubkey1,hexpubkey2
```

Notes:

- `VITE_PLATFORM_URL` should be the final public URL of the app.
- `VITE_PLATFORM_NAME`, `VITE_PLATFORM_DESCRIPTION`, `VITE_PLATFORM_URL`, and `VITE_PLATFORM_LOGO` are fallbacks. At runtime, the selected/default community profile name, about, website, and picture are used when available.
- `VITE_PLATFORM_LOGO` can be a remote HTTPS URL. The build pulls it into the static bundle for PWA assets.
- `VITE_PLATFORM_ACCENT` controls the deployment fallback accent color.
- `VITE_DEFAULT_PUBKEYS` is worth setting even if `.env.example` makes it look optional.
- `VITE_DEFAULT_COMMUNITY` should be a community hex pubkey, `npub`, or `ncommunity` value. `ncommunity` relay hints are used first.
- `VITE_INDEXER_RELAYS` should include relays that can resolve the default community profile and `kind:10222` definition before the app knows that community's own relays.
- `VITE_GIT_RELAYS` are used for top-level `/git` repository discovery and Git-related Nostr events. Community repository catalogs are still selected through `/c/<community>/git` and targeted publication events.

Optional but useful for community media:

```env
VITE_DEFAULT_BLOSSOM_SERVERS=https://blossom-1.example.com,https://blossom-2.example.com
```

Community-specific Blossom servers should live in the community `kind:10222` definition. `VITE_DEFAULT_BLOSSOM_SERVERS` is a fallback, not community identity.

## Community Definition Checklist

Self-hosting Budabit does not create a community by itself. Before setting `VITE_DEFAULT_COMMUNITY`, make sure the community pubkey has public Nostr state that Budabit can resolve:

- A `kind:0` profile with name, about, website, and picture if you want runtime branding to override the fallback env values
- A latest `kind:10222` Communikey definition authored by the community pubkey
- `r` relay tags in the definition for community reads and writes
- `content`, `k`, and `a` tags for the sections you want to expose and their `kind:30000` profile-list write permissions
- Optional `blossom` tags for community-owned media storage

Relays are infrastructure, not identity. Do not configure a deployment as if one relay URL is the community. The app routes community state through `/c/<community>`, where `<community>` is parsed as a hex pubkey, `npub`, or `ncommunity` value.

## Optional Alerts

Email digests and web push alerts are disabled by default with `FEATURE_ALERTS=0`.
Set `FEATURE_ALERTS=1` and configure notifier values only if you want external alert delivery.
In-app unread badges and notification sounds do not require notifier values.

## Hosting Requirements

Any static host is fine if it can do SPA fallback.

Requirements:

- Serve the app from the domain root, like `https://your-domain.com/`
- Rewrite unknown routes to `/index.html`
- Do not strip the generated `.htaccess` if you use LiteSpeed or Apache

### LiteSpeed / Apache

The generated `build/.htaccess` already handles:

- SPA rewrites
- cache rules for hashed assets
- no-cache for `service-worker.js`, `manifest.webmanifest`, and `_app/version.json`
- CORS headers for `/.well-known/`

If you are on LiteSpeed or Apache, upload `build/` as-is.

### Other Static Hosts

Set the equivalent rule:

- if request matches a real file, serve it
- otherwise serve `/index.html`

If your host cannot do SPA fallback, direct links like `/settings`, `/git/...`, or `/c/...` will break.

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

Use a two-pass deploy:

1. Upload `build/_app/immutable` **without** `--delete`
2. Upload the rest of `build/` **with** `--delete`, excluding `/_app/immutable`

This keeps deploys fast and avoids deleting assets that may still be needed by users with older tabs open.

### Password-safe dry run (no password in shell history)

```sh
SFTP_HOST='sftp://example.com'
SFTP_USER='your-user'
REMOTE_PATH='.'              # e.g. '/public_html'

read -rsp 'SFTP password: ' LFTP_PASSWORD
printf '\n'
export LFTP_PASSWORD

lftp -u "$SFTP_USER" --env-password "$SFTP_HOST" <<LFTP
set cmd:fail-exit yes

# Pass 1: immutable assets (no delete)
mirror -R \
  --dry-run \
  --verbose=1 \
  --parallel=4 \
  --ignore-time \
  build/_app/immutable \
  "$REMOTE_PATH/_app/immutable"

# Pass 2: everything else (delete enabled, immutable excluded)
mirror -R \
  --dry-run \
  --verbose=1 \
  --parallel=4 \
  --delete \
  --exclude-rx '(^|/)_app/immutable(/|$)' \
  build \
  "$REMOTE_PATH"

bye
LFTP

unset LFTP_PASSWORD
```

### Actual deploy

```sh
SFTP_HOST='sftp://example.com'
SFTP_USER='your-user'
REMOTE_PATH='.'              # e.g. '/public_html'

read -rsp 'SFTP password: ' LFTP_PASSWORD
printf '\n'
export LFTP_PASSWORD

lftp -u "$SFTP_USER" --env-password "$SFTP_HOST" <<LFTP
set cmd:fail-exit yes

# Pass 1: immutable assets (no delete)
mirror -R \
  --verbose=1 \
  --parallel=4 \
  --ignore-time \
  build/_app/immutable \
  "$REMOTE_PATH/_app/immutable"

# Pass 2: everything else (delete enabled, immutable excluded)
mirror -R \
  --verbose=1 \
  --parallel=4 \
  --delete \
  --exclude-rx '(^|/)_app/immutable(/|$)' \
  build \
  "$REMOTE_PATH"

bye
LFTP

unset LFTP_PASSWORD
```

Notes:

- Do **not** add `--delete-excluded` in pass 2, or excluded immutable files may be removed.
- If your SFTP server is unstable, reduce `--parallel=4` to `--parallel=2`.

### Remote storage growth and cleanup

Because immutable files are not deleted on every deploy, remote storage will grow over time. That is expected.

Recommended policy:

- Keep fast, safe deploys day-to-day (strategy above)
- Run cleanup in a maintenance window (for example weekly or monthly)

For cleanup, you can temporarily run a full mirror with delete once during off-hours:

```sh
lftp -u "$SFTP_USER" --env-password "$SFTP_HOST" <<LFTP
set cmd:fail-exit yes

mirror -R \
  --verbose=1 \
  --parallel=2 \
  --delete \
  build \
  "$REMOTE_PATH"

bye
LFTP
```

This trades occasional planned cleanup time for much faster regular deploys.

## External Runtime Dependencies

Budabit is static, but it still talks to public network services from the browser:

- Nostr relays from `VITE_INDEXER_RELAYS`, `VITE_GIT_RELAYS`, user relay lists, and the active community definition
- Blossom servers from user settings, the active community definition, and optional fallback env values
- Git HTTP remotes, usually through a CORS proxy

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

## Sanity Check

Before uploading, this should work locally:

```sh
npx serve -s build -p 3000
```

Then open `http://localhost:3000` and test a deep route directly.
