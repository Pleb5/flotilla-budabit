# Deployment Guide

This guide covers build processes, deployment strategies, and CI/CD configuration for the Nostr-Git project.

## Build Process

### Production Builds

#### Build All Packages

```bash
# Clean previous builds
pnpm -r clean

# Build all packages in dependency order
pnpm build

# Verify build outputs
pnpm -r publint
```

#### Package-Specific Builds

```bash
# Core library
cd packages/core
pnpm build          # TypeScript compilation
pnpm typecheck      # Type checking

# UI components
cd packages/ui
pnpm build          # Svelte compilation + CSS

# Browser extension
cd packages/extension
# Production builds (Chrome/Firefox)
pnpm build:chrome:prod
pnpm build:firefox:prod
```

### Build Optimization

#### Bundle Analysis

```bash
# Analyze bundle sizes
pnpm -r run bundle-analyzer

# Check for duplicate dependencies
pnpm dedupe
```

#### Performance Optimization

- Tree-shaking enabled for all packages
- Dynamic imports for code splitting
- Minification in production builds
- Source maps for debugging

## Package Publishing

### NPM Packages

#### Manual Publishing

```bash
# Build and publish core library
cd packages/core
pnpm build
pnpm publish --access public

# Publish UI components
cd packages/ui
pnpm build
pnpm publish --access public
```

#### Automated Publishing with Changesets

```bash
# Create changeset
pnpm changeset

# Version packages
pnpm changeset version

# Publish to NPM
pnpm changeset publish
```

### Extension Stores

#### Chrome Web Store

```bash
# Build + zip for stores
cd packages/extension
pnpm release:zip   # Produces extension-chrome.zip and extension-firefox.zip in package dir

# Upload to Chrome Web Store Developer Dashboard
# https://chrome.google.com/webstore/devconsole
```

Notes:

- To hide the Debug option in the popup for release builds, set the compile-time flag:
  ```bash
  NOSTR_GIT_SHOW_DEBUG=false pnpm --filter nostr-github-extension build:chrome:prod
  ```
  The release:zip script can also be run with the env var to produce a debugless Chrome bundle.


## Environment Configuration

### Development Environment

```bash
# .env.development
NODE_ENV=development
DEBUG=nostr-git:*
NOSTR_RELAY_URL=wss://relay.damus.io
```

### Production Environment

```bash
# .env.production
NODE_ENV=production
NOSTR_RELAY_URL=wss://relay.nostr.band
LOG_LEVEL=error
```

### Extension Configuration

```javascript
// packages/extension/src/config.ts
export const config = {
  development: {
    relayUrls: ["wss://relay.damus.io"],
    debugMode: true,
  },
  production: {
    relayUrls: ["wss://relay.nostr.band", "wss://nos.lol", "wss://relay.damus.io"],
    debugMode: false,
  },
}
```

## Local Logging

### Application Logging

```typescript
// packages/core/src/lib/logger.ts
export class Logger {
  error(message: string, error?: Error, context?: object) {
    console.error(`[nostr-git] ${message}`, {error, context})
  }
}
```

### Performance Logging

```typescript
// Local timing for critical operations
export async function trackOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    const result = await operation()
    const duration = performance.now() - start
    logger.debug(`Operation ${name} completed`, {duration})
    return result
  } catch (error) {
    const duration = performance.now() - start
    logger.error(`Operation ${name} failed`, error, {duration})
    throw error
  }
}
```

## Security Considerations

### Build Security

#### Dependency Scanning

```bash
# Audit dependencies
pnpm audit

# Check for known vulnerabilities
pnpm -r exec npm audit --audit-level high
```

### Extension Security

#### Content Security Policy

```json
// packages/extension/manifest.json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  },
  "permissions": ["activeTab", "storage"]
}
```

#### Secure Communication

```typescript
// Secure message passing between contexts
export interface SecureMessage {
  type: string
  payload: unknown
  timestamp: number
  signature?: string // For sensitive operations
}
```

## Rollback Procedures

### NPM Package Rollback

```bash
# Unpublish specific version (within 24 hours)
npm unpublish @nostr-git/core@1.2.3

# Deprecate version
npm deprecate @nostr-git/core@1.2.3 "Security vulnerability, use 1.2.4+"
```

### Extension Rollback

```bash
# Chrome Web Store: Use developer dashboard to rollback

# Emergency: Remove from stores and notify users
```

### Git Tag Management

```bash
# Remove problematic release tag
git tag -d v1.2.3
git push origin :refs/tags/v1.2.3

# Create hotfix release
git checkout -b hotfix/v1.2.4
# Make fixes
git tag v1.2.4
git push origin v1.2.4
```

## Performance Optimization

### Build Performance

```bash
# Parallel builds
pnpm -r --parallel build

# Incremental TypeScript compilation
tsc --build --incremental

# Cache optimization
pnpm store path  # Check store location
pnpm store prune # Clean unused packages
```

### Runtime Performance

- Lazy loading for extensions
- Web Workers for heavy operations
- Efficient event handling patterns
- Memory leak prevention

## Troubleshooting

### Common Build Issues

#### TypeScript Compilation Errors

```bash
# Clear TypeScript cache
pnpm -r exec tsc --build --clean
rm -rf packages/*/dist

# Rebuild with verbose output
pnpm build --verbose
```

#### Extension Build Failures

```bash
# Clear extension build cache
cd packages/extension
rm -rf dist node_modules/.cache
pnpm install
pnpm build:prod
```

#### Publishing Failures

```bash
# Check package.json exports
pnpm publint

# Verify authentication
npm whoami
npm config get registry

# Test publish (dry run)
npm publish --dry-run
```

This deployment guide provides comprehensive coverage of build processes, CI/CD setup, and operational procedures for the Nostr-Git project.
