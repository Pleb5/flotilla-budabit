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

## High-Level Architecture

- UI is a SvelteKit app under `src/`.
- Application state and Nostr data are centralized in `src/app/core/state.ts` and domain-specific core modules, built on the Welshman store/repository pattern.
- Routes under `src/routes/` mount pages that read from derived stores and invoke thunks/loaders.
- Community routes use `/c/[community]`, where `[community]` parses a hex pubkey, `npub`, or `ncommunity`; legacy relay-space routes are not part of the current architecture.
- The canonical Git route family is `/git`, with community Git catalogs available under `/c/[community]/git`.
- Reusable UI components live in `src/app/components/` and `src/lib/components/`.
- Nostr Git (NIP-34) UI flows are implemented in `packages/nostr-git-ui/src/lib/components/git/`.
- Packaging/build is orchestrated with `vite` and `build.sh`.

## Key Directories

- `src/app/core/`: Central state and domain helpers, including community state, permissions, feeds, moderation, Git state, sync, wallet, and trust graph logic.
- `src/app/components/`: App-level UI components for communities, chat, Git integrations, modals, alerts, profile flows, and settings.
- `src/app/util/`: Routing, notification, relay, URL, and app utility helpers.
- `src/lib/`: Design system and general-purpose components/utilities.
- `src/routes/`: SvelteKit routes and pages. Community pages are under `src/routes/c/[community]/...`; canonical Git pages are under `src/routes/git/...`.
- `packages/nostr-git-ui/src/lib/components/git/`: Git feature UI, such as repo dialogs, repository views, and worker managers.
- `packages/nostr-git-core/src/lib/`: Core Git providers, workers, Nostr Git event handling, vendor APIs, and shared Git utilities.

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
  - `appContext.dufflepudUrl` provides a backend service URL.
- Signing/Decryption:
  - `@welshman/signer` with NIP‑44/NIP‑59 helpers for encrypted content and unwrap logic.

## Git/NIP‑34 Features

- UI flows (create repo, configure metadata, progress, etc.) are in:
  - `packages/nostr-git-ui/src/lib/components/git/`
  - Example: `NewRepoWizard.svelte` imports `AdvancedSettingsStep.svelte`, `RepoDetailsStep.svelte`, `RepoProgressStep.svelte`.
- `useNewRepo.svelte` and related hooks in `packages/nostr-git-ui/src/lib` coordinate repo creation, progress, and publishing events.
- The app-level state exposes repo announcements and maintainers using `@nostr-git/core` utilities.

## Configuration and Environment

- Root `package.json` scripts:
  - `dev`: `vite dev`
  - `build`: `./build.sh`
  - `check`: `svelte-check`
- Env vars are read via `import.meta.env.*` in `src/app/core/state.ts` and related core modules:
  - Relays and communities: `VITE_INDEXER_RELAYS`, `VITE_SIGNER_RELAYS`, `VITE_DEFAULT_COMMUNITY`, `VITE_GIT_RELAYS`.
  - App metadata: `VITE_APP_NAME`, `VITE_APP_URL`, `VITE_APP_LOGO`, `VITE_APP_ACCENT`.
  - Media: `VITE_DEFAULT_BLOSSOM_SERVERS` for fallback Blossom upload targets; community Blossom servers come from active community definitions.
  - Services: `VITE_BURROW_URL`; alert delivery services `VITE_NOTIFIER_PUBKEY`, `VITE_NOTIFIER_RELAY`, `VITE_NOTIFIER_HANDLER_ADDRESS`, `VITE_NOTIFIER_HANDLER_RELAY`, and `VITE_VAPID_PUBLIC_KEY` are used only when `FEATURE_ALERTS=1`.
  - Git HTTP fallback: `VITE_GIT_DEFAULT_CORS_PROXY`.

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
- Community state: `src/app/core/community-state.ts`, `src/app/core/community.ts`, and `src/app/core/community-feeds.ts`.
- Shared state: `src/app/core/state.ts`.

## Build/Run

- Development: `pnpm dev` (SvelteKit dev server).
- Type checks: `pnpm check`.
- Build: `pnpm build` (delegates to `./build.sh`).

---

This overview should equip an LLM with the minimal mental model to navigate Budabit's SvelteKit UI, Communikey community model, Welshman-backed Nostr state, and NIP-34 Git features packaged in `packages/nostr-git-core` and `packages/nostr-git-ui`.
