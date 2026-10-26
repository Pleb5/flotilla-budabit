# Exact featured-event resolution

`community:queryEvents` optionally returns `resolutions` for exact refs:
`{ref, status: "found" | "deleted" | "missing" | "unavailable"}`. Existing event,
pagination, permission and context fields remain compatible. Incomplete unknown
refs retain the existing transient query-timeout response.

The exact query also requests kind-5 evidence with a requested limit of 100 per
filter in its already-authorized author/address scope (or `#e` for exact IDs).
Verified, authorized cached candidates contribute author-scoped `#e` and `#a`
filters to that first request. Newly loaded candidates can cause at most one
follow-up request on the same relay set for the other representation, excluding
filters already covered. Each stage uses the existing 5-second relay deadline;
there is no recursive lookup or new relay discovery. The existing cached-value
fast path still refreshes in the background when no cached tombstone is known.

A deletion must verify cryptographically, match the original author, and not have
a future timestamp. An ID pin requires the verified original event to establish
its author/address; a tombstone alone cannot establish that identity. Both deletion
forms apply independently of pin representation: an `e` tag removes only that
exact ID, while an `a` tag removes address versions at or before the deletion's
timestamp, as specified by NIP-09. A newer address replacement survives an older
`a` deletion, and an `e` deletion does not remove other versions. Deletion evidence
is sufficient even when another queried relay did not complete. Absence without
deletion evidence is terminal only after completed event-query coverage.

Here, completion means the existing loader's transport/EOSE completion flag, not
a raw-result saturation or exhaustive-history certificate. Requested per-filter
limits and stage deadlines are not a hard raw-delivery bound against a relay
that disregards filters or limits. This change does not redesign that loader.

Hex event IDs and address pubkeys are compared case-insensitively. The `d`
identifier remains case-sensitive, including identifiers containing colons.
Resolution metadata retains the caller's original ref spelling for correlation.

The widget consumes terminal metadata to avoid broad discovery of known missing
pins. Old widgets/hosts still speak the previous protocol; deploying only the host
cannot eliminate an older widget's broad fallback. Review and release the paired
widget separately. No shared configuration or featured selection is rewritten.

Investigation on 2026-10-26 found both configured BudaBit pins author-deleted:
identifiers `8196787090026553` and `5662056102314358`, kind 31923, author
`d04ecf33a303a59852fdb681ed8b412201ba85d8d2199aec73cb62681d62aa90`.
The corresponding deletion IDs on `wss://relay.budabit.club` were
`cf8c0d3522963d12f60f2a60affaf27709a674776b7d66a5bbae6b31c3b52d03` and
`cf1b4cf3441e87913158d25060ca42b905ebd396bd5fea18fa1b59f19b409496`.
The definition, configuration, manifest and both deletions passed `nak verify`.
The live logged-out home did not mount the calendar widget, so the exact operator
transport failure was not reproduced. A controlled widget protocol fixture covers
the deleted/incomplete-response path instead.

Follow-up review regressions exercise the actual bridge query filters and responses
for ID-pin/`a` deletion, address-pin/`e` deletion, cached old-version deletion plus a
newer surviving replacement, uppercase IDs, and uppercase address pubkeys with
case-sensitive identifiers. These use signed disposable fixtures and the bridge's
mock relay-loader boundary; widget source and release configuration are unchanged.
