# Profile resolution bridge

`profiles:resolve` exposes Budabit's existing profile resolver to widgets. Declare the read-only `profiles:resolve` permission and feature-detect it in `widget:init.capabilities.actions`.

The adapter reads the shared `profilesByPubkey` store and calls `loadBudabitProfile` for missing display data, passing the widget's current community relays as `communityRelays`. Existing indexer configuration, known-author outbox fallback, shared caching, in-flight deduplication, retry cooldowns, parsing, and event selection remain in the existing resolver. The adapter does not implement another profile discovery policy or use `nostr:query`.

## Request

```ts
const request = {
  requestId: crypto.randomUUID(),
  pubkeys: [authorPubkey, counterpartyPubkey],
  contextSessionId: communityContext.contextSessionId,
  contextVersion: communityContext.contextVersion,
}

bridge.on("profiles:updated", applySnapshot)
applySnapshot(await bridge.request("profiles:resolve", request))
```

- `requestId`: nonempty string, at most 128 characters. Use a new ID whenever replacing the request.
- `pubkeys`: up to 512 full lowercase hex public keys; duplicates are removed.
- Community widgets supply their current `contextSessionId` and `contextVersion`. A mismatch is rejected before loading. These fields are optional outside a community context.
- The host derives community relay hints from the widget context. No arbitrary relay list is accepted by this method.

Each accepted request **replaces this iframe's watched pubkey set**. Send an empty list to stop watching. Combine visible account labels into one request rather than sending independent requests per component.

## Snapshots and updates

Both the response and `profiles:updated` use this shape:

```ts
{
  status: 'ok',
  requestId: 'current-request-id',
  revision: 0,
  profiles: [
    {
      pubkey: '...',
      status: 'ready',
      profile: {pubkey: '...', display_name: 'Ada', name: 'ada', picture: 'https://...'},
    },
    {pubkey: '...', status: 'loading'},
    {pubkey: '...', status: 'unavailable'},
  ],
}
```

Cached profiles return immediately. Missing profiles load with the existing resolver's batch-concurrency bound. The adapter allows at most five seconds of loading UI per watched set. `unavailable` means the attempt has produced no usable display data or that window elapsed; it is not proof that the author has never published a profile.

The store watch remains active after fallback. Later profiles and edits update the widget, including profiles found by another Budabit surface. Only changes to requested identities emit snapshots. Empty or malformed display fields do not become names or image URLs; names are bounded to 120 characters and picture strings to 2048. Widgets should still validate image URL schemes and handle image failures locally.

Subscribe before issuing the request. Ignore snapshots for old request IDs and revisions no newer than the last applied revision: a live update can arrive before the initial request response. Clear display state and issue a fresh request when the account/community context changes.

The adapter releases its store watch and timer on request replacement, community/account context change, and iframe detach. Shared resolver work is not canceled on behalf of other app consumers. Missing profiles never affect workflow publishing permissions.

## Freelance integration

Community Freelance v0.5.0 coalesces mounted identity labels into this API, renders avatars and profile names, and uses shortened npubs when no usable name is available. The signing account can render matching `widget:init.user` metadata immediately. Old hosts without the API retain that signer metadata and npub fallbacks for other accounts. Full profile resolution requires both the host update and the widget manifest's added read permission.
