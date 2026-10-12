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
