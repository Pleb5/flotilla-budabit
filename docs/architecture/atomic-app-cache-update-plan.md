# Atomic App Cache Update Plan

## Goal

Make Budabit behave like a simple installed static app:

- The app can start offline after it has been installed once.
- A running app keeps using one complete build until the user accepts an update.
- A new version is advertised only after every file required by that version is available.
- The reload button switches the browser from one complete build to another complete build.
- No page should be able to land in a mixed state where old HTML loads new chunks, new HTML references missing chunks, or old route chunks have been deleted before old tabs are done with them.

## Non-Goals

- Do not restore generic Workbox or `vite-plugin-pwa` caching.
- Do not use stale-while-revalidate for app shell files.
- Do not cache Nostr relay responses, Git remotes, Blossom media, or other user/network data in the app-shell cache.
- Do not make offline external data magically work. The offline guarantee is for the app shell and previously persisted application data only.

## Current Problems To Fix

- The live host headers do not match `static/.htaccess`; mutable files are not reliably no-store/revalidate.
- The current update prompt detects a new `/_app/version.json`, but it does not prove the new bundle is actually running after reload.
- The current service worker is not an atomic app cache; it only forwards navigations and handles push.
- Old Workbox-era caches can still exist for users who visited during the previous PWA implementation.
- Deleting old `/_app/immutable/*` files during deploy can break old open tabs that lazy-load a route they had not visited yet.

## Target Architecture

Use a custom service worker as a strict atomic app-cache manager.

The service worker has one app-shell responsibility:

1. Install a build-specific cache, for example `budabit-app-${BUILD_ID}`.
2. Fetch and store every required file for that build during `install`.
3. Fail the install if any required app-shell file cannot be fetched.
4. Keep the old service worker and old cache active until the new cache is complete.
5. Notify the app that an update is ready only after the install succeeds.
6. Activate the new cache only when the user accepts the update.
7. On activate, claim clients and reload app tabs into the new complete build.
8. Delete app-shell caches older than the current and previous build.

This keeps the browser from observing a half-downloaded app version.

## Build Versioning

Add a build ID that changes for every deploy, not only every Git commit.

Recommended variables:

- `VITE_BUILD_HASH`: human-visible source commit, used in About/debug UI.
- `VITE_BUILD_ID`: unique app-shell version, used by SvelteKit and the service worker.

If `VITE_BUILD_ID` is not supplied by CI/deploy, generate it in `build.sh` from commit plus timestamp, for example:

```sh
${VITE_BUILD_HASH:-$(git rev-parse --short HEAD)}-$(date -u +%Y%m%d%H%M%S)
```

Configure SvelteKit `kit.version.name` to use `VITE_BUILD_ID`. This makes `/_app/version.json` a reliable update marker even for same-commit rebuilds with changed env, feature flags, assets, or generated output.

## Service Worker File List

Use SvelteKit's service worker build metadata as the source of truth.

The custom service worker should use `$service-worker` values:

- `version`: current SvelteKit build version.
- `build`: generated SvelteKit client files.
- `files`: static files copied from `static/`.

The app-shell precache list should include:

- `index.html`
- SvelteKit generated JS/CSS/assets from `build`
- static icons, manifest, fonts, and notification sound from `files`
- Git worker bundles emitted under `/_app/immutable/assets/`

The app-shell precache list should exclude:

- `*.map`
- debug-only files
- unrelated docs or deployment-only files
- external URLs

Production sourcemaps should either be disabled or kept out of the service worker cache. They should not be part of the offline app-shell payload.

## Service Worker Fetch Rules

The service worker should be boring and strict.

Rules:

- Navigation requests return cached `index.html` from the active build.
- Requests under `/_app/immutable/` return only matching cached files from the active build.
- Static app files included in the precache return from the active build cache.
- `/_app/version.json`, `/service-worker.js`, and `/sw.js` should use network-first or bypass cache so update checks are never pinned.
- Non-app requests go to the network and are not added to the app-shell cache.
- If an app-shell cache miss happens for a path that should be cached, respond with a hard failure rather than serving `index.html` as JavaScript.

The last rule prevents MIME-type white screens where a missing JS file receives HTML from the SPA fallback.

## Update UI Flow

The app should separate detection from readiness.

Flow:

1. Poll `/_app/version.json` with `cache: "no-store"`.
2. Compare the remote version to the currently running `VITE_BUILD_ID`, not to a localStorage value.
3. If different, call `registration.update()`.
4. Wait for the new worker to reach `installed` with a complete cache.
5. Only then show `New app version is ready`.
6. On click, store `expectedBuildId` in `sessionStorage`, post `SKIP_WAITING`, and wait for `controllerchange`.
7. Reload with a cache-busting query parameter.
8. On boot, verify the running `VITE_BUILD_ID` equals `expectedBuildId`.
9. If verification fails once, unregister legacy workers, delete Cache Storage keys not matching the expected app cache, and reload one more time.
10. If verification fails twice, show a recovery warning with a manual cache reset action.

Do not write a new version as handled before the new build is actually running.

## Legacy Workbox Cleanup

Add a tombstone service worker at `/sw.js`, following the GitWorkshop pattern.

Behavior:

- `install`: `skipWaiting()`.
- `activate`: delete all old Cache Storage keys that are not current Budabit atomic app caches.
- `activate`: `clients.claim()`.
- `activate`: unregister itself.

Keep `/sw.js` deployed long-term because old browsers may still have legacy `/sw.js` registrations.

The main app service worker should live at `/service-worker.js`.

## Handling Lazy Chunks

SvelteKit can keep code splitting. The service worker removes lazy network fetching by precaching every generated chunk before an update is considered ready.

This gives the desired behavior without forcing one giant JS file:

- SvelteKit may still dynamically import route chunks.
- Those chunks are already downloaded into the active app cache.
- A route change cannot discover a missing chunk after the user has accepted an update.

Add a final safety net in the app:

- Listen for `error` and `unhandledrejection`.
- If the error is a dynamic import or module load failure under `/_app/immutable/`, force one cache-busted reload.
- Use a session flag to avoid reload loops.

## Deployment Requirements

The deployment must never publish the stable version marker before all files for that version exist on the server.

Upload order:

1. Upload new `/_app/immutable/*` files without deleting old ones.
2. Upload all other files except the stable update marker.
3. Upload the stable update marker last, currently `/_app/version.json`.

Keep old immutable files during normal deploys. Clean them only in a maintenance task after a retention window.

Why old immutable files stay:

- New users do not use them because new HTML references new hashed filenames.
- Old open tabs may still need them if they lazy-load a route before accepting the update.
- Deleting them early creates the exact mixed-state failure this plan is designed to remove.

## Transition Deployment

The first deployment after this plan is implemented is a transition deployment, not business as usual.

Transition requirements:

- Use the new ordered deploy path.
- Keep old `/_app/immutable/*` files.
- Deploy `/sw.js` so old Workbox-era users can clear legacy caches.
- Verify live cache headers after deployment.
- Expect some old users to need one online reload or visit before legacy cleanup is complete.

After the transition deployment, normal deployments should be the business-as-usual build plus deploy script flow.

## Simplified Deployment Command

Implement a wrapper script so normal deployment is one command after build.

Planned command shape:

```sh
pnpm run build-in-production
BUDABIT_SFTP_HOST='sftp://example.com' \
BUDABIT_SFTP_USER='your-user' \
BUDABIT_REMOTE_PATH='.' \
./scripts/deploy-static-lftp.sh
```

The script should prompt for the SFTP password with `read -rsp` and pass it to `lftp` through `LFTP_PASSWORD`. Passwords must not appear in command history or process arguments.

The script should run the ordered upload internally from `build/`:

```sh
# Pass 1: upload new immutable app assets, keep old immutable files.
mirror -R --verbose=1 --parallel=8 --ignore-time \
  _app/immutable/ \
  "$BUDABIT_REMOTE_PATH/_app/immutable/"

# Pass 2: upload everything else, delete removed mutable files, but do not publish
# the stable version marker yet and never delete immutable files here.
mirror -R --verbose=1 --parallel=8 --delete \
  -x '(^|/)_app/immutable(/|$)' \
  -x '^_app/version\.json$' \
  . \
  "$BUDABIT_REMOTE_PATH"

# Pass 3: publish the stable update marker last.
put -O "$BUDABIT_REMOTE_PATH/_app" _app/version.json
```

Normal operator flow becomes two commands:

```sh
pnpm run build-in-production
./scripts/deploy-static-lftp.sh
```

If host/user/path are not stored in a local untracked config file, pass them as environment variables on the deploy command.

## Optional Local Deploy Config

To reduce typing without committing secrets, support an ignored file such as `.deploy.local.env`:

```sh
BUDABIT_SFTP_HOST='sftp://example.com'
BUDABIT_SFTP_USER='your-user'
BUDABIT_REMOTE_PATH='.'
```

The deploy script may source this file if present. It must still prompt for the password unless `LFTP_PASSWORD` is already present in the environment.

## Manual LFTP Fallback

If the wrapper script is unavailable, run these from inside `build/` after logging into `lftp` and changing to the remote web root:

```sh
mirror -R --verbose=1 --parallel=8 --ignore-time _app/immutable/ _app/immutable/
mirror -R --verbose=1 --parallel=8 --delete -x "(^|/)_app/immutable(/|$)" -x "^_app/version\.json$" . .
put -O _app _app/version.json
```

This is intentionally three manual operations because the version marker must be uploaded last. The wrapper script hides this complexity for normal deployments.

## Required Host Headers

Headers must be verified on the live host after deployment.

Required:

```txt
/                              Cache-Control: no-store, must-revalidate
/<client route>                 Cache-Control: no-store, must-revalidate
/_app/version.json              Cache-Control: no-store, must-revalidate
/service-worker.js              Cache-Control: no-store, must-revalidate
/sw.js                          Cache-Control: no-store, must-revalidate
/manifest.webmanifest           Content-Type: application/manifest+json
/manifest.webmanifest           Cache-Control: no-store, must-revalidate
/_app/immutable/*               Cache-Control: public, max-age=31536000, immutable
```

If Apache/LiteSpeed `.htaccess` cannot enforce these headers, configure them in the hosting control panel or move deployment to a host that supports explicit static headers.

## Verification Script

Add a deploy verification script in a later implementation phase:

```sh
node scripts/check-deploy-cache.mjs https://budabit.club
```

It should fail if:

- `/_app/version.json` is cached for a positive max-age.
- `/service-worker.js` or `/sw.js` is cached for a positive max-age.
- `/manifest.webmanifest` has the wrong content type.
- `/_app/immutable/*` is not immutable-cached.
- A client route does not return the SPA shell.

## Implementation Phases

Execution rule: once implementation starts, continue phase by phase through the complete plan and stop only for a hard failure that blocks safe progress. If a phase has a non-blocking verification limitation because the final live deployment has not happened yet, document the limitation and continue.

### Phase 1: Make Deployment Observable

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Add the header verification script.
- Fix `static/.htaccess`, `serve.json`, and docs to describe the required headers.
- Verify locally with the relevant static checks and a production build. Live host verification can be deferred until the complete plan is deployed.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

### Phase 2: Add Build IDs

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Generate `VITE_BUILD_ID` during build.
- Configure SvelteKit `kit.version.name` from `VITE_BUILD_ID`.
- Expose the running build ID to the root layout for update comparison and reload verification.
- Verify with `pnpm run build-in-production` and confirm the generated `build/_app/version.json` matches the running build ID expected by the app.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

### Phase 3: Add Legacy Cleanup

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Add `/sw.js` tombstone service worker.
- Ensure old Workbox caches and old `/sw.js` registrations are removed.
- Keep `/sw.js` no-store on the host.
- Verify with a production build and a local/browser service-worker cleanup test where possible. Live no-store verification can be deferred until final deployment.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

### Phase 4: Implement Atomic App Cache

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Replace the current `/service-worker.js` behavior with the strict custom app-cache service worker.
- Precache all app-shell files excluding sourcemaps.
- Keep push notification behavior only if it does not interfere with app-shell caching.
- Do not use runtime app-shell caching strategies.
- Verify with a production build, local static serving, browser DevTools Cache Storage inspection, and offline reload/navigation tests.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

### Phase 5: Update UI Coordination

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Compare remote version to the running build ID.
- Show the update prompt only after the service worker has fully installed the new cache.
- Verify the expected build after reload.
- Add dynamic import failure recovery.
- Verify with local two-build simulations: serve build A, load it, build B, swap served files locally, confirm the prompt appears only after the B cache is complete, accept the update, and confirm the running build ID is B.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

### Phase 6: Simplify Deployment

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Add `scripts/deploy-static-lftp.sh`.
- Support `.deploy.local.env` for host/user/path.
- Prompt for password securely.
- Run the ordered upload internally and publish `/_app/version.json` last.
- Verify with script shell checks, a dry run mode if implemented, and a local/mock remote directory test that confirms upload order and excludes `/_app/version.json` until the final pass.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

### Phase 7: Maintenance Cleanup

- Start by reading this architecture plan: `docs/architecture/atomic-app-cache-update-plan.md`.
- Add an optional cleanup command for old immutable files and old app caches.
- Run it manually during low-traffic maintenance windows.
- Keep at least the current and previous app-shell cache names in browsers and keep remote immutable files for a retention window.
- Verify with dry run output only. Do not run destructive cleanup against production during implementation.
- End the phase by inspecting `git status` and `git diff`, committing only the phase changes, and pushing the commit.

## Acceptance Criteria

- Fresh visit downloads one complete app build.
- Opening the app offline after first load starts the app shell.
- A failed deploy upload cannot create an update prompt.
- A failed service worker install keeps the old app active.
- Accepting an update reloads into the expected build ID.
- Route navigation after update acceptance does not fetch missing chunks from the network.
- Old open tabs do not break if they navigate before accepting the update.
- The live deploy checker passes for `budabit.club`.
