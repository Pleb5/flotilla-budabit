# Contributing

Thank you for your interest in contributing!

## Development Setup

1. Clone Budabit and create a feature branch based on `dev`.
2. Install dependencies at the Budabit root: `pnpm install --frozen-lockfile`
   using Node 22 and pnpm 10.12.4.
3. Start the widget and SDK watchers from the root: `pnpm dev:releases`.
4. Make your changes
5. Run tests from the root: `pnpm test:releases` and `pnpm test:extensions`.
6. Run widget verification: `pnpm --filter budabit-releases-extension run verify`.

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
5. Run `pnpm verify`
6. Submit the PR against Budabit `dev`, including any related host/SDK changes.

## Testing

- Unit tests: `pnpm test`
- E2E tests: `pnpm e2e`
- Coverage: `pnpm test:coverage`
- Full verification: `pnpm verify`

## Questions?

Open an issue or discussion on GitHub.
