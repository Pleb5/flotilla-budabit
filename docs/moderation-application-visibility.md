# Personal application visibility

Built on verified web source `4c85781b77570b18d42398017b360ea7c2fd704d`, with
the separately committed profile recovery fix `2522e0f4e`.

The moderation review queue offers **Hide** on each application and a **Hidden**
group with **Restore**. Hide is a personal browser preference, scoped to the
signed-in account, exact community definition address, and response event ID.
Other applications from the same applicant are unaffected. A later community
decision does not remove the preference; restoring uses the current decision
and therefore returns the application to New, Granted, or Rejected as appropriate.

Preferences use localStorage under `budabit/hidden-applications:v1:`. This follows
existing browser-local persistence conventions; no relay event, grant, rejection,
membership change, signing request, or cross-device sync is introduced. Clearing
site storage clears these preferences. Other browsers/devices have their own
visibility preferences. The page explicitly labels this limitation.

The storage helper reads the latest saved record before mutation, persists before
updating the UI, listens for other-tab storage changes, and refuses to overwrite
unreadable data. Read failures show an alert and disable Hide/Restore. Write
failures leave the current view intact and show a toast. Account/community changes
select a separate store. A hidden record contains no applicant or review status.

## Verification

- `pnpm check`: zero errors and warnings, using symlinked existing dependencies.
- Focused Vitest: 23 passing tests (18 resolver + 5 visibility tests), including
  failed/empty profile reads, delayed shared profiles, exact-ID persistence,
  account/community isolation, read corruption, and failed writes.
- `tests/e2e/moderation-applications.spec.ts`: two mocked Chromium flows exercise
  the actual moderation route and profile modal with synthetic signed events.
  Three applications by one author have New/Granted/Rejected decisions. Coverage
  includes delayed metadata, profile modal, Hide, Hidden profile modal, reload,
  a later decision while hidden, restoration to the current group, and keyboard
  Hide at 390px width. No publication occurred. A second flow covers missing
  metadata followed by a later modal load and recovery across all groups.
- Desktop and mobile screenshots were inspected. The browser helper was attempted
  but reported `agent-browser is unavailable`; the project-approved focused
  Playwright fallback was used. The run starts with fresh browser state and then
  reloads that state; it does not establish real-relay or production-account
  behavior.
- The new E2E files pass a focused TypeScript check. The repository-wide E2E
  TypeScript command reports existing errors in unrelated fixture/spec files
  (classifieds, freelance, initial-import, private-community, repository identity).
  No diagnostic references the new moderation files.

Review-group counts exclude hidden applications; Hidden has its own count and
the total still includes them. Community-wide moderation notification badges
continue to represent protocol-pending decisions rather than personal hiding.

No deployment, public application submission, grant, rejection, or real account
publication was performed. The exact reported cross-group profile discrepancy
remains unconfirmed; see `moderation-profile-recovery.md` for the verified defect
and the limits of the reproduction.
