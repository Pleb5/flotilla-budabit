# Flotilla Client – Compact Overview

This document summarizes how the Flotilla client is structured and how the main pieces interact. It’s optimized for another LLM to craft accurate prompts when navigating or modifying the codebase.

## Tech Stack
- SvelteKit (Svelte 5) for the web UI (`svelte`, `@sveltejs/kit`, `vite`).
- TailwindCSS 3 for styling (`tailwindcss`, `postcss`).
- Capacitor 7 for mobile builds (`android/`, `ios/`).
- Nostr protocol via the Welshman libraries for data, networking, and state:
  - `@welshman/*`: app, store, net, router, signer, util.
  - `nostr-tools` for nip19, etc.
- Internal Git/NIP-34 features provided by `packages/nostr-git` (workspace dependency: `@nostr-git/*`).

## High-Level Architecture
- UI is a SvelteKit app under `src/`.
- Application state and Nostr data are centralized in `src/app/state.ts`, built on the Welshman store/repository pattern.
- Routes under `src/routes/` mount pages that read from derived stores and invoke thunks/loaders.
- Reusable UI components live in `src/app/components/` and `src/lib/components/`.
- Nostr Git (NIP‑34) UI flows are implemented in `packages/nostr-git/packages/ui/src/lib/components/git/`.
- Packaging/build is orchestrated with `vite`, `build.sh`, and Capacitor configs.

## Key Directories
- `src/`
  - `app/`
    - `state.ts`: Central state, stores, selectors, loaders. Hooks into `@welshman/app` repository, tracker, thunks, router context, etc.
    - `components/`: App-level UI components (chat, channels, git integrations, modals, alerts, etc.).
    - `analytics.ts`, `notifications.ts`, etc.: side-channel app services.
  - `lib/`: Design system and general-purpose components/utilities.
  - `routes/`: SvelteKit routes and pages. Git/NIP‑34 pages are under `src/routes/spaces/[relay]/git/...`.
  - `params/`: SvelteKit route parameter parsers.
- `packages/nostr-git/`
  - `packages/ui/src/lib/components/git/`: Git feature UI (e.g., `NewRepoWizard.svelte`, `AdvancedSettingsStep.svelte`).
  - `packages/core`: Core logic for NIP‑34 repo announcements and helpers.
  - `packages/shared-types`: Shared types.
- `android/`, `ios/`: Capacitor mobile projects.

## Central State and Data Flow
- The app uses a Nostr repository abstraction from Welshman:
  - `repository`: event store (Nostr events are fetched/derived via filters).
  - `tracker`: tracks which relays have which events.
  - `load(...)`: loads events from relays.
- `src/app/state.ts` defines derived stores and helpers for application domains:
  - Settings: `settings`, `deriveSettings(...)`, with outbox loader for persisting.
  - Chats: `chatMessages`, `chats`, `deriveChat(...)`.
  - Channels/Rooms: `channels`, `channelsById`, helpers like `deriveChannel(...)`.
  - Repo announcements (NIP‑34): `repoAnnouncements`, `repoGroups`, `deriveMaintainersForEuc(...)` (uses `@nostr-git/core`).
  - URL/Relay helpers: `getUrlsForEvent`, `deriveEventsForUrl`, `encodeRelay/decodeRelay`.
- Router/Context:
  - `routerContext.getIndexerRelays` is wired to env-configured relays.
  - `appContext.dufflepudUrl` provides a backend service URL.
- Signing/Decryption:
  - `@welshman/signer` with NIP‑44/NIP‑59 helpers for encrypted content and unwrap logic.

## Git/NIP‑34 Features
- UI flows (create repo, configure metadata, progress, etc.) are in:
  - `packages/nostr-git/packages/ui/src/lib/components/git/`
  - Example: `NewRepoWizard.svelte` imports `AdvancedSettingsStep.svelte`, `RepoDetailsStep.svelte`, `RepoProgressStep.svelte`.
- `useNewRepo.svelte` (in `packages/nostr-git/packages/ui/src/lib`) coordinates repo creation, progress, and publishing events.
- The app-level state exposes repo announcements and maintainers using `@nostr-git/core` utilities.

## Configuration and Environment
- Root `package.json` scripts:
  - `dev`: `vite dev`
  - `build`: `./build.sh`
  - `check`: `svelte-check`
- Env vars are read via `import.meta.env.*` in `src/app/state.ts`:
  - Relays: `VITE_INDEXER_RELAYS`, `VITE_SIGNER_RELAYS`, `VITE_PLATFORM_RELAYS`.
  - Branding: `VITE_PLATFORM_NAME`, `VITE_PLATFORM_DESCRIPTION`, `VITE_PLATFORM_TERMS`, `VITE_PLATFORM_PRIVACY`, `VITE_PLATFORM_ACCENT`.
  - Services: `VITE_BURROW_URL`, `VITE_NOTIFIER_PUBKEY`, `VITE_NOTIFIER_RELAY`, `VITE_VAPID_PUBLIC_KEY`.
  - GitHub OAuth client id: `VITE_GH_CLIENT_ID`.

## How Pages Use State
- Pages under `src/routes/` import selectors from `src/app/state.ts`:
  - Derived stores trigger `load(...)` on first empty read to fetch from relays.
  - Components reactively subscribe to stores, e.g., `deriveEvent(...)`, `deriveNaddrEvent(...)`.
  - Actions typically call domain-specific thunks or `load` helpers.

## Typical LLM Prompting Guide
- Ask for exact files and functions by path.
  - Example: “Open `src/app/state.ts` and show the implementations of `repoAnnouncements` and `repoGroups`.”
- When adding UI, specify route and component folder explicitly.
  - Example: “Create `src/app/components/MyWidget.svelte` and import it in `src/routes/+layout.svelte`.”
- For Nostr data, reference `repository`, `load(...)`, and relevant derived stores.
  - Example: “Use `deriveEvents(repository, {filters: [...]})` to read kind X and wire `load(...)` with proper relays.”
- For Git/NIP‑34 flows, reference the UI in `packages/nostr-git/packages/ui/...` and `@nostr-git/core` helpers.
- When changing styling, mention Tailwind utility classes.
- For environment‑specific logic, reference the `import.meta.env` keys explicitly.

## Naming and Conventions
- Components: PascalCase Svelte components under `src/app/components/` or `src/lib/components/`.
- Stores/selectors are camelCase in `src/app/state.ts`.
- Routes follow SvelteKit conventions in `src/routes/` with `+page.svelte`, `+layout.svelte`, etc.
- Git/NIP‑34 feature components live alongside their steps and helpers within the `packages/nostr-git` workspace.

## Entry Points to Explore
- App shell/layout: `src/routes/+layout.svelte` and `src/app/components/AppContainer.svelte`.
- Messaging: `src/app/components/Chat.svelte`, `ChannelMessage*.svelte` components.
- Git pages: `src/routes/spaces/[relay]/git/` and components in `packages/nostr-git/.../git/`.
- Central state: `src/app/state.ts` (start here for data flow and selectors).

## Build/Run
- Development: `pnpm dev` (SvelteKit dev server).
- Type checks: `pnpm check`.
- Build: `pnpm build` (delegates to `./build.sh`).
- Mobile: Capacitor workflows under `android/` and `ios/`.

---
This overview should equip an LLM with the minimal mental model to navigate Flotilla’s SvelteKit UI, Welshman-backed Nostr state, and NIP‑34 Git features packaged in `packages/nostr-git`.
