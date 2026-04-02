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
VITE_DEFAULT_PUBKEYS=hexpubkey1,hexpubkey2
```

Notes:

- `VITE_PLATFORM_URL` should be the final public URL of the app.
- `VITE_PLATFORM_LOGO` can be a remote HTTPS URL. The build pulls it into the static bundle.
- `VITE_DEFAULT_PUBKEYS` is worth setting even if `.env.example` makes it look optional.

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
