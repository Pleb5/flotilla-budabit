# Budabit - Code Flow Overview

This document explains the overall flow of the codebase, with emphasis on Git-related functionality and the role of workers. Budabit's current app shell is community-first: communities are keyed by Communikey pubkeys under `/c/[community]`, while repository collaboration has a canonical top-level `/git` route family.

## Project Structure

```
flotilla-budabit/
├── src/                    # Main SvelteKit application (community-first Nostr client)
├── packages/
│   ├── nostr-git-core/     # Core Git/Nostr library (NIP-34 implementation)
│   ├── nostr-git-ui/       # Svelte 5 UI components for Git features
│   ├── budabit-kanban-extension/  # Kanban board extension
│   ├── budabit-pipelines-extension/  # Pipelines extension package
│   └── flotilla-extension-template/
├── docs/                   # Project and architecture documentation
```

---

## The Git System Architecture

### 1. Provider Abstraction Layer

The git functionality is abstracted through a **GitProvider interface** in `packages/nostr-git-core/src/git/`:

- **`GitProvider`** (`provider.ts`) - Defines ~60+ git operations (clone, push, fetch, branch, etc.)
- **`IsomorphicGitProvider`** (`isomorphic-git-provider.ts`) - Implements GitProvider using **isomorphic-git** (a pure JS git implementation that works in browsers)
- **`MultiVendorGitProvider`** - Wraps the base provider with vendor-specific features (GitHub, GitLab, Gitea, GRASP)

### 2. External Git Providers (`/api/`)

The project supports multiple git hosting platforms through a unified `GitServiceApi` interface:

| Provider            | Features                                          |
| ------------------- | ------------------------------------------------- |
| **GitHub**          | REST API v3, token auth                           |
| **GitLab**          | REST API v4, cross-provider forking               |
| **GRASP**           | Nostr-native git relay system (event-based state) |
| **Gitea/Bitbucket** | Self-hosted support                               |

Each provider handles: repos, commits, issues, PRs, comments, users, branches, tags.

---

## The Worker System (Key to Understanding)

Workers are **the backbone** of git operations. Since git operations are expensive and blocking, they run in **Web Workers** to keep the UI responsive.

### Why Workers?

1. **Browser filesystem** - Uses LightningFS (IndexedDB-backed) since browsers don't have a real filesystem
2. **Non-blocking** - Heavy operations (clone, fetch) don't freeze the UI
3. **Isolation** - Git operations run in a separate thread

### Worker Architecture

**Main Worker** (`worker.ts`):

- Entry point exposing 50+ async methods via **Comlink** (RPC library)
- Maintains state: `git` provider, `cacheManager`, `clonedRepos`, `repoDataLevels`

**Specialized Workers** (`workers/`):

| Worker               | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `auth.ts`            | Token storage, auth callbacks, retry with multiple tokens      |
| `branches.ts`        | Branch resolution with fallbacks (HEAD → main → master → list) |
| `cache.ts`           | IndexedDB caching (repo metadata, commits, merge analysis)     |
| `commit-history.ts`  | Commit history loading and history-specific fallbacks          |
| `fs-utils.ts`        | Filesystem utilities (ensureDir, safeRmrf)                     |
| `git-config.ts`      | Runtime Git configuration, including CORS proxy defaults       |
| `pr-merge.ts`        | Pull request merge analysis and conflict detection             |
| `push.ts`            | Safe push with preflight checks                                |
| `remote-backfill.ts` | Remote refs/state backfill helpers                             |
| `repo-management.ts` | Create, fork, update repositories                              |
| `repos.ts`           | Clone operations, smart initialization                         |
| `sync.ts`            | Sync local with remote, check for updates                      |
| `timeout.ts`         | Timeout helpers for long-running worker operations             |

### App-Level Worker Wiring

The root app does not rely on package-default worker URL discovery. It wires workers explicitly for Vite/SvelteKit:

- `src/app/core/worker-singleton.ts` creates one shared Git worker with `@nostr-git/core/worker/worker.js?url`, pings it, configures EventIO, and applies Git CORS proxy settings.
- `src/app/util/git-cors-proxy.ts` normalizes the app-level default CORS proxy from `VITE_GIT_DEFAULT_CORS_PROXY` and the user override in local storage.
- `src/routes/git/[id=naddr]/+layout.svelte` builds repo-local worker managers and injects repo contexts/stores for child routes.

### Communication Pattern

```
┌─────────────────┐    Comlink RPC    ┌─────────────────┐
│   Main Thread   │◄─────────────────►│   Web Worker    │
│   (UI/Hooks)    │                   │ (Git Operations)│
└─────────────────┘                   └─────────────────┘
        │                                     │
        │ getGitWorker()                      │ Uses:
        │ returns { api, worker }             │ - isomorphic-git
        │                                     │ - LightningFS
        ▼                                     │ - CORS proxy
   await api.clone(...)                       │
   await api.push(...)                        ▼
                                       Actual git operations
```

**Messages from Worker → UI**:

- `clone-progress`: `{ type, repoId, phase, loaded, total }`
- `merge-progress`: Similar for merge operations

---

## The UI Layer

### Hooks (UI-to-Worker Bridge)

Located in `nostr-git-ui/src/lib/hooks/`:

| Hook                      | Purpose                  |
| ------------------------- | ------------------------ |
| `useForkRepo.svelte.ts`   | Fork repository workflow |
| `useNewRepo.svelte.ts`    | Create new repository    |
| `useCloneRepo.svelte.ts`  | Clone repository         |
| `useImportRepo.svelte.ts` | Import existing repo     |
| `useEditRepo.svelte.ts`   | Edit repo metadata       |

### How Hooks Work

```typescript
// 1. Hook gets worker API
const {getGitWorker} = await import("@nostr-git/core/worker")
const {api, worker} = getGitWorker()

// 2. Hook calls worker method
const result = await api.forkAndCloneRepo({
  owner,
  repo,
  forkName,
  token,
  provider,
  dir,
})

// 3. Progress updates via reactive state
let progress = $state<ForkProgress[]>([])
```

### Components

- **Dialogs**: `ForkRepoDialog.svelte`, `CloneRepoDialog.svelte`, `NewRepoWizard.svelte`
- **Managers**: `CommitManager.ts`, `BranchManager.ts`, `FileManager.ts`
- **WorkerManager.ts**: Higher-level abstraction with progress tracking and token management

### Route Context

- `src/routes/git/[id=naddr]/+layout.ts` decodes the `naddr`, validates the canonical repo key, extracts relay hints, and merges fallback Git announcement relays.
- `src/routes/git/[id=naddr]/+layout.svelte` constructs the `Repo` class, wires repo-scoped derived stores, creates settings/actions contexts, and mounts repo tabs for overview, code, feed, commits, issues, PRs, settings, and enabled repo-tab extensions.
- Community repository catalogs are separate from canonical repository routes: `/c/[community]/git` lists community-targeted repository publications, while `/git/[id]` is the canonical repo workspace.

---

## Community Bootstrap

Communities are identified by a pubkey, not by a relay URL.

- `src/app/core/community.ts` parses hex pubkeys, `npub`, and `ncommunity://...` values. `ncommunity` relay hints are preserved and used first.
- `src/app/core/community-state.ts` stores the active community session, loads the latest `kind:10222` definition, resolves profile lists, admission forms, moderator requests, reports, and user/community refs, and persists the active session in local storage.
- `src/routes/c/[community]/+layout.svelte` activates the route community, hydrates bootstrap data, and provides the shell for community pages.
- Section definitions in `kind:10222` map community content to rooms, threads, calendar events, goals, repositories, permalinks, widgets, badges, moderation, and admin/access surfaces.

---

## Extension Architecture

Built-in extensions are not bundled or auto-installed. `src/app/extensions/builtin.ts` intentionally leaves `installBuiltinExtensions()` as a no-op.

Budabit supports two install paths:

- NIP-89-style manifest URLs from Settings > Extensions.
- Smart Widget `kind:30033` events discovered from widget relays or installed directly.

Runtime pieces:

- `src/app/extensions/registry.ts` fetches manifests, parses Smart Widget metadata, validates embeddable URLs, registers origins, and tracks repo context.
- `src/app/extensions/bridge.ts` provides the iframe host bridge and permissioned messaging.
- `src/app/extensions/settings.ts` persists installed/enabled extension state.
- `src/app/extensions/slots.ts` and `components/SlotRenderer.svelte` render extension slots.
- Repo-tab slots appear under `/git/[id=naddr]/extensions/[extId]`; global/community widget views live under `/widgets` and `/c/[community]/widgets`.

---

## Complete Data Flow Example (Forking a Repo)

```
┌──────────────────────────────────────────────────────────────────────┐
│  1. User clicks "Fork" in ForkRepoDialog.svelte                      │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  2. useForkRepo hook calls forkRepository(originalRepo, config)      │
│     - Validates inputs                                               │
│     - Gets worker API via getGitWorker()                             │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3. Worker API call: api.forkAndCloneRepo({ owner, repo, ... })      │
│     (Comlink RPC → Web Worker)                                       │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  4. Worker executes in repo-management.ts:                           │
│     - Calls GitLab/GitHub API to create fork                         │
│     - Clones the forked repo using isomorphic-git                    │
│     - Stores in LightningFS (IndexedDB)                              │
│     - Posts progress messages                                        │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  5. Hook receives result, updates reactive state                     │
│     - progress = [...progress, { step, status: 'completed' }]        │
│     - Calls onForkCompleted callback                                 │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  6. Hook creates NIP-34 events (RepoAnnouncementEvent)               │
│     - Passes to onPublishEvent callback                              │
│     - App publishes to Nostr relays via welshman libraries           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Patterns

1. **Provider Pattern** - Pluggable git backends (isomorphic-git, vendor APIs)
2. **Factory Pattern** - `getGitWorker()`, `getGitServiceApiFromUrl()`
3. **Worker Pattern** - Isolated git operations in Web Workers
4. **Repository Data Levels**:
   - `none` → `refs` → `shallow` → `full`
   - Tracks how much data has been fetched to avoid redundant clones
5. **URL Fallback** - Tries multiple clone URLs with preference caching

---

## Nostr Integration (NIP-34)

The project implements **NIP-34** (Git Stuff) for Nostr-native git:

- **Kind 30617**: Repository Announcement
- **Kind 30618**: Repository State (HEAD + refs)
- **Kind 1618-1633**: Pull requests, issues, comments, status events

The `RepoCore` class in `repo-core.ts` orchestrates Nostr-based git workflows, including:

- Issue/PR thread assembly
- Status resolution (open/closed/merged)
- Maintainer trust verification
- Pull request trust and status metrics

GRASP and Nostr Git paths are compiled in unless `FEATURE_GRASP=0`. Experimental CI/CD hooks require `FEATURE_CICD=1`.

External email/push alerts are compiled in only with `FEATURE_ALERTS=1`. In-app unread badges and notification sounds remain available without enabling external alerts.

---

## Package Relationships

**Dependency Graph:**

```
Root Application
├── @welshman/* (external) - Core Nostr functionality
├── @nostr-git/core (workspace) - Git/Nostr core library
│   └── Uses: isomorphic-git, nostr-tools, comlink
└── @nostr-git/ui (workspace) - Git/Nostr UI components
    └── Depends on: @nostr-git/core (workspace)
```

The repository also contains extension packages such as `budabit-kanban-extension`, `budabit-pipelines-extension`, and `flotilla-extension-template`. They are development/distribution packages, not bundled built-ins in the app shell.

**Data Flow:**

- **Nostr Events**: Welshman store → App state → UI components
- **Git Operations**: UI → `@nostr-git/core` → Git Worker → Git providers (GitHub/GitLab/etc.)

---

## Summary

This architecture supports a modular, extensible Nostr client with Git collaboration features. It allows the app to work with traditional git hosts (GitHub/GitLab) **and** Nostr-native git (GRASP protocol), all through a unified interface that keeps the UI responsive via the worker system.
