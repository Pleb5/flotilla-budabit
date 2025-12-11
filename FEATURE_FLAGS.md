# Feature Flags Reference

Budabit uses **build-time feature flags** to enable/disable features and optimize bundle size through dead-code elimination.

## Overview

Feature flags are compile-time constants defined during the build process. When a feature is disabled, the bundler (Vite/esbuild) automatically removes all associated code from the final bundle through tree-shaking, resulting in smaller bundle sizes and faster load times.

## Available Flags

### `__PRODUCTION__` / `__DEVELOPMENT__`

**Type**: Environment  
**Default**: Based on `NODE_ENV`  
**Control**: Automatic

Indicates the build environment. Used for debug logging, development-only features, and source maps.

```typescript
if (__DEVELOPMENT__) {
  console.log('Debug info:', data);
}
```

### `__GRASP__`

**Type**: Feature  
**Default**: Enabled  
**Control**: `FEATURE_GRASP` environment variable

Enables GRASP (Git Repository Announcement State Protocol) integration for Git-over-Nostr functionality.

**When enabled**:
- GRASP relay support
- Repository state synchronization
- GRASP-specific Git providers
- ~50KB bundle size

**Usage**:
```bash
# Disable GRASP features
FEATURE_GRASP=0 npm run build
```

**Code gating**:
```typescript
if (__GRASP__) {
  const graspApi = new GraspApi(config);
}
```

### `__TERMINAL__`

**Type**: Feature  
**Default**: Enabled  
**Control**: `FEATURE_TERMINAL` environment variable

Enables terminal emulator components for Git CLI operations.

**When enabled**:
- Terminal.svelte component
- Git CLI adapters
- XTerm.js integration
- Command execution UI
- ~150KB bundle size (includes xterm dependencies)

**Usage**:
```bash
# Disable terminal features
FEATURE_TERMINAL=0 npm run build
```

**Code gating**:
```svelte
{#if __TERMINAL__}
  <Terminal {options} />
{/if}
```

### `__NIP34_PR__`

**Type**: Feature  
**Default**: Disabled  
**Control**: `FEATURE_NIP34_PR` environment variable

Enables experimental NIP-34 Pull Request format support.

**When enabled**:
- Updated PR event structures
- Enhanced patch metadata
- PR-specific validation

**Usage**:
```bash
# Enable NIP-34 PR features
FEATURE_NIP34_PR=1 npm run build
```

**Code gating**:
```typescript
if (__NIP34_PR__) {
  // Use updated PR format
  event.tags.push(['pr-status', status]);
}
```

### `__CICD__`

**Type**: Feature  
**Default**: Disabled  
**Control**: `FEATURE_CICD` environment variable

Enables CI/CD automation features and GitHub Actions integration.

**When enabled**:
- Automated workflow triggers
- Build pipeline integration
- GitHub Actions event handlers

**Usage**:
```bash
# Enable CI/CD features
FEATURE_CICD=1 npm run build
```

**Code gating**:
```typescript
if (__CICD__) {
  setupGitHubActionsIntegration();
}
```

### `__STRICT_NIP29__`

**Type**: Feature  
**Default**: Disabled  
**Control**: `FEATURE_STRICT_NIP29` environment variable

Enables strict validation for NIP-29 group/room specifications.

**When enabled**:
- Stricter conversation thread validation
- Enhanced group membership checks
- Stricter relay requirement enforcement

**Usage**:
```bash
# Enable strict NIP-29 validation
FEATURE_STRICT_NIP29=1 npm run build
```

**Code gating**:
```typescript
const isStrictRelay = __STRICT_NIP29__ && 
  error.includes("missing group (`h`) tag");
```

## Build Configuration

Feature flags are defined in multiple build configuration files:

### Main Application (Vite)

**File**: `vite.config.ts`

```typescript
export default defineConfig({
  define: {
    __PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
    __DEVELOPMENT__: JSON.stringify(process.env.NODE_ENV !== "production"),
    __GRASP__: JSON.stringify(process.env.FEATURE_GRASP !== "0"),
    __NIP34_PR__: JSON.stringify(process.env.FEATURE_NIP34_PR === "1"),
    __CICD__: JSON.stringify(process.env.FEATURE_CICD === "1"),
    __TERMINAL__: JSON.stringify(process.env.FEATURE_TERMINAL !== "0"),
    __STRICT_NIP29__: JSON.stringify(process.env.FEATURE_STRICT_NIP29 === "1"),
  }
});
```

### Browser Extension (esbuild)

**File**: `packages/nostr-git/packages/extension/esbuild.config.js`

```javascript
define: {
  __PRODUCTION__: JSON.stringify(isProd),
  __DEVELOPMENT__: JSON.stringify(!isProd),
  __GRASP__: JSON.stringify(process.env.FEATURE_GRASP !== "0"),
  // ... other flags
}
```

### Git Worker (Vite)

**File**: `packages/nostr-git/packages/git-worker/vite.config.ts`

Same as main application configuration.

## TypeScript Support

Feature flag type declarations are provided in `feature-flags.d.ts`:

```typescript
declare const __PRODUCTION__: boolean;
declare const __DEVELOPMENT__: boolean;
declare const __GRASP__: boolean;
declare const __NIP34_PR__: boolean;
declare const __CICD__: boolean;
declare const __TERMINAL__: boolean;
declare const __STRICT_NIP29__: boolean;
```

## Best Practices

### 1. Use build-time checks, not runtime

✅ **Good** - Tree-shakeable:
```typescript
if (__GRASP__) {
  import('./grasp-api.js');
}
```

❌ **Bad** - Not tree-shakeable:
```typescript
if (process.env.FEATURE_GRASP === '1') {
  import('./grasp-api.js');
}
```

### 2. Gate entire code blocks

✅ **Good**:
```typescript
if (__TERMINAL__) {
  function setupTerminal() {
    // All terminal code here
  }
  setupTerminal();
}
```

❌ **Bad**:
```typescript
function setupTerminal() {
  if (__TERMINAL__) {
    // Mixed gating reduces tree-shaking effectiveness
  }
}
```

### 3. Keep exports unconditional

✅ **Good** - TypeScript compatible:
```typescript
export { Terminal } from './Terminal.svelte';
// Usage site gates access
```

❌ **Bad** - TypeScript error:
```typescript
if (__TERMINAL__) {
  export { Terminal } from './Terminal.svelte';
}
```

### 4. Gate at consumption point

For components, gate usage in parent components:

```svelte
<script>
  import { Terminal } from '@nostr-git/ui';
</script>

{#if __TERMINAL__}
  <Terminal />
{/if}
```

## Verification

To verify tree-shaking is working:

```bash
# Build with feature disabled
FEATURE_GRASP=0 npm run build

# Check bundle size
ls -lh dist/assets/*.js

# Search for feature-specific code (should find nothing)
grep -r "GraspApi" dist/
```

## Migration Guide

When adding new feature flags:

1. **Add to build configs**: Update all three config files (main, extension, worker)
2. **Add TypeScript declarations**: Update all `feature-flags.d.ts` files
3. **Document**: Add to this file and `.env.example`
4. **Gate code**: Wrap feature code in `if (__FLAG__)` blocks
5. **Test**: Build with flag disabled and verify tree-shaking

## Bundle Size Impact

Approximate bundle size savings when features are disabled:

| Feature | Size Reduction |
|---------|----------------|
| `__GRASP__` | ~50KB |
| `__TERMINAL__` | ~150KB |
| `__NIP34_PR__` | ~5KB |
| `__CICD__` | ~10KB |
| `__STRICT_NIP29__` | ~2KB |

**Total potential savings**: ~217KB when all optional features are disabled.
