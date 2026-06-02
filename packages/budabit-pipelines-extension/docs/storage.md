# Storage API

Documentation for the Flotilla Smart Widget storage actions, enabling widgets to persist data through the host.

## Overview

Smart Widgets can persist data using storage actions. The host manages storage on behalf of widgets, providing:

- **Scoped storage** - Data isolated per widget
- **Repository-scoped storage** - Optional data scoping to the current repository
- **Key-value interface** - Simple get/set/remove/keys operations

All storage actions are privileged and require the appropriate `permission` tags in the widget's kind 30033 event.

## Storage Actions

### `storage:get`

Retrieve data by key from widget storage.

**Request:**

```typescript
interface StorageGetRequest {
  /** The key to retrieve */
  key: string;

  /** If true, scope the key to the current repository */
  repoScoped?: boolean;
}
```

**Response:**

```typescript
interface StorageGetResponse {
  /** The stored value, or null if not found */
  value: unknown | null;

  /** The key that was requested */
  key: string;
}

// On error
interface StorageError {
  error: string;
}
```

**Usage Example:**

```typescript
import { createWidgetBridge } from '@flotilla/ext-shared';

const bridge = createWidgetBridge();

// Get global widget data
const globalResult = await bridge.request('storage:get', {
  key: 'user-preferences'
});
console.log('Preferences:', globalResult.value);

// Get repository-scoped data
const repoResult = await bridge.request('storage:get', {
  key: 'repo-settings',
  repoScoped: true
});
console.log('Repo settings:', repoResult.value);
```

### `storage:set`

Store data by key in widget storage.

**Request:**

```typescript
interface StorageSetRequest {
  /** The key to store under */
  key: string;

  /** The value to store (must be JSON-serializable) */
  value: unknown;

  /** If true, scope the key to the current repository */
  repoScoped?: boolean;
}
```

**Response:**

```typescript
interface StorageSetResponse {
  /** Confirmation of success */
  status: 'ok';

  /** The key that was set */
  key: string;
}

// On error
interface StorageError {
  error: string;
}
```

**Usage Example:**

```typescript
// Store global widget data
await bridge.request('storage:set', {
  key: 'user-preferences',
  value: {
    theme: 'dark',
    notifications: true,
    language: 'en'
  }
});

// Store repository-scoped data
await bridge.request('storage:set', {
  key: 'repo-settings',
  value: {
    autoSync: true,
    branch: 'main'
  },
  repoScoped: true
});
```

### `storage:remove`

Remove data by key from widget storage.

**Request:**

```typescript
interface StorageRemoveRequest {
  /** The key to remove */
  key: string;

  /** If true, scope the key to the current repository */
  repoScoped?: boolean;
}
```

**Response:**

```typescript
interface StorageRemoveResponse {
  /** Confirmation of success */
  status: 'ok';

  /** The key that was removed */
  key: string;

  /** Whether the key existed before removal */
  existed: boolean;
}

// On error
interface StorageError {
  error: string;
}
```

**Usage Example:**

```typescript
// Remove global data
const result = await bridge.request('storage:remove', {
  key: 'old-cache'
});
console.log('Key existed:', result.existed);

// Remove repository-scoped data
await bridge.request('storage:remove', {
  key: 'repo-cache',
  repoScoped: true
});
```

### `storage:keys`

List all keys in widget storage.

**Request:**

```typescript
interface StorageKeysRequest {
  /** If true, list only repository-scoped keys */
  repoScoped?: boolean;

  /** Optional prefix to filter keys */
  prefix?: string;
}
```

**Response:**

```typescript
interface StorageKeysResponse {
  /** Array of matching keys */
  keys: string[];

  /** Total count of keys */
  count: number;
}

// On error
interface StorageError {
  error: string;
}
```

**Usage Example:**

```typescript
// List all global keys
const allKeys = await bridge.request('storage:keys', {});
console.log('All keys:', allKeys.keys);

// List repository-scoped keys
const repoKeys = await bridge.request('storage:keys', {
  repoScoped: true
});
console.log('Repo keys:', repoKeys.keys);

// List keys with prefix
const cacheKeys = await bridge.request('storage:keys', {
  prefix: 'cache:'
});
console.log('Cache keys:', cacheKeys.keys);
```

## TypeScript Types

Complete type definitions for storage actions:

```typescript
// Request types
export interface StorageGetRequest {
  key: string;
  repoScoped?: boolean;
}

export interface StorageSetRequest {
  key: string;
  value: unknown;
  repoScoped?: boolean;
}

export interface StorageRemoveRequest {
  key: string;
  repoScoped?: boolean;
}

export interface StorageKeysRequest {
  repoScoped?: boolean;
  prefix?: string;
}

// Response types
export interface StorageGetResponse {
  value: unknown | null;
  key: string;
}

export interface StorageSetResponse {
  status: 'ok';
  key: string;
}

export interface StorageRemoveResponse {
  status: 'ok';
  key: string;
  existed: boolean;
}

export interface StorageKeysResponse {
  keys: string[];
  count: number;
}

export interface StorageError {
  error: string;
}

// Extend WidgetActionMap with storage actions
declare module '@flotilla/ext-shared' {
  interface WidgetActionMap {
    'storage:get': {
      req: StorageGetRequest;
      res: StorageGetResponse | StorageError;
    };
    'storage:set': {
      req: StorageSetRequest;
      res: StorageSetResponse | StorageError;
    };
    'storage:remove': {
      req: StorageRemoveRequest;
      res: StorageRemoveResponse | StorageError;
    };
    'storage:keys': {
      req: StorageKeysRequest;
      res: StorageKeysResponse | StorageError;
    };
  }
}
```

## Permissions

Storage actions are privileged. Your widget must declare storage permissions in the kind 30033 event:

```json
{
  "kind": 30033,
  "tags": [
    ["permission", "storage:get"],
    ["permission", "storage:set"],
    ["permission", "storage:remove"],
    ["permission", "storage:keys"]
  ]
}
```

Or use a wildcard if the host supports it:

```json
{
  "kind": 30033,
  "tags": [
    ["permission", "storage:*"]
  ]
}
```

## Repository Scoping

When `repoScoped: true` is specified, the storage key is automatically namespaced to the current repository context. This allows widgets to store different data for different repositories.

**How it works:**

```
Global key:      "preferences"
Repo-scoped key: "repo:owner/name:preferences"
```

**Important:** Repository-scoped storage requires an active repository context. If no repository is in scope (e.g., widget loaded in a global slot), the request will return an error.

```typescript
// Check if repo context is available before using repoScoped
bridge.onEvent('widget:init', (payload) => {
  if (payload.repoContext) {
    // Safe to use repoScoped storage
    loadRepoSettings();
  } else {
    // Fall back to global storage
    loadGlobalSettings();
  }
});
```

## Complete Storage Example

```typescript
import { createWidgetBridge } from '@flotilla/ext-shared';

interface WidgetSettings {
  theme: 'light' | 'dark';
  notifications: boolean;
  autoSave: boolean;
}

interface RepoSettings {
  defaultBranch: string;
  syncEnabled: boolean;
}

class StorageManager {
  private bridge = createWidgetBridge();
  private hasRepoContext = false;

  constructor() {
    this.bridge.onEvent('widget:init', (payload) => {
      this.hasRepoContext = !!payload.repoContext;
    });
  }

  // Global settings
  async getSettings(): Promise<WidgetSettings | null> {
    const result = await this.bridge.request('storage:get', {
      key: 'settings'
    });

    if ('error' in result) {
      console.error('Failed to get settings:', result.error);
      return null;
    }

    return result.value as WidgetSettings | null;
  }

  async saveSettings(settings: WidgetSettings): Promise<boolean> {
    const result = await this.bridge.request('storage:set', {
      key: 'settings',
      value: settings
    });

    if ('error' in result) {
      console.error('Failed to save settings:', result.error);
      return false;
    }

    return true;
  }

  // Repository-scoped settings
  async getRepoSettings(): Promise<RepoSettings | null> {
    if (!this.hasRepoContext) {
      console.warn('No repository context available');
      return null;
    }

    const result = await this.bridge.request('storage:get', {
      key: 'repo-settings',
      repoScoped: true
    });

    if ('error' in result) {
      console.error('Failed to get repo settings:', result.error);
      return null;
    }

    return result.value as RepoSettings | null;
  }

  async saveRepoSettings(settings: RepoSettings): Promise<boolean> {
    if (!this.hasRepoContext) {
      console.warn('No repository context available');
      return false;
    }

    const result = await this.bridge.request('storage:set', {
      key: 'repo-settings',
      value: settings,
      repoScoped: true
    });

    if ('error' in result) {
      console.error('Failed to save repo settings:', result.error);
      return false;
    }

    return true;
  }

  // Clear all cached data
  async clearCache(): Promise<void> {
    const keysResult = await this.bridge.request('storage:keys', {
      prefix: 'cache:'
    });

    if ('error' in keysResult) {
      console.error('Failed to list cache keys:', keysResult.error);
      return;
    }

    for (const key of keysResult.keys) {
      await this.bridge.request('storage:remove', { key });
    }

    console.log(`Cleared ${keysResult.count} cache entries`);
  }
}

// Usage
const storage = new StorageManager();

// Load settings on init
const settings = await storage.getSettings();
if (!settings) {
  // Set defaults
  await storage.saveSettings({
    theme: 'light',
    notifications: true,
    autoSave: true
  });
}
```

## Storage Limits

Hosts may enforce storage limits:

| Limit | Typical Value |
|-------|---------------|
| Max key length | 256 characters |
| Max value size | 1 MB |
| Max keys per widget | 1000 |
| Max total storage | 10 MB |

Check the host documentation for specific limits. Handle quota exceeded errors gracefully:

```typescript
const result = await bridge.request('storage:set', {
  key: 'large-data',
  value: largeObject
});

if ('error' in result) {
  if (result.error.includes('quota')) {
    // Clear old data to make room
    await clearOldCache();
    // Retry
    await bridge.request('storage:set', { key: 'large-data', value: largeObject });
  }
}
```

## Security Considerations

1. **Data is widget-scoped** - Widgets cannot access other widgets' storage
2. **Host controls storage** - The host may encrypt, backup, or clear storage
3. **No sensitive secrets** - Avoid storing private keys or tokens; use host capabilities instead
4. **JSON-serializable only** - Values must be JSON-serializable (no functions, circular refs)

## Related Documentation

- [Lifecycle Events](./lifecycle.md)
- [Security Best Practices](./security.md)
- [Host Bridge Integration](./host-bridge.md)
