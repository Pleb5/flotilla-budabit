# Community Moderation Model

## Goals

- Keep moderation actions explicit, reversible, and easy to audit.
- Separate event-level censorship from community-wide person bans.
- Treat person bans as an override layer on top of normal access grants, not as implicit edits to profile lists or moderator refs.
- Avoid placeholder spam from banned users while preserving clear placeholders for individually censored events.

## Event Censor

An event censor is a section-scoped kind `1984` report targeting a single event id.

- It hides one event in one community section.
- It renders a `Moderated event` placeholder when the original event is present.
- It does not remove the author's access grants.
- It remains active even if the author is later unbanned.
- It is revoked by publishing a kind `5` delete for the report event.

## Person Ban

A person ban is a community-wide kind `1984` report targeting a pubkey.

- It overrides normal write access from profile lists, admission grants, and moderator grants.
- It blocks publishing through Budabit while the report is active.
- It hides that pubkey's community content in normal feeds without rendering one placeholder per event.
- Direct/detail views may show a single `Moderated person` state if the original event is loaded.
- It is revoked by publishing a kind `5` delete for the report event.
- It does not mutate community profile lists, admission history, or moderator grant refs.

This makes a ban reversible without reconstructing previous grants. Durable governance changes, such as removing a moderator's grant refs from the community definition, remain explicit admin actions.

## Section Access Grants And Revocations

Section-scoped write access is separate from community-wide person bans.

- A `+` admission review on a form response is immutable evidence that a moderator granted section write access.
- A `-` admission review on the same response is immutable evidence that the moderator rejected or later revoked that section write access.
- The latest authorized review for a response is the durable decision: latest `+` grants, latest `-` revokes.
- Profile-list events are materialized state for active write access. Granting access appends the applicant to the moderator-owned section profile list. Revoking access removes the applicant from that profile list.
- Repair flows must rebuild profile lists from immutable admission reviews using the exact profile-list refs in the community definition. They must not derive `d` tags from section names.

This keeps ordinary access revocation reversible and auditable without using person bans as a substitute for section-level permission changes.

## Admission Review History

Active submission state and review history are separate.

- A deleted response is no longer the applicant's active submission and should not block a revised application.
- Deleting or superseding a response must not hide prior authorized moderator decisions for the applicant.
- Budabit should query review reactions by applicant `p`, community `h`, and response-kind `k` tags, then filter by section/form client-side.
- Prior authorized reviews should be shown as context on new pending applications, such as `Previously rejected`, `Previously granted`, or `Previously revoked`.
- Review history prevents applicants from making a fresh pending response look like it has no prior decision, while still allowing resubmission after rejection.

This keeps the user-facing workflow forgiving without making moderator evidence disappear from normal review UX.

## Badges

Badges are community engagement and endorsement primitives, not access-control primitives.

- Badges do not grant section write access.
- Badges do not make a pubkey a moderator.
- Section access must come from profile-list state and authorized admission reviews.
- Badge definitions and awards should be loaded only by views or tools that need badge data, not by the core community permission bootstrap.
- Budabit should only present community badges from the admin or the current active, non-banned moderator set.

This keeps moderation simple while leaving room for badges to support recognition, achievements, endorsements, and future context-specific community features.

## Moderator And Admin Rules

- Moderators cannot censor or ban other current moderators.
- Moderators cannot censor or ban the community admin.
- The admin can censor or ban moderators.
- A banned moderator's app-level grant/review/moderation powers are ignored while the ban is active.
- Admin moderator-grant revocation is separate from person banning. A future combined action may offer `Ban and revoke moderator grants`, but unbanning should not silently restore revoked moderator grant refs.
- Section access revocation is separate from person banning. It removes section write access and publishes a `-` admission review, but does not hide the person's existing content.

## Rendering Rules

- Event-censored content renders as `Moderated event` where the event would normally appear.
- Person-banned content is filtered out of normal feeds to prevent placeholder flooding.
- Person-banned content can still render a single `Moderated person` state in direct/detail contexts.
- Moderation audit pages show active event censors and person bans with reporter, target, section/scope, and captured event metadata when available.

## State Ownership

- Community bootstrap loads moderation reports with authentication.
- Report-delete hydration is centralized in community state and runs fire-and-forget so community readiness is not blocked by delete backfill.
- Community live subscriptions include report and report-delete filters.
- Local storage persists both `1984` reports and kind `5` report deletes for reports so stale cached reports do not resurrect after reload.
