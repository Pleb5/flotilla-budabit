import { describe, expect, it } from "vitest";

import { deriveForkProgressPhases, getForkProgressPhaseId } from "./fork-progress";
import type { ForkProgress } from "../../hooks/useForkRepo.svelte";

describe("fork-progress", () => {
  it("groups clone attempt updates under the fork phase", () => {
    const progress: ForkProgress[] = [
      { step: "validate", message: "GitHub token validated", status: "completed" },
      { step: "user", message: "Current user: alice", status: "completed" },
      {
        step: "clone-source-url-1",
        message: "Clone URL 1/2: relay.example/repo.git",
        status: "running",
      },
    ];

    const phases = deriveForkProgressPhases(progress);
    const forkPhase = phases.find((phase) => phase.id === "fork");

    expect(getForkProgressPhaseId("clone-source-url-1")).toBe("fork");
    expect(forkPhase?.status).toBe("active");
    expect(forkPhase?.detail).toContain("Clone URL 1/2");
  });

  it("collapses publish-related steps into one publish phase", () => {
    const progress: ForkProgress[] = [
      { step: "events", message: "Nostr events created successfully", status: "completed" },
      {
        step: "publish-announcement",
        message: "Published GRASP announcement event",
        status: "completed",
      },
      {
        step: "preflight",
        message: "Preflight complete: relay reports provisioning signal",
        status: "completed",
      },
      {
        step: "push",
        message: "Pushing branch main (1/3)...",
        status: "running",
      },
    ];

    const phases = deriveForkProgressPhases(progress);
    const publishPhase = phases.find((phase) => phase.id === "publish");

    expect(publishPhase?.status).toBe("active");
    expect(publishPhase?.steps.map((step) => step.step)).toEqual([
      "publish-announcement",
      "preflight",
      "push",
    ]);
    expect(publishPhase?.detail).toBe("Pushing branch main (1/3)...");
  });

  it("surfaces rollback as an error phase when rollback fails", () => {
    const phases = deriveForkProgressPhases([
      {
        step: "rollback",
        message: "Rollback failed: relay rejected delete",
        status: "error",
        error: "relay rejected delete",
      },
    ]);

    const rollbackPhase = phases.find((phase) => phase.id === "rollback");

    expect(rollbackPhase?.status).toBe("error");
    expect(rollbackPhase?.detail).toContain("Rollback failed");
  });
});
