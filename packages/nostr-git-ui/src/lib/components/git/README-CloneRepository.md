# Clone Repository Feature

A comprehensive GitHub-style clone repository feature for the Budabit-Flotilla client that runs entirely in the browser with Git token authentication and NIP-34 event emission.

## Features

- **Browser-native Git operations** using `isomorphic-git` and `LightningFS`
- **GitHub-style UI** with repository URL input, clone depth selection, and progress tracking
- **Authentication support** for private repositories using Git tokens
- **NIP-34 event emission** for repository state announcements
- **Progress tracking** with real-time status updates and cancellation support
- **Error handling** with retry functionality and detailed error messages

## Components

### CloneRepoDialog.svelte

A modal dialog component that provides the clone repository interface.

**Props:**

- `isOpen: boolean` - Controls dialog visibility
- `onClose: () => void` - Called when dialog is closed
- `onClone: (config: CloneConfig) => Promise<void>` - Called to initiate clone
- `signEvent: (event: Partial<Event>) => Promise<Event>` - Event signing closure
- `publishEvent: (event: Event) => Promise<void>` - Event publishing closure
- `registerRepo: (repoId: string, cloneUrl: string) => Promise<void>` - Repository registration closure
- `progress?: CloneProgress` - Current clone progress
- `error?: string` - Current error message
- `isCloning?: boolean` - Whether clone is in progress

**Features:**

- Repository URL/Naddr input with validation
- Clone depth selector (shallow vs full)
- Destination path input (auto-filled from URL)
- Progress bar with status messages
- Error display with retry functionality
- Cancel and Clone buttons

### useCloneRepo Hook

A Svelte 5 composable that manages the clone repository workflow.

**API:**

```typescript
const cloneRepo = useCloneRepo();

// State
cloneRepo.progress; // Current progress information
cloneRepo.error; // Current error message
cloneRepo.isCloning; // Whether clone is in progress

// Methods
await cloneRepo.cloneRepository(config); // Start clone operation
cloneRepo.reset(); // Reset state
```

**Features:**

- Interfaces with git-worker's `cloneRemoteRepo` method
- Manages progress state and error handling
- Creates and emits NIP-34 repository state events
- Uses injected closures for event signing and publishing

## Git Worker Integration

### cloneRemoteRepo Method

The core git operation that performs the actual repository cloning.

**Signature:**

```typescript
async function cloneRemoteRepo(
  url: string,
  destinationPath: string,
  options: {
    depth?: number;
    onProgress?: (message: string, percentage: number) => void;
  }
): Promise<{
  success: boolean;
  repoId: string;
  branches: string[];
  tags: string[];
  defaultBranch: string;
  error?: string;
}>;
```

**Features:**

- Supports both shallow and full clones
- Automatic authentication using configured tokens
- Progress callbacks for UI updates
- Robust error handling with cleanup
- Returns repository metadata for NIP-34 events

## Usage Example

```svelte
<script lang="ts">
  import { CloneRepoDialog } from "@nostr-git/ui";
  import { useCloneRepo } from "@nostr-git/ui";

  let showCloneDialog = $state(false);
  const cloneRepo = useCloneRepo();

  // Event signing closure (provided by parent app)
  const signEvent = async (event) => {
    return await signer.signEvent(event);
  };

  // Event publishing closure (provided by parent app)
  const publishEvent = async (event) => {
    await pool.publish(relays, event);
  };

  // Repository registration closure (provided by parent app)
  const registerRepo = async (repoId, cloneUrl) => {
    await repoStore.addRepository({ id: repoId, cloneUrl });
  };

  async function handleClone(config) {
    await cloneRepo.cloneRepository(config);
    showCloneDialog = false;
  }
</script>

{#if showCloneDialog}
  <CloneRepoDialog
    isOpen={showCloneDialog}
    onClose={() => (showCloneDialog = false)}
    onClone={handleClone}
    signEvent={signEvent}
    publishEvent={publishEvent}
    registerRepo={registerRepo}
    progress={cloneRepo.progress}
    error={cloneRepo.error}
    isCloning={cloneRepo.isCloning}
  />
{/if}
```

## Configuration

### Clone Configuration

```typescript
interface CloneConfig {
  url: string; // Repository URL or Naddr
  destinationPath: string; // Local destination path
  depth: number; // Clone depth (1 for shallow, 0 for full)
}
```

### Progress Information

```typescript
interface CloneProgress {
  message: string; // Current status message
  percentage: number; // Progress percentage (0-100)
}
```

## NIP-34 Integration

The feature automatically creates and emits NIP-34 repository state events after successful clones:

- **Event Kind:** 30618 (Repository State)
- **Tags:** Repository ID, clone URL, branch refs, tag refs, maintainers
- **Content:** Empty (metadata in tags)

## Authentication

Git token authentication is handled automatically:

1. Tokens are configured via the app's token management system
2. The git worker automatically injects authentication for matching URLs
3. Supports GitHub, GitLab, and other Git providers
4. Uses HTTP basic authentication with token as password

## Error Handling

Comprehensive error handling includes:

- **Network errors:** Connection timeouts, DNS failures
- **Authentication errors:** Invalid tokens, permission denied
- **Repository errors:** Not found, invalid URL format
- **Storage errors:** Insufficient space, permission issues
- **Cancellation:** User-initiated operation cancellation

## Testing

Unit tests should cover:

- **UI Component:** User interactions, validation, error states
- **Hook:** State management, error handling, event emission
- **Git Worker:** Clone operations, authentication, progress tracking
- **Integration:** End-to-end clone workflow with mocked dependencies

## Dependencies

- `isomorphic-git` - Git operations in the browser
- `LightningFS` - In-memory file system
- `nostr-tools` - Nostr event handling
- `@nostr-git/shared-types` - NIP-34 types and utilities
- `comlink` - Web worker communication
- Svelte 5 - UI framework with runes API

## Browser Compatibility

- **Modern browsers** with Web Worker and IndexedDB support
- **CORS proxy** may be required for some Git providers
- **Memory limitations** for very large repositories
- **Storage quotas** managed by browser IndexedDB limits
