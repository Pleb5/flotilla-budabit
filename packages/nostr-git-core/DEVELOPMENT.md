# Development Guide

This guide covers local development setup, workflows, and best practices for the Nostr-Git project.

## Prerequisites

### Required Software

- **Node.js**: Version 18.0.0 or higher
- **pnpm**: Version 8.0.0 or higher (preferred package manager)
- **Git**: Version 2.30.0 or higher

### Recommended VSCode Extensions

- **Svelte for VS Code**: Svelte language support
- **TypeScript and JavaScript**: Enhanced TypeScript support
- **Prettier**: Code formatting
- **ESLint**: Code linting
- **Tailwind CSS IntelliSense**: TailwindCSS support

## Initial Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/your-org/nostr-git.git
cd nostr-git

# Install dependencies for all packages
pnpm install

# Verify installation
pnpm --version
node --version
```

## Canonical Tag Helpers (Required)

- Always use `@nostr-git/shared-types` helpers to access tags on Nostr events:
  - `getTag(event, tagName)`
  - `getTags(event, tagName)`
  - `getTagValue(event, tagName)`

- Do not use `event.tags.find` or `event.tags.filter` directly in application code.
  - A repo-wide ESLint rule enforces this. Violations will fail CI.

### Rationale

- Provides consistent, type-safe behavior across packages and future-proofs parsing logic.
- Centralizes NIP-34 tag shape knowledge in `packages/shared-types/`.

### Examples

```ts
import {getTag, getTags, getTagValue} from "@nostr-git/shared-types"

// First committer tag
const committer = getTag(event, "committer")

// All clone tags in order
const clones = getTags(announcement, "clone")

// Single value from first matching tag
const repoUrl = getTagValue(announcement, "r")
```

## Runtime Validation (Zod)

For optional runtime guarantees, `@nostr-git/shared-types` exposes Zod schemas and helpers in `src/validation.ts`.

- **Tag tuple schemas**: NIP-34 tag shapes (e.g., `DTag`, `CloneTag`, `RefsTag`, `CommitterTag`).
- **Per-kind tag arrays**: `RepoAnnouncementTagsSchema`, `RepoStateTagsSchema`, `IssueTagsSchema`, `StatusTagsSchema`.
- **Per-kind strict event schemas**: `RepoAnnouncementEventSchema`, `RepoStateEventSchema`, `IssueEventSchema`, `StatusEventSchema`.
- **Helpers**: `assertValidTags(event)`, `safeParseEventTags(event)`, and `validate*Tags(...)` / `validate*Event(...)` convenience functions.

Example:

```ts
import {validateRepoAnnouncementEvent, validateIssueTags} from "@nostr-git/shared-types"

const evt = {
  kind: 30617,
  content: "",
  tags: [
    ["d", "repo-id"],
    ["clone", "https://git"],
  ],
}
const ok = validateRepoAnnouncementEvent(evt)
if (!ok.success) console.error(ok.error.format())

const tagsOk = validateIssueTags([
  ["a", "30617:<owner>:<repo>"],
  ["p", "npub1..."],
  ["subject", "Bug report"],
])
```

Notes:

- Runtime validation is optional; prefer canonical helpers for normal reads.
- Use strict schemas in boundaries (ingress/egress, tests) or when dealing with untrusted inputs.

### Feature Flag: NOSTR_GIT_VALIDATE_EVENTS

Runtime validation guards are feature-flagged for performance flexibility.

- Default behavior: enabled when `NODE_ENV !== 'production'`, disabled in production.
- Explicit toggle via env var `NOSTR_GIT_VALIDATE_EVENTS` (case-insensitive):
  - Truthy: `true`, `1`, `yes`
  - Falsy: `false`, `0`, `no`

Examples:

```bash
# Enable validation explicitly
NOSTR_GIT_VALIDATE_EVENTS=true pnpm -w --filter @nostr-git/core test

# Disable validation even in development
NOSTR_GIT_VALIDATE_EVENTS=false pnpm -r test
```

### Guards and Where to Apply Them

- Core (`@nostr-git/core`):
  - `assertRepoAnnouncementEvent(evt)`, `assertRepoStateEvent(evt)` throw on invalid events when enabled.
  - Apply at ingress points like `fetchRepo`, constructors, and any boundary receiving Nostr events.

- Git-Wrapper (`@nostr-git/git-wrapper`):
  - Discovery ignores invalid announcements.
  - State subscription rejects invalid state events.
  - Collaboration streams (pull request/issue/status) deliver only valid events.

- Extension (`@nostr-git/extension`):
  - `fetchRepoEvent()` filters invalid announcements.
  - `publishEvent()` preflight validates outgoing repo announcement, repo state, and issue events before signing/publishing.

### Testing Guidance

- In Vitest, set the env per test or suite:

```ts
// validation.spec.ts
import {beforeEach} from "vitest"

beforeEach(() => {
  process.env.NOSTR_GIT_VALIDATE_EVENTS = "true"
})
```

- Verify both modes:
  - Enabled: invalid inputs should throw (or be filtered/ignored depending on path).
  - Disabled: guards should be no-ops and not throw.

- Extension tests: mock NIP-07 signing and relay pool querying; assert that invalid events are filtered prior to being surfaced or published.

## Compile-time Type Assertions (tsd)

We use `tsd` to assert helper typings and prevent regressions.

- Test file: `packages/shared-types/index.test-d.ts`
- Script: `pnpm -w --filter @nostr-git/shared-types tsd`
- CI: `.github/workflows/shared-types-ci.yml` runs `tsd` after build/tests.

Snippet:

```ts
// index.test-d.ts
import {expectType} from "tsd"
import type {getTag, getTagValue, IssueEvent} from "./dist/index.d.ts"

declare const issue: IssueEvent
const _getTag: typeof getTag = null as any
const _getTagValue: typeof getTagValue = null as any

const subject = _getTag(issue, "subject")
expectType<["subject", string] | undefined>(subject)

const subjectValue = _getTagValue(issue, "subject")
expectType<string | undefined>(subjectValue)
```

### 2. Build All Packages

```bash
# Build all packages in dependency order
pnpm build

# Verify builds completed successfully
ls packages/*/dist
```

### 3. Verify Setup

```bash
# Run type checking across all packages
pnpm -r typecheck

# Run linting
pnpm -r lint

# Run formatting check
pnpm -r format
```

## Development Workflow

### Starting Development

```bash
# Core package watch (tsc + worker bundle, fail-fast)
pnpm watch

# One-off local build
pnpm build

# In the app root, run everything together (app + core + ui)
pnpm dev:full
```

### Package-Specific Development

```bash
# Work on core library
cd packages/nostr-git-core
pnpm watch          # TypeScript compilation in watch mode
pnpm typecheck      # Type checking
pnpm test           # Run tests

# Work on UI components
cd ../nostr-git-ui
pnpm watch          # Svelte compilation + CSS copying
pnpm build          # Production build
```

## Environment Configuration

### Environment Variables

Create a `.env.local` file in the project root:

```bash
# Development environment
NODE_ENV=development

# Nostr relay configuration (optional for development)
NOSTR_RELAY_URL=wss://relay.example.com

# Git provider configuration
GIT_PROVIDER=isogit

# Debug logging
DEBUG=nostr-git:*
```

### Package-Specific Configuration

#### Core Package

- Uses `tsconfig.json` for TypeScript compilation
- ESM modules with `.js` extensions in imports
- Web Workers for background Git operations

#### UI Package

- Svelte 5 with runes API
- TailwindCSS with custom preset
- PostCSS for CSS processing

#### Extensions

- Manifest V3 for browser extension

## Testing

### Running Tests

```bash
# Run all tests
pnpm -r test

# Run tests for specific package
cd packages/core
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests with coverage
pnpm test --coverage
```

### Test Structure

```
packages/core/
├── src/
│   ├── lib/
│   │   ├── event.ts
│   │   └── event.test.ts     # Unit tests
│   └── __tests__/
│       └── integration.test.ts  # Integration tests
```

### Writing Tests

```typescript
// Unit test example
import {describe, it, expect} from "vitest"
import {createRepoEvent} from "./event.js"

describe("createRepoEvent", () => {
  it("should create valid repo announcement event", () => {
    const repo = {name: "test-repo", url: "https://github.com/test/repo"}
    const event = createRepoEvent(repo)

    expect(event.kind).toBe(30617)
    expect(event.tags).toContainEqual(["r", repo.url])
  })
})
```

## Debugging

### Browser Extension Debugging

```bash
# Build Chrome MV3 bundle (development)
cd packages/extension
pnpm build:chrome

# Load unpacked extension in Chrome
# 1. Go to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select packages/extension/dist/nostr-github-extension

# Optional: build Firefox bundle (for testing in Firefox)
pnpm build:firefox
```

Notes:

- **Viewer base URL**: set in the popup. Input is normalized to include scheme and trailing slash; default is `https://njump.me/`.
- **Confirm dialogs**: shown before repo announcements and permalinks; cancel shows a gentle cancel snackbar.
- **Snackbars**: persistent until dismissed; auto-dismiss 5s (success/error) or 3s (cancel). Animated fade/slide; respects reduced motion.
- **Debug option visibility**: a compile-time flag controls visibility in the popup. In development it is visible by default; in release builds it can be hidden with `NOSTR_GIT_SHOW_DEBUG=false`.

### Core Library Debugging

```typescript
// Enable debug logging
import {logger} from "./logger.js"

logger.debug("Processing event", {eventId: event.id})
```

## Common Development Tasks

### Adding a New Package

```bash
# Create package directory
mkdir packages/new-package
cd packages/new-package

# Initialize package.json
pnpm init

# Add to workspace (automatic with pnpm)
# Update root package.json workspaces if needed
```

### Adding Dependencies

```bash
# Add dependency to specific package
pnpm --filter @nostr-git/core add lodash

# Add dev dependency
pnpm --filter @nostr-git/ui add -D @types/node

# Add dependency to root (for tooling)
pnpm add -D -w prettier
```

### Cross-Package Dependencies

```bash
# Link local packages
pnpm --filter @nostr-git/ui add @nostr-git/shared-types

# This creates a workspace link automatically
```

## Build and Release

### Building for Production

```bash
# Clean all build artifacts
pnpm -r clean

# Build all packages
pnpm build

# Verify build outputs
pnpm -r publint  # Check package.json exports
```

### Publishing Packages

```bash
# Build and publish specific package
cd packages/core
pnpm build
pnpm publish --access public

# Publish all changed packages (using changeset)
pnpm changeset
pnpm changeset version
pnpm changeset publish
```

## Troubleshooting

### Common Issues

#### TypeScript Compilation Errors

```bash
# Clear TypeScript cache
pnpm -r exec tsc --build --clean

# Rebuild all packages
pnpm build
```

#### Package Resolution Issues

```bash
# Clear node_modules and reinstall
rm -rf node_modules packages/*/node_modules
pnpm install
```

#### Extension Loading Issues

```bash
# Rebuild extension
cd packages/extension
pnpm clean
pnpm build

# Check manifest.json syntax
pnpm validate-manifest
```

### Performance Issues

#### Slow TypeScript Compilation

- Use `--incremental` flag for faster rebuilds
- Consider using `tsc --build` for project references
- Enable `skipLibCheck` in development

#### Large Bundle Sizes

- Use `pnpm bundle-analyzer` to identify large dependencies
- Enable tree-shaking in build configuration
- Use dynamic imports for code splitting

### Development Server Issues

#### Port Conflicts

```bash
# Check for processes using ports
lsof -i :3000  # Development server

# Kill processes if needed
kill -9 <PID>
```

#### File Watching Issues

```bash
# Increase file watcher limits (macOS/Linux)
echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

## Git Workflow

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

### Commit Messages

Follow conventional commits format:

```
type(scope): description

feat(core): add pull request creation functionality
fix(ui): resolve component rendering issue
docs(readme): update installation instructions
```

### Pre-commit Hooks

```bash
# Install pre-commit hooks
pnpm prepare

# Hooks will run:
# - ESLint
# - Prettier
# - TypeScript type checking
# - Unit tests
```

This development guide should help you get up and running with the Nostr-Git project efficiently.

---

## Package: @nostr-git/git-wrapper

The git-wrapper package implements the TypeScript ngit provider over Nostr (NIP-34) and a pluggable Git backend.

### Build and Test

```bash
# From repo root
pnpm -w --filter @nostr-git/git-wrapper build
pnpm -w --filter @nostr-git/git-wrapper test
```

### Protocol Preference Stores

Persist preferred clone/push URLs per `repoId`. Three adapters are available:

- Memory (default; ephemeral)
- File-backed (Node)
- localStorage (browser)

#### Node (File-backed)

```ts
import {NostrGitProvider} from "@nostr-git/git-wrapper/src/nostr-git-provider.js"
import {FileProtocolPrefs} from "@nostr-git/git-wrapper/src/prefs-store.js"
import fs from "node:fs"

const provider = new NostrGitProvider(git, nostr)
provider.configureProtocolPrefsStore(new FileProtocolPrefs(fs, `${process.cwd()}/.ngit/prefs.json`))
```

#### Browser (localStorage)

```ts
import {LocalStorageProtocolPrefs} from "@nostr-git/git-wrapper/src/prefs-store.js"

const provider = new NostrGitProvider(git, nostr)
provider.configureProtocolPrefsStore(new LocalStorageProtocolPrefs(window.localStorage))
```

### Repo Address Helpers

Always construct repo addresses via the helper for consistency:

```ts
import {makeRepoAddr, isRepoAddr} from "@nostr-git/git-wrapper/src/repo-addr.js"

const repoAddr = makeRepoAddr(ownerPubkey, repoId)
console.assert(isRepoAddr(repoAddr))
```

### Unified Diff in PR Content

By providing `{ fs, dir }` and refs (e.g., `baseBranch` and the PR ref), the default PR content generator will append a lightweight unified diff generated by isomorphic-git.
