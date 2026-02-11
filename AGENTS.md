# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

# AGENTS.md

## Commands

### Development & Build

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production (runs build.sh)
- `npm run check` - Type check with svelte-check
- `npm run check:watch` - Type check in watch mode
- `npm run lint` - Run prettier and eslint checks
- `npm run format` - Format code with prettier

### Testing

- `npm test` - Run all tests with Vitest
- `npm run test:repo` - Run repository-specific tests
- `npm run test:ui` - Run tests with Vitest UI

#### Single Test

- `vitest run path/to/test.test.ts` - Run specific test file
- `vitest run -t "test name"` - Run tests matching pattern

## Code Style Guidelines

### Svelte 5 Requirements

- Use new runes: `$state`, `$derived`, `$effect`, `$props`
- Use callback props (`onclick`) over deprecated `createEventDispatcher`
- Avoid slots; use snippet syntax `{@render ...}`
- Components encapsulate reactive properties and computed values explicitly

### Formatting

- No semicolons
- Print width: 100 chars
- Arrow parens: avoid when possible
- Bracket spacing: false
- Bracket same line: true
- Svelte sort order: options-styles-scripts-markup

### Imports

- Use path aliases: `@lib`, `@app`, `@assets`, `@nostr-git/*`
- Group imports: external deps, @welshman/\*, internal, local
- Prefer navigating file-by-file using imports over grep/rg

### Types

- TypeScript strict mode enabled
- Explicit types for function params and returns
- Use interface for objects, type for unions/primitives
- Complex types: define in shared types or adjacent to usage

### Error Handling

- Silent catch blocks with `// pass` for expected failures
- Use `tryCatch` utility from @welshman/lib for safe operations
- Log errors with context; avoid generic error messages

### Nostr Protocol

- Event timestamps: seconds only, never milliseconds
- Use `nostr-tools` with centralized `SimplePool` instance
- Subscribe via `Pool.get()`, publish via `relay.send()`

### Git Integration

- Follow NIP-34 specifications strictly
- Offload git operations to WebWorkers (isomorphic-git)
- Serialize messages using structured clone for worker comms
- Use comlink for worker communication

### State Management

- Use svelte/store: `writable`, `derived`, `readable`
- Reactive values: `$state` for local, `$derived` for computed
- Store patterns: `deriveEvent()`, `loadEvents()`, `collections()`
- Room memberships accessed via user bookmarks

### Styling

- Use Tailwind CSS
- Prefer `flex` and `gap` over margin/padding utilities
- Avoid space-y classes; use gap instead
- Responsive: mobile-first approach

### Naming Conventions

- Variables/functions: camelCase
- Components: PascalCase
- Types/interfaces: PascalCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case (components), PascalCase (Svelte files)
- Derive functions: `derive[Entity]()`
- Load functions: `load[Entity]()`
- Get functions: `get[Entity]()`

### Component Props

- Use `$props()` with destructuring
- Default values in destructuring: `{ prop = default } = $props()`
- Rest props: `...restProps` for forwarding

### Comments

- Add comments only when asked
- Keep inline documentation around complex Nostr/Git interactions
- Comment reactive logic and component lifecycle events

### File Organization

- `src/routes/` - Page routes with +page.svelte, +page.ts
- `src/lib/components/` - Reusable components
- `src/lib/` - Utilities, helpers, core logic
- `src/app/` - App-specific logic, state, editor
- Test files: `.test.ts` or `.spec.ts` alongside source

### Web Workers

- Worker files in dedicated directories
- Use comlink for type-safe worker communication
- Handle progress callbacks for long-running operations
- Clean up workers on component unmount

### Environment Variables

- Access via `import.meta.env.VITE_*`
- Define in .env files (not committed)
- Type definitions in `src/feature-flags.d.ts`

### Commit Guidelines

- Follow existing commit message style
- Focus on "why" not "what"
- Use present tense: "add feature" not "added feature"
- Reference issues/pulls in relevant commits

### Testing

- Use Vitest
- Test files alongside source or in test/ directory
- Mock external dependencies (Worker, fetch, etc.)
- Test edge cases and error handling
- Coverage thresholds: 90% (lines, functions, branches, statements)

### Performance

- Memoize expensive computations
- Use `$derived` for computed values
- Debounce/throttle user input
- Lazy load routes and components
- Use code splitting for large bundles
