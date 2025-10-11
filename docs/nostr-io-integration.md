# Nostr I/O Integration for @nostr-git Components

## Summary

This document describes how @nostr-git components integrate with host application Nostr I/O infrastructure. The @nostr-git packages are **framework-agnostic** and can be used with any Nostr application. This example shows integration with Flotilla's Welshman-based event layer.

## Key Changes

### 1. I/O Adapter Interface (Shared Types)

**File**: `packages/nostr-git/packages/shared-types/src/io-types.ts`

Defines the contract between @nostr-git components and the host application:

- `NostrFilter` - Re-exported from `nostr-tools` (canonical filter type)
- `FlotillaEventIO` - Interface for fetch/publish operations  
- `SignEvent` - Signing function signature
- `PublishResult` - Result of publishing events

These types are exported from `@nostr-git/shared-types` and used consistently across all components.

**Note**: `NostrFilter` is imported from `nostr-tools` to avoid type duplication and ensure compatibility with the wider Nostr ecosystem. All types use generic names (`EventIO`, not `FlotillaEventIO`) to emphasize framework independence.

### 2. Flotilla I/O Adapter

**File**: `src/lib/nostr/io-adapter.ts`

Wraps the existing Flotilla/Welshman infrastructure to provide the `EventIO` interface:

```typescript
export function createEventIO(): EventIO
export function createSignEvent(): SignEvent
export function getCurrentPubkey(): string | null
```

**Critical**: This adapter does NOT create new pools or connections. It delegates to:
- `load` from `@welshman/net` for fetching events
- `publishThunk` from `@welshman/app` for publishing events
- `signer` from `@welshman/app` for signing events
- `Router` from `@welshman/router` for determining relay targets

### 3. Updated Components

#### GraspServersPanel Component

**File**: `src/app/components/GraspServersPanel.svelte`

Now receives I/O closures via props using **Svelte 5 patterns**:

```svelte
<script lang="ts">
  import type { EventIO, SignEvent } from "@nostr-git/shared-types";
  
  const { io, signEvent, authorPubkey, onsaved }: {
    io?: EventIO;
    signEvent?: SignEvent;
    authorPubkey?: string;
    onsaved?: () => void;
  } = $props();
</script>
```

**Key improvements**:
- ✅ Uses `$props()` rune instead of `export let`
- ✅ Uses callback prop `onsaved` instead of deprecated `createEventDispatcher`
- ✅ No Svelte 4 legacy APIs

#### graspServers Store

**File**: `packages/nostr-git/packages/ui/src/lib/stores/graspServers.ts`

Updated to accept I/O closures as parameters instead of importing clients:

```typescript
async function load(io: EventIO, authorPubkey: string): Promise<void>
async function save(io: EventIO, sign: SignEvent, authorPubkey: string): Promise<NostrEvent>
```

### 4. Usage in Routes

**File**: `src/routes/settings/profile/+page.svelte`

Example of how to use the adapter in Svelte 5 components:

```svelte
<script lang="ts">
  import {
    createEventIO,
    createSignEvent,
  } from "@lib/nostr/io-adapter";

  // Create I/O closures once for the entire component lifetime
  const io = createEventIO();
  const signEvent = createSignEvent();
</script>

<GraspServersPanel {io} {signEvent} authorPubkey={$pubkey ?? undefined} />
```

### 5. Unit Tests

**File**: `src/lib/nostr/__tests__/io-adapter.test.ts`

Comprehensive unit tests verify that the adapter correctly delegates to Welshman functions without creating new infrastructure.

**File**: `packages/nostr-git/packages/ui/src/lib/stores/__tests__/grasp-servers.test.ts`

Tests for the graspServers store verify it works correctly with the FlotillaEventIO interface.

## Architecture Principles

### ✅ CORRECT: Components receive closures

```svelte
<!-- Component receives io/signEvent as props -->
<GraspServersPanel {io} {signEvent} authorPubkey={$pubkey} />
```

```typescript
// Store function receives io/signEvent as parameters
export async function load(io: FlotillaEventIO, pubkey: string) {
  const events = await io.fetchEvents(filters);
}
```

### ❌ INCORRECT: Components import clients directly

```typescript
// NEVER DO THIS in app-level components
import { SimplePool } from 'nostr-tools';
const pool = new SimplePool();
```

### Exceptions

The following contexts are allowed to have their own pools/clients:
- **Web Workers** (`packages/nostr-git/packages/core/src/lib/workers/*`)
- **Browser Extensions** (`packages/nostr-git/packages/extension/*`)
- **GRASP Git Provider** (`packages/nostr-git/packages/core/src/lib/git/providers/grasp.ts`)

These run in separate contexts where they cannot access the main app's infrastructure.

## Threading I/O Closures

### Option A: Via Props (Used in Settings)

Create closures in a parent component and pass via props:

```svelte
<script lang="ts">
  const io = createFlotillaEventIO();
  const signEvent = createSignEvent();
</script>

<ChildComponent {io} {signEvent} />
```

### Option B: Via Svelte Context (For Deep Trees)

Set once at a high level:

```svelte
<!-- App root or layout -->
<script lang="ts">
  import { setContext } from "svelte";
  setContext("nostr-io", createEventIO());
  setContext("nostr-sign", createSignEvent());
</script>
```

Read in descendants:

```svelte
<script lang="ts">
  import { getContext } from "svelte";
  const io = getContext<EventIO>("nostr-io");
</script>
```

### Option C: Via +layout.ts Data (For Route Trees)

Export from layout:

```typescript
// +layout.ts
export async function load() {
  return {
    io: createEventIO(),
    signEvent: createSignEvent(),
  };
}
```

Use in pages:

```svelte
<script lang="ts">
  export let data;
  const io = $derived(data.io);
</script>
```

## Verification Checklist

- [x] Adapter delegates to existing Welshman functions
- [x] No new pools created in app-level components
- [x] Shared types exported from @nostr-git/shared-types
- [x] Components receive closures via props/context
- [x] Stores accept closures as function parameters
- [x] Svelte 5 runes used ($state, $derived, $effect)
- [x] Unit tests verify delegation to real app layer
- [x] Integration tested in settings/profile route

## Files Modified

### New Files
- `packages/nostr-git/packages/shared-types/src/io-types.ts`
- `src/lib/nostr/io-adapter.ts`
- `src/lib/nostr/__tests__/io-adapter.test.ts`
- `docs/nostr-io-integration.md` (this file)

### Modified Files
- `packages/nostr-git/packages/shared-types/src/index.ts` - Export I/O types
- `packages/nostr-git/packages/ui/src/lib/stores/graspServers.ts` - Import types from shared-types, typed sort callbacks
- `src/app/components/GraspServersPanel.svelte` - Import types from shared-types
- `src/routes/settings/profile/+page.svelte` - Use adapter to pass closures

## Migration Notes

If other components need similar updates:

1. Import types from `@nostr-git/shared-types`
2. Accept `FlotillaEventIO` and `SignEvent` as props/parameters
3. Use the adapter functions in the parent route/component
4. Pass closures down via props, context, or layout data
5. Verify no imports of `SimplePool`, `nostr-tools` pool/relay clients

## References

- Welshman Documentation: https://github.com/coracle-social/welshman
- NIP-51 (Lists): https://github.com/nostr-protocol/nips/blob/master/51.md
- NIP-34 (Git): https://github.com/nostr-protocol/nips/blob/master/34.md
