import type { WorkflowRun, WorkflowRunDetail } from './types';

export interface DetailSessionState {
  selectedRunId: string | null;
  selectedRunDetail: WorkflowRunDetail | null;
  detailError: string | null;
  detailLoading: boolean;
}

export function createClosedDetailSessionState(): DetailSessionState {
  return {
    selectedRunId: null,
    selectedRunDetail: null,
    detailError: null,
    detailLoading: false,
  };
}

export function createOpeningDetailSessionState(run: WorkflowRun): DetailSessionState {
  return {
    selectedRunId: run.id,
    selectedRunDetail: null,
    detailError: null,
    detailLoading: true,
  };
}

export function createOpenedDetailSessionState(
  detail: WorkflowRunDetail | null
): DetailSessionState {
  return {
    selectedRunId: detail?.run?.id || null,
    selectedRunDetail: detail,
    detailError: detail ? null : 'Run details were not found on the configured relays.',
    detailLoading: false,
  };
}

export function createDetailSessionErrorState(
  selectedRunId: string,
  detailError: string
): DetailSessionState {
  return {
    selectedRunId,
    selectedRunDetail: null,
    detailError,
    detailLoading: false,
  };
}

export function reconcileSelectedRunState(args: {
  workflowRuns: WorkflowRun[];
  selectedRunId: string | null;
  selectedRunDetail: WorkflowRunDetail | null;
}) {
  const { workflowRuns, selectedRunId, selectedRunDetail } = args;
  if (!selectedRunId) {
    return {
      selectedRunId,
      selectedRunDetail,
    };
  }

  const refreshed = workflowRuns.find((run) => run.id === selectedRunId);
  if (refreshed) {
    return {
      selectedRunId,
      selectedRunDetail,
    };
  }

  return {
    selectedRunId: null,
    selectedRunDetail: null,
  };
}
