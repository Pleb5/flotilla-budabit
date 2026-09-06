# Create a repository from GitHub

Use **Git → Import Repo**, or **New Repo → Create from GitHub**. Sign in with the Nostr account that should own the new repository.

1. Enter a public GitHub repository URL, a **new destination name**, and one GRASP service URL.
2. Optionally select issues/current status and conversation comments. A read-only GitHub token can increase the history API allowance; it stays only in the open dialog and must be entered again after reload.
3. Review the exact destination, branch/tag tips, exclusions, and public-side-effect warning. Nothing is published during review.
4. Approve and select **Create public repository**. GRASP must admit the announcement and state before Git can be pushed.
5. If stopped, reopen **Import Repo → Saved imports** under the same account. Use **Resume saved import**, not a fresh import into the same destination.

Once publication is attempted, cancellation cannot promise rollback. An announcement may remain even if the source clone fails. **Repository created** means the destination refs and metadata were verified; it does not mean all issue history arrived. You can open that repository while retaining a partial result, or choose **Keep repository; stop history**. Preserve this browser's site data for recovery.

## Scope and practical limits

- Public GitHub only; one new GRASP destination. No existing-repository augmentation or ongoing sync.
- At most 100 branch/tag refs, GitHub-reported size 50 MiB, and 64 MiB per Git HTTP body. Full reachable history is requested, not a silent shallow/top-five subset. Transfer caps do not guarantee peak heap; start with a small repository.
- At most 1,000 history events and 8 MiB signed history per job. An issue with its status consumes two events, plus one for each comment. Oversized events or source scans stop the history import instead of truncating it.
- PRs, private repositories, LFS objects, release assets, wikis, and submodule repositories are excluded. Native Git/agent-assisted migration is the escape hatch for unsupported jobs, not an atomic rollback mechanism.
- GitHub attribution is preserved, but Nostr events are signed by the importing owner. Originals are not given fabricated Nostr identities.
- Resume retries signed pending content exactly; unfinished source data is fetched again and may have changed. New items after the creation cutoff are not imported. This is not an immutable migration snapshot.

## Manual real-service acceptance

The automated tests use simulated Git/relay outcomes and real browser IndexedDB. Before relying on a large migration, test with a small disposable **public** source and a destination you are willing to publish permanently:

1. Run the full `pnpm dev` stack, not Vite alone; use one hostname consistently. The lane is enabled unless `FEATURE_IMPORT_REPO=0` is set. Restart the stack after changing that flag.
2. First import **Git only**. Include a second branch and an annotated tag in the source. Confirm the new repo opens, its default branch is correct, and `git ls-remote --heads --tags <destination>` matches the corresponding source refs. Ignore peeled `^{}` entries when counting refs.
3. Use another new destination with a few open/closed issues and comments. Confirm statuses, original-author/source labels, comment order, and the displayed confirmed counts.
4. Stop during history delivery. Confirm the repository remains usable. Close/reopen the dialog or reload and select the saved job. Verify no second Git push or duplicate issues/comments after Resume. Source edits during interruption may affect only unfinished items.
5. Deny a signer prompt or interrupt the relay connection. The UI must retain an unconfirmed pending event/partial result, not report rollback. Switching accounts must block continuation. Re-enter an optional API token after reopening; it must not appear in the saved job.
6. Try an existing name/destination, private source, unsupported forge, or too-large source. Expect refusal before publication. Try a history item exceeding 32 KiB and expect a retained partial result, not a truncated body.
7. If Git creation becomes **unknown**, inspect the destination and saved operation evidence. Do not force a retry or delete remote data to clear the message. Report the stage, source/destination URLs (without credentials), expected refs and error text.

No real-service signing, publishing or Git pushes were performed during implementation verification.

## Focused automated checks

```sh
pnpm --filter @nostr-git/core build
pnpm --filter @nostr-git/ui build
pnpm exec vitest run -c packages/nostr-git-ui/vitest.config.ts src/lib/utils/initial-import.test.ts src/lib/utils/initial-import-source.test.ts
pnpm exec playwright test --project=chromium tests/e2e/initial-repository-import.spec.ts
```

The retained browser regression includes a 250-page/500-event/25-retry heap check on an isolated fixture page. It tests collaboration working-set retention, not peak memory of a live Git pack. Detailed budgets and recovery contracts are in [the architecture](../architecture/import-repo-architecture.md).
