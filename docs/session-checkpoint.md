# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Migrate app-level GRASP server preferences to protocol `kind:10317` with ordered `g` tags.
- Keep legacy `kind:30002` / `d=grasp-servers` reads only as migration fallback.
- Source the app last-resort fallback from the `.env` default community's `kind:10317` GRASP list.
- Replace hardcoded GRASP recommendations with community-first web-of-trust recommendations from communities and individuals.

## Current Phase

- Phase 2: Default Community Fallback And Recommendation Engine

## Phase Exit Criteria

- A GRASP recommendation module/store exists and mirrors the DM relay ranking model for community and individual signals.
- Recommendation sources include active community relay evidence, starred/default community evidence, community/admin/moderator/member `kind:10317` lists, own list, and unmuted follow `kind:10317` lists.
- Recommendation authors are community-first: viewer, active community pubkeys, default community pubkey, moderators, starred community pubkeys, follows, then members, with sensible limits.
- Default community fallback loads `VITE_DEFAULT_COMMUNITY`, resolves its definition with existing community lookup helpers, then loads that community author's `kind:10317` list from default/indexer/community relays.
- The last-resort fallback is used only when the user has no authoritative saved list and no community/social recommendation items.
- No hardcoded GRASP recommendation URLs remain in app recommendation logic.
- Focused tests cover ranking, default-community fallback, empty-list authority, and muted follow exclusion.
- Phase 2 changes are committed and pushed without staging unrelated files.

## Completed With Evidence

- Previous DM relay recommendation workflow was already complete before this GRASP workflow started.
- New GRASP migration/recommendation durable plan created in `docs/session-plan.md`.
- Phase 1 added normalized `kind:10317` GRASP websocket URL helpers in `packages/nostr-git-core/src/events/nip34/nip34-utils.ts`.
- Phase 1 added `src/app/core/grasp-server-events.ts` to centralize new-vs-legacy GRASP list filters and selection.
- Phase 1 switched app GRASP loading/sync, repo-announcement relay lookup, route-local fork GRASP list lookup, and settings save publishing to `kind:10317` with ordered `g` tags.
- Phase 1 preserved legacy `kind:30002` / `d=grasp-servers` as read-only fallback only when no `kind:10317` event exists.
- Phase 1 verified explicit empty `kind:10317` lists suppress legacy fallback.
- Phase 1 focused verification passed: `pnpm vitest run src/app/core/grasp-server-events.test.ts src/app/core/git-requests.test.ts src/app/core/git-state.test.ts packages/nostr-git-core/test/events/nip34-builders.spec.ts`.
- Phase 1 project verification passed: `pnpm check`.
- Phase 1 was committed and pushed as `1eda2bd9 feat: migrate grasp server list kind`.

## Decisions

- Current GRASP preference protocol is `kind:10317` with `g` tags, not legacy `kind:30002` / `d=grasp-servers`.
- New `kind:10317` presence is authoritative, including an empty `g` tag list.
- Legacy `kind:30002` is read-only migration fallback until a `kind:10317` event exists.
- New `kind:10317` helper parsing accepts only `ws://` and `wss://` service URLs; legacy migration parsing keeps historical validation semantics.
- Hardcoded GRASP recommendations should be removed; the only fallback should derive from the default community when no better candidates exist.

## Current State

- Root repo `/home/johnd/Work/budabit` is on branch `dev` tracking `origin/dev`.
- Worktree contains many unrelated extension/widget changes; do not stage them.
- `src/routes/git/[id=naddr]/+layout.svelte` had a pre-existing unrelated hunk at the community option relays mapping; do not stage that hunk with Phase 1.
- App shell no longer has non-test direct legacy GRASP usage outside `src/app/core/grasp-server-events.ts` migration fallback.
- Phase 2 has not started implementation yet.

## Next Action

- Start Phase 2 by implementing the GRASP recommendation module/store and default-community fallback resolver.

## Verification

- Phase 1 focused tests passed: `pnpm vitest run src/app/core/grasp-server-events.test.ts src/app/core/git-requests.test.ts src/app/core/git-state.test.ts packages/nostr-git-core/test/events/nip34-builders.spec.ts`
- Phase 1 project check passed: `pnpm check`

## Risks Or Blockers

- Dirty unrelated files remain present and must not be staged.
- `src/routes/git/[id=naddr]/+layout.svelte` still has an unrelated pre-existing hunk at the community option relays mapping.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `packages/nostr-git-core/src/events/nip34/nip34-utils.ts`
- `packages/nostr-git-core/test/events/nip34-builders.spec.ts`
- `src/app/core/grasp-server-events.ts`
- `src/app/core/grasp-server-events.test.ts`
- `src/app/core/git-requests.ts`
- `src/app/core/git-requests.test.ts`
- `src/app/core/git-state.ts`
- `src/app/core/git-state.test.ts`
- `src/app/core/git-commands.ts`
- `src/app/core/git-commands.test.ts`
- `src/app/components/GraspServersPanel.svelte`
- `src/routes/git/[id=naddr]/+layout.svelte`
