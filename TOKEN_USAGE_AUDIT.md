# Token Usage Audit

This document identifies all places where authentication tokens are used in the codebase.

## Token Storage & Management

### 1. Token Store (`packages/nostr-git/packages/ui/src/lib/stores/tokens.ts`)

- **Purpose**: Centralized token storage using Svelte store
- **Key Functions**:
  - `tokens.subscribe()` - Subscribe to token changes
  - `tokens.waitForInitialization()` - Wait for tokens to load from localStorage
  - `tokens.refresh()` - Manually refresh tokens
  - `tokens.push()` - Add a new token
  - `tokens.clear()` - Clear all tokens
- **Token Interface**: `{ host: string; token: string }`

### 2. Token Loading (`packages/nostr-git/packages/ui/src/lib/utils/tokenLoader.ts`)

- **Functions**:
  - `loadTokensFromStorage()` - Load encrypted tokens from localStorage
  - `saveTokensToStorage()` - Save encrypted tokens to localStorage
- **Storage**: Uses NIP-04 encryption via signer

### 3. Token Helpers (`packages/nostr-git/packages/ui/src/lib/utils/tokenHelpers.ts`)

- **Functions**:
  - `tryTokensForHost()` - Try multiple tokens for a host until one succeeds (fallback retry)
  - `getTokensForHost()` - Get all tokens matching a host
- **Uses**: Local token matcher from `./tokenMatcher.js`
- **Error Handling**: Throws `TokenNotFoundError` or `AllTokensFailedError` for better error handling

### 3a. Token Matcher (`packages/nostr-git/packages/ui/src/lib/utils/tokenMatcher.ts`)

- **Purpose**: Centralized token matching utility for consistent hostname matching
- **Functions**:
  - `matchesHost(tokenHost: string, urlHostname: string): boolean` - Check if token host matches URL hostname
  - `createHostMatcher(urlHostname: string)` - Create a host matcher function for filtering
- **Matching Logic**: Supports exact matches and subdomain matching (e.g., "github.com" matches "api.github.com")
- **Note**: Moved from `@nostr-git/core` to UI package since it's only used by UI layer

### 3b. Token Errors (`packages/nostr-git/packages/ui/src/lib/utils/tokenErrors.ts`)

- **Purpose**: Token-related error types for better error handling
- **Classes**:
  - `TokenError` - Base error class for token-related errors
  - `TokenNotFoundError` - Thrown when no tokens found for a host
  - `AllTokensFailedError` - Thrown when all tokens for a host have been tried and failed
- **Note**: Moved from `@nostr-git/core` to UI package since it's only used by UI layer

## Git Service API Providers

### 4. GitHub API (`packages/nostr-git/packages/core/src/lib/git/providers/github.ts`)

- **Constructor**: `GitHubApi(token: string, baseUrl?: string)`
- **Usage**: `Authorization: token ${this.token}` header
- **Operations**: All GitHub API calls use the token

### 5. GitLab API (`packages/nostr-git/packages/core/src/lib/git/providers/gitlab.ts`)

- **Constructor**: `GitLabApi(token: string, baseUrl?: string)`
- **Usage**: `Authorization: Bearer ${this.token}` header
- **Operations**: All GitLab API calls use the token

### 6. Gitea API (`packages/nostr-git/packages/core/src/lib/git/providers/gitea.ts`)

- **Constructor**: `GiteaApi(token: string, baseUrl?: string)`
- **Usage**: `Authorization: token ${this.token}` header
- **Operations**: All Gitea API calls use the token

### 7. Bitbucket API (`packages/nostr-git/packages/core/src/lib/git/providers/bitbucket.ts`)

- **Constructor**: `BitbucketApi(token: string, baseUrl?: string)`
- **Usage**: `Authorization: Bearer ${this.token}` header
- **Operations**: All Bitbucket API calls use the token

### 8. GRASP API (`packages/nostr-git/packages/core/src/lib/git/providers/grasp.ts`)

- **Constructor**: `GraspApi(baseUrl: string, token: string)` (token is pubkey)
- **Usage**: Message-based authentication (not HTTP header)
- **Operations**: Smart HTTP Git operations

## Git Worker Operations

### 9. Worker Auth Config (`packages/nostr-git/packages/git-worker/src/lib/workers/auth.ts`)

- **Functions**:
  - `setAuthConfig(config: AuthConfig)` - Set tokens in worker
  - `getAuthCallback(url: string)` - Get auth callback for isomorphic-git
  - `getTokensForHost(hostname: string)` - Get all tokens for a host (internal matching logic)
  - `tryPushWithTokens()` - Try push with multiple tokens (fallback retry)
- **Storage**: In-memory `authConfig.tokens` array
- **Uses**: Inline token matching logic (not dependent on core package)
- **Error Handling**: Throws standard Error with details (no typed errors, as it's internal worker code)
- **Note**: Intended for internal worker operations only, not for API calls initiated from UI

### 10. Create Remote Repo (`packages/nostr-git/packages/git-worker/src/worker.ts`)

- **Function**: `createRemoteRepo({ provider, token, name, description, isPrivate, baseUrl })`
- **Line**: ~1429
- **Usage**: Creates repository via GitServiceApi with provided token
- **Fallback Retry**: ❌ No - UI layer handles token retry via `tryTokensForHost()`
- **Note**: Worker uses token directly; UI layer selects and retries with different tokens

### 11. Fork and Clone Repo (`packages/nostr-git/packages/git-worker/src/worker.ts`)

- **Function**: `forkAndCloneRepo({ owner, repo, forkName, visibility, token, dir, provider, baseUrl })`
- **Line**: ~1838
- **Usage**: Forks repository via GitServiceApi, then clones
- **Fallback Retry**: ❌ No - UI layer handles token retry via `tryTokensForHost()`
- **Note**: Worker uses token directly; UI layer selects and retries with different tokens

### 12. Push to Remote (`packages/nostr-git/packages/git-worker/src/worker.ts`)

- **Function**: `pushToRemote({ repoId, remoteUrl, branch, token, provider })`
- **Line**: ~1531
- **Usage**: Pushes to remote using provided token
- **Fallback Retry**: ❌ No - UI layer handles token retry via `tryTokensForHost()`
- **Note**: Worker uses token directly; UI layer selects and retries with different tokens

### 13. Clone and Fork (`packages/nostr-git/packages/git-worker/src/worker.ts`)

- **Function**: `cloneAndFork({ sourceUrl, targetHost, targetToken, targetUsername, targetRepo, ... })`
- **Line**: ~1057
- **Usage**: Clones source, creates target repo, pushes
- **Fallback Retry**: ✅ Yes - uses `tryPushWithTokens()` for internal git push operations
- **Note**: Internal operation that uses worker auth config for retry

### 14. Update Remote Repo Metadata (`packages/nostr-git/packages/git-worker/src/worker.ts`)

- **Function**: `updateRemoteRepoMetadata({ owner, repo, updates, token, provider, baseUrl })`
- **Line**: ~2058
- **Usage**: Updates repository metadata via GitServiceApi with provided token
- **Fallback Retry**: ❌ No - UI layer handles token retry via `tryTokensForHost()`
- **Note**: Worker uses token directly; UI layer selects and retries with different tokens

### 15. Update and Push Files (`packages/nostr-git/packages/git-worker/src/worker.ts`)

- **Function**: `updateAndPushFiles({ dir, files, commitMessage, token, provider, onProgress })`
- **Line**: ~2126
- **Usage**: Updates files, commits, and pushes with provided token
- **Fallback Retry**: ❌ No - UI layer handles token retry via `tryTokensForHost()`
- **Note**: Worker uses token directly; UI layer selects and retries with different tokens

## UI Hooks & Components

### 17. useNewRepo (`packages/nostr-git/packages/ui/src/lib/useNewRepo.svelte.ts`)

- **Function**: `createRemoteRepo(config)`
- **Token Usage**:
  - Line ~881: Uses `tryTokensForHost()` for repo creation with fallback retry
  - Line ~907: Passes token to `api.createRemoteRepo()`
  - Line ~1067: Uses `tryTokensForHost()` for initial push with fallback retry
  - Line ~1086: Passes token to `api.pushToRemote()`
- **Token Source**: `tokens` store, filtered by provider host

### 18. useForkRepo (`packages/nostr-git/packages/ui/src/lib/hooks/useForkRepo.svelte.ts`)

- **Function**: `forkRepository(originalRepo, config)`
- **Token Usage**:
  - Line ~335: Gets token from `tokens` store
  - Line ~398-426: Uses `tryTokensForHost()` for fork operations with fallback retry
  - Line ~412: Passes token to `gitWorkerApi.forkAndCloneRepo()`
- **Token Source**: `tokens` store, filtered by provider host

### 19. useEditRepo (`packages/nostr-git/packages/ui/src/lib/hooks/useEditRepo.svelte.ts`)

- **Function**: `editRepository(currentAnnouncement, currentState, config, editOptions)`
- **Token Usage**:
  - Line ~140: Uses `tryTokensForHost()` for metadata updates with fallback retry
  - Line ~193: Uses `tryTokensForHost()` for file push operations with fallback retry
  - Passes token to `updateRemoteRepoMetadata()` and `updateAndPushFiles()`
- **Token Source**: `tokens` store, filtered by provider host

### 20. useCloneRepo (`packages/nostr-git/packages/ui/src/lib/hooks/useCloneRepo.svelte.ts`)

- **Function**: `cloneRepository(url, destinationPath, depth)`
- **Token Usage**:
  - Line ~83-84: Gets tokens from store and filters by hostname
  - Line ~93-107: Uses `tryTokensForHost()` for clone operations with fallback retry
  - Line ~109-117: Falls back to cloning without token for public repositories
- **Token Source**: `tokens` store, filtered by hostname matching
- **Fallback Retry**: ✅ Yes - UI layer handles token retry via `tryTokensForHost()`

## Component Integration

### 21. Repo Component (`packages/nostr-git/packages/ui/src/lib/components/git/Repo.svelte.ts`)

- **Token Usage**:
  - Line ~304-313: Subscribes to `tokens` store and updates `WorkerManager` auth config
  - Line ~335-341: Waits for tokens initialization and configures worker auth
- **Purpose**: Keeps worker authentication in sync with token store

### 22. WorkerManager (`packages/nostr-git/packages/ui/src/lib/components/git/WorkerManager.ts`)

- **Token Usage**:
  - Line ~35: `AuthToken` interface: `{ host: string; token: string }`
  - Line ~87-91: Sets auth config in worker during initialization
  - Line ~489-493: `addAuthToken()` - Adds token to worker auth config
  - Line ~505: `removeAuthToken()` - Removes token from worker auth config
- **Purpose**: Manages token synchronization between UI and worker

### 23. ForkRepoDialog (`packages/nostr-git/packages/ui/src/lib/components/git/ForkRepoDialog.svelte`)

- **Token Usage**:
  - Line ~382: Gets tokens from store and filters by hostname
  - Line ~398-480: Uses `tryTokensForHost()` for fork existence checks with fallback retry
  - Checks for existing forks and repo name conflicts with token retry
- **Purpose**: Validates fork availability before creating fork
- **Fallback Retry**: ✅ Yes - UI layer handles token retry via `tryTokensForHost()`

## Vendor Providers (Legacy)

### 24. GitHub Provider (`packages/nostr-git/packages/core/src/lib/vendors/github-provider.ts`)

- **Functions**:
  - `createRepo(name, options, token)` - Line ~40
  - `getRepo(owner, repo, token)` - Line ~82
  - `updateRepo(owner, repo, options, token)` - Line ~127
  - `forkRepo(owner, repo, options, token)` - Line ~184
  - `getAuthHeaders(token)` - Line ~321

### 25. GitLab Provider (`packages/nostr-git/packages/core/src/lib/vendors/gitlab-provider.ts`)

- **Functions**:
  - `createRepo(name, options, token)` - Line ~41
  - `getRepo(owner, repo, token)` - Line ~78
  - `updateRepo(owner, repo, options, token)` - Line ~122
  - `forkRepo(owner, repo, options, token)` - Line ~178
  - `getAuthHeaders(token)` - Line ~258

## Multi-Vendor Git Provider

### 26. MultiVendorGitProvider (`packages/nostr-git/packages/core/src/lib/multi-vendor-git-provider.ts`)

- **Functions**:
  - `setTokens(tokens: Array<{ host: string; token: string }>)` - Line ~25
  - `getToken(hostname: string)` - Line ~32
- **Purpose**: Manages tokens for multiple Git hosts

### 27. setGitTokens (`packages/nostr-git/packages/core/src/lib/git-provider.ts`)

- **Function**: `setGitTokens(tokens: Array<{ host: string; token: string }>)` - Line ~44
- **Purpose**: Configures tokens for the multi-vendor provider

## HTTP Adapters

### 28. GitHub HTTP (`packages/nostr-git/packages/core/src/lib/github-http.ts`)

- **Function**: `makeGitHubHttp(token: string)` - Line ~3
- **Usage**: Creates HTTP client with `Authorization: Basic x-access-token:${token}` header
- **Purpose**: For isomorphic-git HTTP operations

## Factory Functions

### 29. Git Service API Factory (`packages/nostr-git/packages/core/src/lib/git/factory.ts`)

- **Function**: `getGitServiceApi(provider, token, baseUrl?)` - Line ~39
- **Usage**: Creates appropriate GitServiceApi instance with token
- **Called From**: Multiple places including `useNewRepo`, `useForkRepo`, worker operations

## Terminal/CLI Integration

### 30. Terminal Component (`packages/nostr-git/packages/ui/src/lib/components/terminal/Terminal.svelte`)

- **Token Usage**:
  - Line ~646: Gets tokens from store and filters by hostname
  - Line ~667-684: Uses `tryTokensForHost()` for git push operations with fallback retry
  - Handles both explicit token and token store scenarios
- **Purpose**: Git push operations from terminal interface
- **Fallback Retry**: ✅ Yes - UI layer handles token retry via `tryTokensForHost()`

### 31. Git CLI Adapter (`packages/nostr-git/packages/ui/src/lib/components/terminal/git-cli-adapter.ts`)

- **Interface**: `GitCliContext.getAuthToken?: (host: string) => Promise<string | undefined>` - Line ~11
- **Purpose**: Optional token provider for terminal git operations

## App-Level Token Management

### 32. GitAuth Component (`src/app/components/GitAuth.svelte`)

- **Purpose**: UI for managing tokens in the app

### 33. GitAuthAdd Component (`src/app/components/GitAuthAdd.svelte`)

- **Function**: `saveTokens(toks: TokenEntry[])` - Line ~47
- **Usage**: Saves encrypted tokens to localStorage using NIP-04 encryption
- **Storage Key**: Uses app-specific key for localStorage


### Pattern 1: UI Layer Token Retry (Primary Pattern)

- **Usage**: UI hooks use `tryTokensForHost()` to select and retry with multiple tokens
- **Examples**: 
  - `useNewRepo.createRemoteRepo()` - retries repo creation
  - `useForkRepo.forkRepository()` - retries fork operations
  - `useEditRepo.editRepository()` - retries metadata updates and file pushes
- **Fallback**: ✅ Yes - UI layer tries all tokens for the host until one succeeds
- **Architecture**: UI layer owns token selection and retry for all API operations

### Pattern 2: Worker Direct Token Usage

- **Usage**: Worker functions receive token parameter and use it directly
- **Examples**: `createRemoteRepo`, `forkAndCloneRepo`, `updateRemoteRepoMetadata`, `pushToRemote`, `updateAndPushFiles`
- **Fallback**: ❌ No - worker doesn't retry, UI layer handles retry before calling worker
- **Note**: Clear separation - UI handles token selection, worker just uses provided token

### Pattern 3: Worker Auth Config (Internal Operations Only)

- **Usage**: Tokens stored in worker via `setAuthConfig()` for internal operations
- **Examples**: `cloneAndFork`, `applyPatchAndPushUtil` - internal git push operations
- **Fallback**: ✅ Yes - `tryPushWithTokens()` provides fallback retry using worker auth config
- **Note**: Only used for internal operations that don't receive tokens from UI layer

### Pattern 4: GitServiceApi Instance

- **Usage**: Token passed to API provider constructor, used for all API calls
- **Examples**: GitHubApi, GitLabApi, GiteaApi, BitbucketApi
- **Fallback**: ❌ No - API providers don't implement retry (standard best practice)
- **Note**: Retry logic is handled at the UI layer before creating API instances

## Summary

**Total Token Usage Locations**: 34+ distinct locations

**Categories**:

- Storage & Management: 5 locations (includes token matcher and errors)
- Git Service API Providers: 5 locations
- Git Worker Operations: 7 locations
- UI Hooks & Components: 4 locations
- Component Integration: 3 locations
- Vendor Providers (Legacy): 2 locations
- Multi-Vendor Provider: 2 locations
- HTTP Adapters: 1 location
- Factory Functions: 1 location
- Terminal/CLI: 2 locations
- App-Level: 3 locations

**Fallback Retry Support**:

- ✅ **UI Layer Retry** (Primary Pattern):
  - `useNewRepo` (repo creation & push) - retries at UI layer
  - `useForkRepo` (fork operations) - retries at UI layer
  - `useEditRepo` (metadata update & file push) - retries at UI layer
  - `useCloneRepo` (clone operations) - retries at UI layer
  - `ForkRepoDialog` (fork existence checks) - retries at UI layer
  - `Terminal.svelte` (git push operations) - retries at UI layer
  - `GitActions.svelte` (push local changes) - retries at UI layer

- ✅ **Worker Layer Retry** (Internal Operations Only):
  - `cloneAndFork` (internal clone-and-fork) - uses worker auth config
  - `applyPatchAndPushUtil` (patch merge/push) - uses worker auth config

- ❌ **No Worker Retry** (UI Handles):
  - `createRemoteRepo` (worker operation) - UI handles retry
  - `forkAndCloneRepo` (worker operation) - UI handles retry
  - `updateRemoteRepoMetadata` (worker operation) - UI handles retry
  - `pushToRemote` (general push) - UI handles retry
  - `updateAndPushFiles` (file updates with push) - UI handles retry

**Implementation Details**:
- **UI Layer**: Uses `tryTokensForHost()` from `tokenHelpers.ts` to retry with multiple tokens for all API operations
- **Worker Layer**: 
  - Uses provided token directly (no retry) for operations called from UI
  - Uses `tryPushWithTokens()` from `auth.ts` only for internal git push operations
  - Uses inline token matching logic (not dependent on UI package token matcher)
- **Separation of Concerns**:
  - **UI Layer**: Owns token selection and retry for API operations (GitHub/GitLab API calls)
  - **Worker Layer**: Uses provided tokens directly; only handles retry for internal operations
- **Token Matching**: 
  - **UI Package**: Centralized in `packages/ui/src/lib/utils/tokenMatcher.ts` - used by all UI components
  - **Worker Package**: Inline matching logic in `auth.ts` - independent implementation
- **Token Source**: 
  - UI operations: Tokens from `tokens` store, filtered by hostname matching
  - Internal operations: Tokens from worker auth config (synced from UI store)
- **Fallback Behavior**: UI layer tries all tokens until one succeeds or all fail
- **Error Handling**: 
  - UI layer uses typed errors (`TokenNotFoundError`, `AllTokensFailedError`) from `tokenErrors.ts`
  - Worker layer uses standard Error objects with error details

**Recent Improvements** (2024):

1. ✅ **COMPLETED**: Added centralized token matching utility (`tokenMatcher.ts` in UI package)
2. ✅ **COMPLETED**: Moved token matcher and errors from core to UI package (where they're actually used)
3. ✅ **COMPLETED**: Refactored to eliminate duplicate retry logic
4. ✅ **COMPLETED**: Removed worker-level retry from API operations (UI layer handles)
5. ✅ **COMPLETED**: Removed `apiHelpers.ts` (no longer needed)
6. ✅ **COMPLETED**: Added typed error handling (`TokenError`, `AllTokensFailedError`, `TokenNotFoundError`)
7. ✅ **COMPLETED**: Removed token information from console logs (security improvement)
8. ✅ **COMPLETED**: Updated all UI hooks to use `tryTokensForHost()` for token retry
9. ✅ **COMPLETED**: Added token retry to `ForkRepoDialog` for fork existence checks
10. ✅ **COMPLETED**: Added token retry to `Terminal.svelte` for git push operations
11. ✅ **COMPLETED**: Added token retry to `GitActions.svelte` for push operations
12. ✅ **COMPLETED**: Updated `useCloneRepo` to use proper token retry logic
13. ✅ **COMPLETED**: Updated `useEditRepo` to use token retry for both metadata and push operations

**Current Status**: 
- Clear separation of concerns - UI layer handles token retry for all API operations, worker layer only handles retry for internal git operations
- No duplicate retry logic
- Token matching utilities are in UI package (where they're used)
- Worker uses inline matching for independence
- All UI entry points now use `tryTokensForHost()` for consistent token retry behavior
- Token retry is implemented everywhere tokens are required for API operations
