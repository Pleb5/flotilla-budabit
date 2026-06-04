export interface ForkRollbackPlanInput {
  successfulTargetCount: number;
  hasPublishedRepoRollbackContext: boolean;
  hasRollbackPublishedRepoEvents: boolean;
  createdRemoteRepoCount: number;
  hasGitWorkerApi: boolean;
  hasRollbackLocalRepoId: boolean;
}

export interface ForkRollbackPlan {
  rollbackPublishedEvents: boolean;
  rollbackRemoteRepos: boolean;
  rollbackLocalRepo: boolean;
  hasAnyRollback: boolean;
}

export function getForkRollbackPlan(input: ForkRollbackPlanInput): ForkRollbackPlan {
  const isTotalFailure = input.successfulTargetCount === 0;

  const rollbackPublishedEvents =
    isTotalFailure && input.hasPublishedRepoRollbackContext && input.hasRollbackPublishedRepoEvents;

  const rollbackRemoteRepos = isTotalFailure && input.createdRemoteRepoCount > 0;

  const rollbackLocalRepo = isTotalFailure && input.hasGitWorkerApi && input.hasRollbackLocalRepoId;

  return {
    rollbackPublishedEvents,
    rollbackRemoteRepos,
    rollbackLocalRepo,
    hasAnyRollback: rollbackPublishedEvents || rollbackRemoteRepos || rollbackLocalRepo,
  };
}
