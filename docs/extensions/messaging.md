# Widget DM readiness

Classifieds checks the host's shared NIP-17 messaging relay lists (kind `10050`) before publishing or opening Chat. This uses the same list store and outbox/indexer discovery as Chat, with community relay hints. A NIP-65 read/write relay list is not sufficient.

Both actions require their own manifest permission and an attached bridge:

- `messaging:check`: read-only discovery. Send `{expectedPubkey, contextSessionId, contextVersion, recipient?, refresh?}`. The response contains `self`, an optional `recipient`, `communityRelays`, and the matching context version. Each participant has `{pubkey, status: "ready" | "missing" | "unavailable", relays}`. Preload this while the editor or listing detail is open; repeat the check when acting. Concurrent lookups are coalesced, missing results are cached briefly, and each check rereads the live shared store.
- `messaging:useCommunityRelay`: explicit inline setup. Send the same account/context fields plus `relay`, selected from the returned community relay choices. The host accepts only relays from that exact community's current signed definition. It preserves existing settings, signs a kind-10050 list with the pinned account, publishes through the normal personal-data relay policy, and returns readiness only after a positive relay acknowledgement. Failed setup does not optimistically populate Chat's relay list. Existing configured accounts are returned without replacing their settings.

The widget owns the setup prompt. **Use community relay for DMs** continues the pending publish/contact action after successful setup. **Open messaging settings** navigates to `/settings/relays?section=messaging`, which expands, scrolls to and focuses the **Messaging Relays** accordion. Save drafts before navigating away. **Keep editing / Back to listing** cancels the pending action. An unavailable lookup can be retried; a seller without usable DM relays cannot be repaired by the buyer and stays on the listing with a helpful prompt.

Account/context changes and iframe teardown invalidate pending checks. The host rechecks the account and list revision after signing, and verifies that the signed event matches the requested settings before publishing. The setup capability does not grant arbitrary kind-10050 signing or publication through generic Nostr bridge actions.

Deploy the host changes and update the widget's installed manifest permissions together. Earlier hosts cannot supply this readiness contract.

Verification: `src/app/extensions/messaging.test.ts`, the messaging permission cases in `bridge.test.ts`, and `tests/e2e/community-classifieds-messaging.spec.ts` cover discovery, acknowledgement failures, identity/list changes, the settings accordion, publication continuation, seller/buyer readiness, and listing clipboard controls with local/generated test identities and mocked public services.
