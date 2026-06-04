# Repo Rich Composer Implementation Plan

## Goal

Bring the repo issue/PR comment and description composition experience up to the same standard as Thread replies:

- Rich `@` mention search and insertion.
- Nostr entity handling for pasted/embedded notes, profiles, addresses, and permalinks.
- Blossom media/file attachment upload with `imeta` tags and appended URLs.
- Consistent comment editing that preserves rich-editor tags.
- Compact, responsive attachment rendering in all repo comment and description surfaces, especially inline PR comments.

## Non-Negotiable Phase Rule

Every implementation phase starts by reading this whole document from top to bottom before changing code. The phase is not started until that read is complete.

Every phase ends with:

- Verification commands appropriate to the files changed.
- A code review pass for the phase diff.
- `git status`, `git diff`, and `git log --oneline -10` inspection.
- A commit containing only intended files.
- A push of the current branch.

Do not push a phase that has failing required verification unless the failure is unrelated, documented in the commit message/body or handoff notes, and accepted as outside the phase scope.

## Design Constraints

- Prefer small integration seams over rewriting repo UI components.
- Keep `packages/nostr-git-core` framework-agnostic and event-focused.
- Keep `packages/nostr-git-ui` usable outside the app with existing textarea fallbacks.
- Put Budabit-specific rich editor, Blossom policy, and community context in `src/app` components or registry injections.
- Preserve existing NIP-22/NIP-34 event shapes. Use existing `extraTags`/`tags` builder options where possible.
- Do not render raw attachment URLs twice when a dedicated attachment preview renders them.
- Never let inline comments render huge media. Inline comment attachments must stay compact and expandable.
- Keep mobile ergonomics first: touch targets, horizontal overflow, and compact attachment strips must work below 375px viewport width.

## Attachment UX Rules

- Composer attachment strips use small thumbnails/cards, horizontal scrolling, clear remove affordances, and no layout shift when uploads begin.
- Regular issue/PR discussion comments may show image/video previews, but previews must be bounded by max width and max height and remain within the card.
- Inline PR comments must use compact attachment cards by default:
  - Images/videos: thumbnail no larger than a small card.
  - Generic files: filename, extension, and size chip/card.
  - Multiple attachments: wrapping compact grid or horizontal strip, never a tall media column.
  - Full-size media opens by link/click instead of expanding inline by default.
- Description rendering for issue/PR bodies may use larger previews than inline comments, but still bounded and responsive.
- Markdown/content rendering should strip standalone attachment URL lines only when a dedicated attachment renderer is present for those URLs.

## Phase 1 Architecture Review Findings

The monorepo already has the right boundaries for a small integration seam instead of a broad rewrite.

- `packages/nostr-git-core` is event-focused and framework-free. It already supports editor-generated tags:
  - `createGitCommentEvent({extraTags})`.
  - `createGitInlineCommentEvent({extraTags})`.
  - `createIssueEvent({tags})`.
  - `createPullRequestEvent({tags})`.
  - `createCoverLetterEvent({tags})`.
- `packages/nostr-git-ui` is the correct place for optional rich-composer registry contracts and textarea fallbacks. It must not import app-only editor, Blossom, modal, toast, or community modules.
- `src/routes/+layout.svelte` already injects app-owned components into `@nostr-git/ui` through `ConfigProvider`, so rich composer injection fits the existing architecture.
- `src/app/components/RoomCompose.svelte` already has the complete Thread reply experience for comments. A thin app wrapper can adapt it to the generic repo composer contract.
- Issue/PR descriptions need a field-style wrapper around `makeEditor`, not direct reuse of `RoomCompose`, because creation/edit forms submit at the parent form level.
- `src/lib/components/Markdown.svelte` already strips standalone attachment URL lines and renders `BlossomAttachmentList`, but `BlossomAttachmentList` currently has one display mode. Attachment compactness should be handled by adding variants and passing the right variant from repo surfaces.
- The implementation should therefore avoid core event model changes unless tests reveal a missing tag type.

## Phase 1: Monorepo Architecture Review And Integration Boundaries

Start:

- Read this whole implementation plan.

Implementation:

- Review current monorepo architecture before feature work:
  - `docs/architecture/PROJECT_ARCHITECTURE.md`.
  - `packages/nostr-git-core` event builders and tests.
  - `packages/nostr-git-ui` registry, `IssueThread`, `DiffViewer`, `NewIssueForm`, `NewPRForm`.
  - App registry injection in `src/routes/+layout.svelte`.
  - App rich composer/editor implementation in `src/app/components/RoomCompose.svelte`, `ChatCompose.svelte`, `ComposerAttachmentStrip.svelte`, and `src/app/editor`.
- Confirm exact boundaries for rich composition:
  - Core package owns event builder tag plumbing only.
  - UI package owns optional composer slots and fallbacks.
  - App package owns Blossom upload, editor implementation, and context selection.
- Update this document if review finds a simpler or safer integration path.

Verification:

- Documentation-only or exploratory changes: run `git diff --check`.
- If package exports or types are touched: run `npm run check` and targeted package tests.

Commit and push:

- Commit architecture review/doc updates.
- Push the branch.

## Phase 2: Shared Rich Composition Contract

Start:

- Read this whole implementation plan.

Implementation:

- Define a small composition payload contract: `{content: string; tags?: string[][]}`.
- Add optional registry components to `packages/nostr-git-ui` for repo composition while preserving fallbacks:
  - Discussion comment composer.
  - Inline diff comment composer.
  - Rich description editor/field for issue/PR creation forms if practical.
- Prefer generic prop names so the UI package is not coupled to Blossom or Budabit.
- Add app wrappers around existing editor primitives instead of duplicating Blossom upload code everywhere.
- Ensure wrappers can run with:
  - Initial content for edits.
  - Submit/cancel callbacks.
  - Disabled/submitting state.
  - Placeholder text.
  - Repo relay URL and optional community Blossom context.

Verification:

- Run type checks for changed package/app boundaries.
- Add focused tests for contract helpers if any non-trivial helper is introduced.
- Run `npm run check` if registry types or app registration changes.

Commit and push:

- Commit the shared contract and app wrapper components.
- Push the branch.

## Phase 3: Issue And PR Discussion Comments

Start:

- Read this whole implementation plan.

Implementation:

- Replace `IssueThread` textarea composer with the optional rich composer when registered.
- Preserve the existing textarea path as fallback.
- Pass rich-editor `tags` into `createGitCommentEvent({extraTags})`.
- Update comment edit handling to pass tags through `onCommentEdited(comment, content, tags?)`.
- Wire issue list cards, issue detail discussion, and PR discussion to the registered app composer.
- Use repo-bound relays, repo address refs, root event data, and relay hints exactly as today.
- Include compact attachment rendering in discussion comments, using existing `imeta` helpers where possible.

Verification:

- Unit tests for comment builder extra tags if gaps exist.
- `npm run check`.
- Manual UI smoke on desktop and mobile widths:
  - Create text comment.
  - Mention a profile.
  - Paste a Nostr entity/permalink.
  - Attach image and generic file.
  - Edit own comment and preserve tags.

Commit and push:

- Commit discussion comment integration.
- Push the branch.

## Phase 4: PR Inline Diff Comments And Replies

Start:

- Read this whole implementation plan.

Implementation:

- Replace inline diff textarea composer with the optional compact rich composer when registered.
- Preserve the existing textarea path as fallback.
- Pass rich-editor `tags` into `createGitInlineCommentEvent({extraTags})`.
- Pass rich-editor tags through inline reply creation and inline edit callbacks.
- Keep inline comment attachment UI compact by default.
- Ensure click-outside behavior does not close the composer while using mention suggestions, attachment menus, or file pickers.
- Ensure inline comment location metadata (`f`, `c`, `line`) is preserved alongside editor tags.

Verification:

- Targeted tests for inline comment extra tags and preserved file/line tags.
- `npm run check`.
- Manual UI smoke on desktop and mobile widths:
  - Add inline comment with mention.
  - Add inline comment with image attachment.
  - Reply to inline comment with attachment.
  - Edit inline comment.
  - Verify images stay compact and do not break diff layout.

Commit and push:

- Commit inline diff comment integration.
- Push the branch.

## Phase 5: Issue And PR Creation Descriptions

Start:

- Read this whole implementation plan.

Implementation:

- Add rich description support to `NewIssueForm` and `NewPRForm` through an optional registered editor/field.
- Preserve textarea fallback for package consumers.
- Include editor tags in `createIssueEvent({tags})` and `createPullRequestEvent({tags})`.
- Upload attachments before form submission completes; block duplicate submit while uploading.
- Keep attachment preview compact inside modal forms on mobile.
- Validate that empty description rules remain unchanged:
  - Issue description remains required if current behavior requires it.
  - PR description remains optional if current behavior allows it.

Verification:

- Core builder tests for root issue/PR extra tags if not already covered.
- `npm run check`.
- Manual UI smoke on desktop and mobile widths:
  - Create issue with mention, Nostr entity, image, and file attachment.
  - Create PR with mention, Nostr entity, image, and file attachment.
  - Confirm published root events contain `p`, `q`/address, and `imeta` tags.

Commit and push:

- Commit issue/PR creation description integration.
- Push the branch.

## Phase 6: Issue And PR Description Edits

Start:

- Read this whole implementation plan.

Implementation:

- Replace issue detail and PR detail description edit textareas with the shared rich description editor.
- Publish cover-letter update events with editor tags preserved.
- Preserve existing maintainer/author authorization checks.
- Keep the edit UI responsive and compact in the header cards.
- Avoid duplicating attachment URL rendering after edits.

Verification:

- Tests for cover-letter tag preservation if a helper is introduced.
- `npm run check`.
- Manual UI smoke on desktop and mobile widths:
  - Edit issue description with mention and attachment.
  - Edit PR description with Nostr entity and attachment.
  - Confirm rendered result is compact and links/entities resolve.

Commit and push:

- Commit description edit integration.
- Push the branch.

## Phase 7: Attachment Rendering Consistency

Start:

- Read this whole implementation plan.

Implementation:

- Audit all repo rendering surfaces that can display attachment URLs or `imeta` tags:
  - Issue cards and issue detail body.
  - PR list body excerpt and PR detail body.
  - Discussion comments.
  - Inline diff comments and replies.
- Introduce or reuse a compact attachment renderer with variants:
  - `body`: bounded previews suitable for issue/PR descriptions.
  - `comment`: medium compact previews for discussion comments.
  - `inline`: small compact previews/chips for inline PR comments.
- Strip standalone attachment URL lines only for URLs rendered by the attachment renderer.
- Ensure generic files show useful metadata without large previews.

Verification:

- Unit tests for attachment URL stripping/render selection helpers if changed.
- `npm run check`.
- Manual responsive screenshots or viewport checks for body, comment, and inline variants.

Commit and push:

- Commit attachment rendering consistency work.
- Push the branch.

## Phase 8: Final Thorough Verification And Review

Start:

- Read this whole implementation plan.

Round 1, correctness and tests:

- Run full relevant automated checks:
  - `npm run check`.
  - `npm run test:main` if app utilities/core changed.
  - `npm run test:nostr-git-core` if core builders changed.
  - `npm run test:nostr-git-ui` if UI package logic changed.
- Review failing tests before changing code; fix only root causes.

Round 2, code review for simplification and optimization:

- Review the full branch diff.
- Look for duplicated upload/editor logic that can be removed.
- Look for unnecessary compatibility layers, extra names, or helpers.
- Confirm no package consumes app-only imports.
- Confirm no Blossom-specific logic leaked into `packages/nostr-git-ui` or `packages/nostr-git-core`.
- Simplify where it clearly reduces risk.

Round 3, non-obvious bugs and responsive UI:

- Manually review these flows on desktop and narrow mobile widths:
  - Issue creation.
  - PR creation.
  - Issue discussion comment create/edit.
  - PR discussion comment create/edit.
  - PR inline comment create/reply/edit.
  - Issue description edit.
  - PR description edit.
- Specifically check:
  - Mention suggestions are not clipped or hidden behind modals/cards.
  - Attachment pickers and upload status fit on mobile.
  - Inline comment attachments stay compact.
  - Keyboard submit/cancel behavior still works.
  - Click-outside handling does not close active editor popovers.
  - Repeated submit cannot duplicate uploads or comments.
  - `imeta`, `p`, `q`, and address tags are preserved across create/edit paths.

Final commit and push:

- Commit only the fixes and simplifications found in this final phase.
- Push the branch after final verification.
