# Import Repos Feature Plan

**Issue**: `flotilla-vmmnqi94`
**Status**: Planning
**Priority**: P0

## Overview

Enable users to import their repositories from external Git hosting providers (GitHub, GitLab, Codeberg) to Nostr with a smooth, one-click experience. The import process will:

1. Create/fork the repository on the source platform (if needed)
2. Publish NIP-34 repository announcement to Nostr
3. Import all issues, comments, and PRs as Nostr events
4. Create ephemeral Nostr profiles for platform users

---

## Supported Sources

| Platform | Authentication | Features |
|----------|---------------|----------|
| **GitHub** | OAuth App / PAT | Repos, Issues, Comments, PRs |
| **GitLab** | OAuth / PAT | Repos, Issues, Comments, MRs |
| **Codeberg** | PAT | Repos, Issues, Comments, PRs |
| **Custom** | PAT (future) | Basic repo metadata only |

### Authentication Requirements

- All imports require valid access tokens
- Tokens must have read/write permissions to repos
- Without tokens: rate limiting and access issues make import unreliable

---

## Authentication Flow

### Token Management

Existing token infrastructure in `@nostr-git/ui`:
- `tokens as tokensStore` - Svelte store for token state
- `tryTokensForHost(tokens, hostMatcher, action)` - Token selection helper
- `getTokensForHost(tokens, hostMatcher)` - Get tokens for a host

### OAuth Flow (GitHub)

```
+--------+     +----------+     +---------+     +--------+
|  User  | --> |  Flotilla| --> |  GitHub | --> | Callback|
+--------+     +----------+     +---------+     +--------+
    |               |                |               |
    | 1. Click      |                |               |
    |   "Connect    |                |               |
    |    GitHub"    |                |               |
    |-------------->|                |               |
    |               | 2. Redirect to |               |
    |               |    OAuth URL   |               |
    |               |--------------->|               |
    |               |                | 3. User       |
    |               |                |    authorizes |
    |               |                |<--------------|
    |               |                | 4. Redirect   |
    |               |                |    with code  |
    |               |<--------------------------------|
    |               | 5. Exchange    |               |
    |               |    code for    |               |
    |               |    token       |               |
    |               |--------------->|               |
    |               |<---------------|               |
    | 6. Token      |                |               |
    |    stored     |                |               |
    |<--------------|                |               |
```

### Token Storage

```typescript
interface PlatformToken {
  host: string           // "github.com", "gitlab.com"
  token: string          // Access token
  scopes: string[]       // ["repo", "read:user"]
  createdAt: number      // Unix timestamp
  expiresAt?: number     // Optional expiry
}

// Store in encrypted user settings (NIP-44)
// Key: "git-platform-tokens"
```

---

## Sync Mechanism

### Import Process

```
+------------------+
| 1. Validate URL  |
+------------------+
        |
        v
+------------------+
| 2. Check Token   |
|    Permissions   |
+------------------+
        |
        v
+------------------+     +------------------+
| 3. Fork Needed?  |---->| 3a. Create Fork  |
|    (not owner)   |     |     on Platform  |
+------------------+     +------------------+
        |                        |
        v                        v
+------------------+     +------------------+
| 4. Fetch Repo    |<----| Fork Ready       |
|    Metadata      |     +------------------+
+------------------+
        |
        v
+------------------+
| 5. Configure     |
|    Repo Relays   |
+------------------+
        |
        v
+------------------+
| 6. Publish       |
|    30617 Event   |
+------------------+
        |
        v
+------------------+
| 7. Import Issues |
|    & PRs         |
+------------------+
        |
        v
+------------------+
| 8. Done!         |
+------------------+
```

### Data Mapping

| Platform Concept | Nostr Event Kind | Notes |
|-----------------|------------------|-------|
| Repository | 30617 (Repo Announcement) | NIP-34 |
| Issue | 1621 (Git Issue) | With `#a` tag to repo |
| Issue Comment | 1111 (Comment) | NIP-22, `#E` to issue |
| Pull Request | 1617 (Git Patch) | Root patch event |
| PR Comment | 1111 (Comment) | `#E` to patch root |
| User | 0 (Profile) | Ephemeral, platform-derived |

### Ephemeral User Profiles

For platform users without Nostr accounts:

```typescript
interface EphemeralProfile {
  // Derived from platform user
  name: string           // Platform username
  picture?: string       // Platform avatar URL
  about?: string         // "Imported from GitHub"

  // Generated keypair (stored locally, disposable)
  pubkey: string
  privkey: string        // Only for signing during import
}

// Profile event (kind 0)
{
  "kind": 0,
  "content": JSON.stringify({
    "name": "alice_github",
    "picture": "https://avatars.githubusercontent.com/u/12345",
    "about": "Profile imported from GitHub during repo migration"
  }),
  "tags": [
    ["i", "github:alice", "proof-not-available"]
  ]
}
```

---

## UI Design

### Step 1: URL Input

```
+------------------------------------------------------------------+
|                     Import Repository                             |
+------------------------------------------------------------------+
|                                                                   |
|  Enter the URL of the repository you want to import:              |
|                                                                   |
|  +------------------------------------------------------------+  |
|  | https://github.com/Pleb5/satshoot                         |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  Supported: GitHub, GitLab, Codeberg                              |
|                                                                   |
|                                    [Cancel]  [Next ->]            |
+------------------------------------------------------------------+
```

### Step 2: Token Verification

```
+------------------------------------------------------------------+
|                     Verify Access Token                           |
+------------------------------------------------------------------+
|                                                                   |
|  Platform: GitHub                                                 |
|                                                                   |
|  [x] Access token found for github.com                            |
|                                                                   |
|  [ ] My token has read and write permissions to repos             |
|      (Required for forking and push access)                       |
|                                                                   |
|  Token Status: Checking permissions...                            |
|  [=====>                    ] Verifying repo access               |
|                                                                   |
|                                    [<- Back]  [Next ->]           |
+------------------------------------------------------------------+
```

### Step 3: Fork Decision

```
+------------------------------------------------------------------+
|                     Repository Access                             |
+------------------------------------------------------------------+
|                                                                   |
|  Repository: Pleb5/satshoot                                       |
|  Owner: Pleb5                                                     |
|  Your Access: Read-only (not owner)                               |
|                                                                   |
|  +------------------------------------------------------------+  |
|  | You don't own this repository.                             |  |
|  | A fork will be created under your account.                 |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|  Fork name: satshoot                                              |
|  +------------------------------------------------------------+  |
|  | satshoot                                                   |  |
|  +------------------------------------------------------------+  |
|  (Check for naming conflicts)                                     |
|                                                                   |
|                                    [<- Back]  [Create Fork ->]    |
+------------------------------------------------------------------+
```

### Step 4: Relay Configuration

```
+------------------------------------------------------------------+
|                     Configure Relays                              |
+------------------------------------------------------------------+
|                                                                   |
|  Your repository metadata will live on Nostr.                     |
|  Select relays to publish to:                                     |
|                                                                   |
|  Recommended:                                                     |
|  [x] wss://relay.damus.io                                         |
|  [x] wss://nos.lol                                                |
|                                                                   |
|  Your relays:                                                     |
|  [x] wss://relay.snort.social                                     |
|  [ ] wss://nostr.wine                                             |
|                                                                   |
|  Add custom relay:                                                |
|  +------------------------------------------------------------+  |
|  | wss://                                                     |  |
|  +------------------------------------------------------------+  |
|  [+ Add]                                                          |
|                                                                   |
|  At least one relay required.                                     |
|                                                                   |
|                                    [<- Back]  [Next ->]           |
+------------------------------------------------------------------+
```

### Step 5: Import Execution

```
+------------------------------------------------------------------+
|                     SET MY REPO FREE                              |
+------------------------------------------------------------------+
|                                                                   |
|  Ready to import:                                                 |
|                                                                   |
|  Repository: satshoot                                             |
|  Source: https://github.com/YourUser/satshoot                     |
|  Relays: wss://relay.damus.io, wss://nos.lol                      |
|                                                                   |
|  This will:                                                       |
|  - Publish repository announcement to Nostr                       |
|  - Import 47 issues as Nostr events                               |
|  - Import 123 comments                                            |
|  - Import 12 pull requests                                        |
|  - Create 28 ephemeral profiles for GitHub users                  |
|                                                                   |
|  +------------------------------------------------------------+  |
|  |               [ SET MY REPO FREE ]                         |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|                                    [<- Back]  [Cancel]            |
+------------------------------------------------------------------+
```

### Step 6: Progress

```
+------------------------------------------------------------------+
|                     Importing Repository                          |
+------------------------------------------------------------------+
|                                                                   |
|  [====================>              ] 67%                        |
|                                                                   |
|  Current step: Publishing issues...                               |
|                                                                   |
|  Completed:                                                       |
|  [x] Fork created successfully                                    |
|  [x] Repository announcement published                            |
|  [x] 32/47 issues imported                                        |
|  [ ] Comments (pending)                                           |
|  [ ] Pull requests (pending)                                      |
|                                                                   |
|  Log:                                                             |
|  +------------------------------------------------------------+  |
|  | Published issue #1: "Initial commit bug"                   |  |
|  | Published issue #2: "Add dark mode"                        |  |
|  | Published issue #3: "Performance improvements"             |  |
|  | ...                                                        |  |
|  +------------------------------------------------------------+  |
|                                                                   |
|                                                   [Cancel]        |
+------------------------------------------------------------------+
```

---

## Components Needed

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ImportRepoWizard.svelte` | `src/app/components/` | Multi-step import wizard |
| `PlatformTokenManager.svelte` | `src/app/components/` | Token CRUD UI |
| `RelaySelector.svelte` | `src/app/components/` | Relay picker with defaults |
| `ImportProgress.svelte` | `src/app/components/` | Progress tracking |
| `ForkNameInput.svelte` | `src/app/components/` | Fork naming with validation |

### New Modules

| Module | Location | Purpose |
|--------|----------|---------|
| `platform-api.ts` | `src/lib/budabit/` | GitHub/GitLab API clients |
| `import-mapper.ts` | `src/lib/budabit/` | Platform -> Nostr mapping |
| `ephemeral-keys.ts` | `src/lib/budabit/` | Ephemeral keypair generation |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/budabit/commands.ts` | Add `importRepository()` command |
| `src/lib/budabit/state.ts` | Add import status store |
| `src/app/core/state.ts` | Add platform token settings |

---

## Implementation Phases

### Phase 1: Token Management (Week 1)

- [ ] Design token storage schema
- [ ] Implement GitHub OAuth flow
- [ ] Build PlatformTokenManager UI
- [ ] Add token verification endpoints
- [ ] Encrypt tokens in user settings

### Phase 2: Repository Import (Week 2)

- [ ] Implement GitHub API client
- [ ] Add fork detection and creation
- [ ] Build 30617 event generator from platform metadata
- [ ] Implement relay configuration UI
- [ ] Add basic import wizard steps 1-4

### Phase 3: Issue/PR Import (Week 3)

- [ ] Implement issue fetching and pagination
- [ ] Build issue -> 1621 event mapper
- [ ] Implement comment fetching
- [ ] Build comment -> 1111 event mapper
- [ ] Implement PR -> 1617 mapping

### Phase 4: User Profile Handling (Week 3-4)

- [ ] Implement ephemeral keypair generation
- [ ] Build platform user -> profile mapper
- [ ] Add profile deduplication logic
- [ ] Implement profile publishing

### Phase 5: Progress and Error Handling (Week 4)

- [ ] Add fine-grained progress tracking
- [ ] Implement retry logic for failures
- [ ] Add rollback for partial imports
- [ ] Build error aggregation UI

### Phase 6: GitLab/Codeberg Support (Week 5)

- [ ] Implement GitLab API client
- [ ] Implement Codeberg API client
- [ ] Add platform detection from URL
- [ ] Test cross-platform imports

### Phase 7: Polish (Week 6)

- [ ] Add "SET MY REPO FREE" button styling
- [ ] Implement import history
- [ ] Add re-sync capability
- [ ] Performance optimization
- [ ] Documentation

---

## API Integration

### GitHub API Endpoints

```typescript
// Repository info
GET /repos/{owner}/{repo}

// Create fork
POST /repos/{owner}/{repo}/forks

// List issues
GET /repos/{owner}/{repo}/issues?state=all&per_page=100

// List issue comments
GET /repos/{owner}/{repo}/issues/{issue_number}/comments

// List PRs
GET /repos/{owner}/{repo}/pulls?state=all&per_page=100

// User info
GET /users/{username}
```

### Rate Limiting

| Platform | Limit | Strategy |
|----------|-------|----------|
| GitHub | 5000/hour (authenticated) | Queue with backoff |
| GitLab | 2000/hour (authenticated) | Queue with backoff |
| Codeberg | Similar to Gitea defaults | Queue with backoff |

---

## Error Handling

### Error Categories

| Error Type | User Message | Recovery |
|------------|--------------|----------|
| Token Invalid | "Your access token is invalid or expired" | Re-authenticate |
| Rate Limited | "GitHub rate limit reached. Retry in X minutes" | Auto-retry with delay |
| Fork Exists | "A fork with this name already exists" | Prompt for new name |
| Relay Unreachable | "Could not connect to relay X" | Skip or retry |
| Event Rejected | "Relay rejected event: reason" | Log and continue |

### Partial Failure Recovery

```typescript
interface ImportState {
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  repoId: string
  platform: string

  // Progress tracking
  issuesImported: number
  issuesTotal: number
  commentsImported: number
  commentsTotal: number
  prsImported: number
  prsTotal: number

  // Error tracking
  errors: ImportError[]
  lastSuccessfulStep: ImportStep
  canResume: boolean
}
```

---

## Security Considerations

1. **Token Storage**: Encrypt tokens using NIP-44 before storing
2. **Token Scope**: Request minimum necessary scopes
3. **Ephemeral Keys**: Never persist private keys for ephemeral profiles
4. **Rate Limiting**: Respect platform rate limits to avoid bans
5. **Content Validation**: Sanitize imported content before publishing

---

## Future Enhancements (Not in v1)

1. **Multi-Platform Push**: Push fork to GitHub + GitLab + Codeberg simultaneously
2. **Continuous Sync**: Webhook-based ongoing sync
3. **Two-Way Sync**: Sync Nostr issues back to GitHub
4. **Organization Import**: Import entire organizations
5. **Migration Wizard**: Guided platform exit strategy

---

## Success Metrics

- [ ] Import completes in < 2 minutes for 100 issues
- [ ] Zero data loss during import
- [ ] All imported events are valid and verifiable
- [ ] Works offline (queues events for later publish)
- [ ] Error rate < 1% for standard imports

---

## Open Questions

1. Should we support importing closed issues/PRs?
2. How to handle image attachments in issues/comments?
3. Should ephemeral profiles be marked as "bot" accounts?
4. Rate limit handling strategy - pause or background queue?
5. Should we support importing repo wiki pages?

---

## References

- [NIP-34 Git Stuff](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [NIP-22 Comments](https://github.com/nostr-protocol/nips/blob/master/22.md)
- [GitHub REST API](https://docs.github.com/en/rest)
- [GitLab REST API](https://docs.gitlab.com/ee/api/)
- [Gitea API (Codeberg)](https://docs.gitea.io/en-us/api-usage/)
