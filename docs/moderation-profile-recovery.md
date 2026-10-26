# Moderation profile recovery

Source base: `4c85781b77570b18d42398017b360ea7c2fd704d` (the verified web source).

The moderation New/Granted/Rejected rows use the application response event's
exact author pubkey. `ProfileCircle`, `ProfileName`, and `ProfileDetail` all read
the same normalized-pubkey `profilesByPubkey` store through `profile-resolver.ts`.
The modal receives that pubkey and the same relay hints. The audit did not find
an application-ID cache key or moderator/applicant mix-up in these paths.

A confirmed recovery defect existed in the shared resolver: explicit relay
hints were remembered as attempted indefinitely, including empty and failed
reads. Later rows or profile modals could therefore never retry those hints
until cache eviction or a page reload. Explicit attempts now remain deduplicated
while in flight and for 60 seconds after completion. Later loads may retry a
hint if the exact-author profile still lacks display data. Already resolved
profiles do not repeatedly refresh the same hints. Existing relay limits,
ambient discovery, and repository metadata selection remain in use.

`profile-resolver.test.ts` reproduces both empty and failed reads: the two new
cooldown tests fail against the original implementation and pass after the fix.
It also checks that delayed exact-author metadata updates three subscribers and
a newly opened modal subscriber consistently (18 resolver tests pass).

This is a verified recovery bug, not proof of the operator's exact reported
cross-group discrepancy. The synthetic browser flow resolves the same author
consistently across groups; no real operator applications were read or changed.
Browser recovery can also succeed through ambient discovery, so the focused
resolver tests are the regression evidence for the explicit-hint defect.

No deployment or production publication is part of this change.
