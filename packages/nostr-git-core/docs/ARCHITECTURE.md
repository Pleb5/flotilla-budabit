# Nostr-Git Architecture (Pre-Release Skeleton)

This document is a short, working skeleton for the current architecture during pre-release hardening. See the root `ARCHITECTURE.md` for the detailed version and diagrams.

- Core packages
  - `@nostr-git/shared-types`: Cross-package TypeScript contracts for NIP-34/22/51 and provider abstractions.
  - `@nostr-git/core`: Git + Nostr orchestration with provider interface and safety guardrails.
  - `@nostr-git/ui`: Svelte 5 component library consuming the ergonomic core APIs.
  - `@nostr-git/git-wrapper`: Thin glue around the git engine, aligned with core provider abstractions.
- Runtime targets
  - Browser and mobile. Node-only dependencies are kept out of public entrypoints; fallbacks where required.
- NIPs in scope for v1
  - NIP-34 (git repo events), NIP-22 (reactions/related), NIP-51 (lists). Optional future: NIP-78 with NIP-44 payloads.
- Git engine
  - Targeting fork `chebizarro/isomorphic-git` for lazy object fetch, blob range requests, better shallow ops.
- Safety guardrails
  - Force-push blocked by default (explicit opt-in + consent callback required).
  - HEAD parity checks before any push.
  - Explicit user consent for destructive/remote-altering operations.
- Providers
  - Gitea, GitHub, GitLab, Bitbucket, GRASP via unified `GitProvider` interface.
- Caching (opt-in)
  - IndexedDB-backed cache for the isomorphic-git fork; repo/session configurable.
- Logging policy
  - Errors and warnings only; warnings suppressed in production.

For the full design, see `ARCHITECTURE.md` at the repo root. This file will be expanded in Phase 7 with final diagrams and links to API docs.
