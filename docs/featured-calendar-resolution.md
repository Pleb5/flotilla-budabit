# Exact featured-event resolution

`community:queryEvents` optionally returns `resolutions` for exact refs:
`{ref, status: "found" | "deleted" | "missing" | "unavailable"}`. Existing event,
pagination, permission and context fields remain compatible. Incomplete unknown
refs retain the existing transient query-timeout response.

The exact query also requests bounded kind-5 evidence in its already-authorized
author/address scope (or `#e` for exact IDs). A deletion must verify cryptographically,
match the original author, and not have a future timestamp. An ID deletion requires
the original event to establish its author. Address deletions remove versions at
or before the deletion timestamp; a newer replacement survives. Deletion evidence
is sufficient even when another queried relay did not complete. Absence without
deletion evidence is terminal only after completed event-query coverage.

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
