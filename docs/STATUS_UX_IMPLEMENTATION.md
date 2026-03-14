# Status UX Implementation Summary

## Overview
Implemented a comprehensive Status UX system for Issues & Patches using Svelte 5, following NIP-34 specifications and integrating with the existing `Repo` class as the single source of truth.

## Components Created

### 1. Status Component (`packages/nostr-git/packages/ui/src/lib/components/git/Status.svelte`)

**Features:**
- **Two modes**: Compact (badge only) and Full (complete UI with history, suggestions, and editor)
- **Authority-based permissions**: Only maintainers and root authors can publish status
- **Status resolution**: Determines current status from newest authoritative event
- **History tracking**: Shows all status changes in chronological order
- **Community suggestions**: Non-authorized users' status events shown as suggestions
- **Adopt functionality**: Maintainers can adopt community suggestions
- **Merge metadata**: For 1631 (merged/resolved), supports optional merge-commit and applied-as-commits tags
- **Rate limiting**: 3-second cooldown between status publications
- **Optimistic UI**: Immediate feedback with graceful error handling

**Props:**
```typescript
{
  repo: Repo                    // Repo instance (source of truth)
  rootId: string                // Issue/patch root event ID
  rootKind: 1621 | 1617        // Issue (1621) or Patch (1617)
  rootAuthor: string            // Root event author pubkey
  statusEvents?: StatusEvent[]  // Filtered status events for this root
  actorPubkey?: string          // Current user's pubkey
  compact?: boolean             // Compact mode (badge only)
  onPublish?: (event) => Promise<any>  // Publish handler
}
```

**Status States:**
- **Issues**: open, draft, resolved, closed
- **Patches**: open, draft, merged, closed

**Event Structure:**
```typescript
{
  kind: 1630 | 1631 | 1632 | 1633,  // open, merged/resolved, closed, draft
  content: string,                   // Optional note
  tags: [
    ["e", rootId, "", "root"],
    ["a", repoAddr, relayHint],      // Optional repo reference
    ["r", eucOrCommitSha],           // Optional EUC or commit refs
    ["p", recipientPubkey],          // Recipients
    // For 1631 only:
    ["merge-commit", sha],
    ["applied-as-commits", sha1, sha2, ...]
  ]
}
```

## Integration Points

### 1. Issues List (`src/routes/spaces/[relay]/git/[id=naddr]/issues/+page.svelte`)
- Added `Status` component in **compact mode** to each issue card
- Positioned alongside existing `RepoPatchStatus` badge
- Status events grouped by root ID via `statusEventsByRoot` map

### 2. Issue Detail (`src/routes/spaces/[relay]/git/[id=naddr]/issues/[issueid]/+page.svelte`)
- Added `Status` component in **full mode** in dedicated section
- Integrated `handleStatusPublish` handler using `postStatus` from git-commands
- Shows complete status history, suggestions, and editor for authorized users

### 3. Patches List (`src/routes/spaces/[relay]/git/[id=naddr]/patches/+page.svelte`)
- Added `Status` component in **compact mode** to each patch card
- Mirrors issues list integration
- Uses rootKind=1617 for patches

### 4. Patch Detail (`src/routes/spaces/[relay]/git/[id=naddr]/patches/[patchid]/+page.svelte`)
- Added `Status` component in **full mode** in dedicated section
- Integrated `handleStatusPublish` handler using `postStatus` from git-commands
- Shows complete status history, suggestions, and editor for authorized users
- Positioned before merge analysis section

### 5. Data Loaders

**Issues (`issues/+page.ts`):**
```typescript
const statusEventsByRoot = derived(statusEvents, events => {
  const map = new Map<string, any[]>()
  for (const event of events) {
    const rootTag = event.tags.find((t: string[]) => t[0] === "e" && t[3] === "root")
    if (rootTag) {
      const rootId = rootTag[1]
      if (!map.has(rootId)) map.set(rootId, [])
      map.get(rootId)!.push(event)
    }
  }
  return map
})
```

**Patches (`patches/+page.ts`):**
- Same grouping logic as issues

## Publishing Functions (`src/app/git-commands.ts`)

Already existed, no changes needed:
```typescript
export const postStatus = (status: StatusEvent, relays: string[]) => {
  const merged = Array.from(new Set([
    ...(relays || []),
    ...Router.get().FromUser().getUrls(),
    ...INDEXER_RELAYS
  ]))
  return publishThunk({ relays: merged, event: status })
}
```

## Authority Rules

**Authorized to publish status:**
1. Root author (issue/patch creator)
2. Repository maintainers (from `repo.maintainers`)
3. Repository owner (from `repo.repoEvent.pubkey`)

**Status resolution precedence:**
1. Newest event from authorized users only
2. Non-authorized events shown as "Suggestions"

## Merge Metadata Defaults

For status kind 1631 (merged/resolved):
- **merge-commit**: Defaults to current HEAD if not specified
- **applied-as-commits**: Defaults to merge-commit if not specified
- Retrieved via `repo.getCommitHistory({ depth: 1 })`

## Relay Hints

Status events include:
- `["a", repoAddr, relayHint]` where relayHint is first relay from `repo.relays`
- `["r", euc]` for repository EUC when available
- `["r", commitSha]` for each commit referenced in merge metadata

## Rate Limiting

- **Cooldown**: 3000ms (3 seconds) between publications
- **UI feedback**: Shows countdown timer when cooldown active
- **Error handling**: Displays error message if publish fails

## Optimistic UI

1. Status change appears immediately in UI
2. On success: Persists in state
3. On error: Shows error message, allows retry

## Console Logging

All publish attempts, successes, and failures logged to console:
```typescript
console.log("[Status] Publishing status", { selectedState, rootId, rootKind })
console.log("[Status] Status published successfully")
console.error("[Status] Failed to publish status:", error)
```

## Svelte 5 Compliance

- Uses `$props()`, `$state()`, `$derived.by()`, `$effect()`
- No deprecated APIs
- Proper `{#snippet}` usage for `{@const}` blocks
- Type-safe component props

## Verification Checklist

✅ List page: Each issue/patch shows status badge in compact mode
✅ Detail page: Full status section with history, suggestions, editor
✅ Permissions: Only maintainers/root author can publish
✅ Suggestions: Non-authorized events shown with "Adopt" button
✅ Merge metadata: Optional fields with HEAD defaults for 1631
✅ Relay hints: Proper `a` and `r` tags with relay hints
✅ Rate limit: 3-second cooldown enforced
✅ Optimistic UI: Immediate feedback with error rollback
✅ No deprecated Svelte APIs
✅ Console logging only

## Files Modified

1. **Created:**
   - `packages/nostr-git/packages/ui/src/lib/components/git/Status.svelte`
   - `STATUS_UX_IMPLEMENTATION.md`

2. **Modified:**
   - `packages/nostr-git/packages/ui/src/lib/components/index.ts` (export Status)
   - `src/routes/spaces/[relay]/git/[id=naddr]/issues/+page.ts` (add statusEventsByRoot)
   - `src/routes/spaces/[relay]/git/[id=naddr]/issues/+page.svelte` (integrate Status compact mode)
   - `src/routes/spaces/[relay]/git/[id=naddr]/issues/[issueid]/+page.svelte` (integrate Status full mode)
   - `src/routes/spaces/[relay]/git/[id=naddr]/patches/+page.ts` (add statusEventsByRoot)
   - `src/routes/spaces/[relay]/git/[id=naddr]/patches/+page.svelte` (integrate Status compact mode)
   - `src/routes/spaces/[relay]/git/[id=naddr]/patches/[patchid]/+page.svelte` (integrate Status full mode)

## Notes

- `postIssue`, `postStatus`, `postComment` functions already existed in `git-commands.ts`
- No feature flags added (as per requirements)
- No new network pools created (uses existing `Repo` instance)
- All data flows through route loaders and `Repo` class
- Compatible with existing `RepoPatchStatus` component (shown alongside)
