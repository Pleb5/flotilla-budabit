# Widget Lifecycle Events

Documentation for lifecycle events that the Flotilla host sends to Smart Widgets during their lifecycle.

## Overview

Smart Widgets receive lifecycle events from the host at key moments:

1. **Initialization** - Context and configuration delivered
2. **Mount** - Iframe loaded and bridge communication ready
3. **Unmount** - Widget about to be removed, time to cleanup

These events use the standard event wire format:

```typescript
{ type: "event", action: string, payload?: unknown }
```

## Lifecycle Events

### `widget:init`

Sent immediately when the widget iframe is created. Provides initial context including the extension identifier, repository context (if applicable), and host version information.

**When sent:** After iframe creation, before `widget:mounted`

**Payload:**

```typescript
interface WidgetInitPayload {
  /** Unique identifier for this widget instance */
  extensionId: string;

  /** Repository context if widget is loaded in a repo scope */
  repoContext?: {
    /** Owner of the repository */
    owner: string;
    /** Repository name */
    name: string;
    /** Full repository identifier (owner/name) */
    fullName: string;
    /** Default branch name */
    defaultBranch?: string;
    /** Current branch if applicable */
    currentBranch?: string;
    /** Repository visibility */
    visibility?: 'public' | 'private';
  };

  /** Host application version */
  hostVersion: string;

  /** Additional host-specific context */
  [key: string]: unknown;
}
```

**Usage Example:**

```typescript
import { createWidgetBridge } from '@flotilla/ext-shared';

const bridge = createWidgetBridge();

// Listen for initialization
bridge.onEvent('widget:init', (payload) => {
  console.log('Widget initialized:', payload.extensionId);
  console.log('Host version:', payload.hostVersion);

  if (payload.repoContext) {
    console.log('Repository:', payload.repoContext.fullName);
    // Initialize repo-specific features
    loadRepoData(payload.repoContext);
  }
});
```

### `widget:mounted`

Sent when the iframe has fully loaded and the postMessage bridge is confirmed ready for bidirectional communication.

**When sent:** After iframe `load` event and bridge handshake complete

**Payload:**

```typescript
interface WidgetMountedPayload {
  /** Timestamp when mount completed */
  mountedAt: number;

  /** Slot where the widget is mounted */
  slot?: string;

  /** Viewport dimensions allocated to the widget */
  viewport?: {
    width: number;
    height: number;
  };
}
```

**Usage Example:**

```typescript
bridge.onEvent('widget:mounted', (payload) => {
  console.log('Widget mounted at:', new Date(payload.mountedAt));

  if (payload.viewport) {
    // Adjust layout based on available space
    adjustLayout(payload.viewport.width, payload.viewport.height);
  }

  // Safe to start making requests to host
  initializeWidget();
});
```

### `widget:unmounting`

Sent when the widget is about to be removed from the DOM. Use this event to perform cleanup: save state, cancel pending requests, close connections.

**When sent:** Before iframe removal, gives widget time to cleanup

**Payload:**

```typescript
interface WidgetUnmountingPayload {
  /** Reason for unmounting */
  reason?: 'navigation' | 'user-closed' | 'slot-change' | 'error';

  /** Grace period in milliseconds before forced removal */
  gracePeriodMs?: number;
}
```

**Usage Example:**

```typescript
bridge.onEvent('widget:unmounting', async (payload) => {
  console.log('Widget unmounting, reason:', payload.reason);

  // Save any unsaved state
  await saveWidgetState();

  // Cancel pending requests
  cancelPendingOperations();

  // Close any open connections
  closeConnections();

  // Cleanup bridge
  bridge.destroy();
});
```

## TypeScript Types

Complete type definitions for lifecycle events:

```typescript
// Lifecycle event payloads
export interface WidgetInitPayload {
  extensionId: string;
  repoContext?: RepoContext;
  hostVersion: string;
  [key: string]: unknown;
}

export interface RepoContext {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch?: string;
  currentBranch?: string;
  visibility?: 'public' | 'private';
}

export interface WidgetMountedPayload {
  mountedAt: number;
  slot?: string;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface WidgetUnmountingPayload {
  reason?: 'navigation' | 'user-closed' | 'slot-change' | 'error';
  gracePeriodMs?: number;
}

// Extend WidgetActionMap with lifecycle events
declare module '@flotilla/ext-shared' {
  interface WidgetActionMap {
    'widget:init': {
      event: WidgetInitPayload;
    };
    'widget:mounted': {
      event: WidgetMountedPayload;
    };
    'widget:unmounting': {
      event: WidgetUnmountingPayload;
    };
  }
}
```

## Complete Lifecycle Example

```typescript
import { createWidgetBridge, type WidgetBridge } from '@flotilla/ext-shared';

class MyWidget {
  private bridge: WidgetBridge;
  private extensionId: string | null = null;
  private repoContext: RepoContext | null = null;
  private isInitialized = false;

  constructor() {
    this.bridge = createWidgetBridge();
    this.setupLifecycleHandlers();
  }

  private setupLifecycleHandlers(): void {
    // Handle initialization
    this.bridge.onEvent('widget:init', (payload) => {
      this.extensionId = payload.extensionId;
      this.repoContext = payload.repoContext ?? null;
      console.log(`[${this.extensionId}] Initialized`);
    });

    // Handle mount - safe to start operations
    this.bridge.onEvent('widget:mounted', (payload) => {
      this.isInitialized = true;
      console.log(`[${this.extensionId}] Mounted in slot: ${payload.slot}`);
      this.start();
    });

    // Handle unmount - cleanup
    this.bridge.onEvent('widget:unmounting', async (payload) => {
      console.log(`[${this.extensionId}] Unmounting: ${payload.reason}`);
      await this.cleanup();
    });
  }

  private async start(): Promise<void> {
    if (!this.isInitialized) return;

    // Begin widget operations
    if (this.repoContext) {
      await this.loadRepoSpecificData();
    }
  }

  private async cleanup(): Promise<void> {
    // Save state before removal
    await this.saveState();

    // Destroy bridge
    this.bridge.destroy();
  }

  private async loadRepoSpecificData(): Promise<void> {
    // Load data specific to the repository context
  }

  private async saveState(): Promise<void> {
    // Persist any state that should survive widget removal
  }
}

// Initialize widget
const widget = new MyWidget();
```

## Lifecycle Sequence Diagram

```
Host                              Widget Iframe
  │                                     │
  │──── Create iframe ────────────────>│
  │                                     │
  │──── widget:init ─────────────────>│
  │     { extensionId, repoContext,    │
  │       hostVersion }                │
  │                                     │
  │                        iframe loads │
  │                                     │
  │──── widget:mounted ──────────────>│
  │     { mountedAt, slot, viewport }  │
  │                                     │
  │<─── Widget requests ───────────────│
  │──── Host responses ───────────────>│
  │                                     │
  │     ... widget active ...          │
  │                                     │
  │──── widget:unmounting ───────────>│
  │     { reason, gracePeriodMs }      │
  │                                     │
  │            Widget cleanup          │
  │                                     │
  │──── Remove iframe ────────────────>│
  │                                     │
```

## Best Practices

1. **Always handle `widget:unmounting`** - Cleanup resources to prevent memory leaks
2. **Wait for `widget:mounted`** before making requests - The bridge may not be fully ready before this event
3. **Store `extensionId`** from `widget:init` - Use it for scoped storage and logging
4. **Handle missing `repoContext`** gracefully - Not all slots provide repository context
5. **Respect `gracePeriodMs`** - Complete cleanup within the grace period to ensure smooth transitions

## Related Documentation

- [Host Bridge Integration](./host-bridge.md)
- [Storage API](./storage.md)
- [Architecture Overview](./architecture.md)
