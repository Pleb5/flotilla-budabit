# Budabit Community Moderation Implementation Plan

This document breaks the community moderation and NIP-101 admission model into implementation phases.

The target behavior is described in `docs/architecture/Budabit-Community-Moderation.md`. Each phase should leave the app in a working state with focused tests for the new pure helpers or user flows introduced in that phase.

## Phase 0: Protocol Helpers

Add pure helpers for section-scoped admission forms, responses, review reactions, and delete handling.

Scope:

- Add a normalized model for NIP-101 form templates used by Budabit admission.
- Parse `kind:30168` form templates with `d`, `name`, `settings`, `field`, `a`, `content`, and relay tags.
- Parse `kind:1069` responses and normalize `response` tags into field values.
- Build `kind:1069` response templates for identified applicants.
- Parse and build `kind:5` deletes for form responses.
- Parse and build `kind:7` review reactions with `+` and `-` content.
- Add deterministic latest-form selection by address, timestamp, and event id.
- Add deterministic latest-active-submission selection by timestamp and event id, excluding valid deletes.

Suggested files:

- `src/app/core/community-forms.ts`
- `src/app/core/community-forms.test.ts`

Exit criteria:

- Unit tests cover form parsing, response parsing, latest form selection, duplicate response handling, and delete exclusion.

## Phase 1: Authority And Capability Mapping

Extend permission helpers so UI components can reason by publish effect while users still see section-oriented language.

Scope:

- Add a derived capability map keyed by event kind and optional subtype.
- Map every known publish target to the section that grants it.
- Expose helpers that return `allowed`, `missing`, `login-required`, `pending`, `rejected`, or `granted` gate states.
- Add helpers to find grant-capable moderators for a section.
- Enforce that admission form authors and review reaction authors must be grant-capable for the requested section.
- Keep existing profile-list membership as the source of truth for publishing.

Suggested files:

- `src/app/core/community-permissions.ts`
- `src/app/core/community-admission.ts`
- `src/app/core/community-admission.test.ts`

Exit criteria:

- Unit tests prove that permissions are granted by publish effect, not only by section name.
- Unit tests prove that a user with General permission can react/comment without Repositories permission.
- Unit tests prove that non-authoritative forms and reactions are ignored.

## Phase 2: Form Discovery

Load section application forms from community relays without changing `kind:10222`.

Scope:

- For each section, derive grant-capable moderator authors from the active community definition.
- Query community relays for `kind:30168` forms authored by those moderators and tagged with `#a = 10222:<community-pubkey>:`.
- Client-side filter by `content` tag matching the section name.
- Select the active form for each section using the deterministic ordering rules.
- Cache discovered forms in community state.
- Keep queries confined to active community relays.

Suggested files:

- `src/app/core/community-state.ts`
- `src/app/core/community-forms.ts`

Exit criteria:

- Active community bootstrap can expose application forms per section.
- Missing forms are represented explicitly so UI can explain that applications are not currently available.
- Tests cover multiple moderators, stale form versions, same-timestamp tie breaking, and section client-side filtering.

## Phase 3: Application Submission State

Load and classify the logged-in user's access requests.

Scope:

- Query community relays for the user's `kind:1069` responses to active section forms.
- Query valid `kind:5` deletes authored by the same user.
- Query `kind:7` review reactions on the user's responses from grant-capable moderators.
- Classify each request as none, pending, granted, rejected, or deleted.
- Treat profile-list membership as granted even if the `+` reaction is missing.
- Preserve response values in local component state after delete so resubmission is easy.

Suggested files:

- `src/app/core/community-admission.ts`
- `src/app/core/community-state.ts`
- `src/app/components/community/AccessRequests.svelte`

Exit criteria:

- Logged-in users can see their request status for all sections with forms.
- Existing active submissions block duplicate submissions.
- Delete-and-resubmit flow works with confirmation.

## Phase 4: Access Requests Page

Add a community-level page where users manage requested and granted permissions.

Suggested route:

```text
/c/[community]/access
```

Scope:

- Show granted permissions grouped by section and publish effect.
- Show pending applications with submitted response details.
- Show rejected applications with delete/resubmit affordances.
- Show available applications for missing permissions.
- Render simplified NIP-101 form fields for text, option, and label inputs first.
- Require login before submission.
- Publish identified public `kind:1069` responses to community relays only.
- Confirm deletion in a modal before publishing `kind:5`.

Suggested files:

- `src/routes/c/[community]/access/+page.svelte`
- `src/app/components/community/AccessRequests.svelte`
- `src/app/components/community/AdmissionForm.svelte`
- `src/app/components/community/DeleteSubmissionModal.svelte`

Exit criteria:

- A non-member can request access to a section from the page.
- A user with an active submission cannot create another until deleting the old one.
- The page clearly distinguishes granted, pending, rejected, and available permissions.

## Phase 5: Generic Publish Gate UI

Introduce a reusable gate for UI elements that publish community-scoped events.

Scope:

- Add a generic component or helper that accepts event kind, optional subtype, and action label.
- Resolve the required section and user's current admission state.
- Render normal UI when allowed.
- Render muted UI with a tooltip or inline message when missing permission.
- Link missing, pending, and rejected states to the Access Requests page.
- Support compact gate variants for buttons, composer inputs, menu items, and empty states.

Suggested files:

- `src/app/components/community/PublishGate.svelte`
- `src/app/components/community/PermissionHint.svelte`
- `src/app/core/community-admission.ts`

Initial integration targets:

- Room message composer.
- Create room action.
- Create forum thread action.
- Reaction action.
- Comment action.
- Calendar/goal/repository/permalink/widget publication actions.

Exit criteria:

- Inaccessible actions remain visible but muted.
- Each gated element explains the missing permission and links to the correct access flow.
- Allowed users see the normal publishing UI with no extra friction.

## Phase 6: Permissioned View Filtering

Enforce community content rules in read paths by querying allowed authors for permission-governed content.

Scope:

- Ensure each permissioned view loads its section profile list before querying content.
- Construct filters with `authors` from the section profile list where applicable.
- For targeted publications, filter original publications by the authorized author set for the target kind's section.
- Do not broaden queries when a required profile list cannot be loaded.
- Keep public readability of approved content for non-members.

Initial integration targets:

- Room roots.
- Room messages.
- Forum threads.
- Community comments/reactions where they are section-governed.
- Targeted publication catalogs for calendar, goals, repositories, permalinks, and widgets.

Exit criteria:

- Permission-governed views only request or render allow-listed authors.
- Non-members can read approved community content.
- Unauthorized relay-served events do not appear as community-approved content.

## Phase 7: Moderator Form Management

Add form creation and editing for grant-capable moderators.

Scope:

- Add a moderator panel separate from owner/admin tools.
- Show form creation/editing controls only for sections where the logged-in user has grant capability.
- Build `kind:30168` form templates with community `a` tag and section `content` tag.
- Publish forms to community relays.
- Support basic field types: text, option, and label.
- Use addressable replacement semantics for edits by keeping the same `d` tag.

Suggested route:

```text
/c/[community]/moderation
```

Suggested files:

- `src/routes/c/[community]/moderation/+page.svelte`
- `src/app/components/community/ModeratorPanel.svelte`
- `src/app/components/community/AdmissionFormEditor.svelte`

Exit criteria:

- A moderator can create or replace an application form for each section they can grant.
- A moderator cannot create forms for sections they cannot grant.
- Newly published forms become discoverable by the Access Requests page and publish gates.

## Phase 8: Moderator Review Queue

Implement application review workflows.

Scope:

- Load `kind:1069` responses for forms the moderator can review.
- Load valid deletes and review reactions.
- Group cards into New, Granted, and Rejected.
- Show applicant profile, requested section, form name, submitted time, and response summary.
- Provide a review expansion or modal with the full response.
- Grant by publishing profile-list edit, badge award, and `+` reaction.
- Reject by publishing `-` reaction.
- Highlight the moderator panel when new submissions are present.

Suggested files:

- `src/app/components/community/ModerationQueue.svelte`
- `src/app/components/community/ApplicationReviewCard.svelte`
- `src/app/components/community/ApplicationReviewModal.svelte`
- `src/app/core/community-admin.ts`
- `src/app/core/community-admission.ts`

Exit criteria:

- New applications appear in the moderator queue.
- Grant updates effective permissions immediately after publish confirmation.
- Reject moves the application into the rejected group.
- Granted applications remain visible through `+` reactions even if a profile list is later damaged.

## Phase 9: Notifications And Highlights

Notify users when their access status changes.

Scope:

- Watch for relevant `kind:8` badge awards and `kind:7` review reactions on the user's application responses.
- Show in-app notification or toast when access is granted or rejected while Budabit is open.
- Highlight newly granted permissions on the Access Requests page.
- Refresh community permission state after grant or rejection events are seen.
- Defer DM/NIP-44 notification to a later phase unless explicitly required.

Exit criteria:

- Users get visible feedback when a request is granted or rejected in-app.
- Granted permissions unlock gated publish UI without a full reload where possible.

## Phase 10: End-To-End Verification

Add integration and e2e coverage for the complete admission lifecycle.

Scope:

- Test non-member viewing approved content.
- Test missing-permission publish gates.
- Test form discovery from moderator-authored forms.
- Test user application submission.
- Test duplicate submission prevention.
- Test delete and resubmit.
- Test moderator grant.
- Test moderator rejection.
- Test targeted publication author filtering.
- Test kind-level capability behavior across sections.

Expected commands:

```text
npm run check
npm run test:main
npm run build
```

Focused tests should be added near the pure helper phases first so the UI work has stable primitives to build on.

## Phase 11: Root Visibility Consistency

Normalize read paths so root-level content never appears just because another permitted event references it.

Scope:

- Ensure root views and previews use current section writer allow-lists.
- Fix community home room previews to use the same room-root author filtering as `/rooms`.
- Keep reply-like events attached only to permitted roots.
- Do not add fallback root rendering for disallowed roots.

Suggested files:

- `src/routes/c/[community]/+page.svelte`
- `src/routes/c/[community]/rooms/+page.svelte`
- `src/routes/c/[community]/rooms/[room]/+page.svelte`
- `src/routes/c/[community]/threads/+page.svelte`
- `src/routes/c/[community]/threads/[thread]/+page.svelte`
- Targeted publication routes for calendar, goals, repositories, permalinks, and widgets.

Exit criteria:

- Root-level events only render when their author/targeting passes the current section policy.
- Replies/messages do not resurrect hidden roots.
- Tests cover the community home room-preview filtering gap.

## Phase 12: NIP-56 Censor Helpers

Add pure helpers for Budabit community censor reports using NIP-56 `kind:1984` reports with report type `spam`.

Scope:

- Parse event and person censor reports.
- Require community `a = 10222:<community-pubkey>:`.
- Require `content = <section-name>` for event-scoped moderation.
- Build event censor report templates with `e`, `p`, `a`, and `content` tags.
- Build person censor report templates with `p` and community `a` tags.
- Parse and apply `kind:5` deletes for reports.
- Derive effective event/person censor state from reports, deletes, latest community definition, and active moderator authority.
- Enforce render-time authority: admin always counts; section moderators only count for event reports in their section; all-section moderators count for person reports.
- Enforce moderator protection: moderators cannot moderate another current moderator; admin reports can.

Suggested files:

- `src/app/core/community-reports.ts`
- `src/app/core/community-reports.test.ts`

Exit criteria:

- Tests cover admin event/person reports, section moderator event reports, all-section moderator person reports, report deletes, removed moderator reports being ignored, and moderator protection.

## Phase 13: Report Hydration And State

Load effective community censor reports into active community state.

Scope:

- Query community relays for `kind:1984` reports tagged to the active community definition address.
- Query `kind:5` deletes for loaded report ids.
- Expose derived effective report state for current community.
- Keep report hydration safe and bounded; avoid broad network loops.
- Include admin and current eligible moderator reports only at render time.

Suggested files:

- `src/app/core/community-state.ts`
- `src/app/core/community-reports.ts`

Exit criteria:

- Active community state can answer whether an event id or pubkey is censored for a section context.
- Report state updates when the latest `kind:10222` changes, so removed moderator reports stop counting.

## Phase 14: Render Overlay Integration

Apply the censor overlay to section feeds, detail pages, room messages, comments, and quote/reference rendering.

Scope:

- Add a small reusable moderated placeholder component.
- For root feeds and root detail views, replace censored root cards with `Moderated event` where preserving layout is useful, or omit in dense feeds if UX is cleaner.
- For room messages and comments, render `Moderated event` or `Moderated person` placeholders instead of message/comment content.
- Make quote/reference rendering community-aware through the negative path: only replace quoted content when the quoted event or author is effectively censored in the current context.
- Do not add extra labels for normal uncensored quotes, mentions, or references.

Suggested files:

- `src/app/components/community/ModeratedContent.svelte`
- `src/app/components/ContentQuote.svelte`
- `src/app/components/Content.svelte`
- Community route components that render roots, messages, comments, and targeted event discussions.

Exit criteria:

- Censored events/persons show placeholders consistently.
- Uncensored references render as they do today.
- Root visibility remains positive-policy gated.

## Phase 15: Moderation Actions UI

Expose censor actions to authorized moderators and admins.

Scope:

- Add event moderation action for admins and grant-capable section moderators.
- Add person moderation action for admins and all-section moderators.
- Block moderators from moderating current moderators in the UI, while still enforcing the same rule at render time.
- Publish NIP-56 report events to community relays.
- Optionally support report delete/undo for the reporting moderator/admin.

Suggested files:

- Event menus/cards for rooms, forum, calendar/goals, and generic notes.
- `src/app/core/community-reports.ts`
- `src/app/components/community/ModerationAction.svelte`

Exit criteria:

- Authorized users can censor event/person content from the UI.
- Unauthorized users do not see active moderation actions.
- Published reports immediately affect render state after relay/repository confirmation.

## Phase 16: Moderation Activity And Unmoderation

Expose active moderation history and report-delete revocation flows.

Scope:

- Tabulate the community moderation page into review queue, application forms, and moderation activity.
- List the current moderator's active event and person moderation actions newest first.
- Revoke event moderation by publishing a `kind:5` delete for the reporting moderator's `kind:1984` report, labeled `Uncensor`.
- Revoke person moderation by publishing a `kind:5` delete for the reporting moderator's `kind:1984` report, labeled `Unban`.
- Hydrate report deletes anywhere moderation activity is shown so revoked reports disappear from effective state.
- In the admin `Moderators` tab, tabulate each moderator list item into section grants and recent moderator actions.
- Let admins view all current moderators' active moderation actions without allowing admins to revoke other moderators' reports.

Suggested files:

- `src/app/components/community/ModerationReportCard.svelte`
- `src/app/components/community/ModerationReportList.svelte`
- `src/routes/c/[community]/moderation/+page.svelte`
- `src/routes/c/[community]/admin/+page.svelte`
- `src/app/core/community-reports.ts`

Exit criteria:

- Active event and person reports are listed separately on the moderation page.
- Only the reporting moderator sees active revoke controls for a report.
- Report delete publication removes the report from effective render-time censor state.
- Admins can review each current moderator's grants and recent active moderation actions from the same moderator list item.

## Implementation Notes

Keep the first version deliberately simple:

- Public forms only.
- Identified responses only.
- Community relays only.
- Text, option, and label fields first.
- No anonymous submissions.
- No form references in `kind:10222`.
- No separate reviewer-only role yet.
- No DM notification yet.
- Root visibility is positive-policy gated; references do not grant root visibility.
- NIP-56 censoring is a negative overlay and must be enforced at render time.

The most important architectural boundary is that admission forms are moderation workflow state, while profile lists remain the source of effective write permission.
