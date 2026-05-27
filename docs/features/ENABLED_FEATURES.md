# Enabled Features Summary

This document records the current build-time feature defaults and built-in extension status. For the full feature flag reference, see `docs/features/FEATURE_FLAGS.md`.

## Current Feature Flag Defaults

The root `vite.config.ts` defines these compile-time flags from environment variables. `.env.example` carries the recommended defaults.

| Environment variable | Compile-time constant | Default                    | Current role                                                                                                                                  |
| -------------------- | --------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEATURE_GRASP`      | `__GRASP__`           | Enabled unless set to `0`  | GRASP and Nostr Git integration paths.                                                                                                        |
| `FEATURE_CICD`       | `__CICD__`            | Disabled unless set to `1` | Experimental CI/CD automation hooks.                                                                                                          |
| `FEATURE_ALERTS`     | `__ALERTS__`          | Disabled unless set to `1` | External email digest and web push alert setup. In-app unread badges and sounds remain available while disabled.                              |
| `FEATURE_NIP85`      | `__NIP85__`           | Disabled unless set to `1` | Legacy NIP-85 provider discovery and provider-based trust graph adjustments. Stored provider settings are preserved but inert while disabled. |

## Community Architecture Note

Budabit's current community architecture is Communikey-based:

- Community identity comes from a community pubkey and latest `kind:10222` definition.
- Community routes are under `/c/[community]`.
- Canonical Git routes are under `/git`.
- Relay URLs are infrastructure and discovery hints, not community IDs.

NIP-34 pull request support is always part of Budabit. Terminal UI has been removed for now. Strict NIP-29 validation is not part of the current community access-control model; current write permissions come from community definition sections and their referenced `kind:30000` profile lists.

## Built-In Extensions

Built-in extensions are no longer bundled or auto-installed by this repo.

`src/app/extensions/builtin.ts` intentionally keeps `installBuiltinExtensions()` as a no-op so the app shell can retain the call site without installing bundled extension manifests.

Extensions are installed through Nostr `kind:30033` events or manifest URLs from Settings > Extensions.

## Optional Extension Packages

The repo still contains extension packages for development and distribution, such as pipelines and Kanban, but they are not automatically enabled in the app bundle.

Run or publish those packages according to their package-level docs when you want to test or distribute them.

## Source Of Truth

- `.env.example` for recommended environment defaults
- `vite.config.ts` for compile-time flag definitions
- `src/feature-flags.d.ts` for TypeScript declarations
- `src/app/extensions/builtin.ts` for built-in extension behavior
