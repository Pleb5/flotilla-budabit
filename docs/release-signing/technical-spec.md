# Release Signing Page - Technical Specification

## Overview

The Release Signing page enables repository maintainers to verify and co-sign release artifacts produced by CI/CD workflows. It aggregates kind 1063 (file metadata) events published by ephemeral CI keys, groups them by configurable tags, compares SHA-256 hashes for consensus, and allows trusted maintainers to republish verified artifacts under their own Nostr identity.

## Tech Stack

- **Framework**: SvelteKit 2 (Svelte 5 runes mode) with TypeScript
- **Nostr**: `@welshman/app`, `@welshman/net`, `@welshman/store`, `@welshman/util`
- **UI**: TailwindCSS + DaisyUI, `@lucide/svelte` icons, `@nostr-git/ui` shared components
- **Routing**: SvelteKit file-based routing under `src/routes/spaces/[relay]/git/[id=naddr]/`

## Architecture

### File Structure

```
flotilla-budabit/src/
  routes/spaces/[relay]/git/[id=naddr]/
    +layout.svelte          # MODIFY - add "Releases" tab
    releases/
      +page.svelte          # NEW - release signing page
  lib/budabit/
    releases.ts             # NEW - core logic module
    constants.ts            # EXISTING - reuse CICD_RELAYS, CICD_PUBLISH_RELAYS
    state.ts                # EXISTING - reuse REPO_KEY, REPO_RELAYS_KEY, effectiveMaintainersByRepoAddress
```

### Data Flow

```
┌─────────────┐     load({kinds:[5401], #a:[repo]})     ┌──────────────┐
│  Page Mount  │ ──────────────────────────────────────► │  Nostr Relays │
│              │     load({kinds:[1063], authors:[...]})  │              │
│              │ ──────────────────────────────────────► │              │
└──────┬───────┘                                         └──────┬───────┘
       │                                                        │
       │  ◄──────────── kind 5401 events ──────────────────────┘
       │  ◄──────────── kind 1063 events ──────────────────────┘
       │
       ▼
┌──────────────┐
│ Filter by    │  trustedNpubs ∩ triggered-by tags
│ trust chain  │  → valid ephemeral pubkeys
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Group by     │  user-selected tags (filename, version, etc.)
│ configured   │
│ tags         │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Compare x    │  validate hex, count consensus
│ tag hashes   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Render       │  consensus view, expandable groups
│ groups       │
└──────────────┘
```

### Trust Chain

The trust model connects the user's identity to ephemeral CI keys through kind 5401 workflow run events:

1. A **maintainer** (trusted npub) triggers a CI workflow, producing a kind 5401 event with `triggered-by` and `publisher` tags.
2. The `publisher` tag contains the ephemeral pubkey that will sign kind 1063 file metadata events.
3. The Release Signing page fetches kind 5401 events for the repo, filters to those triggered by trusted npubs, and extracts the set of valid ephemeral pubkeys.
4. Kind 1063 events are then fetched, filtered to only those authored by valid ephemeral pubkeys.

---

## Implementation Details

### 1. Core Logic Module: `src/lib/budabit/releases.ts`

This module contains all pure logic for release artifact processing, separated from the Svelte component for testability.

#### Types

```typescript
import type {TrustedEvent} from "@welshman/util"

export interface ReleaseArtifact {
  event: TrustedEvent          // the kind 1063 event
  hash: string                 // x tag value (SHA-256, validated)
  filename: string             // filename tag
  triggeredBy: string          // npub that triggered the CI run
  ephemeralPubkey: string      // publisher pubkey
  workflow: string             // workflow file path
  tags: Record<string, string> // all tag key-values for grouping
}

export interface ArtifactGroup {
  key: string                  // composite key from group-by tags
  labels: Record<string, string>  // group-by tag values
  hashCounts: Map<string, ReleaseArtifact[]>  // hash -> artifacts with that hash
  totalCount: number
  consensusHash: string | null // hash with most votes, null if tie
  isUnanimous: boolean         // true when all artifacts agree on hash
}
```

#### Hash Validation

All `x` tag values (SHA-256 hashes) are validated before processing. This prevents injection of non-hash values that could cause false consensus or display issues.

```typescript
export function validateHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash)
}
```

#### Tag Extraction

Follows the same pattern as `cicd/+page.svelte`'s `parseWorkflowRunEvent`, using a closure over the tags array:

```typescript
export function getTagValue(event: TrustedEvent, tagName: string): string | undefined {
  return event.tags.find(t => t[0] === tagName)?.[1]
}
```

#### Group Key Construction

Builds a composite key from user-selected tags. The default group-by tag is `["filename"]`, but users can configure this to include version, platform, architecture, etc.

```typescript
export function buildGroupKey(event: TrustedEvent, groupByTags: string[]): string {
  return groupByTags
    .map(tag => getTagValue(event, tag) ?? "unknown")
    .join("|")
}
```

#### Trusted Publisher Resolution

Fetches kind 5401 events and filters to those triggered by trusted npubs. Returns a map of ephemeral pubkey to the workflow run event that authorized it.

```typescript
import {load} from "@welshman/net"

export async function resolveTrustedPublishers(
  repoAddr: string,
  trustedNpubs: Set<string>,
  relays: string[]
): Promise<Map<string, TrustedEvent>> {
  const runs = await load({
    relays,
    filters: [{kinds: [5401], "#a": [repoAddr]}]
  })

  const trustedRuns = new Map<string, TrustedEvent>()
  for (const run of runs) {
    const triggeredBy = getTagValue(run, "triggered-by")
    const publisher = getTagValue(run, "publisher")
    if (triggeredBy && trustedNpubs.has(triggeredBy) && publisher) {
      trustedRuns.set(publisher, run)
    }
  }
  return trustedRuns
}
```

This mirrors the pattern in `cicd/+page.svelte` where kind 5401 events are loaded via `load()` from `CICD_RELAYS` and parsed with tag extraction.

#### Artifact Grouping and Consensus

Groups artifacts by configured tags and computes hash consensus within each group:

```typescript
export function groupArtifacts(
  artifacts: ReleaseArtifact[],
  groupByTags: string[]
): ArtifactGroup[] {
  const groups = new Map<string, ReleaseArtifact[]>()

  for (const artifact of artifacts) {
    const key = buildGroupKey(artifact.event, groupByTags)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(artifact)
  }

  return Array.from(groups.entries()).map(([key, artifacts]) => {
    const hashCounts = new Map<string, ReleaseArtifact[]>()
    for (const a of artifacts) {
      if (!hashCounts.has(a.hash)) hashCounts.set(a.hash, [])
      hashCounts.get(a.hash)!.push(a)
    }

    const sorted = [...hashCounts.entries()].sort((a, b) => b[1].length - a[1].length)
    const consensusHash = sorted[0]?.[0] ?? null
    const isUnanimous = sorted.length === 1

    return {
      key,
      labels: Object.fromEntries(
        groupByTags.map(tag => [tag, getTagValue(artifacts[0].event, tag) ?? "unknown"])
      ),
      hashCounts,
      totalCount: artifacts.length,
      consensusHash,
      isUnanimous,
    }
  })
}
```

#### Signed Release Event Construction

Creates a new kind 1063 event under the user's pubkey, copying all tags from the source event. The URL tag is preserved for now (blossom re-upload is a follow-up feature).

```typescript
import type {EventTemplate} from "nostr-tools"

export function createSignedRelease(
  sourceEvent: TrustedEvent,
  userPubkey: string
): EventTemplate {
  const tags = sourceEvent.tags.filter(t => t[0] !== "url")
  const urlTag = sourceEvent.tags.find(t => t[0] === "url")
  if (urlTag) tags.unshift(urlTag)

  return {
    kind: sourceEvent.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: sourceEvent.content,
  }
}
```

#### NIP-51 List Resolution

Optionally expand the trusted set via a NIP-51 people list:

```typescript
export async function resolveNip51List(
  listAddr: string,
  relays: string[]
): Promise<string[]> {
  const events = await load({
    relays,
    filters: [{kinds: [30000], "#d": [listAddr]}]
  })

  if (!events.length) return []

  return events[0].tags
    .filter(t => t[0] === "p")
    .map(t => t[1])
}
```

---

### 2. Page Component: `src/routes/spaces/[relay]/git/[id=naddr]/releases/+page.svelte`

Follows the established patterns from `cicd/+page.svelte`:
- Context retrieval via `getContext` for `REPO_KEY` and `REPO_RELAYS_KEY`
- Naddr decoding via `nip19.decode()` for `#a` tag filtering
- Data loading via `load()` from `@welshman/net` using `CICD_RELAYS`
- Svelte 5 runes (`$state`, `$derived`, `$effect`) for reactive state

#### Component Structure

```svelte
<script lang="ts">
  import {getContext} from "svelte"
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {nip19} from "nostr-tools"
  import {load} from "@welshman/net"
  import {pubkey, signer} from "@welshman/app"
  import {getTagValue} from "@welshman/util"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import {CICD_RELAYS, CICD_PUBLISH_RELAYS} from "@lib/budabit/constants"
  import {
    type ReleaseArtifact,
    type ArtifactGroup,
    validateHash,
    resolveTrustedPublishers,
    groupArtifacts,
    createSignedRelease,
    resolveNip51List,
  } from "@lib/budabit/releases"
  import {Shield, ChevronDown, ChevronRight, Check, AlertTriangle, Copy} from "@lucide/svelte"
  import {Button, toast} from "@nostr-git/ui"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  // Context (same pattern as cicd/+page.svelte)
  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  if (!repoClass) throw new Error("Repo context not available")

  const {relay, id} = $page.params

  // Decode naddr for #a tag filtering (same as cicd page)
  const repoNaddr = $derived.by(() => {
    if (!id) return id
    try {
      const decoded = nip19.decode(id)
      if (decoded.type === "naddr") {
        const {kind, pubkey: pk, identifier} = decoded.data
        return `${kind}:${pk}:${identifier}`
      }
    } catch { /* pass */ }
    return id
  })

  // ── State ──────────────────────────────────────────────────────────
  let filterJson = $state(JSON.stringify({kinds: [1063]}, null, 2))
  let groupByTags = $state<string[]>(["filename"])
  let trustedNpubs = $state<Set<string>>(new Set())
  let workflowRuns = $state<Map<string, any>>(new Map())
  let releaseEvents = $state<any[]>([])
  let loading = $state(false)
  let expandedGroups = $state<Set<string>>(new Set())
  let selectedArtifacts = $state<Set<string>>(new Set())

  // ── Derived ────────────────────────────────────────────────────────
  // ... artifacts, groups, consensus computed from releaseEvents + workflowRuns
</script>
```

#### Key State Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `filterJson` | `string` | `{kinds: [1063]}` | User-editable Nostr subscription filter (JSON textarea) |
| `groupByTags` | `string[]` | `["filename"]` | Tags used to group artifacts for hash comparison |
| `trustedNpubs` | `Set<string>` | repo maintainers | Pubkeys trusted to trigger CI runs |
| `workflowRuns` | `Map<string, TrustedEvent>` | `new Map()` | Kind 5401 events keyed by publisher (ephemeral) pubkey |
| `releaseEvents` | `TrustedEvent[]` | `[]` | Kind 1063 events from trusted ephemeral keys |
| `loading` | `boolean` | `false` | Loading indicator |
| `expandedGroups` | `Set<string>` | `new Set()` | Which artifact groups are expanded in the UI |
| `selectedArtifacts` | `Set<string>` | `new Set()` | Event IDs selected for signing |

#### Data Loading Strategy

The page uses a two-phase load, matching the pattern from `cicd/+page.svelte` where kind 5401 events are fetched first, then dependent data is fetched in an `$effect`:

**Phase 1** (onMount): Fetch kind 5401 workflow run events for the repo.

```typescript
onMount(async () => {
  if (!repoNaddr) return
  loading = true

  try {
    // Phase 1: Load workflow runs to discover ephemeral pubkeys
    const runs = await load({
      relays: CICD_RELAYS,
      filters: [{kinds: [5401], "#a": [repoNaddr]}]
    })

    // Build trusted publisher map
    const publisherMap = new Map<string, any>()
    for (const run of runs) {
      const triggeredBy = getTagValue("triggered-by", run.tags)
      const publisher = getTagValue("publisher", run.tags)
      if (triggeredBy && trustedNpubs.has(triggeredBy) && publisher) {
        publisherMap.set(publisher, run)
      }
    }
    workflowRuns = publisherMap
  } finally {
    loading = false
  }
})
```

**Phase 2** ($effect): When `workflowRuns` changes, fetch kind 1063 events from the discovered ephemeral pubkeys.

```typescript
$effect(() => {
  const publishers = Array.from(workflowRuns.keys())
  if (publishers.length === 0) return

  load({
    relays: CICD_RELAYS,
    filters: [{kinds: [1063], authors: publishers}]
  }).then(events => {
    releaseEvents = events.filter(e => {
      const hash = getTagValue("x", e.tags)
      return hash && validateHash(hash)
    })
  })
})
```

This two-phase approach is necessary because the set of trusted ephemeral pubkeys (authors filter for kind 1063) depends on the kind 5401 results.

#### Derived Computations

Artifact grouping and consensus are computed reactively:

```typescript
const artifacts = $derived.by((): ReleaseArtifact[] => {
  return releaseEvents
    .map(event => {
      const hash = getTagValue("x", event.tags)
      if (!hash || !validateHash(hash)) return null
      const publisherRun = workflowRuns.get(event.pubkey)
      if (!publisherRun) return null

      return {
        event,
        hash,
        filename: getTagValue("filename", event.tags) ?? "unknown",
        triggeredBy: getTagValue("triggered-by", publisherRun.tags) ?? "",
        ephemeralPubkey: event.pubkey,
        workflow: getTagValue("workflow", publisherRun.tags) ?? "",
        tags: Object.fromEntries(
          event.tags.map(t => [t[0], t[1]])
        ),
      } satisfies ReleaseArtifact
    })
    .filter((a): a is ReleaseArtifact => a !== null)
})

const groups = $derived.by(() => groupArtifacts(artifacts, groupByTags))
```

#### Sign and Publish

```typescript
async function signAndPublish() {
  if (!$signer || !$pubkey) {
    toast.error("Please log in to sign releases")
    return
  }

  const toSign = artifacts.filter(a => selectedArtifacts.has(a.event.id))
  if (toSign.length === 0) return

  try {
    for (const artifact of toSign) {
      const unsigned = createSignedRelease(artifact.event, $pubkey)
      const signed = await $signer.sign(unsigned)
      // Publish using welshman pattern
      await load({
        relays: CICD_PUBLISH_RELAYS,
        filters: [], // publish-only
      })
      // Alternative: use publishThunk from @welshman/app
    }
    toast.success(`Signed ${toSign.length} release artifact(s)`)
    selectedArtifacts = new Set()
  } catch (e) {
    toast.error(`Failed to sign: ${e}`)
  }
}
```

#### UI Layout

The page template follows the card-based layout from `cicd/+page.svelte`:

```svelte
<svelte:head>
  <title>{repoClass.name} - Releases</title>
</svelte:head>

<div class="space-y-4">
  <!-- Header -->
  <div class="sticky -top-8 z-nav my-4 max-w-full space-y-2 backdrop-blur">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold">Release Signing</h2>
        <p class="text-sm text-muted-foreground max-sm:hidden">
          Verify and co-sign release artifacts from CI builds
        </p>
      </div>
      <Button variant="git" size="sm" onclick={signAndPublish}
              disabled={selectedArtifacts.size === 0 || !$pubkey}>
        <Shield class="h-4 w-4" />
        Sign Selected ({selectedArtifacts.size})
      </Button>
    </div>
  </div>

  <!-- Filter Configuration (collapsible) -->
  <!-- ... JSON textarea for filter, tag chips for groupByTags -->

  <!-- Artifact Groups -->
  {#each groups as group (group.key)}
    <!-- Group card with consensus indicator, expandable hash details -->
  {/each}
</div>
```

Each artifact group renders as a card showing:
- Group label (e.g., filename)
- Consensus status icon: green check (unanimous), yellow warning (majority), red alert (no consensus)
- Hash value(s) with vote counts
- Expandable list of individual artifacts with their source workflow runs

---

### 3. Layout Modification: `+layout.svelte`

Add a `RepoTab` for the releases page, following the existing tab pattern. The tab is inserted after the "Commits" tab and before the extension tabs loop.

#### Import Addition

Add `Shield` to the `@lucide/svelte` import:

```diff
  import {
    FileCode,
    GitBranch,
    CircleAlert,
    GitPullRequest,
    GitCommit,
    ChevronLeft,
+   Shield,
  } from "@lucide/svelte"
```

#### Tab Addition

Insert after the Commits `RepoTab` and before the `{#each repoTabExtensions}` block:

```svelte
<RepoTab
  tabValue="releases"
  label="Releases"
  href={`${basePath}/releases`}
  {activeTab}>
  {#snippet icon()}
    <Shield class="h-4 w-4" />
  {/snippet}
</RepoTab>
```

### 4. Constants: `src/lib/budabit/constants.ts`

No new constants needed. The release signing feature reuses:
- `CICD_RELAYS` (`["wss://relay.sharegap.net", "wss://nos.lol", "wss://relay.primal.net"]`) for fetching workflow runs and release events
- `CICD_PUBLISH_RELAYS` (`["wss://relay.sharegap.net", "wss://nos.lol"]`) for publishing signed release events

---

## Nostr Event Kinds

| Kind | Name | Role in Release Signing |
|------|------|------------------------|
| 5401 | Workflow Run | Links trusted npub (triggered-by) to ephemeral key (publisher). Contains workflow metadata. |
| 1063 | File Metadata (NIP-94) | Published by ephemeral CI key. Contains `x` (SHA-256 hash), `filename`, `url`, and other artifact metadata tags. |
| 30000 | NIP-51 People List | Optional. Expands trusted npub set via a curated list. |

### Kind 5401 Tag Structure (relevant fields)

```
["a", "30617:<pubkey>:<repo-identifier>"]   // repo reference
["triggered-by", "<hex-pubkey>"]            // who triggered the CI run
["publisher", "<hex-pubkey>"]               // ephemeral key that will publish artifacts
["workflow", ".github/workflows/release.yml"] // workflow file path
["branch", "main"]                          // branch
["trigger", "workflow_dispatch"]            // trigger type
```

### Kind 1063 Tag Structure (NIP-94)

```
["x", "<sha256-hex>"]                      // file hash (64 char hex)
["filename", "myapp-v1.0.0-linux-amd64"]   // artifact filename
["url", "https://blossom.example/..."]     // download URL
["m", "application/octet-stream"]          // MIME type
["size", "12345678"]                       // file size in bytes
["version", "1.0.0"]                       // optional: version tag
["platform", "linux-amd64"]               // optional: platform tag
```

---

## Security Considerations

### 1. Hash Validation
The `x` tag must match `/^[a-f0-9]{64}$/` (lowercase hex, exactly 64 characters). Any event with an invalid hash is silently dropped. This prevents:
- Non-hash values being used as group keys
- Display injection via tag values
- False consensus from malformed data

### 2. Pubkey Validation
All pubkeys (triggered-by, publisher, event.pubkey) must be valid 64-character hex strings. The existing `isHexPubkey` helper in `state.ts` provides this validation:
```typescript
const isHexPubkey = (value: string) => /^[0-9a-f]{64}$/i.test(value)
```

### 3. Tag Sanitization
When constructing the signed release event via `createSignedRelease()`, all tags are copied from the source event. Before publishing, tag values should be validated as reasonable strings (no control characters, bounded length).

### 4. URL Independence
Hash comparison uses only the `x` tag. The `url` tag is never used for verification -- URLs can point to different content or be spoofed. The URL is preserved in the signed event only for download convenience.

### 5. Filter Validation
The user-editable filter JSON textarea must parse as a valid Nostr filter object. Client-side validation checks:
- `kinds` is an array of positive integers
- `authors` (if present) is an array of 64-char hex strings
- No unexpected keys that could cause relay-side issues

---

## State Persistence

Following the pattern from `cicd/+page.svelte`, filter state is persisted to `localStorage` per-repo:

```typescript
const storageKey = $derived(repoClass ? `releaseFilters:${repoClass.key}` : "")

onMount(() => {
  if (!storageKey) return
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const data = JSON.parse(raw)
      if (data.filterJson) filterJson = data.filterJson
      if (Array.isArray(data.groupByTags)) groupByTags = data.groupByTags
    }
  } catch { /* ignore */ }
})

$effect(() => {
  if (!storageKey) return
  try {
    localStorage.setItem(storageKey, JSON.stringify({filterJson, groupByTags}))
  } catch { /* ignore */ }
})
```

---

## Testing

### Manual Testing

Use the `demo-release-publish.yml` workflow to publish test kind 1063 events from ephemeral keys:
- Run the workflow multiple times with the **same** artifact to simulate hash consensus
- Run with **different** artifacts to simulate hash disagreement
- Run from different trusted npubs to test multi-signer scenarios

### Unit Testing

The `releases.ts` module is designed for unit testing (pure functions, no Svelte dependencies except for the `load()` calls which can be mocked):

```typescript
// releases.test.ts
import {validateHash, buildGroupKey, groupArtifacts} from "./releases"

test("validateHash rejects non-hex", () => {
  expect(validateHash("not-a-hash")).toBe(false)
  expect(validateHash("abc123")).toBe(false) // too short
  expect(validateHash("g".repeat(64))).toBe(false) // invalid chars
})

test("validateHash accepts valid SHA-256", () => {
  expect(validateHash("a".repeat(64))).toBe(true)
  expect(validateHash("0123456789abcdef".repeat(4))).toBe(true)
})

test("groupArtifacts detects unanimous consensus", () => {
  const hash = "a".repeat(64)
  const artifacts = [
    makeArtifact({hash, filename: "app.tar.gz"}),
    makeArtifact({hash, filename: "app.tar.gz"}),
  ]
  const groups = groupArtifacts(artifacts, ["filename"])
  expect(groups[0].isUnanimous).toBe(true)
  expect(groups[0].consensusHash).toBe(hash)
})

test("groupArtifacts detects disagreement", () => {
  const artifacts = [
    makeArtifact({hash: "a".repeat(64), filename: "app.tar.gz"}),
    makeArtifact({hash: "b".repeat(64), filename: "app.tar.gz"}),
  ]
  const groups = groupArtifacts(artifacts, ["filename"])
  expect(groups[0].isUnanimous).toBe(false)
})
```

---

## Future Work

- **Blossom re-upload**: After signing, re-upload the artifact to the user's own blossom server and replace the `url` tag. Currently the URL from the ephemeral key's event is preserved as-is.
- **Automated signing**: Allow maintainers to configure auto-sign rules (e.g., "auto-sign if 3+ runners agree") via a repo settings panel.
- **NIP-51 list management UI**: In-page editor for creating/editing the trusted signers NIP-51 list, rather than requiring external tools.
- **Verification badge**: Display a verification status on the main releases list page showing which artifacts have been co-signed by N-of-M maintainers.
