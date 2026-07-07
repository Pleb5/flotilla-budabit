# Session Checkpoint

## Authority

- This file is authoritative over compacted conversation summaries and older chat history.
- Current repository state is authoritative over this file.

## Goal

- Add reversible user-side community renunciation backed by a private Welshman/NIP-51 list.
- Exclude renounced non-admin communities from Budabit membership lists, recommendations, discovery, and web-of-trust without revoking or blocking direct community publishing access.
- Add Membership page `Leave group` / `Rejoin group` controls with confirmation modals.

## Current Phase

- Phase 4: Final Verification And Closeout

## Phase Exit Criteria

- Targeted tests from phases 1 and 2 pass after all changes.
- `pnpm check` passes.
- `git diff --check` passes.
- Final diff review shows only intentional Budabit files plus session docs.
- Checkpoint records `Current Phase: Complete` and final verification evidence.
- Final closeout commit is pushed before final response.

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
- Phase 2 implemented trust/search/recommendation integration:
  - Added `renouncedCommunityPubkeys` inputs to community trust builders and filtered viewer/target refs plus active-context community evidence.
  - Kept report-state bans as moderation overlay evidence instead of filtering refs during trust collection.
  - Added `excludedCommunityPubkeys` to `getCommunityPeoplePubkeys()` and skipped renounced definitions/profile-list evidence plus renunciation-list events.
  - Wired `userRenouncedCommunityPubkeys` through `/explore`, `/people`, `/git`, `ProfileSingleSelect`, `ChatSearchResults`, and profile collaboration analysis trust/search calls.
  - Recommendation paths using `activeUserCommunityRefs` remain covered by Phase 1 effective membership filtering.
- Phase 2 verification passed:
  - Initial focused test run exposed a report-overlay regression, which was fixed before closeout.
  - `pnpm vitest run src/app/core/community-trust.test.ts src/app/util/people-search.test.ts --project=main` passed: 2 files, 16 tests.
  - `pnpm check` passed with 0 errors and 0 warnings.
  - `git diff --check` passed.
- Phase 3 implemented Membership page UI:
  - Added raw-membership and renounced-state derivation to `src/routes/c/[community]/access/+page.svelte`.
  - Added subtle right-aligned `Leave group` / `Rejoin group` action beside the normal Membership tabs.
  - Suppressed the action for community owner/admin keys.
  - Added confirmation modals explaining that leave hides the group from Budabit memberships/recommendations/trust without revoking direct grants, and rejoin restores those calculations.
  - Added in-flight duplicate-publish protection and success/failure toasts.
- Phase 3 verification passed:
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
- Trust builders should not pass report states into membership-ref selection; reports remain overlays.

## Current State

- Repository: `/home/johnd/Work/budabit`.
- Branch: `dev`, tracking `origin/dev`.
- Phase 1 changed files: `docs/session-plan.md`, `docs/session-checkpoint.md`, `src/app/core/community.ts`, `src/app/core/community-renunciations.ts`, `src/app/core/community-renunciations.test.ts`, `src/app/core/community-membership.ts`, `src/app/core/community-membership.test.ts`, `src/app/core/community-state.ts`, `src/app/util/community-preferences.ts`, and `src/app/util/community-preferences.test.ts`.
- Phase 2 changed files: `docs/session-checkpoint.md`, `src/app/core/community-trust.ts`, `src/app/core/community-trust.test.ts`, `src/app/util/people-search.ts`, `src/app/util/people-search.test.ts`, `src/routes/explore/+page.svelte`, `src/routes/people/+page.svelte`, `src/routes/git/+page.svelte`, `src/app/components/ProfileSingleSelect.svelte`, `src/app/components/ChatSearchResults.svelte`, and `src/app/core/profile-collab-analysis.ts`.
- Phase 3 changed files: `docs/session-checkpoint.md` and `src/routes/c/[community]/access/+page.svelte`.
- Direct community permission helpers were intentionally not changed.

## Next Action

- Start Phase 4 by running final targeted tests, `pnpm check`, and `git diff --check`, then close the checkpoint to `Complete`.

## Verification

- Startup inspection read the previous completed checkpoint and full previous plan.
- Startup inspection ran `git status --short --branch`, `git remote -v`, and `git log --oneline -10`.
- Pushed the prior member-community commit with `git push`.
- Inspected Welshman list utilities in `/home/johnd/Work/welshman/packages/util/src/List.ts`, `/home/johnd/Work/welshman/packages/util/src/Kinds.ts`, and Welshman app command/list patterns.
- Phase 1 focused tests passed.
- Phase 1 project check passed.
- Phase 1 whitespace check passed.
- Phase 2 focused tests passed after fixing report overlay semantics.
- Phase 2 project check passed.
- Phase 2 whitespace check passed.
- Phase 3 project check passed.
- Phase 3 whitespace check passed.

## Risks Or Blockers

- Kind `30000` overlaps Budabit community profile-list events; guards now cover membership, preference, and people-search evidence paths.
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
- `src/app/core/community-trust.ts`
- `src/app/core/community-trust.test.ts`
- `src/app/util/people-search.ts`
- `src/app/util/people-search.test.ts`
- `src/routes/explore/+page.svelte`
- `src/routes/people/+page.svelte`
- `src/routes/git/+page.svelte`
- `src/app/components/ProfileSingleSelect.svelte`
- `src/app/components/ChatSearchResults.svelte`
- `src/app/core/profile-collab-analysis.ts`
- `src/routes/c/[community]/access/+page.svelte`
