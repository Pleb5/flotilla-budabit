# Windsurf AI Context

This directory contains AI-specific context files for optimal LLM performance when working on the Nostr-Git project.

## Quick Reference

### Project Type

Monorepo for Git-Nostr integration with TypeScript, Svelte 5, and TailwindCSS

### Key Patterns

- Result types for error handling instead of exceptions
- Barrel exports in index.ts files
- ESM modules with .js extensions
- Svelte 5 runes API ($state, $derived, $effect)
- NIP-34 Nostr events for Git collaboration

### Common Commands

```bash
pnpm install          # Install dependencies
pnpm build           # Build all packages
pnpm watch:all       # Development mode
pnpm -r typecheck    # Type checking
```

### Package Structure

- `@nostr-git/core` - Core business logic
- `@nostr-git/ui` - Svelte components
- `@nostr-git/shared-types` - TypeScript definitions
- `@nostr-git/git-wrapper` - Git operations
- Extensions for GitHub

### Important Files

- `AI_CONTEXT.md` - Comprehensive LLM coding context
- `ARCHITECTURE.md` - System design and patterns
- `DEVELOPMENT.md` - Local setup and workflow
- `CODING_STANDARDS.md` - Style guide and conventions

Refer to the main documentation files for detailed information.
