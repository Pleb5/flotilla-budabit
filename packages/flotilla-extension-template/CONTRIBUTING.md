# Contributing to BudaBit Extension Template

Thank you for your interest in contributing!

## Development Setup

1. Clone Budabit and create a feature branch based on `dev`.
2. Install dependencies at the Budabit root: `pnpm install --frozen-lockfile`
   using Node 22 and pnpm 10.12.4.
3. Start the template and shared-bridge watchers from the root: `pnpm dev:template`.
4. Make your changes
5. Run the template, SDK, and consumer tests from the root: `pnpm test:extensions`.
6. Build and typecheck the workspaces: `pnpm build:extensions && pnpm check:extensions`.

## Code Standards

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier (run `pnpm format`)
- **Linting**: ESLint (run `pnpm lint`)
- **Tests**: 95%+ coverage required

## Commit Messages

Use conventional commits:

```
feat: add new feature
fix: fix bug
docs: update documentation
test: add tests
chore: update dependencies
```

## Pull Requests

1. Create a feature branch
2. Make your changes
3. Add tests
4. Update documentation
5. Run the root extension checks above and focused tests for your changes.
6. Submit the PR against Budabit `dev`, including related SDK/consumer changes.

## Testing

- Unit tests: `pnpm test:extensions` from the Budabit root.
- Template-only tests: `pnpm --filter budabit-extension-template run test`.
- Template E2E: `pnpm --filter budabit-extension-template run e2e`.
- Coverage: `pnpm --filter budabit-extension-template run test:coverage`.

## Questions?

Open an issue or discussion on GitHub.
