# Edit Repository Feature

A comprehensive repository editing feature for the Budabit-Flotilla client that allows users to update repository metadata, files, and settings through GitHub API integration and browser-native git operations, with automatic NIP-34 event emission.

## Features

- **Repository Metadata Editing** with live validation and GitHub API integration
- **File Management** including README editing with live preview
- **GitHub API Integration** for updating remote repository settings
- **Browser-native Git operations** using `isomorphic-git` and `LightningFS`
- **NIP-34 event emission** for updated repository announcements and state
- **Progress tracking** with real-time status updates and error handling
- **Form validation** with immediate feedback and change detection

## Components

### EditRepoPanel.svelte

A comprehensive modal panel component that provides the repository editing interface.

**Props:**

- `isOpen: boolean` - Controls panel visibility
- `currentAnnouncement: RepoAnnouncementEvent` - Current repository announcement event
- `currentState: RepoStateEvent` - Current repository state event
- `onClose: () => void` - Called when panel is closed
- `onSave: (config: EditConfig) => Promise<void>` - Called to save changes
- `onSignEvent: (event: Partial<Event>) => Promise<Event>` - Event signing closure
- `onPublishEvent: (event: Event) => Promise<void>` - Event publishing closure
- `progress?: EditProgress` - Current edit progress
- `error?: string` - Current error message
- `isEditing?: boolean` - Whether edit is in progress

**Features:**

- Repository name input with live validation
- Description textarea with character limit
- Visibility selector (public/private) with icons
- Default branch input with validation
- README editor with live preview toggle
- Change detection and form validation
- Progress display with status messages
- Error handling with retry functionality
- Responsive design with grid layout

### useEditRepo Hook

A Svelte 5 composable that manages the complete repository editing workflow.

**API:**

```typescript
const editRepo = useEditRepo();

// State
editRepo.progress; // Current progress information
editRepo.error; // Current error message
editRepo.isEditing; // Whether edit is in progress

// Methods
await editRepo.editRepository(announcement, state, config, options); // Start edit operation
editRepo.reset(); // Reset state
```

**Features:**

- Interfaces with git-worker's edit methods
- Manages progress state and error handling
- Creates and emits updated NIP-34 events
- Uses injected closures for event signing and publishing
- Handles repository store updates

## Git Worker Integration

### updateRemoteRepoMetadata Method

Updates remote repository metadata via GitHub API.

**Signature:**

```typescript
async function updateRemoteRepoMetadata(options: {
  owner: string;
  repo: string;
  updates: {
    name?: string;
    description?: string;
    private?: boolean;
  };
  token: string;
}): Promise<{
  success: boolean;
  updatedRepo?: any;
  error?: string;
}>;
```

**Features:**

- PATCH requests to GitHub API `/repos/{owner}/{repo}`
- Selective updates (only changed fields)
- Proper authentication headers
- Error handling with detailed messages

### updateAndPushFiles Method

Updates local files, commits changes, and pushes to remote.

**Signature:**

```typescript
async function updateAndPushFiles(options: {
  dir: string;
  files: Array<{ path: string; content: string }>;
  commitMessage: string;
  token: string;
  onProgress?: (stage: string) => void;
}): Promise<{
  success: boolean;
  commitId?: string;
  error?: string;
}>;
```

**Workflow:**

1. **Write Files**: Update local files in LightningFS
2. **Stage Changes**: Add modified files to git index
3. **Create Commit**: Commit changes with descriptive message
4. **Push to Remote**: Push changes with authentication

## Usage Example

```svelte
<script lang="ts">
  import { EditRepoPanel, useEditRepo } from '@nostr-git/ui';

  let showEditPanel = $state(false);
  const editRepo = useEditRepo();

  // Current repository events (from Nostr subscriptions)
  const currentAnnouncement = /* RepoAnnouncementEvent */;
  const currentState = /* RepoStateEvent */;

  // Event signing closure (provided by parent app)
  const signEvent = async (event) => {
    return await signer.signEvent(event);
  };

  // Event publishing closure (provided by parent app)
  const publishEvent = async (event) => {
    await pool.publish(relays, event);
  };

  // Store update closure (provided by parent app)
  const updateStore = async (repoId, updates) => {
    await repoStore.updateRepository(repoId, updates);
  };

  async function handleSave(config) {
    await editRepo.editRepository(
      currentAnnouncement,
      currentState,
      config,
      {
        token: await tokenStore.getToken('github.com'),
        currentUser: user.login,
        repoDir: `/repos/${repoId}`,
        onSignEvent: signEvent,
        onPublishEvent: publishEvent,
        onUpdateStore: updateStore
      }
    );
  }
</script>

{#if showEditPanel}
  <EditRepoPanel
    isOpen={showEditPanel}
    currentAnnouncement={currentAnnouncement}
    currentState={currentState}
    onClose={() => (showEditPanel = false)}
    onSave={handleSave}
    onSignEvent={onSignEvent}
    onPublishEvent={onPublishEvent}
    progress={editRepo.progress}
    error={editRepo.error}
    isEditing={editRepo.isEditing}
  />
{/if}
```

## Configuration

### Edit Configuration

```typescript
interface EditConfig {
  name: string; // Repository name
  description: string; // Repository description
  visibility: "public" | "private"; // Repository visibility
  defaultBranch: string; // Default branch name
  readmeContent: string; // README.md content
}
```

### Progress Information

```typescript
interface EditProgress {
  stage: string; // Current operation stage
  percentage: number; // Progress percentage (0-100)
  isComplete: boolean; // Whether operation is complete
}
```

## Validation

Comprehensive form validation includes:

### Repository Name

- **Required**: Cannot be empty
- **Length**: 1-100 characters
- **Characters**: Letters, numbers, dots, hyphens, underscores only
- **Pattern**: `/^[a-zA-Z0-9._-]+$/`

### Description

- **Length**: Maximum 500 characters
- **Optional**: Can be empty

### Default Branch

- **Required**: Cannot be empty
- **Format**: Valid git branch name pattern
- **Pattern**: `/^[a-zA-Z0-9._/-]+$/`

### README Content

- **Length**: Maximum 10,000 characters
- **Format**: Markdown content
- **Optional**: Can be empty

## Edit Workflow

The edit operation progresses through these stages:

1. **"Initializing repository update..."** (0%)
2. **"Updating remote repository metadata..."** (10%)
3. **"Updating repository files..."** (40%)
4. **"Creating repository announcement events..."** (70%)
5. **"Publishing repository events..."** (85%)
6. **"Updating local repository store..."** (95%)
7. **"Repository updated successfully!"** (100%)

## GitHub API Integration

### Authentication

- Uses Git tokens from the app's token store
- Sends `Authorization: token {token}` header
- Includes proper `User-Agent` and `Accept` headers

### Repository Updates

- **Endpoint**: `PATCH /repos/{owner}/{repo}`
- **Payload**: Selective updates (name, description, private)
- **Response**: Updated repository metadata

### Error Handling

- API rate limiting
- Permission errors
- Repository not found
- Invalid parameters

## NIP-34 Integration

The feature automatically creates and emits updated NIP-34 events:

### Repository Announcement (Kind 30617)

- Updated name, description, visibility
- Updated clone URLs if name changed
- Maintains existing tags (maintainers, relays, etc.)

### Repository State (Kind 30618)

- Updated HEAD reference for default branch
- Maintains existing branch and tag references
- Updated timestamp

Uses helpers from `@nostr-git/shared-types`:

- `makeRepoAnnouncementEvent()`
- `makeRepoStateEvent()`

## File Management

### README Editing

- **Live Preview**: Toggle between edit and preview modes
- **Markdown Support**: Basic markdown rendering
- **Character Limit**: 10,000 characters maximum
- **Auto-save**: Changes committed and pushed automatically

### File Operations

- **Write**: Update files in LightningFS
- **Stage**: Add changes to git index
- **Commit**: Create commit with descriptive message
- **Push**: Push changes to remote with authentication

## Change Detection

The panel includes intelligent change detection:

- **Form State**: Tracks all field changes
- **Dirty Indicator**: Shows "Unsaved changes" when modified
- **Save Button**: Disabled when no changes or validation errors
- **Reset Capability**: Can discard changes and revert to original

## Error Handling

Comprehensive error handling includes:

- **Validation Errors**: Real-time form validation with inline messages
- **API Errors**: GitHub API failures, rate limiting, authentication issues
- **Git Errors**: File operation failures, push conflicts
- **Network Errors**: Connection timeouts, DNS failures
- **Permission Errors**: Insufficient repository access

All errors are surfaced to the UI with retry options and clear messaging.

## Progress Feedback

Real-time progress updates include:

- **Stage Messages**: Clear descriptions of current operations
- **Progress Bar**: Visual progress indicator (0-100%)
- **Completion Status**: Success/failure indicators
- **Error Recovery**: Retry functionality for failed operations

## Security Considerations

- **Token Security**: Git tokens handled securely via app's token store
- **Input Validation**: All user inputs validated before API calls
- **Error Disclosure**: Error messages don't expose sensitive information
- **Permission Checks**: Repository access validated before operations

## Browser Compatibility

- **Modern browsers** with Web Worker and IndexedDB support
- **GitHub API** requires CORS proxy for browser requests
- **Memory limitations** for large file operations
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

- **UI Component**: Form validation, change detection, user interactions
- **Hook**: State management, error handling, workflow coordination
- **Git Worker**: API calls, file operations, authentication
- **Integration**: End-to-end edit workflow with mocked dependencies

## Performance Optimization

- **Selective Updates**: Only update changed fields
- **Efficient Validation**: Real-time validation without excessive computation
- **Progress Feedback**: Prevent user confusion during long operations
- **Error Recovery**: Automatic cleanup of partial operations
- **Memory Management**: Proper cleanup of git worker resources

## Accessibility

- **Keyboard Navigation**: Full keyboard support for all interactions
- **Screen Readers**: Proper ARIA labels and descriptions
- **Focus Management**: Logical tab order and focus indicators
- **Error Announcements**: Screen reader accessible error messages
- **High Contrast**: Proper color contrast for text and UI elements
