# Community local media state

This is local audio-UX coordination between sandboxed widgets, **not** call authority, OBS control/status, a participant roster, or a privacy guarantee. It makes no network requests and publishes no Nostr events.

## Permissions and actions

Declare each requested action explicitly in the widget manifest:

- `community:getMediaState`: get a snapshot and subscribe this bridge instance to `community:mediaStateChanged`.
- `community:setMediaState`: report this instance's call activity or update this tab's broadcast-preview safety hint.

Requests include the host-issued `contextSessionId` and `contextVersion`. The host validates them against the bound iframe's current community context; it never takes a community address/account from request payloads. Normal source/origin and permission checks apply. Active activity requires a signed-in, non-banned viewer. SDK types are `CommunityMediaStateRequest`, `CommunitySetMediaStateRequest`, and `CommunityMediaState`.

```ts
await bridge.request("community:getMediaState", {
  contextSessionId: context.contextSessionId,
  contextVersion: context.contextVersion,
})
await bridge.request("community:setMediaState", {
  contextSessionId: context.contextSessionId,
  contextVersion: context.contextVersion,
  activity: "call", // or "broadcast"
  active: true,
})
```

Snapshots/events include `status: "ok"`, `callActive`, `broadcastPrepared`, a monotonic `revision`, and the **receiving** widget's context session/version. Consumers validate context and revision before applying results. Siblings may have distinct context session IDs; aggregation uses exact community address plus viewer pubkey.

## Lifecycle

Call activity is per bridge **instance**, not extension ID. Any active instance keeps the aggregate active. Leaving, detaching, or changing its context removes only that instance. Opening/joining counts as active before a camera prompt completes, so delayed audio is protected during startup.

Broadcast intent is a tab-local safety flag. It is kept in host `sessionStorage` when available, scoped by community/account, and survives reload or widget removal. Teardown cannot prove external OBS stopped. The broadcasting widget reports preparation once per setup; it offers an explicit clear action after the operator verifies both outputs stopped. Clearing does not unmute current playback.

This service does not coordinate across browser tabs/apps/devices, inspect OBS, or verify capture hardware. Browser storage restrictions may prevent persistence. Stream widgets on older hosts retain a muted/manual fallback. No activity is inferred merely from moderator role or matching an event's host pubkey.
