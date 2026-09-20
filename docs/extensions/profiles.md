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

### Opening the host profile modal

`ui:openProfile` opens the same `ProfileDetail` modal used by Budabit's own profile links. Declare the separate `ui:openProfile` permission and check the advertised actions before rendering interactive profile labels.

```ts
await bridge.request("ui:openProfile", {
  pubkey,
  contextSessionId: communityContext.contextSessionId,
  contextVersion: communityContext.contextVersion,
})
```

The public key must be full lowercase hex. Community widgets supply their current context tokens. The host checks context before and after lazy loading, rejects detached iframes, and derives relay hints from the current widget context. The response is `{status: "ok"}` when the modal opens, or the normal bridge error payload.

The host pushes the profile onto its existing modal stack, retaining the underlying widget iframe. Escape, backdrop dismissal, Back, and the profile's Go back control remove the top modal and return to the widget. For this entry point, **View full profile opens in a separate tab**, preserving the widget and its draft; ordinary host profile modals retain their normal same-tab link. **Open Chat** retains its normal same-tab navigation and therefore closes the widget.

Community Freelance v0.5.1 adds profile buttons throughout its shared account labels. Listing cards use a separate listing button and profile button, supporting keyboard activation without nested buttons. Unsupported hosts continue to render static labels; a bridge error appears in the widget and the user can retry the identity click.

### Profile data

Community Freelance v0.5.0 coalesces mounted identity labels into this API, renders avatars and profile names, and uses shortened npubs when no usable name is available. The signing account can render matching `widget:init.user` metadata immediately. Old hosts without the API retain that signer metadata and npub fallbacks for other accounts. Full profile resolution requires both the host update and the widget manifest's added read permission.

## Verification — 2026-09-20

Host implementation `12242f577`; Community Freelance implementation `176e311` (v0.5.0).

- `pnpm check`: zero Svelte/TypeScript errors or warnings.
- Focused Vitest run for `extensions/profiles`, `extensions/bridge`, `extensions/host-capabilities`, and `core/profile-resolver`: 101 tests passed. Verified cache-first snapshots, community hints, bounded fallback and late updates, stale-context/detach cleanup, request bounds, and the explicit read permission alongside existing resolver regressions.
- `tests/e2e/community-freelance-quicklink.spec.ts`: four Chromium desktop/mobile tests passed using the real localhost host and built widget with generated identities and intercepted relay/HTTP fixtures. The two profile tests also passed against the final widget bundle.
- Browser telemetry confirmed community-only and indexer-only profiles were discovered through their respective host relay requests; a cache-only profile needed no request. Late profiles and avatar edits hydrated labels. Service/order participants and both reviews, Job/proposal authors, and existing signer/access/draft flows passed. Iframe workflow networking contained no profile queries or external relay reads.
- Inspected desktop-light/mobile-dark profile cards and service-detail screenshots; no page errors or mobile horizontal overflow. Private evidence is retained under `~/.cache/opencode-v2/tmp/opencode/freelance-profile-bridge/results/`.

The user is deploying the production host. These checks establish local real-host behavior; production verification awaits deployment confirmation.
