# Self-Hosting Budabit

This is the no-BS path for running your own Budabit.

Budabit is a static SPA/PWA. You do not need to run your own email service, Anchor stack, or other backend just to get the app online.

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

For a branded deployment, create `.env` in the repo root with at least:

```env
VITE_PLATFORM_URL=https://your-domain.com
VITE_PLATFORM_NAME=Your Budabit
VITE_PLATFORM_DESCRIPTION=Your Budabit instance
VITE_PLATFORM_ACCENT=#0f766e
VITE_PLATFORM_LOGO=https://your-domain.com/logo.png
VITE_PLATFORM_RELAYS=wss://relay-1.example.com,wss://relay-2.example.com
VITE_PLATFORM_ROOM_CREATOR_PUBKEYS=hexpubkey1,hexpubkey2
VITE_DEFAULT_PUBKEYS=hexpubkey1,hexpubkey2
```

Notes:

- `VITE_PLATFORM_URL` should be the final public URL of the app.
- `VITE_PLATFORM_LOGO` can be a remote HTTPS URL. The build pulls it into the static bundle.
- `VITE_DEFAULT_PUBKEYS` is worth setting even if `.env.example` makes it look optional.
- `VITE_PLATFORM_ROOM_CREATOR_PUBKEYS` is recommended for production: if set, only listed pubkeys can create new rooms/channels on platform relays.

## What You Do Not Need

You can skip these unless you specifically want the related features:

- `VITE_NOTIFIER_*` and `VITE_VAPID_PUBLIC_KEY` - only for email/push alerts
- `VITE_GH_CLIENT_ID` - only for GitHub OAuth flows
- `VITE_GLITCHTIP_API_KEY` and `GLITCHTIP_AUTH_TOKEN` - only for error reporting

If you do not set notifier values, the app still builds and runs fine. You just will not have alert delivery features.

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

If your host cannot do SPA fallback, direct links like `/settings` or `/spaces/...` will break.

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
- Keep source maps (`*.map`) deployed if your error pipeline depends on public source map fetches.
- If your Glitchtip/Sentry upload pipeline is fully configured in CI, you may choose to stop uploading `*.map` publicly.

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

## One Real External Dependency

Git-over-HTTP operations use a CORS proxy. If you do not set one, Budabit falls back to `https://corsproxy.budabit.club`.

If you want to be fully independent, set your own:

```env
VITE_GIT_DEFAULT_CORS_PROXY=https://your-cors-proxy.example.com
```

## Things That Will Bite You

- Do not deploy under a subfolder unless you plan to rework base-path assumptions.
- Do not skip submodule sync/update on fresh clones or after submodule changes.
- Do not use a dumb file server without SPA rewrites and expect deep links to work.

## Sanity Check

Before uploading, this should work locally:

```sh
npx serve -s build -p 3000
```

Then open `http://localhost:3000` and test a deep route directly.
