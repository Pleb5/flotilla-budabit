# New repository onboarding

From **Git → New Repo**, choose **Brand new Repo** or **Import an existing Repo**.
Import creates an independent Git copy at one or more writable destinations and announces
the new repository on Nostr. The destination account controls the copy; the source may belong
to someone else.

## Public sources

GitHub, GitLab, Gitea and Forgejo (including Codeberg) are supported. Paste a repository
root URL, with or without `.git` or a trailing slash. Supported SSH URLs are normalized
to HTTPS; GitLab nested namespaces are supported. Inspection starts automatically after
1.2 seconds without typing. A green checkmark and **Public repository available** confirm success.
For a custom forge that automatic detection cannot identify, a **Repository server software**
selector appears with an explanation. Bitbucket is disabled. For GRASP sources,
use the existing Nostr repository/fork flow instead.

Metadata and Git source reads are anonymous—even when a saved destination token uses the
same host. No source token is requested or used, cookies are omitted, embedded URL
credentials are rejected, and redirects are not followed. Private or missing repositories
cannot be imported. Rate limits, timeouts and browser/CORS failures are reported; a server
being public does not guarantee it is reachable from this browser.

Initial inspection checks public source readability and known copy limits. After choosing
destinations, the details step checks the active owner's cached announcements and
repository/outbox relays for equivalent clone URLs (including supported SSH and `.git`
variants). Existing announcements are listed and require **Import anyway** to continue.
Changing or rechecking the source resets that consent. The wizard lists successful relay checks,
individual failures and any matches found. Incomplete relay reads require **Import anyway**
or a successful retry; they do not imply that no duplicate exists. Checks use bounded,
paginated reads and are repeated before execution.

The repository identifier (`d`-tag) is checked alongside the destination URLs in the details
step, and again before execution/publication. An existing announcement,
repository state or unresolved creation blocks reuse of that identifier. **Import anyway**
can acknowledge an incomplete relay check, but never bypasses a confirmed identifier clash:
choose a different identifier. Superseded name checks cancel their relay reads. Checks cover known and
queried relays; Nostr has no global atomic identifier reservation.

## Import and announce

1. Inspect the public source anonymously.
2. **Choose target remotes**: at least one writable destination is required. Hosted
   destinations require their own access token; the authenticated destination account is
   displayed and its token is kept selected through checks and execution. GRASP uses the
   Nostr signer and requires at least one selected server. Codeberg is a Forgejo target.
   Configured token hosts appear separately; unknown hosts require choosing their provider
   family in the target card for the current session.
3. Edit details and check availability. The destination account and resulting clone URL are
   shown for each target. Existing/occupied destinations are refused, including empty GRASP
   residue. **Import anyway** cannot bypass destination failures or confirmed identifier clashes.
4. Review the source, destinations and Nostr coordinate, then choose **Import and announce**.
   All advertised branches and tags are copied once; final metadata lists only verified
   destination copies. Availability and account identity are rechecked before creation.

There is no announcement-only option for new imports. No native forge fork or migration API,
force push, or automatic synchronization is used. Later synchronization remains manual.

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
a local Git client for larger/incompatible repositories. For an empty source, add a commit
on its host or choose **Brand new Repo**. Git LFS objects,
release assets, wiki repositories and submodule repositories are not separately transferred.

The advertised source snapshot must match both the complete local clone and a second source
probe before pushing. A changed/incomplete source fails rather than silently copying a subset.
GRASP admission acknowledgements and state visibility precede pushes; destination refs are
verified afterward. Final clone metadata includes only successfully verified destinations.
Partial target failures are reported explicitly. Incomplete destination receipts remain in
recovery even after the successful destinations have been announced and local cleanup finishes.
After repairing an incomplete destination externally, choose **Retry recovery**. It rechecks
every checkpointed branch/tag commit with a bounded read-only probe and clears the receipt
when all match. Empty/missing refs or an unavailable server do not establish cleanup. A
confirmed remote-deletion receipt also resolves the target. Definite creation rejections with
no remote or attempted ref writes are not treated as unresolved destinations.

Closing cancels pending work where possible, but signed events and remote writes may already
exist. Unknown worker outcomes and incomplete publication are recorded in repository recovery;
resume that record rather than starting another creation. Previously saved announcement-only recovery replays
the exact signed announcement without inventing a state event, including after a temporary relay
outage. Rejecting signing before any delivery releases the identifier for a fresh attempt;
unknown delivery outcomes retain their recovery record.
Copy rollback also retains signed provisional announcements when ACKs are lost. Each attempted
relay remains unresolved until a final replacement is acknowledged there or exact-event deletion
succeeds there; failed cleanup remains retryable with the saved signed event.

## Verification scope

Focused source/provider/worker/orchestration tests and isolated browser fixtures cover anonymous
reads without source credentials, mandatory destinations, independent-copy ref outcomes, source errors/staleness, metadata
edits, GRASP readiness, narrow/keyboard controls and owner changes. Browser publication and Git
writes are mocked. Codeberg public metadata/version reads were checked live; authenticated forge
writes and real GRASP provisioning were not exercised for this change. Offline/PWA behavior is
not part of this verification.
