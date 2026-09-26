# Dependency patches

## isomorphic-git 1.37.2

`isomorphic-git@1.37.2.patch` adds checkout support for Git entry transitions
between submodules (`160000 commit`) and ordinary directories (`040000 tree`).
Without it, a browser clone cached before a repository vendors a submodule fails
with `update entry Unhandled type commit-tree`. Restoring the old checkout fails
with the reverse `tree-commit` error.

The patch updates both the CommonJS and ESM entry points. It removes the old
gitlink from the index before materializing directory children, and inserts a
gitlink after removing tracked directory children on the reverse transition.
Existing checkout conflict checks protect local files; untracked contents are
preserved. Both blocking and non-blocking checkout use the same operation plan.

Regression coverage lives in `packages/nostr-git-core/test/git/gitlink-checkout.spec.ts`
and `packages/nostr-git-core/test/worker/pr-merge-gitlinks.spec.ts`. Run these when
upgrading isomorphic-git, and remove the patch once upstream handles these
transitions. The worker tests exercise real Git objects and operations, with
only network fetching mocked.
