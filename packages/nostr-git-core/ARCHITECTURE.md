# Architecture Guide

## System Overview

The Nostr-Git platform is designed as a modular monorepo that bridges Git version control with the Nostr protocol, enabling decentralized code collaboration through NIP-34 events.

See also: [Git Stacking and Merge Metadata](docs/nostr-git-stacking.md)

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Nostr-Git Platform                       │
├─────────────────────────────────────────────────────────────┤
│  Applications & Extensions                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │   Browser   │ │  Web IDE    │ │   CLI       │            │
│  │  Extension  │ │  Editor     │ │  Tooling    │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              @nostr-git/ui                              ││
│  │         Svelte 5 + TailwindCSS Components               ││
│  └─────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────┤
│  Core Libraries                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │    Core     │ │ Git Wrapper │ │ Shared Types│            │
│  │   Library   │ │             │ │             │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
├─────────────────────────────────────────────────────────────┤
│  External Dependencies                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ Nostr Tools │ │ Git (isogit)│ │   Node.js   │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Package Architecture

### Core Package (@nostr-git/core)

**Purpose**: Central library for Git-Nostr event operations

**Key Components**:

- `event.js` - Nostr event creation and parsing
- `git.js` - Git operations and repository management
- `repo.js` - Repository state management
- `merge-analysis.ts` - Pull request merge analysis and diff summaries
- `workers/git-worker.js` - Background Git operations
- `merge.js` - Merge conflict resolution

**Dependencies**: nostr-tools, isogit, diff

### Shared Types Package (@nostr-git/shared-types)

**Purpose**: TypeScript definitions and constants

**Key Components**:

- `nip34.ts` - NIP-34 event type definitions
- `utils.ts` - Utility types and helpers
- Event kind constants (30617, 30618, 1618, 1619, 1621)

### Git Wrapper Package (@nostr-git/git-wrapper)

**Purpose**: Abstraction layer for Git operations

**Key Components**:

- `provider.ts` - Git provider interface
- Git operation wrappers with Nostr integration

### UI Package (@nostr-git/ui)

**Purpose**: Reusable Svelte components

**Key Components**:

- Svelte 5 components with runes
- TailwindCSS styling with custom preset
- Component library for Git/Nostr interfaces

## Data Flow

### Event Publishing Flow

```
Git Operation → Core Library → Nostr Event → Relay Network
     ↓              ↓              ↓             ↓
  Repository → Event Creation → Signing → Broadcasting
```

### Event Consumption Flow

```
Relay Network → Event Parsing → UI Components → User Interface
     ↓              ↓              ↓             ↓
   Subscribe → Event Handling → State Update → Rendering
```

## Technology Choices & Rationale

### TypeScript

- **Why**: Type safety for complex event structures and Git operations
- **Benefits**: Better IDE support, compile-time error detection, self-documenting APIs

### Svelte 5

- **Why**: Modern reactive framework with excellent performance
- **Benefits**: Smaller bundle sizes, intuitive reactivity, great TypeScript support

### pnpm Workspaces

- **Why**: Efficient monorepo management with shared dependencies
- **Benefits**: Faster installs, better dependency resolution, workspace linking

### TailwindCSS

- **Why**: Utility-first CSS framework for rapid UI development
- **Benefits**: Consistent design system, small production bundles, excellent DX

### nostr-tools

- **Why**: Standard library for Nostr protocol operations
- **Benefits**: Well-tested, community-maintained, comprehensive API

## Performance Considerations

### Bundle Size Optimization

- Tree-shaking enabled for all packages
- Separate entry points for different use cases
- Dynamic imports for heavy operations

### Memory Management

- Web Workers for Git operations to prevent UI blocking
- Streaming for large file operations
- Efficient event caching strategies

### Network Optimization

- Relay connection pooling
- Event deduplication
- Optimistic UI updates

## Scalability Notes

### Horizontal Scaling

- Stateless core library design
- Relay-based event distribution
- Independent package deployments

### Vertical Scaling

- Worker threads for CPU-intensive operations
- Streaming APIs for large repositories
- Incremental loading strategies

## Security Architecture

### Event Signing

- Private key management in extensions
- Secure key storage patterns
- Event verification workflows

### Git Operations

- Sandboxed Git operations
- Input validation and sanitization
- Safe file system operations

## Extension Points

### Custom Git Providers

- Provider interface for different Git backends
- Plugin architecture for custom operations

### Custom UI Components

- Component composition patterns
- Theme customization support
- Event handler extensibility

### Custom Relays

- Relay adapter pattern
- Custom event filtering
- Backup relay strategies

## Development Patterns

### Monorepo Organization

- Each package is independently buildable
- Shared configuration files at root
- Cross-package type sharing

### Event-Driven Architecture

- Nostr events as the primary data exchange format
- Reactive UI updates based on event streams
- Decoupled component communication

### Worker Pattern

- Background processing for heavy operations
- Message passing between main thread and workers
- Graceful error handling and recovery
