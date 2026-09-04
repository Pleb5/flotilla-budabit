# Enabled Features Summary

This document records the current build-time feature defaults and built-in extension status. For the full feature flag reference, see `docs/features/FEATURE_FLAGS.md`.

## Current Feature Flag Defaults

The root `vite.config.ts` defines these compile-time flags from environment variables. `.env.example` carries the recommended defaults.

| Environment variable  | Compile-time constant | Default                    | Current role                          |
| --------------------- | --------------------- | -------------------------- | ------------------------------------- |
| `FEATURE_GRASP`       | `__GRASP__`           | Enabled unless set to `0`  | GRASP and Nostr Git integration.      |
| `FEATURE_CICD`        | `__CICD__`            | Disabled unless set to `1` | Experimental CI/CD automation hooks.  |
| `FEATURE_IMPORT_REPO` | `__IMPORT_REPO__`     | Disabled unless set to `1` | Repository import dialog and actions. |

## Community Architecture Note

Budabit's current community architecture is Communikey-based:

- A branch is identified by the exact definition address `32222:<owner>:<communityId>` and its canonical `naddr`; `communityId` remains the stable `d` and community-event `h` value.
- Community routes are under `/c/[community]`, with the definition `naddr` as `[community]`.
- Canonical Git routes are under `/git`.
- Relay URLs are infrastructure and discovery hints, not community IDs.
- Community metadata comes from definition tags, not the owner's personal `kind:0` profile, and community association is never encoded as a person `p` tag.

NIP-34 pull request support is always part of Budabit. Terminal UI has been removed for now. Strict NIP-29 validation is not part of the current community access-control model; current write permissions come from community definition sections and their referenced `kind:30000` profile lists.

## Default Community Extensions

Budabit does not bundle extension code, but it does load default extensions curated by the configured default community.

`src/app/extensions/builtin.ts` resolves the exact `kind:32222` definition `naddr` in `VITE_DEFAULT_COMMUNITY` and loads `kind:30033` widgets targeted through `kind:30222` wrappers whose stable `h=<communityId>` is immediately followed by the marked exact definition `a`.

Default community extensions appear in Settings > Extensions as installed and enabled. Users can disable them, but cannot uninstall them because they come from community curation rather than user-installed storage.

Additional extensions are installed through community-curated `kind:30033` discovery or direct Smart Widget `naddr` values from Settings > Extensions.

## Optional Extension Packages

The repo still contains extension packages for development and distribution, such as pipelines and Kanban, but they are not automatically enabled in the app bundle.

Run or publish those packages according to their package-level docs when you want to test or distribute them.

## Source Of Truth

- `.env.example` for recommended environment defaults
- `vite.config.ts` for compile-time flag definitions
- `src/feature-flags.d.ts` for TypeScript declarations
- `src/app/extensions/builtin.ts` for default community extension loading
- `src/app/extensions/community-curation.ts` for community-curated extension discovery
