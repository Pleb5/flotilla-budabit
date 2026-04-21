# Import Repository Feature Architecture

## Overview

This document describes the architecture and rate limiting strategies for the repository import feature, which imports repositories from Git hosting providers (GitHub, GitLab, Gitea, Bitbucket) into the Nostr Git system.

## Architecture Diagram

```mermaid
flowchart TB
    subgraph "User Interface"
        UI[ImportRepoDialog]
        Hook[useImportRepo Hook]
    end

    subgraph "Import Process Flow"
        Start[Start Import]
        Parse[Parse URL & Detect Provider]
        Validate[Validate Token & Ownership]
        Fork{Fork<br/>Required?}
        Fetch[Fetch Repository Metadata]
        ConvertRepo[Convert Repo to Nostr Events]
        PublishRepo[Publish Repo Events]
        StreamIssues[Stream & Publish Issues]
        StreamPRs[Stream & Publish PRs]
        StreamComments[Stream & Publish Comments]
        PublishProfiles[Publish User Profiles]
        Complete[Import Complete]
    end

    subgraph "Git Provider API Layer"
        GitHub[GitHub API]
        GitLab[GitLab API]
        Gitea[Gitea API]
        Bitbucket[Bitbucket API]
    end

    subgraph "Git Provider Rate Limiting"
        GitRateLimiter[RateLimiter Class]
        ProactiveThrottle[Proactive Throttling<br/>250ms between requests]
        RetryMechanism[Retry Mechanism<br/>Exponential Backoff]
        RateLimitTrack[Rate Limit Tracking<br/>X-RateLimit-* headers]
    end

    subgraph "Nostr Relay Layer"
        Relay1[Nostr Relay 1]
        Relay2[Nostr Relay 2]
        RelayN[Nostr Relay N]
    end

    subgraph "Relay Rate Limiting"
        BatchPublisher[Batch Event Publisher]
        BatchQueue[Event Queue<br/>collects events]
        BatchFlush[Flush Batch<br/>publish in parallel]
        BatchDelay[Delay Between Batches<br/>250ms default]
    end

    Start --> Parse
    Parse --> Validate
    Validate --> Fork
    Fork -->|Not Owner| Fork
    Fork -->|Owner or Forked| Fetch
    Fetch --> ConvertRepo
    ConvertRepo --> PublishRepo
    PublishRepo --> StreamIssues
    StreamIssues --> StreamPRs
    StreamPRs --> StreamComments
    StreamComments --> PublishProfiles
    PublishProfiles --> Complete

    UI --> Hook
    Hook --> Start

    Parse --> GitHub
    Parse --> GitLab
    Parse --> Gitea
    Parse --> Bitbucket

    GitHub --> GitRateLimiter
    GitLab --> GitRateLimiter
    Gitea --> GitRateLimiter
    Bitbucket --> GitRateLimiter

    GitRateLimiter --> ProactiveThrottle
    GitRateLimiter --> RetryMechanism
    GitRateLimiter --> RateLimitTrack

    PublishRepo --> BatchPublisher
    StreamIssues --> BatchPublisher
    StreamPRs --> BatchPublisher
    StreamComments --> BatchPublisher
    PublishProfiles --> BatchPublisher

    BatchPublisher --> BatchQueue
    BatchQueue --> BatchFlush
    BatchFlush --> BatchDelay
    BatchDelay --> Relay1
    BatchDelay --> Relay2
    BatchDelay --> RelayN

    style GitRateLimiter fill:#f96,stroke:#333,stroke-width:3px
    style BatchPublisher fill:#69f,stroke:#333,stroke-width:3px
    style ProactiveThrottle fill:#fc9,stroke:#333,stroke-width:2px
    style RetryMechanism fill:#fc9,stroke:#333,stroke-width:2px
    style RateLimitTrack fill:#fc9,stroke:#333,stroke-width:2px
```

## Rate Limiting Strategies

### Git Provider Rate Limiting (Three-Layer Approach)

The system implements a three-layer rate limiting strategy for Git provider APIs:

#### Layer 1: Proactive Request Throttling

- **Purpose**: Prevent hitting rate limits in the first place
- **Implementation**: Minimum 250ms delay between requests (configurable via `secondsBetweenRequests`)
- **Measurement**: Delay measured from end of previous request, not start
- **Location**: `RateLimiter.throttle()` method

```typescript
// Example: Always wait at least 250ms between GitHub API requests
await rateLimiter.throttle("github", "GET")
const data = await api.listIssues(owner, repo)
```

#### Layer 2: Retry Mechanism with Backoff

- **Purpose**: Handle rate limit errors gracefully
- **Error Detection**:
  - HTTP 403 status code
  - Response body containing "rate limit exceeded"
  - Response headers: `Retry-After`, `X-RateLimit-Reset`
- **Retry Strategy**:
  - **Primary Rate Limit**: Uses `X-RateLimit-Reset` header to calculate exact wait time
  - **Secondary Rate Limit** (abuse detection): Fixed 60-second wait (configurable via `secondaryRateWait`)
  - **5xx Server Errors**: Exponential backoff (1s, 2s, 4s, ...)
  - **Max Retries**: 3 attempts (configurable via `maxRetries`)
- **Location**: `RateLimiter.shouldRetry()` method

#### Layer 3: Rate Limit Status Tracking

- **Purpose**: Monitor remaining quota to inform users
- **Tracking**: Extracts and stores `X-RateLimit-*` headers:
  - `X-RateLimit-Remaining`: Requests left in window
  - `X-RateLimit-Limit`: Total requests allowed
  - `X-RateLimit-Reset`: Unix timestamp when limit resets
- **Usage**: Provides visibility into quota status
- **Location**: `RateLimiter.updateRateLimitStatus()` method

### Relay Rate Limiting (Batched Publishing)

For Nostr relays, a batched publishing approach is used to optimize performance:

#### Batched Event Publishing

- **Purpose**: Publish multiple events efficiently while respecting relay rate limits
- **Implementation**:
  - Events are collected into batches (default: 30 events per batch)
  - Events in each batch are published in parallel using `Promise.allSettled()`
  - A delay is applied between batches (default: 250ms)
- **Performance**: ~20x faster than per-event delays (e.g., 1000 events: ~8.5 seconds vs ~200 seconds)
- **Configuration**:
  - `relayBatchSize` in `ImportConfig` (default: 30 events)
  - `relayBatchDelay` in `ImportConfig` (default: 250ms)
- **Location**: `publishEventBatched()` and `flushEventQueue()` functions

```typescript
// Example: Collect events into batches
await publishEventBatched(context, signedEvent)
// When batch reaches size (30), events are published in parallel
// Then wait 250ms before next batch
```

#### Batch Flushing

- Batches are automatically flushed when they reach the configured size
- Remaining events in the queue are flushed at the end of each phase (issues, PRs, comments, profiles)
- Final flush ensures all queued events are published before import completes

#### No Retry Mechanism

- Relays typically don't have the same aggressive rate limiting as Git providers
- Event publication failures are handled at a higher level (not retried automatically)

## Detailed Flow with Rate Limiting

```mermaid
sequenceDiagram
    participant User
    participant Hook as useImportRepo
    participant RateLimiter as Git Rate Limiter
    participant GitAPI as Git Provider API
    participant BatchPublisher as Batch Event Publisher
    participant Relay as Nostr Relay

    User->>Hook: importRepository(repoUrl, token, config)

    Note over Hook,RateLimiter: Initial Setup
    Hook->>RateLimiter: Create RateLimiter(config)
    Hook->>GitAPI: Parse URL & Detect Provider

    Note over Hook,GitAPI: Validation Phase
    Hook->>RateLimiter: throttle('github', 'GET')
    RateLimiter-->>Hook: Wait 250ms
    Hook->>GitAPI: validateTokenPermissions()
    GitAPI-->>Hook: Response + X-RateLimit-* headers
    Hook->>RateLimiter: updateRateLimitStatus(headers)

    Hook->>RateLimiter: throttle('github', 'GET')
    RateLimiter-->>Hook: Wait 250ms
    Hook->>GitAPI: checkRepoOwnership()

    Note over Hook,GitAPI: Forking (if needed)
    alt Not Owner
        Hook->>RateLimiter: throttle('github', 'POST')
        RateLimiter-->>Hook: Wait 250ms
        Hook->>GitAPI: forkRepo()
        GitAPI-->>Hook: Forked Repository
    end

    Note over Hook,GitAPI: Streaming Import Phase
    loop For Each Page of Issues
        Hook->>RateLimiter: throttle('github', 'GET')
        RateLimiter-->>Hook: Wait 250ms
        Hook->>GitAPI: listIssues(page)
        alt Rate Limit Hit
            GitAPI-->>Hook: HTTP 403 + Rate Limit Error
            Hook->>RateLimiter: shouldRetry(error)
            RateLimiter-->>Hook: {retry: true, delay: X}
            Hook->>RateLimiter: waitWithProgress(delay)
            Note over RateLimiter: Shows progress: "Rate limit hit, waiting X seconds..."
            RateLimiter-->>Hook: Wait Complete
            Hook->>GitAPI: Retry request
        end
        GitAPI-->>Hook: Issues Data

        loop For Each Issue
            Hook->>Hook: Convert to Nostr Event
            Hook->>BatchPublisher: Queue Event (batched)
            alt Batch Full (30 events)
                BatchPublisher->>BatchPublisher: Flush Batch
                BatchPublisher->>Relay: Publish All (parallel)
                BatchPublisher-->>Hook: Wait 250ms
            end
        end
        Note over Hook,BatchPublisher: Flush remaining events
        BatchPublisher->>Relay: Publish Remaining
    end

    Note over Hook,GitAPI: Similar for PRs and Comments
    loop For Each Page of PRs/Comments
        Hook->>RateLimiter: throttle('github', 'GET')
        Hook->>GitAPI: Fetch Data
        Hook->>BatchPublisher: Queue Events (batched)
        alt Batch Full
            BatchPublisher->>Relay: Publish Batch (parallel)
            BatchPublisher-->>Hook: Wait 250ms
        end
    end
    Note over Hook,BatchPublisher: Flush remaining events

    Hook-->>User: Import Complete
```

## Rate Limit Error Handling

```mermaid
stateDiagram-v2
    [*] --> MakeRequest: API Call
    MakeRequest --> Throttle: Before Request
    Throttle --> CheckDelay: Check Time Since Last Request
    CheckDelay --> Wait: Delay Required (>250ms)
    CheckDelay --> Execute: No Delay Needed
    Wait --> Execute: Delay Complete
    Execute --> Success: Request Succeeds
    Execute --> Error: Request Fails
    Success --> UpdateTracking: Update Rate Limit Status
    UpdateTracking --> [*]
    Error --> CheckRetry: Analyze Error
    CheckRetry --> Retry: Rate Limit Error + Retries Left
    CheckRetry --> Fail: Non-Retriable Error
    CheckRetry --> Fail: Max Retries Exceeded
    Retry --> CalculateWait: Determine Wait Time
    CalculateWait --> PrimaryLimit: Primary Rate Limit (X-RateLimit-Reset)
    CalculateWait --> SecondaryLimit: Secondary Rate Limit (60s fixed)
    CalculateWait --> Exponential: 5xx Error (exponential backoff)
    PrimaryLimit --> WaitWithProgress: Wait Until Reset
    SecondaryLimit --> WaitWithProgress: Wait 60 Seconds
    Exponential --> WaitWithProgress: Wait 2^(attempt-1) seconds
    WaitWithProgress --> MakeRequest: Retry Request
    Fail --> [*]
```

## Configuration

### Rate Limiter Configuration

```typescript
interface RateLimitConfig {
  secondsBetweenRequests?: number // Default: 0.25 (250ms)
  secondaryRateWait?: number // Default: 60 (seconds)
  maxRetries?: number // Default: 3
}
```

### Import Configuration

```typescript
interface ImportConfig {
  relayBatchSize?: number // Default: 30 (events per batch)
  relayBatchDelay?: number // Default: 250 (milliseconds between batches)
  // ... other options
}
```

## Provider-Specific Rate Limits

### GitHub

- **Authenticated**: 5,000 requests/hour
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Secondary Limits**: Abuse detection triggers 60s wait

### GitLab

- **Authenticated**: 2,000 requests/minute
- **Headers**: Similar to GitHub
- **Note**: May have different header names

### Gitea

- **Rate Limits**: Configurable per instance
- **Headers**: May vary by instance

### Bitbucket

- **Rate Limits**: Varies by plan
- **Headers**: May differ from GitHub

## Progress Tracking

The import system uses step-based progress tracking instead of percentage-based progress:

- **Step Messages**: Clear messages describing current operation (e.g., "Publishing issues...")
- **Count Information**: Actual counts of published items (e.g., "150 published", "3/10 profiles")
- **No Fake Percentages**: Progress shows real counts, not estimated percentages

### Progress Interface

```typescript
interface ImportProgress {
  step: string // Current step/message
  current?: number // Current count (e.g., published issues)
  total?: number // Total count (e.g., for profiles: 3/10)
  isComplete: boolean // Whether import is complete
  error?: string // Error message if failed
}
```

## Best Practices

1. **Always use rate limiter**: Wrap all Git API calls with `withRateLimit()`
2. **Monitor quota**: Check `getRemainingQuota()` for user feedback
3. **Use batched publishing**: Leverage `relayBatchSize` and `relayBatchDelay` for efficient relay publishing
4. **Stream processing**: Process and publish items incrementally to minimize memory usage
5. **Progress updates**: Use `onProgress` callback to show step messages and counts to users

## Memory Optimization

The import process uses streaming to minimize memory:

- Issues/PRs/Comments are fetched page-by-page (100 per page)
- Each item is immediately converted and published
- Only lightweight ID mappings are kept in memory:
  - `issueEventIdMap`: issue.number → nostr event ID
  - `prEventIdMap`: pr.number → nostr event ID
  - `commentEventMap`: platformCommentId → nostr event ID

This allows importing large repositories without loading everything into memory at once.
