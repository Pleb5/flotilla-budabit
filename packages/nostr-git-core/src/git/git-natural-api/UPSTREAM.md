# Git Natural API Provenance

This directory is Budabit's owned Git Smart HTTP reader.

It was initially derived from `@fiatjaf/git-natural-api` at upstream commit
`72958448e51f035122bea2b3b6ae84f1d257322a` (published as JSR version `0.2.5`)
from:

`https://gitnostr.com/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6/git-natural-api.git`

The upstream package declares the MIT license. Budabit maintains this copy
directly and may selectively port future upstream changes after review.

The transport and pack parser differ intentionally from the baseline:

- requests receive an explicit fetch implementation and abort signal;
- pkt-line and side-band responses are parsed without large array spreads;
- zlib stream boundaries come from consumed input rather than size heuristics;
- object sizes and the pack SHA-1 trailer are validated.
