# Budabit Client - Compact Overview

This document summarizes how the Budabit client is structured and how the main pieces interact. It is optimized for another LLM to craft accurate prompts when navigating or modifying the codebase.

## Tech Stack

- SvelteKit (Svelte 5) for the web UI (`svelte`, `@sveltejs/kit`, `vite`).
- TailwindCSS 3 for styling (`tailwindcss`, `postcss`).
- Web-only SvelteKit deployment.
- Nostr protocol via the Welshman libraries for data, networking, and state:
  - `@welshman/*`: app, store, net, router, signer, util.
  - `nostr-tools` for nip19, etc.
- Internal Git/NIP-34 features provided by `packages/nostr-git-core` and `packages/nostr-git-ui` (workspace dependencies: `@nostr-git/core` and `@nostr-git/ui`).
- Extension surfaces support Smart Widget `kind:30033` events through declared slots and sandboxed iframes for iframe widgets.

## High-Level Architecture

- UI is a SvelteKit app under `src/`.
- Application state and Nostr data are centralized in `src/app/core/state.ts` and domain-specific core modules, built on the Welshman store/repository pattern.
- Routes under `src/routes/` mount pages that read from derived stores and invoke thunks/loaders.
- Community routes use `/c/[community]`, where `[community]` parses a hex pubkey, `npub`, or `ncommunity`; legacy relay-space routes are not part of the current architecture.
- The canonical Git route family is `/git`, with community Git catalogs available under `/c/[community]/git`.
- Reusable UI components live in `src/app/components/` and `src/lib/components/`.
- Nostr Git (NIP-34) UI flows are implemented in `packages/nostr-git-ui/src/lib/components/git/`.
- Extension runtime, settings, bridge, slots, and URL policy live in `src/app/extensions/`.
- Packaging/build is orchestrated with `vite` and `build.sh`.

## Key Directories

- `src/app/core/`: Central state and domain helpers, including community state, permissions, feeds, moderation, Git state, sync, wallet, and trust graph logic.
- `src/app/components/`: App-level UI components for communities, chat, Git integrations, modals, alerts, profile flows, and settings.
- `src/app/util/`: Routing, notification, relay, URL, and app utility helpers.
- `src/lib/`: Design system and general-purpose components/utilities.
- `src/routes/`: SvelteKit routes and pages. Community pages are under `src/routes/c/[community]/...`; canonical Git pages are under `src/routes/git/...`.
- `packages/nostr-git-ui/src/lib/components/git/`: Git feature UI, such as repo dialogs, repository views, and worker managers.
- `packages/nostr-git-core/src/git/`: Core Git providers, GRASP/Nostr Git orchestration, import helpers, and shared Git utilities.
- `packages/nostr-git-core/src/worker/`: Comlink worker entry point and worker helper modules for clone, sync, push, PR merge analysis, cache, branches, commit history, remote backfill, and git config.
- `src/app/extensions/`: Extension registry, iframe bridge, install settings, repo-tab slots, widget parsing, and embeddable URL policy.

## Central State and Data Flow

- The app uses a Nostr repository abstraction from Welshman:
  - `repository`: event store (Nostr events are fetched/derived via filters).
  - `tracker`: tracks which relays have which events.
  - `load(...)`: loads events from relays.
- `src/app/core/state.ts` defines shared stores and helpers for application domains:
  - Settings: `settings`, `deriveSettings(...)`, with outbox loader for persisting.
  - Chats: `chatMessages`, `chats`, `deriveChat(...)`.
  - Rooms and chat events: community-scoped `kind:11` room roots and `kind:9` room messages via community feed helpers.
  - Repo announcements (NIP-34): `repoAnnouncements`, `repoAnnouncementsByAddress`, and direct repo maintainer helpers.
  - URL and relay helpers: `getUrlsForEvent`, `deriveEventsForUrl`, and community route helpers.
- `src/app/core/community-state.ts` owns the active community session and bootstrap:
  - `VITE_DEFAULT_COMMUNITY` provides the recommended starting community on `/explore`.
  - `VITE_INDEXER_RELAYS` are discovery/bootstrap relays before the community definition relays are known.
  - The active `kind:10222` definition provides community relays, sections, profile-list references, forms, moderation state, and Blossom refs.
- Router/Context:
  - `routerContext.getIndexerRelays` is wired to env-configured relays.
  - `appContext.dufflepudUrl` is currently hard-coded to `https://dufflepud.onrender.com`.
- Signing/Decryption:
  - `@welshman/signer` with NIP‑44/NIP‑59 helpers for encrypted content and unwrap logic.

## Git/NIP‑34 Features

- UI flows (create repo, configure metadata, progress, etc.) are in:
  - `packages/nostr-git-ui/src/lib/components/git/`
  - Example: `NewRepoWizard.svelte` imports `AdvancedSettingsStep.svelte`, `RepoDetailsStep.svelte`, `RepoProgressStep.svelte`.
- `useNewRepo.svelte` and related hooks in `packages/nostr-git-ui/src/lib` coordinate repo creation, progress, and publishing events.
- The app-level state exposes repo announcements, maintainers, status grouping, and repo-scoped verified-maintainer derivation using `@nostr-git/core` utilities.
- App-level Git worker access goes through `src/app/core/worker-singleton.ts`, which creates one shared worker, injects the Vite-resolved worker URL, configures EventIO, and applies the configured Git CORS proxy.
- Repo routes decode `naddr` values in `src/routes/git/[id=naddr]/+layout.ts`, build a `Repo` context in `+layout.svelte`, and provide repo-scoped stores for issues, PRs, comments, status, verified maintainers, feed activity, settings actions, clone URLs, and relays.

## Extensions and Widgets

- Built-in extensions are not bundled or auto-installed; `src/app/extensions/builtin.ts` keeps `installBuiltinExtensions()` as a no-op for the existing call site.
- Users install extensions from Settings > Extensions using community-curated Smart Widget `kind:30033` events or direct widget `naddr` values.
- `src/app/extensions/registry.ts` validates embeddable URLs, parses Smart Widget button/slot metadata, and registers extension origins.
- `src/app/extensions/bridge.ts` and `provider.svelte` host extensions in iframes and expose a permissioned host bridge.
- Extension slots are rendered through `src/app/extensions/components/SlotRenderer.svelte`; repo-tab extensions are mounted under `/git/[id]/extensions/[extId]` and surfaced from the Git repo layout.
- Community widget routes live at `/c/[community]/widgets`; generic widget launching is handled through declared widget slots and settings preview actions.

## Configuration and Environment

- Root `package.json` scripts:
  - `dev`: `vite dev`
  - `build`: `./build.sh`
  - `check`: `svelte-check`
- Env vars are read via `import.meta.env.*` in `src/app/core/state.ts` and related core modules:
  - Relays and communities: `VITE_INDEXER_RELAYS`, `VITE_SIGNER_RELAYS`, `VITE_DEFAULT_COMMUNITY`, `VITE_GIT_RELAYS`.
  - App metadata and theme: `VITE_APP_NAME`, `VITE_APP_URL`, `VITE_APP_LOGO`, `VITE_APP_ACCENT`, `VITE_APP_ACCENT_CONTENT`, `VITE_APP_SECONDARY`, `VITE_APP_SECONDARY_CONTENT`.
  - Media: `VITE_DEFAULT_BLOSSOM_SERVERS` for fallback Blossom upload targets; community Blossom servers come from active community definitions.
  - Services: `VITE_BURROW_URL`; alert delivery services `VITE_NOTIFIER_PUBKEY`, `VITE_NOTIFIER_RELAY`, `VITE_NOTIFIER_HANDLER_ADDRESS`, `VITE_NOTIFIER_HANDLER_RELAY`, and `VITE_VAPID_PUBLIC_KEY` are used only when `FEATURE_ALERTS=1`.
  - Widgets: `VITE_SMART_WIDGET_RELAYS` overrides default widget discovery relays.
  - Git HTTP fallback: `VITE_GIT_DEFAULT_CORS_PROXY`.
  - Development: `VITE_DEV_ALLOWED_HOSTS`, `VITE_DEV_HMR_*`, and `VITE_DEV_CHII_TARGET_URL` support reverse-proxied/mobile dev sessions.
- Build-time constants are defined in `vite.config.ts`: `__GRASP__` is enabled unless `FEATURE_GRASP=0`, `__CICD__` is enabled only with `FEATURE_CICD=1`, `__ALERTS__` is enabled only with `FEATURE_ALERTS=1`, and legacy NIP-85 provider trust is gated behind `FEATURE_NIP85=1`.
- Current notification behavior: in-app unread badges and sounds remain available without alerts; external email and web push setup is hidden/rejected unless `FEATURE_ALERTS=1`.
- `build.sh` currently post-processes HTML and manifest metadata from `VITE_PLATFORM_NAME`, `VITE_PLATFORM_SHORT_NAME`, `VITE_PLATFORM_DESCRIPTION`, `VITE_PLATFORM_ACCENT`, and `VITE_PLATFORM_URL`, while runtime app metadata and PWA icon generation use `VITE_APP_*`.

## App Shell Boot Sequence

- `src/routes/+layout.ts` disables SSR for the app shell.
- `src/routes/+layout.svelte` wires global policies and app providers, including signer context, storage/event sync, push setup when alerts are enabled, community hydration, extension provider setup, Cashu bridge integration, update polling, and debug/dev hooks.
- The SvelteKit static adapter uses `fallback: "index.html"`, so deployed hosts must preserve SPA fallback behavior.

## How Pages Use State

- Pages under `src/routes/` import selectors from `src/app/core/state.ts`, `src/app/core/community-state.ts`, and domain-specific core modules:
  - Derived stores trigger `load(...)` on first empty read to fetch from relays.
  - Components reactively subscribe to stores, e.g., `deriveEvent(...)`, `deriveNaddrEvent(...)`.
  - Actions typically call domain-specific thunks or `load` helpers.

## Typical LLM Prompting Guide

- Ask for exact files and functions by path.
  - Example: “Open `src/app/core/state.ts` and show the shared repo announcement selectors.”
- When adding UI, specify route and component folder explicitly.
  - Example: “Create `src/app/components/MyWidget.svelte` and import it in `src/routes/+layout.svelte`.”
- For Nostr data, reference `repository`, `load(...)`, and relevant derived stores.
  - Example: “Use `deriveEvents(repository, {filters: [...]})` to read kind X and wire `load(...)` with proper relays.”
- For Git/NIP-34 flows, reference the UI in `packages/nostr-git-ui/...` and `@nostr-git/core` helpers.
- When changing styling, mention Tailwind utility classes.
- For environment‑specific logic, reference the `import.meta.env` keys explicitly.

## Naming and Conventions

- Components: PascalCase Svelte components under `src/app/components/` or `src/lib/components/`.
- Stores/selectors are camelCase in `src/app/core/state.ts` or the relevant domain module under `src/app/core/`.
- Routes follow SvelteKit conventions in `src/routes/` with `+page.svelte`, `+layout.svelte`, etc.
- Git/NIP-34 feature components live alongside their steps and helpers within `packages/nostr-git-ui`; core Git logic lives in `packages/nostr-git-core`.

## Entry Points to Explore

- App shell/layout: `src/routes/+layout.svelte` and `src/app/components/AppContainer.svelte`.
- Messaging: `src/app/components/Chat.svelte`, `ChannelMessage*.svelte` components.
- Community git catalog: `src/routes/c/[community]/git/` and components in `packages/nostr-git-ui/src/lib/components/git/`.
- Canonical Git surface: `src/routes/git/`.
- Extension settings and widgets: `src/routes/settings/extensions/`, `src/routes/c/[community]/widgets/`, and `src/routes/git/[id=naddr]/extensions/[extId]/`.
- Community state: `src/app/core/community-state.ts`, `src/app/core/community.ts`, and `src/app/core/community-feeds.ts`.
- Shared state: `src/app/core/state.ts`.

## Build/Run

- Development: `pnpm dev` (SvelteKit dev server).
- Type checks: `pnpm check`.
- Build: `pnpm build` (delegates to `./build.sh`).
- Production build helper: `pnpm run build-in-production` installs dependencies, rebuilds native modules, sets build metadata, and delegates to `./build.sh`.

---

This overview should equip an LLM with the minimal mental model to navigate Budabit's SvelteKit UI, Communikey community model, Welshman-backed Nostr state, and NIP-34 Git features packaged in `packages/nostr-git-core` and `packages/nostr-git-ui`.
