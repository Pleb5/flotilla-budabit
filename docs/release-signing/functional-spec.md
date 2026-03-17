# Release Signing — Functional Specification

## Overview

The Release Signing page enables maintainers to verify reproducible builds from multiple independent CI workers ("loom workers") and co-sign releases under their own Nostr identity.

It lives at `/spaces/[relay]/git/[repo]/releases` as a tab in the repository view, loosely coupled from the CI/CD pipeline page.

## Problem

Software releases built by CI pipelines are signed by ephemeral, zero-reputation keys. Users have no reason to trust these keys. To establish trust, multiple independent workers should build the same source and produce identical artifacts. When a maintainer verifies that builds are reproducible (hashes match across independent builders), they co-sign the release under their own reputable npub.

## The Flow

1. A maintainer or enthusiast triggers a CI workflow, generating an ephemeral keypair (HIVE_CI_NSEC)
2. The triggerer publishes a **workflow run event** (kind 5401) that links their identity to the ephemeral pubkey via a `publisher` tag
3. A loom worker executes the build and publishes **release artifact events** (kind 1063 / NIP-94 file metadata) signed by the ephemeral key
4. Multiple independent workers repeat steps 1-3 for the same software version
5. The Release Signing page aggregates these artifacts, compares file hashes, and displays consensus
6. When a maintainer is satisfied that builds are reproducible, they select artifacts and re-sign them under their own npub

## Trust Model

### Trust Triangle

Three identities contribute to the trustworthiness of a release artifact:

- **Triggerer**: The npub that initiated the CI run (known via `triggered-by` tag in kind 5401)
- **Ephemeral key**: The HIVE_CI_NSEC generated for this run (linked via `publisher` tag in kind 5401)
- **Loom worker**: The machine/identity that executed the build

### Trusted Npubs

- **Default**: Repository maintainers, extracted from the kind 30617 repository announcement event
- **Additional**: User can input a NIP-51 list address or follow list to expand the trusted set
- Only workflow runs triggered by trusted npubs are considered
- The additional input is collapsed by default (power-user feature)

## Features

### 1. Configurable Event Filter

- Default preset filter: fetches kind 1063 events associated with the repository
- The filter is a standard Nostr subscription filter (JSON) that users can edit
- This makes the page event-kind-agnostic — if release event formats change in the future, users just adjust the filter
- Collapsed by default

### 2. User-Defined Grouping

- Users specify which event tags to group artifacts by (e.g., `filename`, `version`, `architecture`)
- Each unique combination of group-by tag values becomes one comparison row
- Default grouping: by `filename`
- Users add/remove group-by tags via a chip/tag selector in the UI
- This avoids hardcoding assumptions about how software is structured — the user decides what matters

### 3. Hash Comparison & Consensus

Within each group, the page compares the `x` tag (SHA-256 file hash) across all matching artifacts:

- **URL tags are ignored** — different builders use different blossom servers, so URLs will differ even for identical files
- **Hash validation**: only valid 64-character lowercase hex strings are accepted; anything else is flagged and excluded
- **Consensus indicators**:
  - **Unanimous** (all builds agree): strong visual confirmation
  - **Majority** (most agree, some differ): warning state, shows split
  - **Split** (significant disagreement): alert state
- Shows "N/M builds agree on hash X"
- Expandable to see individual builds with provenance details

### 4. Provenance Display

Each artifact row shows:

- The ephemeral pubkey that signed it
- The triggering maintainer (from kind 5401 `triggered-by` tag)
- The workflow file that produced it (from kind 5401 `workflow` tag)
- The branch built from
- Timestamp

This allows maintainers to make informed decisions about which builds to trust.

### 5. Artifact Selection & Signing

- Users select artifacts that have reached satisfactory consensus (checkboxes per group)
- "Sign & Publish Release" action:
  - Creates new kind 1063 events copying all tags from the selected source artifacts
  - Signs under the currently logged-in user's npub via their browser signer
  - Publishes to configured relays
- The signed events are the user's personal attestation that they verified reproducibility

### 6. Blossom Re-upload (Future)

- Follow-up feature: before signing, re-upload blobs to the user's own blossom server
- Replace the `url` tag with the new blossom URL while keeping the same `x` hash
- Not in initial scope

## Page Layout

### Navigation

- Accessible via "Releases" tab in repository navigation (alongside Code, Commits, Issues, Patches, Actions)

### Configuration Panel (collapsed by default)

- **Event filter**: JSON textarea with the Nostr subscription filter
- **Group by**: Tag selector (chips) — add/remove tags to group by
- **Trusted npubs**: Input for NIP-51 list address or follow list naddr

### Artifact Groups (main content)

- One expandable row per group (determined by group-by tags)
- Each row shows:
  - Group label (tag values that define this group)
  - Consensus hash (truncated, copyable)
  - Agreement ratio (e.g., "12/12" or "10/12")
  - Status indicator (color-coded)
- Expanded view: list of individual builds with provenance, full hash, timestamp

### Action Bar (bottom/sticky)

- Count of selected artifacts
- "Sign & Publish Release" button (disabled until at least one artifact selected)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No artifacts found | Empty state with hint to check filter configuration |
| All hashes disagree | Prominent warning, no auto-selection |
| Ephemeral key not linked to any kind 5401 | Artifact shown as "unverified origin" |
| Hash fails hex validation | Artifact flagged, excluded from comparison |
| User is not logged in | Sign button disabled, prompt to log in |
| Single build (no comparison possible) | Show artifact but note "only 1 build — no comparison available" |
