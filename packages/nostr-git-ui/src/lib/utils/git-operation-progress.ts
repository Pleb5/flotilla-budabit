import type { GitOperationProgressEvent, GitProgressUnit } from "@nostr-git/core";

export type GitProgressListener = (event: GitOperationProgressEvent) => void;
export type SubscribeGitProgress = (listener: GitProgressListener) => () => void;

export interface GitOperationActivity {
  operationId: string;
  operation: GitOperationProgressEvent["operation"];
  phase: string;
  current?: number;
  total?: number;
  unit?: GitProgressUnit;
  target?: string;
  ref?: string;
  startedAt: number;
  updatedAt: number;
}

export function createGitOperationId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${suffix}`;
}

export function toGitOperationActivity(
  event: GitOperationProgressEvent,
  previous?: GitOperationActivity
): GitOperationActivity {
  const now = Date.now();
  const hasDeterminateCount =
    typeof event.loaded === "number" && typeof event.total === "number" && event.total > 0;

  return {
    operationId: event.operationId,
    operation: event.operation,
    phase: event.phase,
    ...(hasDeterminateCount ? { current: event.loaded, total: event.total } : {}),
    ...(event.unit ? { unit: event.unit } : {}),
    ...(event.target ? { target: event.target } : {}),
    ...(event.ref ? { ref: event.ref } : {}),
    startedAt: previous?.operationId === event.operationId ? previous.startedAt : now,
    updatedAt: now,
  };
}

export function createGitOperationProgressObserver(
  operationId: string,
  onActivity: (activity: GitOperationActivity) => void
): GitProgressListener {
  let previous: GitOperationActivity | undefined;
  return (event) => {
    if (event.operationId !== operationId && !event.operationId.startsWith(`${operationId}:`)) {
      return;
    }
    previous = toGitOperationActivity({ ...event, operationId }, previous);
    onActivity(previous);
  };
}

export function formatGitProgressCount(activity: GitOperationActivity): string | undefined {
  if (activity.current == null || activity.total == null || activity.total <= 0) return undefined;
  const unit = activity.unit ? ` ${activity.unit}` : "";
  return `${activity.current}/${activity.total}${unit}`;
}
