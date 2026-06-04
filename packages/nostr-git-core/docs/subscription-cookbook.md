# Subscription Cookbook (NIP-34 / NIP-22 / NIP-32)

This doc outlines practical subscription patterns for Git flows implemented in `@nostr-git/core` and used by the Flotilla app.

- The helper `buildRepoSubscriptions({ addressA, rootEventId, euc })` generates redundant filter sets that the client can merge/dedupe.
- Filters are emitted in a stable order: `ids`, `#e`, `#a`, `#r`.
- Client does client-side deduplication and merging where possible.

## Patterns

- Repo by address (A-tag)
  - Use `#a: [<address>]` to fetch all repo events that reference the repo: patches, issues, statuses, comments, states etc.

- Thread by root event id
  - Use `ids: [<rootId>]` to fetch the root event itself.
  - Use `#e: [<rootId>]` to fetch replies (NIP-22 comments, statuses).

- Group by r:euc
  - Use `#r: [<euc>]` to fetch repo announcement groups (30617) and related context.

## Helper

```ts
import {buildRepoSubscriptions} from "@nostr-git/core"
import {load} from "@welshman/net"
import {normalizeRelayUrl} from "@welshman/util"

export async function loadRepoContext(io: {
  relays: string[]
  addressA?: string
  rootId?: string
  euc?: string
}) {
  const {filters} = buildRepoSubscriptions({
    addressA: io.addressA,
    rootEventId: io.rootId,
    euc: io.euc,
  })
  const relays = io.relays.map(normalizeRelayUrl).filter(Boolean) as string[]
  await load({relays, filters})
}
```

## Notes

- The app may subscribe redundantly to ensure completeness across relay operators that only index subsets of fields.
- Client should dedupe by normalized filter shape and coalesce arrays where possible.
- Time-window and limit constraints should be applied by the caller (the helper only emits shape-level filters).
