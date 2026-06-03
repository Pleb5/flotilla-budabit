# Fork Repository Feature

A comprehensive GitHub-style fork repository feature for the Budabit-Flotilla client that creates remote forks via GitHub API, clones them locally in the browser, and emits NIP-34 repository state events.

## Features

- **GitHub API Integration** for creating remote forks with proper authentication
- **Polling mechanism** to wait for fork readiness before cloning
- **Browser-native Git operations** using `isomorphic-git` and `LightningFS`
- **GitHub-style UI** with fork name input, visibility selector, and progress tracking
- **NIP-34 event emission** for repository state announcements
- **Progress tracking** with real-time status updates and error handling
- **Repository registration** in global store with navigation support

## Components

### ForkRepoDialog.svelte

A modal dialog component that provides the fork repository interface with GitHub-style design.

**Props:**

- `isOpen: boolean` - Controls dialog visibility
- `originalRepo: OriginalRepo` - Original repository information
- `defaultForkName: string` - Pre-filled fork name
- `onClose: () => void` - Called when dialog is closed
- `onFork: (config: ForkConfig) => Promise<void>` - Called to initiate fork
- `onSignEvent: (event: Partial<Event>) => Promise<Event>` - Event signing closure
- `onPublishEvent: (event: Event) => Promise<void>` - Event publishing closure
- `progress?: ForkProgress` - Current fork progress
- `error?: string` - Current error message
- `isForking?: boolean` - Whether fork is in progress

**Features:**

- Original repository display with owner/name/description
- Fork name input with live validation
- Visibility selector (public/private) with icons
- Progress bar with status messages
- Error display with retry functionality
- Cancel and Fork buttons with proper state management

### useForkRepo Hook

A Svelte 5 composable that manages the complete fork repository workflow.

**API:**

```typescript
const forkRepo = useForkRepo();

// State
forkRepo.progress; // Current progress information
forkRepo.error; // Current error message
forkRepo.isForking; // Whether fork is in progress

// Methods
await forkRepo.forkRepository(originalRepo, config, options); // Start fork operation
forkRepo.reset(); // Reset state
```

**Features:**

- Interfaces with git-worker's `forkAndCloneRepo` method
- Manages progress state and error handling
- Creates and emits NIP-34 repository state events
- Uses injected closures for event signing and publishing
- Handles repository registration in global store

## Git Worker Integration

### forkAndCloneRepo Method

The core git operation that performs the complete fork workflow.

**Signature:**

```typescript
async function forkAndCloneRepo(options: {
  owner: string;
  repo: string;
  forkName: string;
  visibility: "public" | "private";
  token: string;
  dir: string;
  onProgress?: (stage: string, pct?: number) => void;
}): Promise<{
  success: boolean;
  repoId: string;
  forkUrl: string;
  defaultBranch: string;
  branches: string[];
  tags: string[];
  error?: string;
}>;
```

**Workflow:**

1. **Create Remote Fork**: POST to GitHub API `/repos/{owner}/{repo}/forks`
2. **Poll for Readiness**: GET `/repos/{user}/{forkName}` until ready
3. **Clone Locally**: Use `cloneRemoteRepo` to clone fork into LightningFS
4. **Gather Metadata**: Extract branches, tags, and default branch info
5. **Cleanup on Error**: Remove partial clones if operation fails

**Features:**

- GitHub API integration with proper authentication headers
- Intelligent polling with timeout protection (30 seconds max)
- Full clone for forks (depth: 0) to ensure complete history
- Progress callbacks for real-time UI updates
- Robust error handling with cleanup

## Usage Example

```svelte
<script lang="ts">
  import { ForkRepoDialog, useForkRepo } from "@nostr-git/ui";

  let showForkDialog = $state(false);
  const forkRepo = useForkRepo();

  const originalRepo = {
    owner: "octocat",
    name: "Hello-World",
    description: "This your first repo!",
  };

  // Event signing closure (provided by parent app)
  const signEvent = async (event) => {
    return await signer.signEvent(event);
  };

  // Event publishing closure (provided by parent app)
  const publishEvent = async (event) => {
    await pool.publish(relays, event);
  };

  // Repository registration closure (provided by parent app)
  const registerRepo = async (repoId, forkUrl) => {
    await repoStore.addRepository({ id: repoId, forkUrl, type: "fork" });
    // Navigate to forked repository
    goto(`/repos/${repoId}`);
  };

  async function handleFork(config) {
    await forkRepo.forkRepository(originalRepo, config, {
      token: await tokenStore.getToken("github.com"),
      currentUser: user.login,
      onSignEvent: signEvent,
      onPublishEvent: publishEvent,
      onRegisterRepo: registerRepo,
    });
  }
</script>

{#if showForkDialog}
  <ForkRepoDialog
    isOpen={showForkDialog}
    originalRepo={originalRepo}
    defaultForkName={originalRepo.name}
    onClose={() => (showForkDialog = false)}
    onFork={handleFork}
    onSignEvent={onSignEvent}
    onPublishEvent={onPublishEvent}
    progress={forkRepo.progress}
    error={forkRepo.error}
    isForking={forkRepo.isForking}
  />
{/if}
```

## Configuration

### Original Repository

```typescript
interface OriginalRepo {
  owner: string; // Repository owner/organization
  name: string; // Repository name
  description?: string; // Optional description
}
```

### Fork Configuration

```typescript
interface ForkConfig {
  forkName: string; // Name for the fork
  visibility: "public" | "private"; // Fork visibility
}
```

### Progress Information

```typescript
interface ForkProgress {
  stage: string; // Current operation stage
  percentage: number; // Progress percentage (0-100)
  isComplete: boolean; // Whether operation is complete
}
```

## GitHub API Integration

The feature integrates with GitHub's REST API for fork creation:

### Authentication

- Uses Git tokens from the app's token store
- Sends `Authorization: token {token}` header
- Includes proper `User-Agent` and `Accept` headers

### Fork Creation

- **Endpoint**: `POST /repos/{owner}/{repo}/forks`
- **Payload**: `{ name: forkName, private: visibility === 'private' }`
- **Response**: Fork metadata including clone URL and owner info

### Polling for Readiness

- **Endpoint**: `GET /repos/{forkOwner}/{forkName}`
- **Frequency**: Every 1 second for up to 30 seconds
- **Success**: Repository exists and is not empty
- **Timeout**: Clear error message if fork takes too long

## NIP-34 Integration

The feature automatically creates and emits NIP-34 repository state events after successful forks:

- **Event Kind:** 30618 (Repository State)
- **Tags:** Repository ID, clone URL, branch refs, tag refs, maintainers
- **Content:** Empty (metadata in tags)
- **Maintainers:** Current user automatically added as maintainer

Uses the `createClonedRepoStateEvent` helper from `@nostr-git/shared-types`.

## Error Handling

Comprehensive error handling includes:

- **API Errors:** GitHub API failures, rate limiting, authentication issues
- **Network Errors:** Connection timeouts, DNS failures
- **Fork Errors:** Repository not found, insufficient permissions
- **Clone Errors:** Git operation failures, storage issues
- **Timeout Errors:** Fork creation taking too long
- **Validation Errors:** Invalid fork names, configuration issues

All errors are surfaced to the UI with retry options and clear messaging.

## Validation

Fork name validation includes:

- **Required**: Fork name cannot be empty
- **Length**: 1-100 characters
- **Characters**: Letters, numbers, dots, hyphens, underscores only
- **Pattern**: `/^[a-zA-Z0-9._-]+$/`

Real-time validation with immediate feedback in the UI.

## Progress Stages

The fork operation progresses through these stages:

1. **"Initializing fork operation..."** (0%)
2. **"Creating remote fork..."** (10%)
3. **"Waiting for fork to be ready..."** (30%)
4. **"Waiting for fork... (N/30)"** (30-50%)
5. **"Cloning fork locally..."** (60%)
6. **"Downloading objects..."** (60-95%)
7. **"Gathering repository metadata..."** (95%)
8. **"Creating repository announcement..."** (95%)
9. **"Fork completed successfully!"** (100%)

## Browser Compatibility

- **Modern browsers** with Web Worker and IndexedDB support
- **GitHub API** requires CORS proxy for browser requests
- **Memory limitations** for very large repositories
- **Storage quotas** managed by browser IndexedDB limits

## Dependencies

- `axios` - HTTP client for GitHub API requests
- `isomorphic-git` - Git operations in the browser
- `LightningFS` - In-memory file system
- `nostr-tools` - Nostr event handling
- `@nostr-git/shared-types` - NIP-34 types and utilities
- `comlink` - Web worker communication
- `lucide-svelte` - Icons for UI components
- Svelte 5 - UI framework with runes API

## Testing

Unit tests should cover:

- **UI Component:** User interactions, validation, error states, progress display
- **Hook:** State management, error handling, event emission, workflow coordination
- **Git Worker:** Fork creation, polling, cloning, authentication, error handling
- **Integration:** End-to-end fork workflow with mocked GitHub API and git operations

## Security Considerations

- **Token Security**: Git tokens are handled securely via the app's token store
- **API Rate Limiting**: GitHub API rate limits are respected with proper error handling
- **Input Validation**: All user inputs are validated before API calls
- **Error Disclosure**: Error messages don't expose sensitive information

## Performance Optimization

- **Efficient Polling**: 1-second intervals with 30-second timeout
- **Progress Feedback**: Real-time updates prevent user confusion
- **Error Recovery**: Automatic cleanup of partial operations
- **Memory Management**: Proper cleanup of git worker resources
