# Flotilla Budabit - Code Flow Overview

This document explains the overall flow of the codebase, with emphasis on git-related functionality and the role of workers.

## Project Structure

```
flotilla-budabit/
├── src/                    # Main SvelteKit application (Discord-like Nostr client)
├── packages/
│   ├── nostr-git-core/     # Core Git/Nostr library (NIP-34 implementation)
│   ├── nostr-git-ui/       # Svelte 5 UI components for Git features
│   ├── budabit-kanban-extension/  # Kanban board extension
│   └── flotilla-extension-template/
├── android/, ios/          # Capacitor mobile apps
```

---

## The Git System Architecture

### 1. Provider Abstraction Layer

The git functionality is abstracted through a **GitProvider interface** in `nostr-git-core`:

- **`GitProvider`** (`provider.ts`) - Defines ~60+ git operations (clone, push, fetch, branch, etc.)
- **`IsomorphicGitProvider`** (`isomorphic-git-provider.ts`) - Implements GitProvider using **isomorphic-git** (a pure JS git implementation that works in browsers)
- **`MultiVendorGitProvider`** - Wraps the base provider with vendor-specific features (GitHub, GitLab, Gitea, GRASP)

### 2. External Git Providers (`/api/`)

The project supports multiple git hosting platforms through a unified `GitServiceApi` interface:

| Provider | Features |
|----------|----------|
| **GitHub** | REST API v3, token auth |
| **GitLab** | REST API v4, cross-provider forking |
| **GRASP** | Nostr-native git relay system (event-based state) |
| **Gitea/Bitbucket** | Self-hosted support |

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

| Worker | Purpose |
|--------|---------|
| `auth.ts` | Token storage, auth callbacks, retry with multiple tokens |
| `branches.ts` | Branch resolution with fallbacks (HEAD → main → master → list) |
| `cache.ts` | IndexedDB caching (repo metadata, commits, merge analysis) |
| `fs-utils.ts` | Filesystem utilities (ensureDir, safeRmrf) |
| `patches.ts` | Patch analysis, unified diff application |
| `push.ts` | Safe push with preflight checks |
| `repo-management.ts` | Create, fork, update repositories |
| `repos.ts` | Clone operations, smart initialization |
| `sync.ts` | Sync local with remote, check for updates |

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

| Hook | Purpose |
|------|---------|
| `useForkRepo.svelte.ts` | Fork repository workflow |
| `useNewRepo.svelte.ts` | Create new repository |
| `useCloneRepo.svelte.ts` | Clone repository |
| `useImportRepo.svelte.ts` | Import existing repo |
| `useEditRepo.svelte.ts` | Edit repo metadata |

### How Hooks Work

```typescript
// 1. Hook gets worker API
const { getGitWorker } = await import("@nostr-git/core/worker");
const { api, worker } = getGitWorker();

// 2. Hook calls worker method
const result = await api.forkAndCloneRepo({
  owner, repo, forkName, token, provider, dir
});

// 3. Progress updates via reactive state
let progress = $state<ForkProgress[]>([]);
```

### Components

- **Dialogs**: `ForkRepoDialog.svelte`, `CloneRepoDialog.svelte`, `NewRepoWizard.svelte`
- **Managers**: `CommitManager.ts`, `BranchManager.ts`, `FileManager.ts`, `PatchManager.ts`
- **WorkerManager.ts**: Higher-level abstraction with progress tracking and token management

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
- **Kind 1617-1633**: Issues, Patches, Comments, Status events

The `RepoCore` class in `repo-core.ts` orchestrates Nostr-based git workflows, including:
- Issue/patch thread assembly
- Status resolution (open/closed/merged)
- Maintainer trust verification
- Patch graph generation

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

**Data Flow:**
- **Nostr Events**: Welshman store → App state → UI components
- **Git Operations**: UI → `@nostr-git/core` → Git Worker → Git providers (GitHub/GitLab/etc.)

---

## Summary

This architecture supports a modular, extensible Nostr client with Git collaboration features. It allows the app to work with traditional git hosts (GitHub/GitLab) **and** Nostr-native git (GRASP protocol), all through a unified interface that keeps the UI responsive via the worker system.
