# Nostr I/O Integration For @nostr-git Components

## Summary

This document describes how `@nostr-git` components integrate with Budabit's Nostr I/O infrastructure. The `@nostr-git/core` and `@nostr-git/ui` packages stay framework-agnostic, while Budabit supplies an `EventIO` adapter backed by Welshman.

## Current Integration

### 1. EventIO Interface

**File**: `packages/nostr-git-core/src/types/io-types.ts`

Defines the contract between `@nostr-git/core` and the host application:

- `NostrFilter` - Re-exported from `nostr-tools` (canonical filter type)
- `EventIO` - Interface for fetch, publish, current-pubkey, and optional signing operations
- `PublishResult` - Result of publishing events

These types are exported from `@nostr-git/core/types` and used by the Git worker, GRASP provider paths, and UI hooks that need host-provided Nostr I/O.

`publishEvent` accepts unsigned events and signs internally through the host adapter. This keeps signer ownership in the app layer instead of passing signer objects into workers or package code.

### 2. Budabit EventIO Adapter

**File**: `src/app/core/event-io.ts`

Wraps Budabit's Welshman infrastructure to provide the `EventIO` interface:

```typescript
export function createEventIO(): EventIO
export async function createNip98AuthHeader(url: string, method?: string): Promise<string | null>
```

The adapter delegates to:

- `load` and `publish` from `@welshman/net`
- `signer` and `pubkey` from `@welshman/app`
- `Router` from `@welshman/router` for relay selection

It does not create a separate long-lived Nostr pool. App-level components should continue to use Welshman-owned relay infrastructure.

### 3. Git Worker Wiring

**File**: `src/app/core/worker-singleton.ts`

Budabit creates one shared Git worker through `getInitializedGitWorker()`. First initialization:

- Resolves the worker URL through Vite with `@nostr-git/core/worker/worker.js?url`
- Pings the worker before use
- Calls `createEventIO()` in the main thread
- Passes the adapter into the worker with `configureWorkerEventIO(api, eventIO)`
- Applies the current Git CORS proxy config

This makes worker-backed Git and GRASP operations reuse one configured EventIO bridge instead of requiring each route or component to initialize Nostr I/O separately.

### 4. GRASP Server Settings

#### GraspServersPanel Component

**File**: `src/app/components/GraspServersPanel.svelte`

The component reads and mutates `graspServersStore` from `@nostr-git/ui`, then publishes the selected server list with app-level Git commands:

```svelte
<script lang="ts">
  import {graspServersStore} from "@nostr-git/ui"
  import {createGraspServersEvent} from "@nostr-git/core/events"
  import {postGraspServersList} from "@app/core/git-commands"
</script>
```

It no longer receives `io` or `signEvent` props from `settings/git`; signing and publication are owned by `src/app/core/git-commands.ts` and the app signer.

#### graspServers Store

**File**: `packages/nostr-git-ui/src/lib/stores/graspServers.ts`

Stores normalized GRASP relay URLs only:

```typescript
export const graspServersStore = createGraspServersStore()
```

Git routes hydrate this store from Nostr state when needed. The settings panel mutates it and publishes the replacement list.

### 5. Usage In Routes

Routes that need worker-backed Git operations should use the singleton:

```typescript
import {getInitializedGitWorker} from "@app/core/worker-singleton"

const {api} = await getInitializedGitWorker()
```

Routes or app services that only need app-level Nostr fetch/publish should continue to use Welshman helpers or domain thunks directly. Do not create independent relay pools in app-level components.

### 6. Unit Tests

**File**: `src/app/core/event-io.test.ts`

Verifies that the adapter delegates to Welshman functions and signs through the app signer.

**File**: `src/app/core/worker-singleton.test.ts`

Verifies worker initialization and EventIO configuration behavior.

**File**: `packages/nostr-git-ui/src/lib/stores/graspServers.test.ts`

Tests GRASP server URL normalization and store behavior.

## Architecture Principles

### Correct: Keep Nostr I/O At The App Boundary

```typescript
const eventIO = createEventIO()
await configureWorkerEventIO(api, eventIO)
```

```typescript
const {api} = await getInitializedGitWorker()
```

### Incorrect: Components Import Relay Clients Directly

```typescript
// NEVER DO THIS in app-level components
import { SimplePool } from 'nostr-tools';
const pool = new SimplePool();
```

### Exceptions

The following contexts are allowed to have their own pools/clients:

- **Git workers** under `packages/nostr-git-core/src/worker/`
- **Low-level package providers** under `packages/nostr-git-core/src/api/` and `packages/nostr-git-core/src/git/`

These run in separate contexts where they cannot access the main app's infrastructure.

## Threading I/O

Use `getInitializedGitWorker()` for worker-backed Git operations. It is the default seam for package code that needs EventIO.

Use domain thunks and Welshman helpers directly for app-level event publication. For example, `src/app/core/git-commands.ts` owns Git-related app publications such as GRASP server list updates.

Only pass explicit `EventIO` into lower-level package APIs when the call site cannot use the Budabit worker singleton.

## Verification Checklist

- [x] Adapter delegates to existing Welshman functions
- [x] No new pools created in app-level components
- [x] EventIO types exported from `@nostr-git/core/types`
- [x] Worker and app command seams receive EventIO instead of raw signers
- [x] Worker singleton configures EventIO once on first use
- [x] Stores hold normalized state and leave publication to app commands
- [x] Svelte 5 runes used ($state, $derived, $effect)
- [x] Unit tests verify delegation to real app layer
- [x] Integration tested in settings/git route

## Files Modified

### Core Files

- `packages/nostr-git-core/src/types/io-types.ts` - EventIO contract
- `src/app/core/event-io.ts` - Budabit Welshman-backed EventIO implementation
- `src/app/core/worker-singleton.ts` - Worker creation and EventIO configuration
- `src/app/components/GraspServersPanel.svelte` - GRASP server settings UI
- `src/app/core/git-commands.ts` - App-level Git event publication
- `packages/nostr-git-ui/src/lib/stores/graspServers.ts` - GRASP server URL store

## Migration Notes

If other components need similar updates:

1. Import `EventIO` from `@nostr-git/core/types` if package-level integration needs the type.
2. Prefer `getInitializedGitWorker()` when a route needs worker-backed Git operations.
3. Prefer app-level thunks or Welshman helpers when a component only needs to publish normal app events.
4. Keep signing in the app boundary through `signer` or the EventIO adapter.
5. Verify no app-level imports of `SimplePool`, `nostr-tools` pool, or independent relay clients are introduced.

## References

- Welshman Documentation: https://github.com/coracle-social/welshman
- NIP-51 (Lists): https://github.com/nostr-protocol/nips/blob/master/51.md
- NIP-34 (Git): https://github.com/nostr-protocol/nips/blob/master/34.md
