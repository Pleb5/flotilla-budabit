# Atomic App Update Lessons

## Why This Exists

Budabit intentionally lets a running tab remain on build A until the user accepts build B. That is not stale-while-revalidate: build A stays complete and self-consistent, build B is prepared separately, and activation is an explicit transition.

A production layout issue exposed an important boundary in that model. The app shell can remain on A while Nostr-discovered widgets, relay data, and other network resources evolve independently. Seeing old host behavior with a newer widget does not by itself prove that an atomic shell transition failed, but it does make retained-build compatibility and reliable update controls important.

The subsequent audit found several ways the implementation could violate its intended contract. These are the lessons that must remain true as the updater evolves.

## Atomicity Starts At Publication

Publishing `/_app/version.json` last is necessary but not sufficient. Browsers check `service-worker.js` independently of application polling, including when an existing page registers the same worker URL again.

Therefore:

- Publish a marker with no build version before changing any shared app-shell file, preventing an old worker from certifying a mixed cache during deployment.
- Supporting mutable files must finish uploading before `service-worker.js`.
- `service-worker.js` must be available before the matching `index.html`.
- `/_app/version.json` remains the final stable marker.
- Each worker, shell, and marker file is uploaded to a temporary path. The old destination is then removed and the completed upload is renamed into place, so clients can observe a brief missing file but never a partially transferred file.
- A worker must fetch the network-only marker during installation and reject installation unless the marker equals its compiled build ID.
- The worker must check the marker again after filling its cache, because a newer deployment may begin during the download.

The worker-side marker check is the authoritative gate. Deployment order reduces race windows, but the browser must still verify the release state itself.

The deployment sequence does not require the SFTP server to support rename-over-existing. Brief missing-file windows fail closed: an absent marker or worker cannot certify a build, while the previous complete service-worker cache remains usable.

## A Cache Name Is Not Proof Of Readiness

`caches.open()` creates a cache before required files have been stored. The existence of `budabit-app-B` therefore proves neither completeness nor that worker B is waiting.

Readiness requires all of the following:

- Worker B reached `installed` without any required fetch failing.
- Worker B reports build ID B through a direct `MessageChannel` handshake.
- The registration's actual waiting worker is B.
- The published network marker is B.

Activation messages include the expected build ID, and a worker ignores `SKIP_WAITING` requests for any other build.

The first repaired worker also accepts the previous production client's unversioned `SKIP_WAITING` message. For that transition only, the worker records legacy activation and navigates every claimed window itself so old tabs do not remain on old JavaScript under the new controller.

## Activation Is A Multi-Tab Transition

Service-worker activation changes the controller for an origin, not only for the tab where the user clicked Reload. Every old-build tab must move to the activated build.

The activated worker claims clients and broadcasts `APP_CACHE_ACTIVATED` with its build ID. Every current tab also listens for `controllerchange` as a fallback. A tab reloads only when the new controller reports a build ID different from the JavaScript currently running in that tab.

The previous complete cache remains available during this transition. It is not deleted merely because another tab activated a newer worker.

## Timeouts Must Preserve The Known-Good Build

Timeouts are observations, not proof that either worker is bad. Mobile browsers may delay installation, activation, message delivery, or background tabs.

On timeout:

- Do not delete the active cache.
- Do not reload under an unverified controller.
- Keep the current build usable.
- Show persistent Retry and explicit Reset controls.
- Use destructive cache clearing only after a user explicitly chooses Reset.

After a reload, one additional cache-busted reload is safe only when the controlling worker already reports the expected build. Otherwise the app stays on the current build and presents recovery UI.

## Update Controls Are Not Ordinary Toasts

An update or recovery action must survive normal notifications. It cannot live in a capped, dismissible toast queue while internal state assumes it remains visible.

Budabit uses dedicated persistent update UI for:

- a completely prepared update;
- activation retry;
- an expected-build mismatch;
- explicit cache reset.

## Build And Deploy Commands Must Fail Closed

An atomic runtime cannot compensate for a build script that reports success after a failed bundler or contract check.

Required behavior:

- Build scripts use `set -euo pipefail`.
- Asset generation, bundling, post-processing, and contract validation must all succeed.
- Validation runs after the final output mutation.
- The generated marker and compiled worker must contain the same build ID.
- Deploy scripts verify that the worker, shell, marker, and immutable directory all exist before uploading.

## Compatibility Beyond The App Shell

The atomic cache covers Budabit's own HTML, JavaScript, CSS, workers, fonts, icons, and other declared app-shell files. It does not freeze:

- Nostr events;
- curated widget manifests;
- Blossom-hosted widget HTML;
- relay responses;
- Git remotes or media.

Because build A may legitimately run while those resources advance, public widget APIs and host behavior need a defined compatibility window. A widget should degrade safely on the previous supported host build, and host changes should preserve the previous widget protocol when practical.

## Regression Tests

The contract is exercised at three levels:

- Pure update-policy tests cover preparation and non-destructive recovery decisions.
- Static deploy tests verify immutable retention and the worker, shell, marker publication order for local and LFTP paths.
- A production Chromium test builds A and B, rejects an unpublished worker, injects a required-asset failure, retries installation, activates B across two tabs, retains both caches, reloads B offline, and exercises the previous client's unversioned activation message.

Any change to build IDs, service-worker messages, cache cleanup, deployment ordering, update UI, or reload recovery must keep `pnpm test:atomic` passing.
