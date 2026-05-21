# Feature Flags Reference

Budabit uses a small set of build-time constants for features that are genuinely optional at deploy time.

## Available Flags

### `__PRODUCTION__` / `__DEVELOPMENT__`

**Type**: Environment
**Default**: Based on `NODE_ENV`
**Control**: Automatic

Used for debug logging, development-only behavior, and production checks.

### `__GRASP__`

**Type**: Feature
**Default**: Enabled unless `FEATURE_GRASP=0`
**Control**: `FEATURE_GRASP`

Enables GRASP and Nostr Git integration paths.

### `__CICD__`

**Type**: Feature
**Default**: Disabled unless `FEATURE_CICD=1`
**Control**: `FEATURE_CICD`

Enables experimental CI/CD automation hooks.

### `__ALERTS__`

**Type**: Feature
**Default**: Disabled unless `FEATURE_ALERTS=1`
**Control**: `FEATURE_ALERTS`

Enables external email digest and web push alert setup.

When disabled, email and push alert setup is hidden and direct alert creation is rejected. In-app notification badges and sounds remain available.

## Removed Flags

These are intentionally not feature flags:

- NIP-34 pull request support is part of the app and is always on.
- Terminal UI is removed for now instead of being gated.
- Strict NIP-29 validation is not relevant to the current Communikey community architecture.

## Build Configuration

Feature flags are defined in `vite.config.ts`:

```typescript
export default defineConfig({
  define: {
    __PRODUCTION__: JSON.stringify(process.env.NODE_ENV === "production"),
    __DEVELOPMENT__: JSON.stringify(process.env.NODE_ENV !== "production"),
    __GRASP__: JSON.stringify(process.env.FEATURE_GRASP !== "0"),
    __CICD__: JSON.stringify(process.env.FEATURE_CICD === "1"),
    __ALERTS__: JSON.stringify(process.env.FEATURE_ALERTS === "1"),
  }
})
```

## TypeScript Support

Feature flag type declarations are provided in `src/feature-flags.d.ts`:

```typescript
declare const __PRODUCTION__: boolean
declare const __DEVELOPMENT__: boolean
declare const __GRASP__: boolean
declare const __CICD__: boolean
declare const __ALERTS__: boolean
```

## Source Of Truth

- `.env.example` for recommended environment defaults
- `vite.config.ts` for compile-time definitions
- `src/feature-flags.d.ts` for TypeScript declarations
