import { describe, expect, it, vi } from "vitest";

import {
  createGitOperationId,
  createGitOperationProgressObserver,
  formatGitProgressCount,
  toGitOperationActivity,
} from "./git-operation-progress.js";

describe("git operation progress", () => {
  it("keeps real counts determinate", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const activity = toGitOperationActivity({
      type: "git-progress",
      operationId: "import:1",
      repoId: "owner/repo",
      operation: "clone",
      phase: "Receiving objects",
      loaded: 42,
      total: 100,
      unit: "objects",
    });

    expect(activity).toMatchObject({ current: 42, total: 100, unit: "objects", startedAt: 100 });
    expect(formatGitProgressCount(activity)).toBe("42/100 objects");
  });

  it("does not turn an unknown or zero denominator into determinate progress", () => {
    const withoutTotal = toGitOperationActivity({
      type: "git-progress",
      operationId: "fork:1",
      repoId: "owner/repo",
      operation: "push",
      phase: "Pushing ref",
      loaded: 1,
      unit: "refs",
    });
    const zeroTotal = toGitOperationActivity({
      type: "git-progress",
      operationId: "fork:1",
      repoId: "owner/repo",
      operation: "push",
      phase: "Pushing ref",
      loaded: 0,
      total: 0,
      unit: "refs",
    });

    expect(withoutTotal.current).toBeUndefined();
    expect(withoutTotal.total).toBeUndefined();
    expect(zeroTotal.current).toBeUndefined();
    expect(formatGitProgressCount(zeroTotal)).toBeUndefined();
  });

  it("preserves the start time across events for one operation", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(250);
    const first = toGitOperationActivity({
      type: "git-progress",
      operationId: "new:1",
      repoId: "owner/repo",
      operation: "remote-sync",
      phase: "Syncing targets",
      loaded: 0,
      total: 2,
      unit: "targets",
    });
    const second = toGitOperationActivity(
      {
        type: "git-progress",
        operationId: "new:1",
        repoId: "owner/repo",
        operation: "remote-sync",
        phase: "Target complete",
        loaded: 1,
        total: 2,
        unit: "targets",
      },
      first
    );

    expect(second.startedAt).toBe(100);
    expect(second.updatedAt).toBe(250);
  });

  it("creates operation IDs with a caller prefix", () => {
    expect(createGitOperationId("import")).toMatch(/^import:/);
  });

  it("filters unrelated operations and keeps observer state", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(10).mockReturnValueOnce(20);
    const onActivity = vi.fn();
    const observe = createGitOperationProgressObserver("import:1", onActivity);

    observe({
      type: "git-progress",
      operationId: "fork:2",
      repoId: "owner/repo",
      operation: "clone",
      phase: "Receiving objects",
      loaded: 1,
      total: 2,
    });
    observe({
      type: "git-progress",
      operationId: "import:1",
      repoId: "owner/repo",
      operation: "clone",
      phase: "Receiving objects",
      loaded: 1,
      total: 2,
    });
    observe({
      type: "git-progress",
      operationId: "import:1",
      repoId: "owner/repo",
      operation: "clone",
      phase: "Resolving deltas",
      loaded: 2,
      total: 2,
    });

    expect(onActivity).toHaveBeenCalledTimes(2);
    expect(onActivity.mock.calls[1][0]).toMatchObject({ startedAt: 10, updatedAt: 20 });
  });
});
