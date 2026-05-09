# Coding Standards

This document defines the coding standards and conventions used throughout the Nostr-Git project to ensure consistency and maintainability.

## Code Style

### TypeScript/JavaScript

#### Formatting

- **Prettier** configuration enforces consistent formatting
- **2 spaces** for indentation
- **Single quotes** for strings
- **Trailing commas** where valid
- **Semicolons** required

```typescript
// ✅ Good
const config = {
  name: "nostr-git",
  version: "1.0.0",
}

// ❌ Bad
const config = {
  name: "nostr-git",
  version: "1.0.0",
}
```

#### Naming Conventions

**Variables and Functions**: camelCase

```typescript
const userName = "alice"
function createEvent() {}
```

**Constants**: SCREAMING_SNAKE_CASE

```typescript
const GIT_REPO_ANNOUNCEMENT = 30617
const MAX_RETRY_ATTEMPTS = 3
```

**Types and Interfaces**: PascalCase

```typescript
interface NostrEvent {
  id: string
  kind: number
}

type GitResult<T> = Success<T> | Error
```

**Classes**: PascalCase

```typescript
class EventHandler {
  private events: NostrEvent[] = []
}
```

**Files and Directories**: kebab-case

```
git-worker.ts
merge-analysis.ts
shared-types/
```

### Import/Export Standards

#### Import Order

1. Node.js built-ins
2. External dependencies
3. Internal packages (workspace)
4. Relative imports

```typescript
// ✅ Good
import {readFile} from "fs/promises"
import {Event} from "nostr-tools"
import type {GitRepository} from "@nostr-git/shared-types"
import {logger} from "../utils/logger.js"
import type {LocalConfig} from "./types.js"
```

#### Export Patterns

- Prefer **named exports** over default exports
- Use **barrel exports** in `index.ts` files
- Include `.js` extension for ESM compatibility

```typescript
// ✅ Good - Named exports
export class GitProvider {}
export function createEvent() {}

// ✅ Good - Barrel export
export {GitProvider} from "./git-provider.js"
export {createEvent} from "./event.js"

// ❌ Avoid - Default exports in libraries
export default class GitProvider {}
```

### Error Handling

#### Result Types

Use Result types instead of throwing exceptions for expected errors:

```typescript
export type Result<T, E = Error> = {success: true; data: T} | {success: false; error: E}

// Usage
export async function cloneRepository(url: string): Promise<Result<Repository>> {
  try {
    const repo = await git.clone(url)
    return {success: true, data: repo}
  } catch (error) {
    return {
      success: false,
      error: new Error(`Failed to clone: ${error.message}`),
    }
  }
}
```

#### Error Types

Define specific error types for different failure modes:

```typescript
export interface GitError {
  code: "REPO_NOT_FOUND" | "INVALID_URL" | "NETWORK_ERROR"
  message: string
  details?: unknown
}
```

### Async/Await Patterns

#### Prefer async/await over Promises

```typescript
// ✅ Good
async function processEvents(events: NostrEvent[]) {
  for (const event of events) {
    await handleEvent(event)
  }
}

// ❌ Avoid
function processEvents(events: NostrEvent[]) {
  return events.reduce(
    (promise, event) => promise.then(() => handleEvent(event)),
    Promise.resolve(),
  )
}
```

#### Error Handling with async/await

```typescript
// ✅ Good
async function safeOperation() {
  try {
    const result = await riskyOperation()
    return {success: true, data: result}
  } catch (error) {
    logger.error("Operation failed", error)
    return {success: false, error}
  }
}
```

## Svelte Component Standards

### Component Structure

```svelte
<!-- 8. Styles (if needed) -->
<style>
  .event-card {
    @apply rounded-lg border p-4;
  }
</style>

<script lang="ts">
  // 1. Imports
  import type {NostrEvent} from "@nostr-git/shared-types"
  import {Button} from "$lib/components"

  // 2. Props interface
  interface Props {
    event: NostrEvent
    readonly?: boolean
    onAction?: (action: string) => void
  }

  // 3. Props destructuring with defaults
  let {event, readonly = false, onAction}: Props = $props()

  // 4. State variables (using runes)
  let expanded = $state(false)
  let loading = $state(false)

  // 5. Derived state
  const isValid = $derived(event.sig && event.id)

  // 6. Functions
  function handleToggle() {
    expanded = !expanded
  }
</script>

<!-- 7. Template -->
<div class="event-card">
  <Button onclick={handleToggle}>
    {expanded ? "Collapse" : "Expand"}
  </Button>
</div>
```

### Prop Naming

- Use descriptive names
- Boolean props should be adjectives (`readonly`, `disabled`)
- Event handlers should start with `on` (`onAction`, `onSubmit`)

### State Management

- Use Svelte 5 runes (`$state`, `$derived`, `$effect`)
- Keep component state minimal
- Lift state up when shared between components

## CSS/Styling Standards

### TailwindCSS Usage

- Use Tailwind utility classes primarily
- Create custom components for repeated patterns
- Use `@apply` sparingly in component styles

```svelte
<!-- ✅ Good - Utility classes -->
<div class="flex items-center gap-4 p-4 bg-white rounded-lg shadow">

<!-- ✅ Good - Custom component class -->
<div class="btn-primary">

<!-- ❌ Avoid - Inline styles -->
<div style="display: flex; padding: 16px;">
```

### Custom CSS

When custom CSS is needed:

```css
/* Use CSS custom properties for theming */
.btn-primary {
  @apply rounded px-4 py-2 font-medium;
  background-color: var(--color-primary);
  color: var(--color-primary-foreground);
}
```

## Documentation Standards

### Code Comments

- Use JSDoc for public APIs
- Explain **why**, not **what**
- Include examples for complex functions

````typescript
/**
 * Creates a Nostr event for a Git repository announcement.
 *
 * This follows NIP-34 specification for Git collaboration events.
 * The event includes repository metadata and discovery tags.
 *
 * @param repo - Repository metadata
 * @returns Unsigned Nostr event (requires signing)
 *
 * @example
 * ```typescript
 * const repo = { name: 'my-repo', url: 'https://github.com/user/repo' };
 * const event = createRepoEvent(repo);
 * const signed = await signEvent(event, privateKey);
 * ```
 */
export function createRepoEvent(repo: GitRepository): UnsignedEvent {
  // Implementation details...
}
````

### Type Documentation

```typescript
/**
 * Represents a Git repository in the Nostr network.
 *
 * @interface GitRepository
 */
export interface GitRepository {
  /** Repository name (should match Git remote name) */
  name: string

  /** Clone URL for the repository */
  url: string

  /** Optional description for discovery */
  description?: string

  /** Repository maintainers' public keys */
  maintainers: string[]
}
```

## Testing Standards

### Test File Organization

- Test files alongside source: `event.test.ts`
- Integration tests in `__tests__/` directory
- Use descriptive test names

```typescript
describe("createRepoEvent", () => {
  it("should create valid NIP-34 repo announcement event", () => {
    // Test implementation
  })

  it("should include all required tags for repository discovery", () => {
    // Test implementation
  })

  it("should handle repositories without descriptions", () => {
    // Test implementation
  })
})
```

### Test Structure

```typescript
// Arrange
const repo = {
  name: "test-repo",
  url: "https://github.com/test/repo",
  maintainers: ["pubkey1"],
}

// Act
const event = createRepoEvent(repo)

// Assert
expect(event.kind).toBe(GIT_REPO_ANNOUNCEMENT)
expect(event.tags).toContainEqual(["r", repo.url])
```

## Git Workflow

### Branch Naming

- `feature/short-description` - New features
- `fix/issue-description` - Bug fixes
- `docs/update-description` - Documentation
- `refactor/component-name` - Code refactoring
- `chore/task-description` - Maintenance tasks

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types**:

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples**:

```
feat(core): add pull request creation functionality

fix(ui): resolve component rendering issue in Safari

docs(readme): update installation instructions

refactor(git-wrapper): simplify provider interface
```

### Pull Request Guidelines

#### PR Title

Use the same format as commit messages:

```
feat(ui): add repository browser component
```

#### PR Description Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Checklist

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings introduced
```

## Package-Specific Standards

### Core Package

- Pure TypeScript, no UI dependencies
- Comprehensive error handling with Result types
- Web Workers for heavy operations
- Full JSDoc documentation for public APIs

### UI Package

- Svelte 5 with TypeScript
- TailwindCSS for styling
- Accessible components (ARIA attributes)

### Shared Types Package

- Only type definitions and constants
- No runtime dependencies
- Comprehensive JSDoc for all types
- Export all types from index.ts

### Extensions

- Follow platform-specific guidelines (Chrome MV3, VSCode API)
- Secure message passing between contexts
- Graceful error handling and user feedback
- Platform-specific build configurations

## Performance Guidelines

### Bundle Size

- Use dynamic imports for large dependencies
- Tree-shaking friendly exports
- Avoid importing entire libraries

```typescript
// ✅ Good - Tree-shakable import
import {signEvent} from "nostr-tools/event"

// ❌ Bad - Imports entire library
import * as nostr from "nostr-tools"
```

### Memory Management

- Clean up event listeners and subscriptions
- Use WeakMap/WeakSet for object references
- Implement proper cleanup in Web Workers

### Async Operations

- Use streaming for large data sets
- Implement proper cancellation
- Avoid blocking the main thread

These standards ensure consistency across the codebase and make it easier for new contributors to understand and maintain the project.
