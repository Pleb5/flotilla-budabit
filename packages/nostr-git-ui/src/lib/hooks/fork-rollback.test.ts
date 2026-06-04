import { describe, expect, it } from "vitest";

import { getForkRollbackPlan } from "./fork-rollback";

describe("fork rollback policy", () => {
  it("rolls back published events, created remotes, and local mirror on total failure", () => {
    const plan = getForkRollbackPlan({
      successfulTargetCount: 0,
      hasPublishedRepoRollbackContext: true,
      hasRollbackPublishedRepoEvents: true,
      createdRemoteRepoCount: 2,
      hasGitWorkerApi: true,
      hasRollbackLocalRepoId: true,
    });

    expect(plan).toEqual({
      rollbackPublishedEvents: true,
      rollbackRemoteRepos: true,
      rollbackLocalRepo: true,
      hasAnyRollback: true,
    });
  });

  it("skips remote rollback when no new remotes were created", () => {
    const plan = getForkRollbackPlan({
      successfulTargetCount: 0,
      hasPublishedRepoRollbackContext: true,
      hasRollbackPublishedRepoEvents: true,
      createdRemoteRepoCount: 0,
      hasGitWorkerApi: true,
      hasRollbackLocalRepoId: true,
    });

    expect(plan).toEqual({
      rollbackPublishedEvents: true,
      rollbackRemoteRepos: false,
      rollbackLocalRepo: true,
      hasAnyRollback: true,
    });
  });

  it("does not roll back after at least one target succeeds", () => {
    const plan = getForkRollbackPlan({
      successfulTargetCount: 1,
      hasPublishedRepoRollbackContext: true,
      hasRollbackPublishedRepoEvents: true,
      createdRemoteRepoCount: 3,
      hasGitWorkerApi: true,
      hasRollbackLocalRepoId: true,
    });

    expect(plan).toEqual({
      rollbackPublishedEvents: false,
      rollbackRemoteRepos: false,
      rollbackLocalRepo: false,
      hasAnyRollback: false,
    });
  });
});
