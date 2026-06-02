# AI Context Guide

This document provides essential context for LLMs working on the Nostr-Git project, including coding conventions, patterns, and domain-specific knowledge.

## Project-Specific Coding Conventions

### File Organization

- **Barrel exports**: Use `index.ts` files to re-export public APIs
- **Feature-based structure**: Group related functionality in dedicated directories
- **Separation of concerns**: Keep UI, logic, and types in separate packages

### Naming Conventions

- **Packages**: kebab-case with `@nostr-git/` scope (e.g., `@nostr-git/core`)
- **Files**: kebab-case for files (e.g., `git-worker.ts`, `merge-analysis.ts`)
- **Classes**: PascalCase (e.g., `GitProvider`, `EventHandler`)
- **Functions**: camelCase (e.g., `createPullRequestEvent`, `parseRepoState`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `GIT_REPO_ANNOUNCEMENT`, `GIT_PULL_REQUEST`)
- **Types**: PascalCase with descriptive suffixes (e.g., `NostrEvent`, `GitRepoState`)

### Import/Export Patterns

```typescript
// Preferred: Named exports with .js extension for ESM compatibility
export {createEvent, parseEvent} from "./event.js"

// Avoid: Default exports for libraries
export default class GitProvider {} // ❌

// Prefer: Named exports
export class GitProvider {} // ✅
```

## Domain-Specific Terminology

### Nostr Protocol Terms

- **Event**: A signed JSON object that represents data on Nostr
- **Kind**: Numeric identifier for event types (e.g., 30617 for repo announcements)
- **Tag**: Key-value metadata attached to events (e.g., `["r", "repo-url"]`)
- **Relay**: Server that stores and forwards Nostr events
- **NIP**: Nostr Implementation Possibility (protocol specifications)

### Git Integration Terms

- **Pull Request Event**: Nostr event proposing Git changes (kind 1618)
- **Repo Announcement**: Event declaring a Git repository (kind 30617)
- **Repo State**: Event containing repository metadata (kind 30618)
- **Issue Event**: Git issue represented as Nostr event (kind 1621)

### Project-Specific Terms

- **ngit**: Short name for "Nostr Git" used in CLI and extensions
- **Git Provider**: Abstraction layer for different Git backends
- **Event Handler**: Component that processes incoming Nostr events
- **Worker Client**: Interface for communicating with Web Workers

## Preferred Libraries & Rationale

### Core Dependencies

- **nostr-tools**: Standard Nostr library with event signing/verification
- **isogit**: Pure JavaScript Git implementation for browser compatibility
- **diff**: Text diffing for patch generation

### UI Dependencies

- **Svelte 5**: Modern reactive framework with runes API
- **TailwindCSS**: Utility-first CSS with custom preset
- **bits-ui**: Headless UI components for Svelte
- **Lucide Svelte**: Icon library

### Development Tools

- **TypeScript**: Strict mode enabled for type safety
- **ESLint**: Code linting with Prettier integration
- **pnpm**: Package manager for monorepo efficiency

## Code Organization Principles

### Package Structure

```
packages/
├── core/                 # Core business logic
│   ├── src/lib/         # Main library code
│   ├── src/workers/     # Web Worker implementations
│   └── dist/            # Compiled output
├── ui/                  # Svelte components
│   ├── src/lib/         # Component library
│   └── dist/            # Compiled components
└── shared-types/        # TypeScript definitions
    └── src/             # Type definitions
```

### Module Boundaries

- **Core**: No UI dependencies, pure business logic
- **UI**: Depends on core and shared-types only
- **Extensions**: Can depend on all packages
- **Shared-types**: No dependencies on other packages

## Error Handling Strategies

### Error Types

```typescript
// Use discriminated unions for error handling
export type GitResult<T> = {success: true; data: T} | {success: false; error: GitError}

export interface GitError {
  code: "REPO_NOT_FOUND" | "INVALID_PULL_REQUEST" | "NETWORK_ERROR"
  message: string
  details?: unknown
}
```

### Async Error Patterns

```typescript
// Prefer Result types over throwing
export async function createPullRequest(repo: string): Promise<GitResult<PullRequest>> {
  try {
    const pullRequest = await generatePullRequest(repo)
    return {success: true, data: pullRequest}
  } catch (error) {
    return {
      success: false,
      error: {
        code: "INVALID_PULL_REQUEST",
        message: "Failed to create pull request",
        details: error,
      },
    }
  }
}
```

## Testing Approaches

### Unit Testing

- Use Vitest for fast unit tests
- Mock external dependencies (Git, Nostr relays)
- Test pure functions extensively

### Integration Testing

- Test package boundaries
- Verify event serialization/deserialization
- Test Git operations with temporary repositories

### Component Testing

- Use @testing-library/svelte for component tests
- Test user interactions and state changes
- Mock external services

## Security Considerations

### Private Key Handling

```typescript
// Never log or store private keys
export function signEvent(event: UnsignedEvent, privateKey: string): NostrEvent {
  // Use private key only for signing, never store
  const signedEvent = signEventWithKey(event, privateKey)
  // Clear sensitive data from memory if possible
  return signedEvent
}
```

### Input Validation

```typescript
// Validate all external inputs
export function parseNostrEvent(data: unknown): NostrEvent | null {
  if (!isValidEventStructure(data)) {
    return null
  }
  return data as NostrEvent
}
```

### Git Operations

- Sanitize file paths to prevent directory traversal
- Validate Git URLs before cloning
- Use read-only operations when possible

## Performance Patterns

### Event Processing

```typescript
// Use streaming for large event sets
export async function* processEvents(events: AsyncIterable<NostrEvent>) {
  for await (const event of events) {
    const processed = await processEvent(event)
    if (processed) yield processed
  }
}
```

### Memory Management

```typescript
// Clean up resources in workers
export class GitWorker {
  private cleanup() {
    // Clear caches, close file handles, etc.
  }

  terminate() {
    this.cleanup()
    self.close()
  }
}
```

## Common Patterns

### Event Creation Pattern

```typescript
export function createRepoEvent(repo: GitRepository): NostrEvent {
  return {
    kind: GIT_REPO_ANNOUNCEMENT,
    content: JSON.stringify(repo.metadata),
    tags: [
      ["r", repo.url],
      ["name", repo.name],
      ["description", repo.description],
    ],
    created_at: Math.floor(Date.now() / 1000),
    pubkey: "", // Set by caller
    id: "", // Set during signing
    sig: "", // Set during signing
  }
}
```

### Worker Communication Pattern

```typescript
// Type-safe worker messages
export interface WorkerMessage {
  id: string
  type: "GIT_CLONE" | "GIT_STATUS"
  payload: unknown
}

export interface WorkerResponse {
  id: string
  success: boolean
  data?: unknown
  error?: string
}
```

### Svelte Component Pattern

```svelte
<script lang="ts">
  import type {NostrEvent} from "@nostr-git/shared-types"

  interface Props {
    event: NostrEvent
    onAction?: (action: string) => void
  }

  let {event, onAction}: Props = $props()

  // Use runes for reactivity
  let expanded = $state(false)
</script>
```

## Build and Development Patterns

### Package.json Scripts

- `build`: TypeScript compilation
- `watch`: Development mode with file watching
- `typecheck`: Type checking without emission
- `format`: Prettier formatting
- `lint`: ESLint with Prettier integration

### TypeScript Configuration

- Strict mode enabled
- ESM modules with `.js` extensions in imports
- Path mapping for package imports
- Declaration file generation

## Integration Points

### Extension Integration

- Extensions communicate with core via message passing
- Use content scripts for DOM manipulation
- Background scripts for Nostr operations

## Debugging Guidelines

### Logging Strategy

```typescript
// Use structured logging
export const logger = {
  debug: (message: string, context?: object) => {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[nostr-git] ${message}`, context)
    }
  },
  error: (message: string, error?: Error) => {
    console.error(`[nostr-git] ${message}`, error)
  },
}
```

### Development Tools

- Use browser DevTools for extension debugging
- VSCode debugger for Node.js components

This context should help LLMs understand the project's patterns, conventions, and architectural decisions when working on the Nostr-Git codebase.
