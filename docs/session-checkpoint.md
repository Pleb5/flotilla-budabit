# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Add reversible user-side community renunciation backed by a private Welshman/NIP-51 list.
- Exclude renounced non-admin communities from Budabit membership lists, recommendations, discovery, and web-of-trust without revoking or blocking direct community publishing access.
- Add Membership page `Leave group` / `Rejoin group` controls with confirmation modals.

## Current Phase

- Phase 2: Trust, Search, And Recommendation Integration

## Phase Exit Criteria

- Community trust builders accept viewer-renounced community pubkeys and exclude those communities from viewer/target trust refs and shared evidence.
- Callers that compute global or active-community trust pass the current user renounced set where available.
- People search/community candidate discovery ignores renounced community definitions/profile-list evidence where appropriate.
- Recommendation paths relying on `activeUserCommunityRefs` naturally use effective membership; any direct raw community evidence paths are filtered.
- Profile trust badges and flag/report evidence use effective membership and do not include renounced community evidence.
- Focused tests cover trust exclusion and search/community candidate exclusion.
- Phase 2 changes are committed, pushed, and the checkpoint is reread.

## Completed With Evidence

- Prior GRASP/NIP-34 workflow in these session files was already complete and has been replaced for this renounced-community workflow.
- Previous member-community explore change was committed as `9644242c feat: include member communities in explore` and pushed to `origin/dev` before starting this workflow.
- Planning evidence: Welshman provides `readList`, `makeList`, `addToListPrivately`, `removeFromList`, `updateList`, `getListTags`, `asDecryptedEvent`, and `nip44EncryptToSelf`; Budabit's encrypted NIP-85 config uses the same pattern.
- Phase 1 implemented core renunciation list and effective membership:
  - Added `src/app/core/community-renunciations.ts` using Welshman `NAMED_PEOPLE`, `readList`, `makeList`, `addToListPrivately`, `removeFromList`, `asDecryptedEvent`, `makeUserData`, `makeUserLoader`, and `nip44EncryptToSelf` patterns.
  - Added private `p` tag parsing for `d = app/budabit/renounced-communities` and leave/rejoin core helpers that publish encrypted list replacements.
  - Added a profile-list guard so the renunciation `30000` event cannot create membership evidence.
  - Added `excludedCommunityPubkeys` to `selectUserCommunityRefs` and `filterExcludedCommunityRefs()` preserving admin refs.
  - Split `rawActiveUserCommunityRefs` from effective exported `activeUserCommunityRefs` in `community-state.ts`.
  - Updated `activePreferredCommunities` and `selectPreferredCommunities()` to filter renounced non-admin communities even when starred/member/moderator-derived.
- Phase 1 verification passed:
  - `pnpm vitest run src/app/core/community-renunciations.test.ts src/app/core/community-membership.test.ts src/app/util/community-preferences.test.ts --project=main` passed: 3 files, 21 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.

## Decisions

- Use NIP-51 kind `30000` / Welshman `NAMED_PEOPLE` with `d = app/budabit/renounced-communities`.
- Store renounced community pubkeys only as encrypted private `p` tags.
- Do not use kind `10004`, because that represents positive community membership.
- Do not use kind `10000`, because renunciation is not a global mute/block.
- Do not artificially gate direct publishing access or section permission checks for a renounced community.
- Do not allow admin/community-owner keys to renounce their own community; ignore accidental admin renunciation entries in effective membership filtering.
- Keep `activeUserCommunityRefs` as the effective filtered membership store and expose `rawActiveUserCommunityRefs` for UI eligibility.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Phase 1 changed files: `docs/session-plan.md`, `docs/session-checkpoint.md`, `src/app/core/community.ts`, `src/app/core/community-renunciations.ts`, `src/app/core/community-renunciations.test.ts`, `src/app/core/community-membership.ts`, `src/app/core/community-membership.test.ts`, `src/app/core/community-state.ts`, `src/app/util/community-preferences.ts`, and `src/app/util/community-preferences.test.ts`.
- Direct community permission helpers were intentionally not changed.

## Next Action

- Start Phase 2 by extending community trust and people-search inputs to filter viewer-renounced community evidence.

## Verification

- Startup inspection read the previous completed checkpoint and full previous plan.
- Startup inspection ran `git status --short --branch`, `git remote -v`, and `git log --oneline -10`.
- Pushed the prior member-community commit with `git push`.
- Inspected Welshman list utilities in `/home/johnd/Work/welshman/packages/util/src/List.ts`, `/home/johnd/Work/welshman/packages/util/src/Kinds.ts`, and Welshman app command/list patterns.
- Phase 1 focused tests passed.
- Phase 1 project check passed.
- Phase 1 whitespace check passed.

## Risks Or Blockers

- Kind `30000` overlaps Budabit community profile-list events; Phase 1 added guards in core membership/preference parsing, and Phase 2 must preserve this when filtering search evidence.
- No current blocker.

## Files

- `docs/session-plan.md`
- `docs/session-checkpoint.md`
- `src/app/core/community.ts`
- `src/app/core/community-renunciations.ts`
- `src/app/core/community-renunciations.test.ts`
- `src/app/core/community-membership.ts`
- `src/app/core/community-membership.test.ts`
- `src/app/core/community-state.ts`
- `src/app/util/community-preferences.ts`
- `src/app/util/community-preferences.test.ts`
