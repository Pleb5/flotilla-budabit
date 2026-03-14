# Repository Identity Grouping for Issues & Patches

## Overview
Issues and patches are now grouped by their canonical repository identity (EUC/clone/name), similar to how repository announcement events are grouped. This allows issues and patches from the same logical repository to be displayed together, even if they reference different pubkeys.

## Implementation

### 1. **New Utility Module** (`packages/nostr-git/packages/core/src/lib/utils/groupByRepoIdentity.ts`)

Created utilities to group issues and patches by canonical repository identity:

#### Key Functions:
- **`extractRepoIdentity(event)`**: Extracts EUC, clone URLs, and name from issue/patch events
- **`normalizeCloneUrls(urls)`**: Normalizes clone URLs for comparison (removes .git, trailing slashes, replaces npub paths)
- **`generateCompositeKey(identity)`**: Creates a composite key: `EUC:name:normalizedCloneUrls`
- **`groupIssuesByRepoIdentity(issues)`**: Groups issues by composite key
- **`groupPatchesByRepoIdentity(patches)`**: Groups patches by composite key
- **`matchesRepoIdentity(event, repoIdentity)`**: Checks if an issue/patch belongs to a specific repo

### 2. **Repo Class Updates** (`packages/nostr-git/packages/ui/src/lib/components/git/Repo.svelte.ts`)

#### Changes:
- **Removed filtering logic**: The Repo class now accepts pre-filtered issues and patches
- **No additional filtering needed**: Issues and patches are filtered at the query level in the layout

### 3. **Route Loader** (`src/routes/spaces/[relay]/git/[id=naddr]/+layout.ts`)

#### Key Changes:
- **Extract maintainers and author**: Parses the repo announcement to get all authorized contributors
- **Filter by authors**: Issues and patches are filtered by `authors` field (maintainers + repo author)
- **Filter by repo reference**: Also filters by `#a` tag to ensure issues/patches reference this repo

#### Filtering Logic:
```typescript
// Extract maintainers and author from repo event
const parsed = parseRepoAnnouncementEvent(repo);
const authors = new Set<string>();
authors.add(repo.pubkey); // Author of the repo announcement
if (parsed.maintainers) {
    parsed.maintainers.forEach(m => authors.add(m));
}
const repoAuthors = Array.from(authors);

// Filter issues and patches by authors (maintainers + repo author)
const issueFilters = {
    kinds: [GIT_ISSUE],
    authors: repoAuthors,
    "#a": [`${GIT_REPO}:${decoded.pubkey}:${repoName}`],
};
```

This ensures that only issues and patches created by authorized contributors (maintainers or repo owner) are loaded.

## How It Works

### Identity Extraction from Events

Issues and patches contain repository identity information in their tags:

```typescript
// Example issue/patch tags:
[
  ["a", "30617:pubkey:reponame"],           // Repository reference
  ["r", "https://example.com/euc", "euc"],  // EUC (optional)
  ["r", "https://github.com/user/repo"],    // Clone URL
  ["r", "https://gitlab.com/user/repo"],    // Another clone URL
]
```

### Composite Key Generation

The composite key combines three elements:
1. **EUC**: The canonical web identifier (if present)
2. **Name**: The repository name
3. **Normalized Clone URLs**: Sorted, normalized clone URLs

Example: `https://example.com/euc:myrepo:https://github.com/user/repo|https://gitlab.com/user/repo`

### Matching Process

When an issue/patch arrives:
1. Extract its repository identity (EUC, clone URLs, name)
2. Generate its composite key
3. Compare with the current repo's composite key
4. Include only if keys match

## Benefits

### 1. **Unified View**
- Issues and patches from the same logical repository are displayed together
- Works across different pubkeys (forks, mirrors, etc.)

### 2. **Consistent with Repo Grouping**
- Uses the same logic as repository announcement grouping
- Maintains consistency across the application

### 3. **Flexible Identity**
- Supports EUC-based identification
- Falls back to clone URL matching
- Handles repositories with multiple clone URLs

### 4. **Efficient**
- Filtering happens in-memory after events are loaded
- No additional network requests
- Caches are automatically invalidated when repo changes

## Example Scenarios

### Scenario 1: Fork with Same Name
```
Repo A: pubkey1:myrepo (EUC: example.com/myrepo, clone: github.com/user1/myrepo)
Repo B: pubkey2:myrepo (EUC: example.com/myrepo, clone: github.com/user2/myrepo)

Issue X: references pubkey1:myrepo, has EUC example.com/myrepo
→ Shows in both Repo A and Repo B (same EUC)
```

### Scenario 2: Mirror with Different Clone URLs
```
Repo A: pubkey1:myrepo (clone: github.com/user/myrepo)
Repo B: pubkey1:myrepo (clone: gitlab.com/user/myrepo)

Issue X: references pubkey1:myrepo, has clone github.com/user/myrepo
→ Shows only in Repo A (different clone URLs, no EUC)
```

### Scenario 3: Same Repo, Different Pubkeys
```
Repo A: pubkey1:myrepo (EUC: example.com/myrepo)
Repo B: pubkey2:myrepo (EUC: example.com/myrepo)

Issue X: references pubkey1:myrepo, has EUC example.com/myrepo
Issue Y: references pubkey2:myrepo, has EUC example.com/myrepo
→ Both issues show in both repos (same EUC)
```

## Testing

To verify the grouping works correctly:

1. **Create two repo announcements** with the same name and EUC but different pubkeys
2. **Create issues** referencing each repo
3. **Navigate to each repo** in the UI
4. **Verify** that issues from both repos appear in both views

## Future Enhancements

Potential improvements:
- Add UI indicator showing which issues/patches are from "related" repos
- Allow users to toggle between "strict" (exact pubkey match) and "grouped" (canonical identity) views
- Add statistics showing how many repos are grouped together
- Implement similar grouping for comments and labels

## Files Modified

1. **Created:**
   - `packages/nostr-git/packages/core/src/lib/utils/groupByRepoIdentity.ts`
   - `REPO_IDENTITY_GROUPING.md`

2. **Modified:**
   - `packages/nostr-git/packages/core/src/index.ts` (export new utilities)
   - `packages/nostr-git/packages/ui/src/lib/components/git/Repo.svelte.ts` (filter issues/patches)
   - `src/routes/spaces/[relay]/git/[id=naddr]/+layout.ts` (updated comments)

## Notes

- The grouping is transparent to the UI components
- No changes needed to issue/patch display components
- The Repo class remains the single source of truth
- Filtering is reactive and updates automatically when repo data changes
