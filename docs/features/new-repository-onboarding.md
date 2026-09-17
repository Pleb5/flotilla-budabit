# New repository onboarding

From **Git → New Repo**, choose **Brand new Repo** or **Import an existing Repo**.
The import choice inspects a public repository; it does not verify that you own the source.

## Public sources

GitHub, GitLab, Gitea and Forgejo (including Codeberg) are supported. Paste a repository
root URL, with or without `.git` or a trailing slash. Supported SSH URLs are normalized
to HTTPS; GitLab nested namespaces are supported. For an unidentified self-hosted forge,
choose its family under **Self-hosted provider**. Bitbucket is disabled. For GRASP sources,
use the existing Nostr repository/fork flow instead.

Metadata and Git source reads are anonymous—even when a saved destination token uses the
same host. No source token is requested or used, cookies are omitted, embedded URL
credentials are rejected, and redirects are not followed. Private or missing repositories
cannot be imported. Rate limits, timeouts and browser/CORS failures are reported; a server
being public does not guarantee it is reachable from this browser.

## Announce or copy

- **Announce only** is the default. It publishes a Nostr repository announcement with the
  inspected source clone URL. It creates no local Git repository, no remote repository,
  no commits and no repository state event. It needs the Nostr signer and metadata relays,
  but no destination token or full-history download. Empty and oversized sources can be announced.
- **Copy to target remotes** creates independent repositories and copies all advertised
  branches and tags once. Hosted destinations require their own access token; GRASP uses
  the Nostr signer and requires at least one selected server. Codeberg is a Forgejo target.
  Configured token hosts appear separately; unknown hosts require choosing their provider
  family in the target card for the current session. Existing/occupied destinations are
  refused, including empty GRASP residue. No native forge fork or migration API, force push,
  or automatic synchronization is used. Later synchronization remains manual.

Source metadata prefills the display name, editable repository identifier, description,
default branch, web/clone URLs and topics. Edited fields survive navigation and reinspection.
Overlong metadata is shown with validation errors, not silently truncated. Imports preserve
existing files, licenses and commit authorship, so README/license/gitignore initialization
and commit-author fields are hidden. Forge users are not added as Nostr maintainers.

**Issues, pull requests and comments are not imported.** The separate historical importer
is permanently disconnected in development and production; `FEATURE_IMPORT_REPO` cannot
enable it. This New Repo workflow is independent of that retired feature flag.

## Browser limits and recovery

Copies require a nonempty source and a complete, non-shallow clone. Current admission limits
are 100 branch/tag refs, a 50 MiB reported repository-size estimate where available, 2 MiB
per metadata/ref response and 64 MiB per Git transfer HTTP body. These are browser safety
limits, not a guarantee that every repository below them will transfer successfully.
Ref discovery has a 30-second deadline; clone attempts have a 90-second deadline. Use
**Announce only** or a local Git client for larger/incompatible repositories. Git LFS objects,
release assets, wiki repositories and submodule repositories are not separately transferred.

The advertised source snapshot must match both the complete local clone and a second source
probe before pushing. A changed/incomplete source fails rather than silently copying a subset.
GRASP admission acknowledgements and state visibility precede pushes; destination refs are
verified afterward. Final clone metadata includes only successfully verified destinations.
Partial target failures are reported explicitly. Incomplete destination receipts remain in
recovery even after the successful destinations have been announced and local cleanup finishes.

Closing cancels pending work where possible, but signed events and remote writes may already
exist. Unknown worker outcomes and incomplete publication are recorded in repository recovery;
resume that record rather than starting another creation. Announcement-only recovery replays
the exact signed announcement without inventing a state event, including after a temporary relay
outage. Rejecting signing before any delivery releases the identifier for a fresh attempt;
unknown delivery outcomes retain their recovery record.

## Verification scope

Focused source/provider/worker/orchestration tests and isolated browser fixtures cover anonymous
reads, no-token announcements, independent-copy ref outcomes, source errors/staleness, metadata
edits, GRASP readiness, narrow/keyboard controls and owner changes. Browser publication and Git
writes are mocked. Codeberg public metadata/version reads were checked live; authenticated forge
writes and real GRASP provisioning were not exercised for this change. Offline/PWA behavior is
not part of this verification.
