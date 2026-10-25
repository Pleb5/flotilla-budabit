# DM inbox-list discovery

DM discovery reads each participant's signed kind-10050 list using:

- app indexers and personal NIP-65 relay hints;
- **every declared relay of every active membership of the signed-in account**
  (admin, moderator or member), independently of the selected community;
- the recipient's outbox discovery path.

Membership eligibility comes from the existing community membership resolver,
including renunciations and bans. Stars and bootstrap hints do not establish
membership. The membership union is normalized and deduplicated without the
profile resolver's sampling limits or the router's default three-relay cap.

Chat and background DM synchronization subscribe to membership and personal-relay
metadata. A changed lookup set rechecks both participants even inside the usual
navigation throttle window. Widget messaging checks use the same complete lookup.
Late replies from superseded Chat checks cannot overwrite current status.

These relays discover **public inbox metadata**. Message delivery and DM history
still use the participants' signed kind-10050 destinations. A membership relay
does not become an inbox just because it answered discovery.

Regression coverage: `dm-inbox-discovery.test.ts`, `dm.test.ts`,
`dm-sync.test.ts`, `community-membership.test.ts` and widget messaging tests.

## Bounded indexer checks

The inbox-check boundary always adds `INDEXER_RELAYS` (`VITE_INDEXER_RELAYS`),
even when a caller supplies only community hints. It uses one deduplicated,
six-second request across those sources and the recipient's routed hints,
instead of an additional independently cached outbox request. Kind 10002
remains routing metadata, not an inbox list.

Each source must reach EOSE before the check is treated as complete. A timeout,
disconnect, or saturated 200-event same-author deletion window reports an
incomplete check, including when a cached list exists. Existing consumers handle
this through their retry/error path rather than confirming an absent inbox.
No negative result is cached by this resolver.

Kind 10050 candidates require an exact author and valid signature, even on a
trusted relay. Future-dated candidates are excluded. The newest timestamp wins,
with lexically smaller IDs breaking ties; an empty replacement removes the inbox.
Same-author kind-5 ID/address tombstones and known repository deletions suppress
the selected list without reviving an older cached replacement. These checks
use the existing application transport and authentication policy.

## Verification — 2026-10-12

- 42 focused DM/widget tests and 17 membership tests passed; Svelte/type checking
  passed with zero errors or warnings.
- Isolated browser on the local full development stack (`http://localhost:1847`),
  chat route for Builder: a supplied membership definition declaring
  `wss://relay.budabit.club` contributed that relay to the real lookup function;
  Builder's live inbox list was found in 593 ms. Browser errors were empty.
  This was a logged-out resolver check with fixture membership context, not an
  authenticated end-user membership-discovery test. Late membership/account
  synchronization is covered by the focused lifecycle tests.
