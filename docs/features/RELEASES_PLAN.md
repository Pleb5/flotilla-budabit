# Releases with Blossom Feature Plan

**Issue**: `flotilla-yr84afr9`
**Status**: Planning
**Priority**: P0

## Overview

Implement software releases for repositories using the Zapstore NIP specification, integrating with Blossom servers for artifact storage. This enables developers to publish verifiable software releases directly from Flotilla, with artifacts stored on decentralized Blossom servers.

---

## Architecture

### Release Flow

```
+------------------+
| Developer        |
| Creates Release  |
+------------------+
        |
        v
+------------------+     +------------------+
| Upload Artifacts |---->| Blossom Server   |
| (.apk, .zip, etc)|     | (cdn.zapstore.dev)|
+------------------+     +------------------+
        |                        |
        v                        v
+------------------+     +------------------+
| Sign Release     |     | Returns SHA-256  |
| Event            |<----|  + Blob URL      |
+------------------+     +------------------+
        |
        v
+------------------+
| Publish to       |
| Repo Relays      |
+------------------+
        |
        v
+------------------+
| Zapstore/Clients |
| Discover Release |
+------------------+
```

### Blossom Integration

Flotilla already has Blossom infrastructure:

```typescript
// Existing in src/app/core/commands.ts
export const DEFAULT_BLOSSOM_SERVERS = [
  "https://cdn.zapstore.dev",
  "https://hbr.coracle.social"
]

export const uploadBlob = async (server, file, options) => { ... }
export const makeBlossomAuthEvent = (params) => { ... }
```

---

## Event Kinds (Zapstore NIP)

### Release Event (Kind 30063)

Parameterized replaceable event for software releases:

```json
{
  "kind": 30063,
  "content": "<release notes in markdown>",
  "tags": [
    ["d", "<version-identifier>"],
    ["a", "30617:<repo-pubkey>:<repo-name>", "<relay-hint>", "repository"],
    ["version", "1.2.3"],
    ["name", "v1.2.3 - Bug Fixes"],
    ["summary", "Critical bug fixes and performance improvements"],

    ["artifact", "<blossom-url>", "<sha256>", "<platform>", "<arch>"],
    ["artifact", "https://cdn.zapstore.dev/abc123.apk", "sha256:...", "android", "arm64"],
    ["artifact", "https://cdn.zapstore.dev/def456.zip", "sha256:...", "linux", "x64"],

    ["t", "stable"],
    ["t", "latest"],
    ["published_at", "<unix-timestamp>"],

    ["commit", "<git-commit-hash>"],
    ["changelog", "<changelog-url-or-content>"]
  ]
}
```

### Artifact Metadata

Each artifact tag contains:

| Index | Field | Description |
|-------|-------|-------------|
| 0 | "artifact" | Tag identifier |
| 1 | URL | Blossom blob URL |
| 2 | SHA-256 | Hash for verification |
| 3 | Platform | "android", "ios", "linux", "macos", "windows", "web" |
| 4 | Architecture | "arm64", "x64", "universal", etc. |

### Release Attestation (Kind 30064) - Future

Third-party verification/attestation of releases:

```json
{
  "kind": 30064,
  "content": "<attestation message>",
  "tags": [
    ["e", "<release-event-id>", "", "release"],
    ["a", "30063:<pubkey>:<version>", "", "release"],
    ["attestation", "verified", "Signature verified against published key"],
    ["t", "trusted"]
  ]
}
```

---

## Components Needed

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ReleaseList.svelte` | `src/app/components/` | List releases for a repo |
| `ReleaseCard.svelte` | `src/app/components/` | Individual release display |
| `ReleaseCreate.svelte` | `src/app/components/` | Create new release wizard |
| `ArtifactUploader.svelte` | `src/app/components/` | Multi-file upload with progress |
| `ArtifactDownload.svelte` | `src/app/components/` | Download button with verification |
| `ReleaseNotes.svelte` | `src/app/components/` | Markdown release notes editor |
| `VersionInput.svelte` | `src/app/components/` | Semver version input |

### New Routes

```
src/routes/spaces/[relay]/git/[id=naddr]/
  releases/
    +page.svelte              # Release list
    [version]/
      +page.svelte            # Release detail
    new/
      +page.svelte            # Create release
```

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/budabit/commands.ts` | Add `publishRelease()`, `uploadArtifact()` |
| `src/lib/budabit/state.ts` | Add release stores and derivations |
| `src/app/core/commands.ts` | Extend Blossom upload for releases |

---

## Data Model

### Release Store

```typescript
interface Release {
  id: string                    // Event ID
  version: string               // Semver version
  name: string                  // Display name
  summary: string               // Short description
  content: string               // Full release notes (markdown)
  artifacts: Artifact[]
  tags: string[]                // "stable", "beta", "latest"
  publishedAt: number           // Unix timestamp
  commit?: string               // Git commit hash
  pubkey: string                // Publisher pubkey
  repoAddress: string           // Linked repo address
}

interface Artifact {
  url: string                   // Blossom URL
  sha256: string                // Content hash
  platform: Platform
  architecture: Architecture
  size: number                  // File size in bytes
  filename: string              // Original filename
}

type Platform = 'android' | 'ios' | 'linux' | 'macos' | 'windows' | 'web' | 'universal'
type Architecture = 'arm64' | 'x64' | 'arm32' | 'universal'
```

### Store Derivations

```typescript
// Derive releases for a repository
export const deriveReleasesForRepo = (repoAddress: string) =>
  withGetter(
    derived(
      deriveEventsAsc(deriveEventsById({
        repository,
        filters: [{kinds: [30063], "#a": [repoAddress]}]
      })),
      ($events) => parseReleases($events)
    )
  )

// Get latest stable release
export const deriveLatestRelease = (repoAddress: string) =>
  derived(deriveReleasesForRepo(repoAddress), ($releases) =>
    $releases.find(r => r.tags.includes('stable') || r.tags.includes('latest'))
  )
```

---

## UI Design

### Release List Page

```
+------------------------------------------------------------------+
| [satshoot] / Releases                              [+ New Release]|
+------------------------------------------------------------------+
|                                                                   |
| +--------------------------------------------------------------+ |
| | v1.2.3 - Bug Fixes                              Latest Stable | |
| | Published 2 days ago by @alice                                | |
| |                                                               | |
| | Critical bug fixes and performance improvements               | |
| |                                                               | |
| | Assets:                                                       | |
| | [Android APK (arm64)] [Linux x64] [Source]                    | |
| +--------------------------------------------------------------+ |
|                                                                   |
| +--------------------------------------------------------------+ |
| | v1.2.2 - Performance Update                                  | |
| | Published 2 weeks ago by @alice                               | |
| |                                                               | |
| | Improved startup time and reduced memory usage                | |
| |                                                               | |
| | Assets:                                                       | |
| | [Android APK (arm64)] [Linux x64]                             | |
| +--------------------------------------------------------------+ |
|                                                                   |
| +--------------------------------------------------------------+ |
| | v1.2.1-beta                                              Beta | |
| | Published 3 weeks ago by @bob                                 | |
| +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### Create Release Page

```
+------------------------------------------------------------------+
|                     Create New Release                            |
+------------------------------------------------------------------+
|                                                                   |
|  Version *                                                        |
|  +------------------------------------------------------------+  |
|  | 1.2.4                                                      |  |
|  +------------------------------------------------------------+  |
|  (Semantic versioning recommended: major.minor.patch)             |
|                                                                   |
|  Release Name                                                     |
|  +------------------------------------------------------------+  |
|  | v1.2.4 - Feature Release                                   |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  Release Type                                                     |
|  ( ) Stable    ( ) Beta    ( ) Alpha    ( ) Pre-release           |
|                                                                   |
|  Tag as Latest Release                                            |
|  [x] This is the latest stable release                            |
|                                                                   |
+------------------------------------------------------------------+
|                                                                   |
|  Release Notes (Markdown)                                         |
|  +------------------------------------------------------------+  |
|  | ## What's Changed                                          |  |
|  |                                                            |  |
|  | - Added new feature X                                      |  |
|  | - Fixed bug in Y                                           |  |
|  | - Improved performance of Z                                |  |
|  |                                                            |  |
|  | ## Breaking Changes                                        |  |
|  |                                                            |  |
|  | - API endpoint changed from /v1 to /v2                     |  |
|  +------------------------------------------------------------+  |
|                                                                   |
+------------------------------------------------------------------+
|                                                                   |
|  Artifacts                                                        |
|                                                                   |
|  +------------------------------------------------------------+  |
|  | +--------------------------------------------------------+ |  |
|  | | app-release.apk                   [Android] [arm64]    | |  |
|  | | 24.5 MB | Uploading... 67%                        [x]  | |  |
|  | +--------------------------------------------------------+ |  |
|  |                                                            |  |
|  | +--------------------------------------------------------+ |  |
|  | | flotilla-linux-x64.tar.gz         [Linux] [x64]        | |  |
|  | | 18.2 MB | Uploaded (sha256: abc...)              [x]   | |  |
|  | +--------------------------------------------------------+ |  |
|  |                                                            |  |
|  | [+ Add Artifact] or drag files here                        |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  Git Commit (optional)                                            |
|  +------------------------------------------------------------+  |
|  | abc123def456...                                            |  |
|  +------------------------------------------------------------+  |
|  [Select from recent commits]                                     |
|                                                                   |
|                                    [Cancel]  [Publish Release]    |
+------------------------------------------------------------------+
```

### Artifact Download Card

```
+------------------------------------------+
| app-release.apk                          |
| Platform: Android (arm64)                |
| Size: 24.5 MB                            |
| SHA-256: abc123...                       |
|                                          |
| [Download]  [Verify]  [Copy Hash]        |
+------------------------------------------+
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)

- [ ] Define Release TypeScript interfaces
- [ ] Create event parser for kind 30063
- [ ] Add release store derivations
- [ ] Extend Blossom upload for multi-file
- [ ] Add SHA-256 computation on upload

### Phase 2: Release List UI (Week 1-2)

- [ ] Create `ReleaseList.svelte`
- [ ] Create `ReleaseCard.svelte`
- [ ] Add releases route
- [ ] Implement release fetching
- [ ] Add platform/arch badges

### Phase 3: Create Release Flow (Week 2-3)

- [ ] Create `ReleaseCreate.svelte` wizard
- [ ] Implement `ArtifactUploader.svelte`
- [ ] Add version validation (semver)
- [ ] Implement markdown editor for notes
- [ ] Build release event construction

### Phase 4: Artifact Management (Week 3)

- [ ] Implement multi-file upload with progress
- [ ] Add platform/architecture detection
- [ ] Implement upload cancellation
- [ ] Add artifact validation
- [ ] Build `ArtifactDownload.svelte`

### Phase 5: Verification & Security (Week 4)

- [ ] Implement SHA-256 verification on download
- [ ] Add download integrity checks
- [ ] Implement maintainer-only release creation
- [ ] Add release signing verification

### Phase 6: Polish (Week 4-5)

- [ ] Add release comparison view
- [ ] Implement release deletion
- [ ] Add release notifications
- [ ] Performance optimization
- [ ] Mobile responsiveness

---

## Blossom Integration Details

### Upload Flow

```typescript
async function uploadArtifact(file: File, server: string): Promise<ArtifactResult> {
  // 1. Compute SHA-256 before upload
  const sha256 = await computeSha256(file)

  // 2. Create Blossom auth event
  const authEvent = await signer.get().sign(
    makeBlossomAuthEvent({
      action: "upload",
      server,
      hashes: [sha256]
    })
  )

  // 3. Upload blob
  const response = await uploadBlob(server, file, { authEvent })
  const result = await response.json()

  // 4. Verify returned hash matches
  if (result.sha256 !== sha256) {
    throw new Error("Hash mismatch after upload")
  }

  return {
    url: result.url,
    sha256,
    size: file.size,
    filename: file.name
  }
}
```

### Server Selection

```typescript
// Use zapstore.yaml configuration if present
const releaseServers = [
  "https://cdn.zapstore.dev",
  ...userBlossomServers,
  ...DEFAULT_BLOSSOM_SERVERS
]

// Try servers in order until success
for (const server of releaseServers) {
  try {
    return await uploadArtifact(file, server)
  } catch (e) {
    console.warn(`Upload to ${server} failed, trying next...`)
  }
}
```

---

## Security Considerations

### Release Integrity

1. **SHA-256 Verification**: All artifacts include SHA-256 hash
2. **Signature Verification**: Release event signed by maintainer
3. **Download Verification**: Compute hash after download, compare

### Access Control

1. **Maintainer-Only**: Only repo maintainers can create releases
2. **Immutable Artifacts**: Once published, artifacts cannot be changed
3. **Version Uniqueness**: Version identifiers must be unique per repo

### Blossom Security

1. **Auth Events**: All uploads authenticated via Blossom auth events
2. **Server Verification**: Verify returned hash matches computed hash
3. **HTTPS Only**: All Blossom servers must use HTTPS

---

## Zapstore Compatibility

### Required Tags for Zapstore

```json
{
  "tags": [
    ["d", "com.example.app-1.2.3"],
    ["version", "1.2.3"],
    ["artifact", "<url>", "<sha256>", "android", "arm64"],
    ["t", "android"],
    ["published_at", "1706140800"]
  ]
}
```

### Zapstore-Specific Fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Semver version string |
| `artifact` | Yes | At least one artifact |
| `t:android` | For Zapstore | Platform tag |
| `published_at` | Recommended | Publication timestamp |

---

## Future Enhancements (Not in v1)

1. **Auto-Build Integration**: CI/CD pipeline triggers release creation
2. **Release Channels**: stable, beta, nightly channels
3. **Rollback Support**: Mark releases as "yanked"
4. **Delta Updates**: Incremental updates between versions
5. **Multi-Sig Releases**: Require multiple maintainer signatures
6. **Release Attestations**: Third-party verification (kind 30064)

---

## Success Metrics

- [ ] Artifact upload completes in < 30s for 50MB file
- [ ] Release creation < 5 clicks from repo page
- [ ] Download verification happens automatically
- [ ] Works with existing Zapstore clients
- [ ] Mobile-friendly release browsing

---

## Open Questions

1. Should we support draft releases before publishing?
2. How to handle very large artifacts (>100MB)?
3. Should artifacts have expiration dates?
4. Support for release signing keys (separate from Nostr key)?
5. How to handle artifact deletion/replacement?

---

## References

- [Zapstore NIP Draft](https://github.com/zapstore/nips)
- [Blossom Protocol](https://github.com/hzrd149/blossom)
- [NIP-34 Git Stuff](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [Flotilla zapstore.yaml](../../zapstore.yaml)
- [Existing Blossom commands](../../src/app/core/commands.ts)
